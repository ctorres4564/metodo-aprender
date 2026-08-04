/* =====================================================================
   TELA DE LOGIN / CADASTRO / RECUPERAÇÃO DE SENHA
   =====================================================================
   Script comum (não-módulo). Renderiza o formulário dentro de
   <div id="auth-gate"></div> e só libera o restante da página
   (chamando onReady) depois que houver um usuário autenticado.

   Depende de window.AppAuth, definido por assets/firebase-init.js.
   Escuta o evento "firebase-ready" em vez de assumir ordem de scripts.
   ===================================================================== */

function initAuthGate(onReady){
  const gate = document.getElementById("auth-gate");
  const appRoot = document.getElementById("app-root");
  if(!gate) return;

  function showLoading(msg){
    gate.style.display = "block";
    if(appRoot) appRoot.style.display = "none";
    gate.innerHTML = `<div class="panel" style="max-width:380px; margin:60px auto; text-align:center;"><p class="lead">${msg}</p></div>`;
  }

  function showApp(){
    gate.style.display = "none";
    if(appRoot) appRoot.style.display = "block";
  }

  function renderForm(mode, errorMsg){
    // mode: "login" | "signup" | "reset"
    const titles = { login: "🔐 Entrar", signup: "✨ Criar conta", reset: "🔑 Recuperar senha" };
    gate.style.display = "block";
    if(appRoot) appRoot.style.display = "none";

    gate.innerHTML = `
      <div class="panel" style="max-width:380px; margin:60px auto;">
        <h2 class="section-title">${titles[mode]}</h2>
        ${errorMsg ? `<div class="feedback bad" style="margin-bottom:10px;">${errorMsg}</div>` : ""}
        ${mode !== "reset" ? `
          <input id="auth-email" type="email" placeholder="E-mail" class="auth-input">
          <input id="auth-password" type="password" placeholder="Senha (mínimo 6 caracteres)" class="auth-input" style="margin-top:8px;">
        ` : `
          <input id="auth-email" type="email" placeholder="E-mail" class="auth-input">
        `}
        <button class="btn" id="auth-primary-btn" style="width:100%; margin-top:12px;">
          ${mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar e-mail de recuperação"}
        </button>
        <div id="auth-msg"></div>
        ${mode !== "reset" ? `
          <div style="display:flex; align-items:center; gap:10px; margin:16px 0; color:var(--text-dim); font-size:11.5px;">
            <div style="flex:1; height:1px; background:var(--border);"></div>ou<div style="flex:1; height:1px; background:var(--border);"></div>
          </div>
          <button class="btn secondary" id="auth-google-btn" style="width:100%;">🔵 Continuar com Google</button>
        ` : ""}
        <div style="margin-top:14px; text-align:center; font-size:12.5px; color:var(--text-dim);">
          ${mode === "login" ? `
            <a href="#" id="auth-go-signup">Criar uma conta</a> ·
            <a href="#" id="auth-go-reset">Esqueci minha senha</a>
          ` : `
            <a href="#" id="auth-go-login">Já tenho conta, entrar</a>
          `}
        </div>
        ${mode === "signup" ? `
          <p style="margin-top:14px; text-align:center; font-size:11px; color:var(--text-dim);">
            Ao criar uma conta, você concorda com os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>
            e a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.
          </p>
        ` : ""}
      </div>
    `;

    if(mode !== "reset"){
      document.getElementById("auth-google-btn").addEventListener("click", async ()=>{
        const msgBox = document.getElementById("auth-msg");
        try{
          await window.AppAuth.signInWithGoogle();
          // Sucesso: onAuthStateChanged cuida de mostrar o app.
        }catch(e){
          console.error(e);
          msgBox.innerHTML = `<div class="feedback bad" style="margin-top:10px;">Não foi possível entrar com o Google. Tente novamente.</div>`;
        }
      });
    }

    document.getElementById("auth-primary-btn").addEventListener("click", async ()=>{
      const email = document.getElementById("auth-email").value.trim();
      const password = mode !== "reset" ? document.getElementById("auth-password").value : null;
      const msgBox = document.getElementById("auth-msg");
      const btn = document.getElementById("auth-primary-btn");

      if(!email || (mode !== "reset" && !password)){
        msgBox.innerHTML = `<div class="feedback bad" style="margin-top:10px;">Preencha todos os campos.</div>`;
        return;
      }

      btn.disabled = true;
      btn.textContent = "Aguarde...";

      try{
        if(mode === "login"){
          await window.AppAuth.signIn(email, password);
        } else if(mode === "signup"){
          await window.AppAuth.signUp(email, password);
          // Dispara o e-mail de verificação uma vez, na hora do cadastro.
          // Não bloqueia o cadastro se falhar — a pessoa ainda pode pedir
          // reenvio depois, pelo banner de aviso (ver renderVerifyBanner).
          try{ await window.AppAuth.sendVerificationEmail(); }
          catch(e){ console.warn("Falha ao enviar e-mail de verificação:", e); }
        } else if(mode === "reset"){
          await window.AppAuth.resetPassword(email);
          msgBox.innerHTML = `<div class="feedback ok" style="margin-top:10px;">E-mail de recuperação enviado! Confira sua caixa de entrada (e o spam).</div>`;
          btn.disabled = false;
          btn.textContent = "Enviar e-mail de recuperação";
          return;
        }
        // Sucesso em login/signup: onAuthStateChanged cuida de mostrar o app.
      }catch(e){
        console.error(e);
        renderForm(mode, traduzErroFirebase(e.code));
      }
    });

    if(mode === "login"){
      document.getElementById("auth-go-signup").addEventListener("click", (e)=>{ e.preventDefault(); renderForm("signup"); });
      document.getElementById("auth-go-reset").addEventListener("click", (e)=>{ e.preventDefault(); renderForm("reset"); });
    } else {
      document.getElementById("auth-go-login").addEventListener("click", (e)=>{ e.preventDefault(); renderForm("login"); });
    }
  }

  function traduzErroFirebase(code){
    const map = {
      "auth/invalid-email": "E-mail inválido.",
      "auth/user-not-found": "Não existe conta com esse e-mail.",
      "auth/wrong-password": "Senha incorreta.",
      "auth/invalid-credential": "E-mail ou senha incorretos.",
      "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
      "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
      "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo."
    };
    return map[code] || "Não foi possível concluir. Tente novamente.";
  }

  showLoading("Carregando...");

  // Aviso de e-mail não verificado (bloqueador de monetização): não trava o
  // uso do app (dá pra continuar estudando/anotando normalmente), mas o
  // servidor já recusa gerações de IA pra quem não confirmou o e-mail (ver
  // api/_lib/usage.js) — este banner só deixa isso visível e dá um jeito
  // fácil de reenviar/atualizar sem precisar sair e entrar de novo.
  function renderVerifyBanner(user){
    const existing = document.getElementById("verify-email-banner");
    if(existing) existing.remove();
    // Login via Google já chega com e-mail verificado pelo próprio Google.
    if(!user || user.emailVerified) return;

    const banner = document.createElement("div");
    banner.id = "verify-email-banner";
    banner.className = "feedback bad";
    banner.style.cssText = "margin:14px auto 0; max-width:960px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;";
    banner.innerHTML = `
      <span>📧 Confirme seu e-mail (${(user.email || "").replace(/</g,"&lt;")}) para poder gerar conteúdo com IA. Verifique sua caixa de entrada (e o spam).</span>
      <span style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn ghost" id="verify-resend-btn" style="font-size:12px;">Reenviar e-mail</button>
        <button class="btn ghost" id="verify-refresh-btn" style="font-size:12px;">Já verifiquei</button>
      </span>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById("verify-resend-btn").addEventListener("click", async ()=>{
      const btn = document.getElementById("verify-resend-btn");
      btn.disabled = true; btn.textContent = "Enviando...";
      try{
        await window.AppAuth.sendVerificationEmail();
        btn.textContent = "Enviado!";
      }catch(e){
        console.error(e);
        btn.disabled = false;
        btn.textContent = "Reenviar e-mail";
        alert("Não foi possível reenviar agora (se você acabou de pedir, aguarde alguns minutos e tente de novo).");
      }
    });
    document.getElementById("verify-refresh-btn").addEventListener("click", async ()=>{
      const btn = document.getElementById("verify-refresh-btn");
      btn.disabled = true; btn.textContent = "Verificando...";
      try{
        const refreshed = await window.AppAuth.reloadCurrentUser();
        renderVerifyBanner(refreshed);
      }catch(e){
        console.error(e);
        btn.disabled = false;
        btn.textContent = "Já verifiquei";
      }
    });
  }

  function start(){
    window.AppAuth.onChange((user)=>{
      if(user){
        showApp();
        const emailEl = document.getElementById("user-email");
        if(emailEl) emailEl.textContent = "👤 " + (user.displayName || user.email || "");
        renderVerifyBanner(user);
        onReady(user);
      } else {
        const existingBanner = document.getElementById("verify-email-banner");
        if(existingBanner) existingBanner.remove();
        renderForm("login");
      }
    });
  }

  if(window.AppAuth){
    start();
  } else {
    window.addEventListener("firebase-ready", start, { once:true });
  }
}

function bindLogoutButton(){
  const btn = document.getElementById("logout-btn");
  if(!btn) return;
  btn.addEventListener("click", async ()=>{
    if(window.AppAuth){
      await window.AppAuth.signOutUser();
      window.location.reload();
    }
  });
}
