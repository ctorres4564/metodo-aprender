/* =====================================================================
   INICIALIZAÇÃO DO FIREBASE (Auth + Firestore)
   =====================================================================
   Script de módulo (type="module"): importa o SDK do Firebase direto
   do CDN do Google, sem precisar de build/bundler.

   Expõe duas interfaces globais para o resto do app (scripts comuns,
   não-módulo) usar:
     window.AppAuth → signUp, signIn, signOutUser, resetPassword,
                       onChange, currentUser
     window.AppDB   → loadProgress(key), saveProgress(key, data)

   Dispara o evento "firebase-ready" no window assim que estiver pronto
   para uso. Outros scripts devem escutar esse evento em vez de assumir
   ordem de carregamento.
   ===================================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

function sanitizeKeyPart(str){
  // Garante que o ID do documento no Firestore não tenha caracteres problemáticos
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "_");
}

window.AppAuth = {
  signUp: (email, password) => createUserWithEmailAndPassword(auth, email, password),
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  signInWithGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),
  signOutUser: () => signOut(auth),
  resetPassword: (email) => sendPasswordResetEmail(auth, email),
  onChange: (cb) => onAuthStateChanged(auth, cb),
  currentUser: () => auth.currentUser
};

window.AppDB = {
  async loadProgress(key){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return null;
    const docId = `${uid}_${sanitizeKeyPart(key)}`;
    const ref = doc(db, "progress", docId);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data().state : null;
  },
  async saveProgress(key, data){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return false;
    const docId = `${uid}_${sanitizeKeyPart(key)}`;
    const ref = doc(db, "progress", docId);
    await setDoc(ref, { state: data, updatedAt: Date.now(), uid });
    return true;
  },

  /* ---- Módulos criados pelo(a) próprio(a) usuário(a) ---- */
  async listUserModules(){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return [];
    const q = query(collection(db, "modules"), where("ownerId", "==", uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  async getUserModule(id){
    const ref = doc(db, "modules", id);
    const snap = await getDoc(ref);
    return snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null;
  },
  async saveUserModule(id, moduleData){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const ref = doc(db, "modules", id);
    await setDoc(ref, Object.assign({}, moduleData, { ownerId: uid, updatedAt: Date.now() }));
    return true;
  },
  async deleteUserModule(id){
    await deleteDoc(doc(db, "modules", id));
    return true;
  },

  /* ---- Perfil do usuário (plano, preferência de lembrete por e-mail) ---- */
  async getUserProfile(){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return null;
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : null;
  },
  async saveUserProfile(data){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const ref = doc(db, "users", uid);
    await setDoc(ref, data, { merge: true });
    return true;
  },

  // Uso de IA do mês corrente (contador gravado pelo servidor em api/_lib/usage.js).
  // Só leitura — usado pra mostrar "X/Y gerações usadas este mês" na tela.
  async getUserUsage(){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return null;
    const d = new Date();
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}`;
    const ref = doc(db, "ai_usage", `${uid}_${monthKey}`);
    const snap = await getDoc(ref);
    return snap.exists() ? snap.data() : { count: 0 };
  },

  /* ---- Biblioteca de materiais (Etapa 1) ----
     O documento principal (materials/{id}) só é escrito pelo servidor
     (api/material-*.js) — aqui só há leitura dele. Já a subcoleção
     "pages" (texto extraído por página) é escrita direto pelo cliente,
     em lotes, porque pode ter centenas de documentos por material (ver
     firestore.rules.txt para a regra que restringe isso ao dono). */
  async listMaterials(){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return [];
    const q = query(collection(db, "materials"), where("ownerId", "==", uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  },
  async getMaterial(id){
    const ref = doc(db, "materials", id);
    const snap = await getDoc(ref);
    return snap.exists() ? Object.assign({ id: snap.id }, snap.data()) : null;
  },

  // pageDocs: [{ pageNumber, partNumber|null, text, extractionMethod, usedOcr }, ...]
  async writeMaterialPages(materialId, pageDocs){
    const CHUNK = 400; // margem abaixo do limite de 500 operações por batch do Firestore
    for(let i = 0; i < pageDocs.length; i += CHUNK){
      const chunk = pageDocs.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      chunk.forEach(p=>{
        const pageId = p.partNumber
          ? `${String(p.pageNumber).padStart(6,"0")}-${String(p.partNumber).padStart(3,"0")}`
          : String(p.pageNumber).padStart(6,"0");
        const ref = doc(db, "materials", materialId, "pages", pageId);
        batch.set(ref, {
          pageNumber: p.pageNumber,
          partNumber: p.partNumber || null,
          text: p.text,
          charCount: p.text.length,
          extractionMethod: p.extractionMethod,
          usedOcr: !!p.usedOcr,
          createdAt: Date.now(),
          schemaVersion: 1
        });
      });
      await batch.commit();
    }
  },

  // Busca TODAS as páginas do material (usado ao reabrir um material da
  // Biblioteca). Sem orderBy na consulta de propósito — evita depender de
  // um índice composto no Firestore; a ordenação certa (por página, depois
  // por parte) é feita aqui mesmo, em memória.
  async readMaterialPages(materialId){
    const q = query(collection(db, "materials", materialId, "pages"));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data())
      .sort((a, b) => (a.pageNumber - b.pageNumber) || ((a.partNumber || 0) - (b.partNumber || 0)));
  }
};

window.AppStorage = {
  // Envia o PDF original pro Firebase Storage, na pasta exclusiva desse
  // usuário. O caminho retornado é salvo no material (storagePath) via
  // api/material.js (action "updateStatus").
  async uploadMaterialPdf(materialId, file){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const path = `users/${uid}/materials/${materialId}/original.pdf`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file, { contentType: "application/pdf" });
    return path;
  }
};

window.dispatchEvent(new Event("firebase-ready"));
