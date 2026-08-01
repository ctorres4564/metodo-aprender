/* =====================================================================
   STORAGE ADAPTER
   =====================================================================
   Quando há uma pessoa autenticada (window.AppDB disponível, definido
   por assets/firebase-init.js), o progresso é lido/escrito no Firestore,
   individualizado por usuário — cada pessoa só acessa o próprio progresso.

   Sem login (ou se o Firestore falhar por qualquer motivo, ex: sem
   internet), cai automaticamente para localStorage, mantendo o app
   utilizável mesmo offline.

   engine.js só conhece load(key)/save(key,data) — não sabe nem precisa
   saber qual dos dois back-ends está sendo usado.
   ===================================================================== */
const StorageAdapter = {
  async load(key){
    if(window.AppDB){
      try{
        const remote = await window.AppDB.loadProgress(key);
        if(remote) return remote;
      }catch(e){
        console.warn("StorageAdapter: falha ao ler do Firestore, tentando localStorage:", e);
      }
    }
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }catch(e){
      console.warn("StorageAdapter.load falhou:", e);
      return null;
    }
  },
  async save(key, data){
    let ok = false;
    if(window.AppDB){
      try{
        ok = await window.AppDB.saveProgress(key, data);
      }catch(e){
        console.warn("StorageAdapter: falha ao salvar no Firestore, salvando só localmente:", e);
      }
    }
    try{
      localStorage.setItem(key, JSON.stringify(data));
      ok = true;
    }catch(e){
      console.warn("StorageAdapter.save (localStorage) falhou:", e);
    }
    return ok;
  }
};
