/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — cria o documento inicial de um material
   na Biblioteca (Etapa 1).
   =====================================================================
   Recebe: { sourceType: "pdf"|"text", title, originalFileName, mimeType, fileSize }
   Retorna: { materialId }

   Todas as escritas no documento materials/{materialId} passam por aqui
   ou pelos outros endpoints material-*.js — o cliente nunca escreve
   diretamente nesse documento (ver firestore.rules.txt: só leitura para
   o dono). Isso evita que alguém manipule campos administrativos
   (status, generatedModuleCount etc.) direto pelo navegador.
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb } from "./_lib/firebaseAdmin.js";
import { MATERIAL_LIMITS } from "./_lib/materialLimits.js";

const SCHEMA_VERSION = 1;

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
