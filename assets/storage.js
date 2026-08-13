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
  // PERFORMANCE/CUSTO (T2): engine.js chama save() a cada ação da pessoa
  // (responder um card, avançar no quiz, mudar de aba...) — gravar o
  // Firestore a cada uma dessas chamadas gera uma escrita cobrada por
  // ação, quando só o estado mais recente realmente importa (ninguém lê
  // um estado intermediário). Por isso o Firestore é debounced (agrupado)
  // aqui: localStorage continua imediato a cada chamada (rede de
  // segurança contra perda de progresso), e o Firestore só recebe o
  // estado já consolidado, DEBOUNCE_MS depois da última chamada — ou
  // antes disso, se algo chamar flush() (ver engine.js: visibilitychange,
  // troca de aba/saída da tela de estudo).
  DEBOUNCE_MS: 4000, // entre 3 e 5s pedidos
  _pending: {},   // { [key]: data } — sempre a versão mais recente ainda não gravada no Firestore
  _timers: {},    // { [key]: timeoutId }
  // V4-C: fila serial por key — substitui _writing + _dirty (semáforo
  // artesanal) por uma promise chain. Cada key tem sua própria fila;
  // escritas na mesma key são serializadas automaticamente (a próxima só
  // começa depois que a anterior terminar), sem os estados implícitos que
  // podiam causar race conditions. Escritas em keys diferentes continuam
  // concorrentes (não há razão para serializá-las entre si).
  _queues: {},    // { [key]: Promise }

  async save(key, data){
    // localStorage: sempre imediato e síncrono — nunca espera o debounce
    // nem o Firestore, e por isso nunca perde progresso local mesmo
    // offline ou se a aba fechar antes do próximo flush.
    let localOk = false;
    try{
      localStorage.setItem(this._key(key), JSON.stringify(data));
      localOk = true;
    }catch(e){
      console.warn("StorageAdapter.save (localStorage) falhou:", e);
    }

    if(window.AppDB){
      this._pending[key] = data;
      clearTimeout(this._timers[key]);
      this._timers[key] = setTimeout(()=> this._flushKey(key), this.DEBOUNCE_MS);
    }

    return localOk;
  },

  // Grava agora mesmo (sem esperar o debounce) o que estiver pendente
  // pra "key" — ou, sem argumento, tudo que estiver pendente em qualquer
  // key. Chamado nos momentos em que perder os últimos segundos de
  // progresso seria ruim (ver engine.js).
  async flush(key){
    if(key === undefined){
      await Promise.all(Object.keys(this._pending).map(k => this._flushKey(k)));
      return;
    }
    await this._flushKey(key);
  },

  async _flushKey(key){
    clearTimeout(this._timers[key]);
    delete this._timers[key];

    if(!(key in this._pending)) return; // nada pendente

    // Fila serial: cada chamada encadeia na promise anterior da mesma key.
    // Isso garante que duas escritas da mesma key nunca rodem ao mesmo tempo
    // e que a mais recente (this._pending[key]) sempre seja a última a ser
    // gravada — sem precisar dos flags _writing e _dirty do semáforo antigo.
    const doWrite = async () => {
      const data = this._pending[key];
      if(!data) return; // foi consumido por outra gravação enquanto esperava na fila
      delete this._pending[key];
      try{
        await window.AppDB.saveProgress(key, data);
      }catch(e){
        console.warn("StorageAdapter: falha ao salvar no Firestore (localStorage já está atualizado):", e);
      }
    };

    this._queues[key] = (this._queues[key] || Promise.resolve()).then(doWrite, doWrite);
    // Deixa a fila limpar depois que terminar (evita acumular promises
    // infinitamente pra keys que nunca mais são usadas).
    this._queues[key] = this._queues[key].then(() => { delete this._queues[key]; });
  }
};