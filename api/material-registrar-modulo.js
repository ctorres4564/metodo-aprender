/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — incrementa generatedModuleCount de um
   material, de forma atômica, depois que um módulo é salvo com sucesso.
   =====================================================================
   Recebe: { materialId }
   Retorna: { ok: true, generatedModuleCount }

   Chamado pelo cliente (importar-livro.html) logo após
   window.AppDB.saveUserModule(...) ter sucesso. O incremento em si usa
   FieldValue.increment (atômico no Firestore) via Admin SDK — o cliente
   nunca escreve esse campo diretamente (as regras do Firestore negam
   qualquer escrita direta em materials/{id} pelo navegador).
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";

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
