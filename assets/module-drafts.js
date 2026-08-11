(function(){
  "use strict";

  const PREFIX = "metodo-aprender:module-draft:v1:";
  const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  function uid(){
    const user = window.AppAuth && window.AppAuth.currentUser && window.AppAuth.currentUser();
    return user && user.uid ? user.uid : null;
  }

  function key(draftId){
    const userId = uid();
    if(!userId || !draftId) return null;
    return `${PREFIX}${userId}:${String(draftId).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  }

  function cleanup(){
    const userId = uid();
    if(!userId) return;
    const prefix = `${PREFIX}${userId}:`;
    const now = Date.now();
    for(let i = localStorage.length - 1; i >= 0; i--){
      const storageKey = localStorage.key(i);
      if(!storageKey || !storageKey.startsWith(prefix)) continue;
      try{
        const draft = JSON.parse(localStorage.getItem(storageKey));
        if(!draft || !draft.updatedAt || now - draft.updatedAt > MAX_AGE_MS){
          localStorage.removeItem(storageKey);
        }
      }catch(_){
        localStorage.removeItem(storageKey);
      }
    }
  }

  function save(draftId, payload){
    const storageKey = key(draftId);
    if(!storageKey) throw new Error("Não foi possível identificar a conta para salvar o rascunho.");
    const previous = load(draftId);
    const now = Date.now();
    const draft = Object.assign({}, payload, {
      version: 1,
      draftId,
      uid: uid(),
      createdAt: previous && previous.createdAt || payload.createdAt || now,
      updatedAt: now
    });
    localStorage.setItem(storageKey, JSON.stringify(draft));
    return draft;
  }

  function load(draftId){
    const storageKey = key(draftId);
    if(!storageKey) return null;
    try{
      const draft = JSON.parse(localStorage.getItem(storageKey));
      if(!draft || draft.uid !== uid()) return null;
      if(Date.now() - draft.updatedAt > MAX_AGE_MS){
        localStorage.removeItem(storageKey);
        return null;
      }
      return draft;
    }catch(_){
      localStorage.removeItem(storageKey);
      return null;
    }
  }

  function remove(draftId){
    const storageKey = key(draftId);
    if(storageKey) localStorage.removeItem(storageKey);
  }

  function latest(){
    cleanup();
    const userId = uid();
    if(!userId) return null;
    const prefix = `${PREFIX}${userId}:`;
    let result = null;
    for(let i = 0; i < localStorage.length; i++){
      const storageKey = localStorage.key(i);
      if(!storageKey || !storageKey.startsWith(prefix)) continue;
      try{
        const draft = JSON.parse(localStorage.getItem(storageKey));
        if(draft && draft.hasContent && (!result || draft.updatedAt > result.updatedAt)) result = draft;
      }catch(_){ /* cleanup remove itens inválidos na próxima passagem */ }
    }
    return result;
  }

  window.ModuleDrafts = { save, load, remove, latest, cleanup };
})();
