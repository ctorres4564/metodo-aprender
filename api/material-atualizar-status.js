/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — atualiza o status e os metadados de
   processamento de um material da Biblioteca (Etapa 1).
   =====================================================================
   Recebe: {
     materialId,
     status: "processing" | "ready" | "failed",
     storagePath, pageCount, extractionMethod, usedOcr, ocrPageCount,
     ocrLimitReached,   // todos opcionais, conforme a transição
     processingError    // só aceito quando status === "failed"
   }
   Retorna: { ok: true }

   A extração do PDF/OCR acontece no navegador (não há mudança nisso
   nesta etapa) — mas o REGISTRO do resultado no Firestore passa sempre
   por aqui, nunca por escrita direta do cliente. Isso mantém os campos
   administrativos do material (status, processingError, processedAt)
   fora do alcance de manipulação direta pelo navegador, mesmo que os
   DADOS em si venham do que o navegador processou.
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb } from "./_lib/firebaseAdmin.js";

const ALLOWED_STATUSES = ["processing", "ready", "failed"];

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
