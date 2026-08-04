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
  updateDoc,
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
  uploadBytes,
  getDownloadURL,
  getBytes
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
  },

  /* ---- Leitor de PDF: destaques e anotações (Etapa 2) ----
     Escritos direto pelo cliente (sem função serverless — não há campo
     administrativo aqui). Protegidos pelas regras em firestore.rules.txt,
     que exigem ownerId == uid E que o material "pai" também pertença a
     esse mesmo uid (ver comentário nas regras). O where("ownerId","==",uid)
     nas consultas abaixo não é só um filtro de conveniência: sem ele, o
     Firestore recusa a query inteira, porque não consegue garantir de
     antemão que ela só retornaria documentos permitidos pela regra. */
  async listHighlights(materialId){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return [];
    const q = query(collection(db, "materials", materialId, "highlights"), where("ownerId", "==", uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  async saveHighlight(materialId, data){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const ref = doc(collection(db, "materials", materialId, "highlights"));
    const now = Date.now();
    const payload = {
      id: ref.id,
      materialId,
      ownerId: uid,
      pageNumber: data.pageNumber,
      text: String(data.text || "").slice(0, 2000),
      color: data.color || "yellow",
      position: data.position || { rects: [] },
      createdAt: now,
      updatedAt: now
    };
    await setDoc(ref, payload);
    return payload;
  },
  // Só cor e posição são aceitos aqui (mesmo conjunto liberado pela regra
  // de update) — qualquer outro campo passado em "fields" é ignorado.
  async updateHighlight(materialId, highlightId, fields){
    const ref = doc(db, "materials", materialId, "highlights", highlightId);
    const update = { updatedAt: Date.now() };
    if(fields.color !== undefined) update.color = fields.color;
    if(fields.position !== undefined) update.position = fields.position;
    await updateDoc(ref, update);
    return true;
  },
  // Exclui em cascata as anotações vinculadas a esse destaque antes de
  // excluir o destaque em si — uma nota nunca deve sobreviver "órfã",
  // sem o trecho ao qual está vinculada.
  async deleteHighlight(materialId, highlightId){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const notesQ = query(
      collection(db, "materials", materialId, "notes"),
      where("ownerId", "==", uid),
      where("highlightId", "==", highlightId)
    );
    const snap = await getDocs(notesQ);
    if(!snap.empty){
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, "materials", materialId, "highlights", highlightId));
    return true;
  },

  async listNotes(materialId){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) return [];
    const q = query(collection(db, "materials", materialId, "notes"), where("ownerId", "==", uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  },
  async saveNote(materialId, data){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const ref = doc(collection(db, "materials", materialId, "notes"));
    const now = Date.now();
    const payload = {
      id: ref.id,
      materialId,
      highlightId: data.highlightId,
      ownerId: uid,
      pageNumber: data.pageNumber,
      text: String(data.text || "").slice(0, 4000),
      // Etapa 3 — vínculo opcional com um módulo/conceito gerado a partir
      // deste mesmo material (null quando a nota não está vinculada).
      linkedModuleId: data.linkedModuleId || null,
      linkedConceptId: data.linkedModuleId ? (data.linkedConceptId || null) : null,
      createdAt: now,
      updatedAt: now
    };
    await setDoc(ref, payload);
    return payload;
  },
  // Texto e o vínculo de módulo/conceito são aceitos aqui (mesmo conjunto
  // liberado pela regra de update em firestore.rules.txt).
  async updateNote(materialId, noteId, fields){
    const ref = doc(db, "materials", materialId, "notes", noteId);
    const update = { updatedAt: Date.now() };
    if(fields.text !== undefined) update.text = String(fields.text).slice(0, 4000);
    if(fields.linkedModuleId !== undefined) update.linkedModuleId = fields.linkedModuleId || null;
    if(fields.linkedConceptId !== undefined) update.linkedConceptId = fields.linkedModuleId ? (fields.linkedConceptId || null) : null;
    await updateDoc(ref, update);
    return true;
  },
  async deleteNote(materialId, noteId){
    await deleteDoc(doc(db, "materials", materialId, "notes", noteId));
    return true;
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
  },

  // Gera uma URL de download temporária para o PDF já salvo. NÃO é usada
  // pelo leitor (ver getMaterialPdfBytes abaixo) — o PDF.js, ao abrir essa
  // URL diretamente via getDocument({url}), faz requisições HTTP com
  // cabeçalho Range para buscar páginas sob demanda; essas requisições
  // saem do domínio do app (metodoaprender.com) para
  // firebasestorage.googleapis.com, e esse cabeçalho Range exige CORS
  // configurado no bucket (algo que este projeto não configura, de
  // propósito, pra não precisar mexer em infraestrutura fora do Firebase
  // Console) — sem isso, o navegador bloqueia com "Failed to fetch".
  // Mantida aqui só como utilidade genérica, caso seja útil no futuro
  // (ex: um link de "abrir em nova aba"). IMPORTANTE se for usada: essa
  // URL funciona como um link de acesso compartilhável (contém um token
  // na query string) — nunca deve ser persistida (Firestore,
  // localStorage) nem registrada em log.
  async getMaterialPdfUrl(storagePath){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const fileRef = storageRef(storage, storagePath);
    return await getDownloadURL(fileRef);
  },

  // Baixa o PDF inteiro, autenticado, como ArrayBuffer — usada pelo leitor.
  // Diferente de getMaterialPdfUrl, isso NÃO gera nenhuma URL de acesso
  // (nada compartilhável em memória, nem em log): getBytes() faz a
  // requisição autenticada direto pelo SDK do Firebase (mesmo canal já
  // usado por uploadBytes) e devolve os bytes crus. Evita depender de
  // CORS/Range no bucket, ao custo de baixar o arquivo inteiro de uma vez
  // em vez de por página sob demanda (ver leitor.html, função boot()).
  async getMaterialPdfBytes(storagePath){
    const uid = auth.currentUser && auth.currentUser.uid;
    if(!uid) throw new Error("Não autenticado");
    const fileRef = storageRef(storage, storagePath);
    return await getBytes(fileRef);
  }
};

window.dispatchEvent(new Event("firebase-ready"));
