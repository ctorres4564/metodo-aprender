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

   Recebe sempre: { action: "create"|"updateStatus"|"registerModule"|"recordRead"|"delete", ...demais campos por ação }

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

   action "recordRead"     → histórico de leitura (Etapa 2): registra que o
                              dono do material abriu/leu uma página agora.
     Recebe: { materialId, page? }
     Retorna: { ok: true }

   action "delete"         → exclui PDF (Storage) + páginas (subcoleção) +
                              documento principal. Idempotente.
     Recebe: { materialId }
     Retorna: { ok: true }
   ===================================================================== */

import { verifyUserFromRequest, getUserPlan } from "./_lib/usage.js";
import { adminDb, adminStorage } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { MATERIAL_LIMITS } from "./_lib/materialLimits.js";
import { withSentry } from "./_lib/sentry.js";

// Materiais que ainda contam pra cota (exclui "failed" — upload que não deu
// certo não deveria ocupar vaga pra sempre — e "deleting", que já está a
// caminho de sumir).
const ACTIVE_MATERIAL_STATUSES = ["uploading", "processing", "ready"];

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

  // Bloqueador de monetização: limite de materiais na Biblioteca por plano
  // (antes disso, free e premium tinham o mesmo limite — nenhum — de PDFs
  // guardados, cada um podendo chegar a 50 MB). Busca só por ownerId (sem
  // combinar com outro where na mesma consulta) de propósito — evita
  // depender de um índice composto no Firestore, mesmo padrão já usado no
  // resto deste projeto; o filtro por status é feito aqui em memória.
  try {
    const plan = await getUserPlan(user.uid);
    const maxMaterials = MATERIAL_LIMITS.maxMaterialsPerPlan[plan] || MATERIAL_LIMITS.maxMaterialsPerPlan.free;
    const existingSnap = await adminDb().collection("materials").where("ownerId", "==", user.uid).get();
    const activeCount = existingSnap.docs.filter(d => ACTIVE_MATERIAL_STATUSES.includes(d.data().status)).length;
    if (activeCount >= maxMaterials) {
      res.status(429).json({
        error: `Limite de materiais na Biblioteca atingido (${activeCount}/${maxMaterials} no plano ${plan}). Exclua um material existente ou assine o Premium para aumentar o limite.`
      });
      return;
    }
  } catch (e) {
    console.error("Falha ao checar limite de materiais (permitindo a criação, pra não travar o app por causa disso):", e.message);
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

    // SEGURANÇA (SEC-01): o storagePath só pode apontar para a pasta do
    // próprio usuário e deste material. Ele é usado depois pelo delete via
    // Admin SDK, que IGNORA as regras do Storage — sem este filtro, seria
    // possível apagar arquivos de outras pessoas.
    if (typeof body.storagePath === "string") {
      const expectedPrefix = `users/${user.uid}/materials/${materialId}/`;
      if (!body.storagePath.startsWith(expectedPrefix)) {
        res.status(400).json({ error: "storagePath inválido para este material." });
        return;
      }
      update.storagePath = body.storagePath.slice(0, 500);
    }
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

/* ---- action: recordRead ------------------------------------------------
   Histórico de leitura (Etapa 2). Escreve lastOpenedAt sempre, e
   lastPageRead só quando um número de página válido é enviado (o cliente
   já valida isso, mas revalidamos aqui já que é o servidor quem decide o
   que é persistido). Chamada com debounce pelo leitor (ver
   leitor.html:scheduleRecordRead) — não é crítica, então erros aqui nunca
   devem impedir a leitura em si. */
async function handleRecordRead(req, res, user) {
  const { materialId, page } = req.body || {};
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

    const update = { lastOpenedAt: Date.now() };
    if (typeof page === "number" && Number.isFinite(page)) {
      const roundedPage = Math.round(page);
      const maxPage = typeof snap.data().pageCount === "number" && snap.data().pageCount > 0
        ? snap.data().pageCount
        : Infinity;
      if (roundedPage > 0 && roundedPage <= maxPage) {
        update.lastPageRead = roundedPage;
      }
    }

    await ref.update(update);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao registrar leitura do material:", e);
    res.status(500).json({ error: "Não foi possível registrar a leitura agora." });
  }
}

/* ---- action: delete -------------------------------------------------- */
// Repete em lotes até a subcoleção ficar vazia — assim funciona tanto pra
// materiais com poucas páginas/destaques/anotações quanto pra livros
// grandes, e também retoma corretamente se uma tentativa anterior parou
// no meio.
async function deleteSubcollection(collectionRef) {
  while (true) {
    const snap = await collectionRef.limit(PAGE_DELETE_BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = adminDb().batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < PAGE_DELETE_BATCH_SIZE) break;
  }
}

// SEGURANÇA/DADOS (A1-02): excluir só "pages" deixava "highlights" e
// "notes" (leitor de PDF, Etapa 2/3) órfãos no Firestore — nunca mais
// acessíveis por nenhuma tela do app, mas continuavam existindo e sendo
// contados/lidos indevidamente. As três subcoleções pertencem ao mesmo
// material e precisam ser removidas juntas (mesmo conjunto já usado em
// api/account.js para exclusão de conta).
async function deleteMaterialSubcollections(materialRef) {
  await deleteSubcollection(materialRef.collection("pages"));
  await deleteSubcollection(materialRef.collection("highlights"));
  await deleteSubcollection(materialRef.collection("notes"));
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

    // SEGURANÇA (SEC-01): não confia no storagePath persistido — ele veio do
    // cliente em algum momento e o Admin SDK ignora as regras do Storage.
    // O caminho padrão é determinístico; um path persistido diferente só é
    // aceito se estiver dentro do prefixo users/{uid}/materials/{materialId}/
    // (compatibilidade com documentos antigos com nomes fora do padrão).
    const expectedPrefix = `users/${user.uid}/materials/${materialId}/`;
    const pathsToDelete = new Set([`${expectedPrefix}original.pdf`]);
    const storedPath = snap.data().storagePath;
    if (typeof storedPath === "string" && storedPath.startsWith(expectedPrefix)) {
      pathsToDelete.add(storedPath);
    }
    for (const p of pathsToDelete) {
      try {
        await adminStorage().file(p).delete({ ignoreNotFound: true });
      } catch (e) {
        console.error("Falha ao excluir PDF do Storage (continuando mesmo assim):", e.message);
      }
    }

    await deleteMaterialSubcollections(ref);
    await ref.delete();

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao excluir material:", e);
    res.status(500).json({ error: "Não foi possível excluir o material agora. Tente novamente." });
  }
}

/* ---- roteador --------------------------------------------------------- */
async function handler(req, res) {
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
    case "recordRead":
      return handleRecordRead(req, res, user);
    case "delete":
      return handleDelete(req, res, user);
    default:
      res.status(400).json({ error: "action inválida (use 'create', 'updateStatus', 'registerModule', 'recordRead' ou 'delete')." });
  }
}

export default withSentry(handler);
