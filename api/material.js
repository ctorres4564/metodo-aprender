/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — API consolidada da Biblioteca de Materiais
   (Etapa 1).
   =====================================================================
   Motivo da consolidação: o plano Hobby da Vercel aceita no máximo 12
   Serverless Functions por projeto. As quatro rotas que existiam antes
   (api/material-criar.js, api/material-atualizar-status.js,
   api/material-registrar-modulo.js, api/material-excluir.js) foram
   fundidas neste único arquivo, despachando por um campo `action` no
   corpo da requisição. Cada handler abaixo preserva integralmente a
   lógica original — autenticação, validação, autorização, idempotência,
   regras de negócio, tratamento de erros e respostas HTTP — só a forma
   de roteamento mudou (era por URL, agora é por `action`).

   Recebe sempre: { action: "create"|"updateStatus"|"registerModule"|"delete", ...demais campos por ação }

   action "create"         → cria o documento inicial de um material.
     Recebe: { sourceType, title, originalFileName, mimeType, fileSize }
     Retorna: { materialId }

   action "updateStatus"   → atualiza status e metadados de processamento.
     Recebe: { materialId, status, storagePath?, pageCount?, extractionMethod?,
               usedOcr?, ocrPageCount?, ocrLimitReached?, processingError? }
     Retorna: { ok: true }

   action "registerModule" → incrementa generatedModuleCount atomicamente.
     Recebe: { materialId }
     Retorna: { ok: true, generatedModuleCount }

   action "delete"         → exclui PDF (Storage) + páginas (subcoleção) +
                              documento principal. Idempotente.
     Recebe: { materialId }
     Retorna: { ok: true }
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb, adminStorage } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { MATERIAL_LIMITS } from "./_lib/materialLimits.js";

const SCHEMA_VERSION = 1;
const ALLOWED_STATUSES = ["processing", "ready", "failed"];
const PAGE_DELETE_BATCH_SIZE = 400; // margem de segurança abaixo do limite de 500 por batch do Firestore

/* ---- action: create ----------------------------------------------- */
async function handleCreate(req, res, user) {
  const { sourceType, title, originalFileName, mimeType, fileSize } = req.body || {};

  if (sourceType !== "pdf" && sourceType !== "text") {
    res.status(400).json({ error: "sourceType inválido (use 'pdf' ou 'text')." });
    return;
  }
  if (!title || typeof title !== "string" || !title.trim()) {
    res.status(400).json({ error: "Informe um título para o material." });
    return;
  }
  if (sourceType === "pdf" && typeof fileSize === "number" && fileSize > MATERIAL_LIMITS.maxPdfSizeBytes) {
    res.status(400).json({ error: `Arquivo maior que o limite permitido (${Math.round(MATERIAL_LIMITS.maxPdfSizeBytes / 1024 / 1024)} MB).` });
    return;
  }

  try {
    const now = Date.now();
    const ref = adminDb().collection("materials").doc();
    const data = {
      ownerId: user.uid,
      sourceType,
      title: String(title).trim().slice(0, 200),
      originalFileName: sourceType === "pdf" ? String(originalFileName || "").slice(0, 200) : null,
      storagePath: null,
      mimeType: sourceType === "pdf" ? (mimeType || "application/pdf") : null,
      fileSize: sourceType === "pdf" ? (typeof fileSize === "number" ? fileSize : null) : null,
      pageCount: 0,
      status: "uploading",
      extractionMethod: null,
      usedOcr: false,
      ocrPageCount: 0,
      ocrLimitReached: false,
      createdAt: now,
      updatedAt: now,
      processedAt: null,
      processingError: null,
      generatedModuleCount: 0,
      schemaVersion: SCHEMA_VERSION
    };
    await ref.set(data);

    res.status(200).json({ materialId: ref.id });
  } catch (e) {
    console.error("Erro ao criar material:", e);
    res.status(500).json({ error: "Não foi possível iniciar o material agora." });
  }
}

