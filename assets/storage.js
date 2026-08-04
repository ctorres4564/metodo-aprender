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
  // SEGURANÇA (SEC-06): as chaves do localStorage levam o uid como prefixo
  // ("u:<uid>:<key>"), para que o progresso de uma pessoa nunca apareça na
  // sessão de outra conta que use o mesmo navegador. Chaves antigas (sem
  // prefixo) são migradas na primeira leitura e apagadas em seguida; o
  // logout limpa todo o localStorage (ver bindLogoutButton em auth-ui.js).
  _uid(){
    const u = window.AppAuth && window.AppAuth.currentUser && window.AppAuth.currentUser();
    return u ? u.uid : null;
  },
  _key(key){
    const uid = this._uid();
    return uid ? `u:${uid}:${key}` : key;
  },
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
      const uid = this._uid();
      const raw = localStorage.getItem(this._key(key));
      if(raw) return JSON.parse(raw);
      // Migração de chaves antigas (sem uid): copia para a chave com
      // prefixo e remove a antiga, que era compartilhada entre contas.
      if(uid){
        const legacy = localStorage.getItem(key);
        if(legacy){
          const parsed = JSON.parse(legacy);
          localStorage.setItem(this._key(key), legacy);
          localStorage.removeItem(key);
          return parsed;
        }
      }
      return null;
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
      localStorage.setItem(this._key(key), JSON.stringify(data));
      ok = true;
    }catch(e){
      console.warn("StorageAdapter.save (localStorage) falhou:", e);
    }
    return ok;
  }
};
