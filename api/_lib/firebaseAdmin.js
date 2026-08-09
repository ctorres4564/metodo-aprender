/* =====================================================================
   Inicialização do Firebase Admin SDK (uso exclusivo no servidor).
   =====================================================================
   Usado pelas funções serverless para verificar o token de login de quem
   está chamando a API (evita que qualquer pessoa sem conta gaste créditos
   de IA) e para ler/gravar contadores de uso no Firestore.

   Requer a variável de ambiente FIREBASE_SERVICE_ACCOUNT na Vercel: o
   conteúdo JSON completo da chave de conta de serviço (gerada em
   Firebase Console → Configurações do projeto → Contas de serviço →
   Gerar nova chave privada), colado como uma única linha.
   ===================================================================== */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

function getAdminApp() {
  const existing = getApps();
  if (existing.length) return existing[0];

  // Modo emulador (só em teste — ver test/emulator/): quando
  // FIRESTORE_EMULATOR_HOST está definida, o Admin SDK já sabe conversar
  // com o Firestore Emulator local em vez do Firestore de produção, e o
  // emulator não verifica credencial nenhuma — por isso inicializa sem
  // "cert". Essa variável só existe quando os testes rodam dentro de
  // `firebase emulators:exec` (ver package.json: "test:emulator"); em
  // produção (Vercel) ela nunca é definida, então este branch nunca roda
  // lá — o caminho de produção abaixo continua idêntico.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-metodo-aprender" });
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT não configurada no servidor.");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT não é um JSON válido.");
  }

  return initializeApp({
    credential: cert(serviceAccount),
    storageBucket: serviceAccount.project_id ? `${serviceAccount.project_id}.firebasestorage.app` : undefined
  });
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function adminDb() {
  return getFirestore(getAdminApp());
}

export function adminStorage() {
  return getStorage(getAdminApp()).bucket();
}