/* ---- action: updateStatus ------------------------------------------ */
async function handleUpdateStatus(req, res, user) {
  const body = req.body || {};
  const { materialId, status } = body;

  if (!materialId || typeof materialId !== "string") {
    res.status(400).json({ error: "materialId é obrigatório." });
    return;
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    res.status(400).json({ error: "status inválido." });
    return;
  }

  try {
    const ref = adminDb().collection("materials").doc(materialId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Material não encontrado." });
      return;
    }
    if (snap.data().ownerId !== user.uid) {
      res.status(403).json({ error: "Você não tem permissão para alterar este material." });
      return;
    }

    const update = { status, updatedAt: Date.now() };

    if (typeof body.storagePath === "string") update.storagePath = body.storagePath.slice(0, 500);
    if (typeof body.pageCount === "number") update.pageCount = Math.max(0, Math.round(body.pageCount));
    if (typeof body.extractionMethod === "string") update.extractionMethod = body.extractionMethod.slice(0, 40);
    if (typeof body.usedOcr === "boolean") update.usedOcr = body.usedOcr;
    if (typeof body.ocrPageCount === "number") update.ocrPageCount = Math.max(0, Math.round(body.ocrPageCount));
    if (typeof body.ocrLimitReached === "boolean") update.ocrLimitReached = body.ocrLimitReached;

    if (status === "ready" || status === "failed") {
      update.processedAt = Date.now();
    }
    if (status === "failed") {
      update.processingError = typeof body.processingError === "string"
        ? body.processingError.slice(0, 500)
        : "Falha desconhecida ao processar o material.";
    } else {
      update.processingError = null;
    }

    await ref.update(update);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao atualizar status do material:", e);
    res.status(500).json({ error: "Não foi possível atualizar o material agora." });
  }
}

/* ---- action: registerModule ----------------------------------------- */
async function handleRegisterModule(req, res, user) {
  const { materialId } = req.body || {};
  if (!materialId || typeof materialId !== "string") {
    res.status(400).json({ error: "materialId é obrigatório." });
    return;
  }

  try {
    const ref = adminDb().collection("materials").doc(materialId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: "Material não encontrado." });
      return;
    }
    if (snap.data().ownerId !== user.uid) {
      res.status(403).json({ error: "Você não tem permissão para alterar este material." });
      return;
    }

    await ref.update({
      generatedModuleCount: FieldValue.increment(1),
      updatedAt: Date.now()
    });

    const updated = await ref.get();
    res.status(200).json({ ok: true, generatedModuleCount: updated.data().generatedModuleCount });
  } catch (e) {
    console.error("Erro ao registrar módulo gerado no material:", e);
    res.status(500).json({ error: "Não foi possível atualizar o contador do material agora." });
  }
}

/* ---- action: delete -------------------------------------------------- */
async function deleteAllPages(materialRef) {
  const pagesRef = materialRef.collection("pages");
  // Repete em lotes até a subcoleção ficar vazia — assim funciona tanto
  // pra materiais com poucas páginas quanto pra livros de 600+ páginas,
  // e também retoma corretamente se uma tentativa anterior parou no meio.
  while (true) {
    const snap = await pagesRef.limit(PAGE_DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = adminDb().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < PAGE_DELETE_BATCH_SIZE) break;
  }
}

async function handleDelete(req, res, user) {
  const { materialId } = req.body || {};
  if (!materialId || typeof materialId !== "string") {
    res.status(400).json({ error: "materialId é obrigatório." });
    return;
  }

  try {
    const ref = adminDb().collection("materials").doc(materialId);
    const snap = await ref.get();

    if (!snap.exists) {
      // Já foi excluído numa tentativa anterior — sucesso idempotente, nada a fazer.
      res.status(200).json({ ok: true });
      return;
    }
    if (snap.data().ownerId !== user.uid) {
      res.status(403).json({ error: "Você não tem permissão para excluir este material." });
      return;
    }

    await ref.update({ status: "deleting", updatedAt: Date.now() });

    const storagePath = snap.data().storagePath;
    if (storagePath) {
      try {
        await adminStorage().file(storagePath).delete({ ignoreNotFound: true });
      } catch (e) {
        console.error("Falha ao excluir PDF do Storage (continuando mesmo assim):", e.message);
      }
    }

    await deleteAllPages(ref);
    await ref.delete();

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao excluir material:", e);
    res.status(500).json({ error: "Não foi possível excluir o material agora. Tente novamente." });
  }
}

/* ---- roteador --------------------------------------------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
    return;
  }

  const { action } = req.body || {};

  switch (action) {
    case "create":
      return handleCreate(req, res, user);
    case "updateStatus":
      return handleUpdateStatus(req, res, user);
    case "registerModule":
      return handleRegisterModule(req, res, user);
    case "delete":
      return handleDelete(req, res, user);
    default:
      res.status(400).json({ error: "action inválida (use 'create', 'updateStatus', 'registerModule' ou 'delete')." });
  }
}
