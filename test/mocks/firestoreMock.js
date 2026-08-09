/* =====================================================================
   MOCK MÍNIMO DO FIRESTORE — só o que api/_lib/usage.js realmente usa:
   collection(x).doc(y).get(), e db.runTransaction(tx => tx.get()/tx.set()).
   =====================================================================
   IMPORTANTE (concorrência): runTransaction() enfileira as transações
   (uma de cada vez, na ordem de chegada) em vez de rodar em paralelo de
   verdade. Isso modela o efeito prático de uma transação real do
   Firestore num único documento (nunca duas escritas conflitantes se
   perdem), mesmo sem simular o retry-on-conflict interno do Firestore —
   suficiente pra testar que checkAndConsumeUsage nunca deixa passar mais
   consumos do que o limite quando chamado em paralelo.
   ===================================================================== */
export function createMockDb(initialDocs = {}) {
  const store = new Map(Object.entries(initialDocs));
  let queue = Promise.resolve();

  function makeSnap(path) {
    const data = store.get(path);
    return { exists: data !== undefined, data: () => data };
  }

  function docRef(path) {
    return {
      path,
      async get() {
        return makeSnap(path);
      }
    };
  }

  function collection(name) {
    return {
      doc(id) {
        return docRef(`${name}/${id}`);
      }
    };
  }

  function runTransaction(fn) {
    const run = queue.then(async () => {
      const tx = {
        async get(ref) {
          return makeSnap(ref.path);
        },
        set(ref, data, opts) {
          const prev = (opts && opts.merge) ? (store.get(ref.path) || {}) : {};
          store.set(ref.path, { ...prev, ...data });
        }
      };
      return fn(tx);
    });
    // Erros de uma transação não devem travar a fila pras próximas.
    queue = run.then(() => {}, () => {});
    return run;
  }

  return {
    collection,
    runTransaction,
    // Acesso direto ao estado interno, só pra asserções nos testes.
    _get(path) { return store.get(path); },
    _set(path, data) { store.set(path, data); }
  };
}
