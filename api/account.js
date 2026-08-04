/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — exclusão de conta.
   =====================================================================
   Bloqueador de monetização: a LGPD garante à pessoa titular dos dados o
   direito de solicitar a eliminação deles a qualquer momento. Até agora
   não existia nenhum jeito de excluir a própria conta — só materiais e
   módulos individualmente.

   Recebe: { action: "delete" }
   Retorna: { ok: true }

   Ordem da exclusão (importante): todos os DADOS primeiro, a conta de
   login (Firebase Authentication) por último. Se algo falhar no meio do
   caminho, é melhor a pessoa ainda conseguir logar e tentar de novo do
   que perder o acesso à própria conta com dados órfãos ainda salvos.

   Usa o Admin SDK (contorna as regras do Firestore, que não permitem ao
   cliente apagar em massa os dados de outras coleções) — só pode ser
   chamado pela própria pessoa dona da conta, dona do token de login
   verificado em verifyUserFromRequest. Não recebe nenhum id de usuário
   no corpo da requisição de propósito — sempre age sobre quem está
   logado(a), nunca sobre um uid arbitrário informado pelo cliente.
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb, adminAuth, adminStorage } from "./_lib/firebaseAdmin.js";
import { FieldPath } from "firebase-admin/firestore";

const BATCH_SIZE = 400; // margem de segurança abaixo do limite de 500 por batch do Firestore

// Apaga todos os documentos que batem com "queryRef", em lotes, repetindo
// até a consulta voltar vazia — funciona tanto pra poucas dezenas quanto
// pra milhares de documentos (ex.: páginas de um livro grande).
async function deleteQueryInBatches(queryRef) {
  const db = adminDb();
  while (true) {
    const snap = await queryRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_SIZE) break;
  }
}

async function deleteMaterialSubcollections(materialRef) {
  await deleteQueryInBatches(materialRef.collection("pages"));
  await deleteQueryInBatches(materialRef.collection("highlights"));
  await deleteQueryInBatches(materialRef.collection("notes"));
}

// progress/{uid}_{storageKey} e ai_usage/{uid}_{ano-mes} usam o uid como
// prefixo determinístico do id do documento (ver firebase-init.js e
// api/_lib/usage.js) — em vez de depender de um campo "uid" gravado
// dentro do documento (que poderia faltar em algum registro antigo), a
// consulta abaixo busca por INTERVALO DE ID diretamente, o que é sempre
// correto e não exige nenhum índice composto no Firestore.
function byIdPrefix(collectionRef, uid) {
  return collectionRef
    .where(FieldPath.documentId(), ">=", `${uid}_`)
    .where(FieldPath.documentId(), "<", `${uid}_`);
}

async function handleDeleteAccount(req, res, user) {
  const uid = user.uid;
  const db = adminDb();

  try {
    // 1. Materiais: Storage (PDF original) + subcoleções (pages/highlights/
    //    notes) + o documento do material em si.
    const materialsSnap = await db.collection("materials").where("ownerId", "==", uid).get();
    for (const materialDoc of materialsSnap.docs) {
      const data = materialDoc.data();
      await deleteMaterialSubcollections(materialDoc.ref);
      if (data.storagePath) {
        try {
          await adminStorage().file(data.storagePath).delete({ ignoreNotFound: true });
        } catch (e) {
          console.error(`Falha ao excluir arquivo do Storage (${data.storagePath}), continuando:`, e.message);
        }
      }
      await materialDoc.ref.delete();
    }

    // 2. Rede de segurança: qualquer arquivo que tenha sobrado na pasta
    //    desta pessoa no Storage (ex.: upload que falhou antes do material
    //    ser registrado no Firestore) — nunca deve travar o resto da
    //    exclusão se falhar.
    try {
      await adminStorage().deleteFiles({ prefix: `users/${uid}/`, force: true });
    } catch (e) {
      console.error("Falha ao limpar pasta do usuário no Storage (continuando mesmo assim):", e.message);
    }

    // 3. Módulos criados/gerados pela pessoa.
    await deleteQueryInBatches(db.collection("modules").where("ownerId", "==", uid));

    // 4. Progresso de estudo (uma "ficha" de conteúdo por módulo estudado).
    await deleteQueryInBatches(byIdPrefix(db.collection("progress"), uid));

    // 5. Contador mensal de uso de IA.
    await deleteQueryInBatches(byIdPrefix(db.collection("ai_usage"), uid));

    // 6. Perfil (plano, preferência de lembrete por e-mail, id de cliente
    //    da Stripe).
    await db.collection("users").doc(uid).delete();

    // 7. Por último, a conta em si no Firebase Authentication — depois
    //    disso a pessoa não consegue mais logar com este e-mail.
    try {
      await adminAuth().deleteUser(uid);
    } catch (e) {
      console.error("Falha ao excluir usuário do Firebase Auth (os dados já foram apagados):", e.message);
      res.status(500).json({
        error: "Seus dados foram apagados, mas houve um problema ao remover o acesso de login em si. Tente sair e entrar de novo, ou entre em contato pra confirmarmos a exclusão."
      });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao excluir conta:", e);
    res.status(500).json({ error: "Não foi possível excluir sua conta agora. Tente novamente em alguns minutos." });
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

  const { action } = req.body || {};

  switch (action) {
    case "delete":
      return handleDeleteAccount(req, res, user);
    default:
      res.status(400).json({ error: "action inválida (use 'delete')." });
  }
}
