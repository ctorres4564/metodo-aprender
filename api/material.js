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

   action "registerModule" → registra o módulo salvo e incrementa o contador
                              uma única vez, mesmo se a chamada for repetida.
     Recebe: { materialId, moduleId }
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
import { MATERIAL_LIMITS } from "./_lib/materialLimits.js";
import { withSentry } from "./_lib/sentry.js";

// Materiais que ainda contam pra cota (exclui "failed" — upload que não deu
// certo não deveria ocupar vaga pra sempre — e "deleting", que já está a
// caminho de sumir).
const ACTIVE_MATERIAL_STATUSES = ["uploading", "processing", "ready"];

const SCHEMA_VERSION = 1;
const ALLOWED_STATUSES = ["processing", "ready", "failed"];
const PAGE_DELETE_BATCH_SIZE = 400; // margem de segurança abaixo do limite de 500 por batch do Firestore

class MaterialLimitError extends Error {
  constructor(current, limit, plan) {
    super("Limite de materiais atingido.");
    this.current = current;
    this.limit = limit;
    this.plan = plan;
  }
}

async function activeMaterialCount(uid) {
  const snap = await adminDb().collection("materials").where("ownerId", "==", uid).get();
  return snap.docs.filter((d) => ACTIVE_MATERIAL_STATUSES.includes(d.data().status)).length;
}

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
    const db = adminDb();
    const plan = await getUserPlan(user.uid);
    const maxMaterials = MATERIAL_LIMITS.maxMaterialsPerPlan[plan] || MATERIAL_LIMITS.maxMaterialsPerPlan.free;
    // Contagem inicial só é usada para migrar perfis antigos. Todas as
    // reservas posteriores disputam o mesmo users/{uid} em transação.
    const initialCount = await activeMaterialCount(user.uid);
    const now = Date.now();
    const ref = db.collection("materials").doc();
    const userRef = db.collection("users").doc(user.uid);
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
    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const storedCount = userSnap.exists ? userSnap.data().activeMaterialCount : undefined;
      const current = Number.isInteger(storedCount) && storedCount >= 0 ? storedCount : initialCount;
      if (current >= maxMaterials) throw new MaterialLimitError(current, maxMaterials, plan);
      tx.set(userRef, { activeMaterialCount: current + 1 }, { merge: true });
      tx.create(ref, data);
    });

    res.status(200).json({ materialId: ref.id });
  } catch (e) {
    if (e instanceof MaterialLimitError) {
      res.status(429).json({
        error: `Limite de materiais na Biblioteca atingido (${e.current}/${e.limit} no plano ${e.plan}). Exclua um material existente ou assine o Premium para aumentar o limite.`
      });
      return;
    }
    console.error("Erro ao criar material:", e);
    res.status(503).json({ error: "Não foi possível confirmar sua cota de materiais agora. Tente novamente em instantes." });
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

    const wasActive = ACTIVE_MATERIAL_STATUSES.includes(snap.data().status);
    const willBeActive = ACTIVE_MATERIAL_STATUSES.includes(status);
    if (wasActive !== willBeActive) {
      const db = adminDb();
      const userRef = db.collection("users").doc(user.uid);
      const plan = willBeActive ? await getUserPlan(user.uid) : null;
      const maxMaterials = willBeActive
        ? (MATERIAL_LIMITS.maxMaterialsPerPlan[plan] || MATERIAL_LIMITS.maxMaterialsPerPlan.free)
        : null;
      const initialCount = await activeMaterialCount(user.uid);
      await db.runTransaction(async (tx) => {
        const [freshMaterial, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
        if (!freshMaterial.exists || freshMaterial.data().ownerId !== user.uid) {
          throw new Error("Material ausente ou sem permissão durante a atualização.");
        }
        const current = userSnap.exists && Number.isInteger(userSnap.data().activeMaterialCount)
          ? userSnap.data().activeMaterialCount
          : initialCount;
        if (willBeActive && current >= maxMaterials) {
          throw new MaterialLimitError(current, maxMaterials, plan);
        }
        tx.update(ref, update);
        tx.set(userRef, { activeMaterialCount: Math.max(0, current + (willBeActive ? 1 : -1)) }, { merge: true });
      });
    } else {
      await ref.update(update);
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    if (e instanceof MaterialLimitError) {
      res.status(429).json({ error: `Limite de materiais na Biblioteca atingido (${e.current}/${e.limit} no plano ${e.plan}).` });
      return;
    }
    console.error("Erro ao atualizar status do material:", e);
    res.status(500).json({ error: "Não foi possível atualizar o material agora." });
  }
}

/* ---- action: registerModule ----------------------------------------- */
async function handleRegisterModule(req, res, user) {
  const { materialId, moduleId } = req.body || {};
  if (!materialId || typeof materialId !== "string" || !moduleId || typeof moduleId !== "string") {
    res.status(400).json({ error: "materialId e moduleId são obrigatórios." });
    return;
  }

  try {
    const db = adminDb();
    const ref = db.collection("materials").doc(materialId);
    const moduleRef = db.collection("modules").doc(moduleId);
    const markerRef = ref.collection("generatedModules").doc(moduleId);
    const result = await db.runTransaction(async (tx) => {
      const [materialSnap, moduleSnap, markerSnap] = await Promise.all([
        tx.get(ref), tx.get(moduleRef), tx.get(markerRef)
      ]);
      if (!materialSnap.exists) return { error: "not_found" };
      if (materialSnap.data().ownerId !== user.uid) return { error: "forbidden" };
      if (!moduleSnap.exists || moduleSnap.data().ownerId !== user.uid || moduleSnap.data().sourceMaterialId !== materialId) {
        return { error: "invalid_module" };
      }
      const current = Math.max(0, Number(materialSnap.data().generatedModuleCount) || 0);
      if (markerSnap.exists) return { count: current, alreadyRegistered: true };
      tx.create(markerRef, { moduleId, ownerId: user.uid, createdAt: Date.now() });
      tx.update(ref, { generatedModuleCount: current + 1, updatedAt: Date.now() });
      return { count: current + 1, alreadyRegistered: false };
    });
    if (result.error === "not_found") return res.status(404).json({ error: "Material não encontrado." });
    if (result.error === "forbidden") return res.status(403).json({ error: "Você não tem permissão para alterar este material." });
    if (result.error === "invalid_module") return res.status(400).json({ error: "O módulo informado não pertence a este material." });
    res.status(200).json({ ok: true, generatedModuleCount: result.count, alreadyRegistered: result.alreadyRegistered });
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
  await deleteSubcollection(materialRef.collection("generatedModules"));
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

    const db = adminDb();
    const userRef = db.collection("users").doc(user.uid);
    const initialCount = await activeMaterialCount(user.uid);
    await db.runTransaction(async (tx) => {
      const [freshMaterial, userSnap] = await Promise.all([tx.get(ref), tx.get(userRef)]);
      if (!freshMaterial.exists || freshMaterial.data().ownerId !== user.uid) {
        throw new Error("Material ausente ou sem permissão durante a exclusão.");
      }
      tx.update(ref, { status: "deleting", updatedAt: Date.now() });
      if (ACTIVE_MATERIAL_STATUSES.includes(freshMaterial.data().status)) {
        const current = userSnap.exists && Number.isInteger(userSnap.data().activeMaterialCount)
          ? userSnap.data().activeMaterialCount
          : initialCount;
        tx.set(userRef, { activeMaterialCount: Math.max(0, current - 1) }, { merge: true });
      }
    });

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
