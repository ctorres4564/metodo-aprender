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
  setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
  }
};

window.dispatchEvent(new Event("firebase-ready"));
