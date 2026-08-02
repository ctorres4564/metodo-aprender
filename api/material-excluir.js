/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — exclui um material da Biblioteca por
   completo (Etapa 1): PDF original (Storage), todas as páginas
   (subcoleção materials/{id}/pages) e o documento principal.
   =====================================================================
   Recebe: { materialId }
   Retorna: { ok: true }

   NÃO exclui os módulos já gerados a partir desse material — eles
   continuam existindo normalmente em "modules", só perdem a referência
   viva ao material de origem (o campo sourceMaterialId no módulo passa
   a apontar para um material que não existe mais, o que é aceitável:
   é só um metadado histórico, não uma dependência funcional).

   Idempotente: pode ser chamado de novo com segurança se uma tentativa
   anterior falhar no meio do caminho — cada etapa verifica o que ainda
   existe antes de agir, então repetir a chamada só termina o que faltou.
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb, adminStorage } from "./_lib/firebaseAdmin.js";

const PAGE_DELETE_BATCH_SIZE = 400; // margem de segurança abaixo do limite de 500 por batch do Firestore

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
