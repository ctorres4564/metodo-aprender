/* =====================================================================
   Cliente de API autenticado.
   =====================================================================
   As funções de IA (avaliar-explicacao, gerar-modulo, localizar-secao,
   gerar-analogia, regenerar-conceito) agora exigem login: o servidor verifica o token do
   Firebase para saber quem está chamando e controlar o limite mensal de
   uso por pessoa. Este helper injeta esse token automaticamente em toda
   chamada — usar authedFetch(url, options) em vez de fetch(url, options)
   ao chamar qualquer endpoint em /api/.
   ===================================================================== */
async function authedFetch(url, options) {
  options = options || {};
  const headers = Object.assign({}, options.headers || {});

  const user = window.AppAuth && window.AppAuth.currentUser && window.AppAuth.currentUser();
  if (user) {
    try {
      const token = await user.getIdToken();
      headers["Authorization"] = "Bearer " + token;
    } catch (e) {
      console.error("Não foi possível obter o token de autenticação:", e);
    }
  }

  return fetch(url, Object.assign({}, options, { headers }));
}

window.authedFetch = authedFetch;
