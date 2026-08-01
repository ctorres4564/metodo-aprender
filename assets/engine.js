/* =====================================================================
   MOTOR COMPARTILHADO DO APP DE ESTUDO
   =====================================================================
   Este arquivo NÃO contém conteúdo de nenhum tema — apenas a lógica de:
   repetição espaçada (SM-2), gamificação (XP/níveis/streak/badges) e
   renderização das telas (Aprender, Revisar, Quiz, Progresso).

   Conteúdo (CONFIG + CONCEPTS) vem de arquivos JSON em /content e é
   injetado via initApp(config, concepts). Isso permite que o mesmo
   motor sirva qualquer número de módulos/temas sem duplicar código.

   Depende de assets/storage.js (StorageAdapter) já carregado antes deste
   script na página.
   ===================================================================== */

let CONFIG = null;
let CONCEPTS = [];
let STATE = null;

const LEVELS = [
  {min:0, name:"Iniciante"},
  {min:60, name:"Aprendiz"},
  {min:150, name:"Estudante Dedicado(a)"},
  {min:280, name:"Praticante"},
  {min:450, name:"Competente"},
  {min:660, name:"Avançado(a)"},
  {min:900, name:"Especialista"},
  {min:1180, name:"Referência no Tema"},
  {min:1500, name:"Mestre(a)"},
  {min:1900, name:"Autoridade Consolidada"}
];

const BADGES = [
  {id:"first_step", ic:"👣", name:"Primeiros Passos", desc:"Aprenda seu 1º conceito", check: s => Object.values(s.cards).some(c=>c.seen)},
  {id:"all_intro", ic:"🗺️", name:"Trilha Completa", desc:"Apresente todos os conceitos", check: s => Object.values(s.cards).filter(c=>c.seen).length >= CONCEPTS.length},
  {id:"first_review", ic:"🔁", name:"Revisor(a) Dedicado(a)", desc:"Complete 1 sessão de revisão", check: s => s.reviewSessions >= 1},
  {id:"streak3", ic:"🔥", name:"Sequência de 3 dias", desc:"Estude 3 dias seguidos", check: s => s.streak >= 3},
  {id:"streak7", ic:"🌟", name:"Sequência de 7 dias", desc:"Estude 7 dias seguidos", check: s => s.streak >= 7},
  {id:"quiz_perfect", ic:"🎯", name:"Mira Perfeita", desc:"Acerte 100% em um Quiz", check: s => s.quiz.best >= CONCEPTS.length},
  {id:"mastered5", ic:"🧱", name:"Bases Sólidas", desc:"Domine 5 conceitos", check: s => Object.values(s.cards).filter(c=>c.reps>=3).length >= 5},
  {id:"mastered_all", ic:"🏆", name:"Mestre(a) do Tema", desc:"Domine todos os conceitos", check: s => Object.values(s.cards).filter(c=>c.reps>=3).length >= CONCEPTS.length},
  {id:"feynman_first", ic:"🗣️", name:"Primeira Explicação", desc:"Explique 1 conceito no modo Feynman", check: s => Object.values(s.cards).some(c=>c.explainCount>0)},
  {id:"feynman5", ic:"🎤", name:"Mestre da Explicação", desc:"Explique 5 conceitos com nota 80+ no modo Feynman", check: s => Object.values(s.cards).filter(c=>c.lastExplainScore!=null && c.lastExplainScore>=80).length >= 5},
  {id:"calibrated10", ic:"🎯", name:"Bem Calibrado(a)", desc:"Acerte sua autoavaliação de confiança 10 vezes", check: s => s.calibration.aligned >= 10}
];

function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(dateStr, n){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function daysBetween(a,b){
  return Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00")) / 86400000);
}

function defaultState(){
  const cards = {};
  CONCEPTS.forEach(c => {
    cards[c.id] = { ef:2.5, interval:0, reps:0, nextReview: null, seen:false, lastQuality:null, explainCount:0, lastExplainScore:null };
  });
  return {
    xp:0, streak:0, lastStudyDate:null, cards, badges:[], reviewSessions:0, quiz:{played:0, best:0, bestAdaptive:0},
    settings: { dailyNewLimit: 5, dailyReviewLimit: 0 }, // dailyReviewLimit 0 = sem limite
    dailyProgress: { date: null, newCount: 0, reviewCount: 0 },
    calibration: { aligned: 0, overconfident: 0, underconfident: 0 }
  };
}

async function loadState(){
  const parsed = await StorageAdapter.load(CONFIG.storageKey);
  const base = defaultState();
  if(parsed){
    // Object.assign preserva campos novos (ex: explainCount) mesmo em progresso salvo antes deles existirem
    CONCEPTS.forEach(c=>{ if(parsed.cards && parsed.cards[c.id]) base.cards[c.id] = Object.assign({}, base.cards[c.id], parsed.cards[c.id]); });
    base.xp = parsed.xp||0;
    base.streak = parsed.streak||0;
    base.lastStudyDate = parsed.lastStudyDate||null;
    base.badges = parsed.badges||[];
    base.reviewSessions = parsed.reviewSessions||0;
    base.quiz = Object.assign({}, base.quiz, parsed.quiz||{});
    base.settings = Object.assign({}, base.settings, parsed.settings||{});
    base.dailyProgress = Object.assign({}, base.dailyProgress, parsed.dailyProgress||{});
    base.calibration = Object.assign({}, base.calibration, parsed.calibration||{});
  }
  return base;
}
async function saveState(){ await StorageAdapter.save(CONFIG.storageKey, STATE); }

function resetDailyProgressIfNeeded(){
  const t = todayStr();
  if(STATE.dailyProgress.date !== t){
    STATE.dailyProgress = { date: t, newCount: 0, reviewCount: 0 };
  }
}

function touchStreak(){
  const t = todayStr();
  if(STATE.lastStudyDate === t) return;
  if(STATE.lastStudyDate && daysBetween(STATE.lastStudyDate, t) === 1){
    STATE.streak += 1;
  } else {
    STATE.streak = 1;
  }
  STATE.lastStudyDate = t;
}

function addXP(n){
  STATE.xp += n;
  showToast(`+${n} XP`);
}

function levelInfo(xp){
  let idx = 0;
  for(let i=0;i<LEVELS.length;i++){ if(xp >= LEVELS[i].min) idx = i; }
  const cur = LEVELS[idx];
  const next = LEVELS[idx+1];
  const pct = next ? Math.min(100, Math.round(((xp-cur.min)/(next.min-cur.min))*100)) : 100;
  return { name: cur.name, level: idx+1, pct, next };
}

function checkBadges(){
  const newly = [];
  BADGES.forEach(b=>{
    if(!STATE.badges.includes(b.id) && b.check(STATE)){
      STATE.badges.push(b.id);
      newly.push(b);
    }
  });
  newly.forEach(b => showToast(`🏅 Conquista: ${b.name}`));
  return newly;
}

/* ---- SM-2 (repetição espaçada) ---- */
function sm2Update(cardState, quality){
  // quality: 1=Esqueci, 3=Difícil, 4=Bom, 5=Fácil
  if(quality < 3){
    cardState.reps = 0;
    cardState.interval = 1;
  } else {
    if(cardState.reps === 0) cardState.interval = 1;
    else if(cardState.reps === 1) cardState.interval = 6;
    else cardState.interval = Math.round(cardState.interval * cardState.ef);
    cardState.reps += 1;
  }
  cardState.ef = Math.max(1.3, cardState.ef + (0.1 - (5-quality)*(0.08+(5-quality)*0.02)));
  cardState.nextReview = addDays(todayStr(), cardState.interval);
  cardState.lastQuality = quality;
  cardState.seen = true;
}

function showToast(msg){
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function conceptStatus(c){
  const s = STATE.cards[c.id];
  if(!s.seen) return {label:"Novo", cls:"chip-new"};
  if(s.reps >= 3) return {label:"Dominado", cls:"chip-mastered"};
  if(s.reps >= 1) return {label:`Revisão ${s.reps}`, cls:"chip-review"};
  return {label:"Aprendendo", cls:"chip-learning"};
}
function dueCards(){
  const t = todayStr();
  return CONCEPTS.filter(c => STATE.cards[c.id].seen && STATE.cards[c.id].nextReview <= t);
}

/* ---- Tabs ---- */
function bindTabs(){
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=> switchTab(btn.dataset.tab));
  });
}
function switchTab(name){
  document.querySelectorAll(".tab-content").forEach(el=> el.style.display = "none");
  document.getElementById("tab-"+name).style.display = "block";
  document.querySelectorAll("nav.tabs button").forEach(b=> b.classList.toggle("active", b.dataset.tab===name));
  if(name==="aprender") renderLearn();
  if(name==="revisar") renderReview();
  if(name==="explicar") renderExplain();
  if(name==="quiz") renderQuizStart();
  if(name==="progresso") renderProgress();
  renderHeader();
}

function renderHeader(){
  const li = levelInfo(STATE.xp);
  const elLevel = document.getElementById("stat-level");
  const elXp = document.getElementById("stat-xp");
  const elStreak = document.getElementById("stat-streak");
  if(elLevel) elLevel.textContent = li.level;
  if(elXp) elXp.textContent = STATE.xp;
  if(elStreak) elStreak.textContent = STATE.streak;

  const due = dueCards().length;
  const dueBadge = document.getElementById("due-badge");
  if(dueBadge){
    if(due>0){ dueBadge.style.display="inline-block"; dueBadge.textContent = due; }
    else dueBadge.style.display = "none";
  }

  const introduced = Object.values(STATE.cards).filter(c=>c.seen).length;
  const elIntro = document.getElementById("home-introduced");
  const elDue = document.getElementById("home-due");
  if(elIntro) elIntro.textContent = `${introduced} / ${CONCEPTS.length}`;
  if(elDue) elDue.textContent = due;
}

/* ---- Aprender ---- */
let learnIndex = 0;
let learnOverrideLimit = false;
function nextUnseenIndex(){
  const idx = CONCEPTS.findIndex(c => !STATE.cards[c.id].seen);
  return idx === -1 ? 0 : idx;
}
function renderLearn(){
  resetDailyProgressIfNeeded();
  learnOverrideLimit = false;
  learnIndex = nextUnseenIndex();
  renderLearnCard();
}
function renderLearnCard(){
  const panel = document.getElementById("learn-panel");
  const total = CONCEPTS.length;
  const allDone = Object.values(STATE.cards).every(c=>c.seen);

  if(allDone){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🎉</div>
        <h2 class="section-title" style="justify-content:center;">Todos os conceitos foram apresentados!</h2>
        <p class="lead">Agora é hora de fortalecer a memória. Vá para a aba <b>Revisar</b> ou desafie-se no <b>Quiz</b>.</p>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" onclick="switchTab('revisar')">🔁 Revisar agora</button>
          <button class="btn secondary" onclick="switchTab('quiz')">🎯 Ir ao Quiz</button>
        </div>
      </div>`;
    return;
  }

  const dailyLimit = STATE.settings.dailyNewLimit;
  const limitReached = dailyLimit > 0 && STATE.dailyProgress.newCount >= dailyLimit;
  if(limitReached && !learnOverrideLimit){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🌤️</div>
        <h2 class="section-title" style="justify-content:center;">Meta diária concluída!</h2>
        <p class="lead">Você já aprendeu <b>${STATE.dailyProgress.newCount}</b> conceito(s) novo(s) hoje — sua meta é ${dailyLimit} por dia
        (dá pra mudar isso na aba Progresso). Assimilar aos poucos ajuda a memória a fixar melhor do que aprender tudo de uma vez.</p>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" onclick="switchTab('revisar')">🔁 Revisar o que já aprendi</button>
          <button class="btn secondary" id="learn-override-btn">Continuar aprendendo mesmo assim</button>
        </div>
      </div>`;
    const overrideBtn = document.getElementById("learn-override-btn");
    if(overrideBtn) overrideBtn.onclick = ()=>{ learnOverrideLimit = true; renderLearnCard(); };
    return;
  }

  const c = CONCEPTS[learnIndex];
  let track = `<div class="track">`;
  CONCEPTS.forEach((cc,i)=>{
    let cls = "dot";
    if(STATE.cards[cc.id].seen) cls += " done";
    if(i===learnIndex) cls += " current";
    track += `<div class="${cls}"></div>`;
  });
  track += `</div>`;

  panel.innerHTML = `
    <h2 class="section-title">📖 Conceito ${learnIndex+1} de ${total}</h2>
    ${track}
    <div class="concept-card" id="learn-card">
      <span class="concept-tag">${c.tag}</span>
      <div class="concept-title">${c.title}</div>
      <div class="concept-text">${c.text}</div>
      <div class="quiz-q">
        <div class="qtext">✅ Checagem rápida: ${c.q}</div>
        <div id="learn-opts"></div>
        <div id="learn-feedback"></div>
      </div>
    </div>
  `;

  const optsWrap = document.getElementById("learn-opts");
  const shuffledOptions = c.options.map((text,i)=>({text, isCorrect: i===c.correct}));
  shuffle(shuffledOptions).forEach(opt=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt.text;
    b.onclick = ()=> handleLearnAnswer(opt.isCorrect, b, optsWrap);
    optsWrap.appendChild(b);
  });
}

async function handleLearnAnswer(isCorrect, btnEl, optsWrap){
  const buttons = optsWrap.querySelectorAll(".opt");
  buttons.forEach(b=> b.classList.add("disabled"));
  buttons.forEach(b=>{ if(b === btnEl) b.classList.add(isCorrect ? "correct" : "wrong"); });

  const c = CONCEPTS[learnIndex];
  const cardState = STATE.cards[c.id];
  const wasNew = !cardState.seen;
  sm2Update(cardState, isCorrect ? 4 : 2);
  touchStreak();
  if(wasNew) STATE.dailyProgress.newCount += 1;
  addXP(isCorrect ? 10 : 4);
  await saveState();

  const fb = document.getElementById("learn-feedback");
  fb.className = "feedback " + (isCorrect ? "ok" : "bad");
  fb.textContent = isCorrect
    ? "Isso mesmo! Este conceito volta amanhã para uma revisão rápida."
    : "Quase! Releia a explicação acima — este conceito vai voltar amanhã para reforço.";

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn";
  nextBtn.style.marginTop = "14px";
  nextBtn.textContent = (learnIndex < CONCEPTS.length-1) ? "Próximo conceito →" : "Concluir";
  nextBtn.onclick = ()=>{
    checkBadges();
    learnIndex = nextUnseenIndex();
    renderHeader();
    renderLearnCard();
  };
  fb.appendChild(document.createElement("br"));
  fb.appendChild(nextBtn);
  renderHeader();
}

/* ---- Revisar ---- */
let reviewQueue = [];
let reviewHiddenByLimit = 0;
let reviewLimitOverride = false;
function renderReview(){
  resetDailyProgressIfNeeded();
  reviewLimitOverride = false;
  const allDue = shuffle(dueCards());
  const limit = STATE.settings.dailyReviewLimit;
  if(limit > 0){
    const remaining = Math.max(0, limit - STATE.dailyProgress.reviewCount);
    reviewQueue = allDue.slice(0, remaining);
    reviewHiddenByLimit = allDue.length - reviewQueue.length;
  } else {
    reviewQueue = allDue;
    reviewHiddenByLimit = 0;
  }
  renderReviewCard();
}
function renderReviewCard(){
  const panel = document.getElementById("review-panel");
  if(reviewQueue.length === 0 && !reviewLimitOverride){
    const totalSeen = Object.values(STATE.cards).filter(c=>c.seen).length;
    if(totalSeen === 0){
      panel.innerHTML = `
        <div class="empty-state">
          <div class="big">📭</div>
          <h2 class="section-title" style="justify-content:center;">Nada para revisar ainda</h2>
          <p class="lead">Você ainda não aprendeu nenhum conceito. Comece pela aba <b>Aprender</b>.</p>
          <button class="btn" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Começar a aprender</button>
        </div>`;
      return;
    }
    if(reviewHiddenByLimit > 0){
      panel.innerHTML = `
        <div class="empty-state">
          <div class="big">🌤️</div>
          <h2 class="section-title" style="justify-content:center;">Meta diária de revisão concluída!</h2>
          <p class="lead">Ainda restam <b>${reviewHiddenByLimit}</b> carta(s) pendente(s) hoje, além do seu limite diário
          (ajustável na aba Progresso). Elas continuam guardadas — só não vencem, então não há problema em deixar para depois.</p>
          <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
            <button class="btn" id="review-override-btn">Revisar mesmo assim</button>
          </div>
        </div>`;
      const overrideBtn = document.getElementById("review-override-btn");
      if(overrideBtn) overrideBtn.onclick = ()=>{
        reviewLimitOverride = true;
        reviewQueue = shuffle(dueCards()).slice(0, reviewHiddenByLimit);
        renderReviewCard();
      };
      return;
    }
    const upcoming = CONCEPTS
      .filter(c=>STATE.cards[c.id].seen)
      .map(c=>STATE.cards[c.id].nextReview)
      .sort()[0];
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">✅</div>
        <h2 class="section-title" style="justify-content:center;">Revisão em dia!</h2>
        <p class="lead">Nenhuma carta pendente hoje. ${upcoming ? `Próxima revisão programada para <b>${upcoming}</b>.` : ""}</p>
        <button class="btn secondary" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Aprender mais conceitos</button>
      </div>`;
    return;
  }

  if(reviewQueue.length === 0 && reviewLimitOverride){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">✅</div>
        <h2 class="section-title" style="justify-content:center;">Revisão concluída!</h2>
        <p class="lead">Você revisou todas as cartas disponíveis nesta sessão.</p>
      </div>`;
    return;
  }

  const c = reviewQueue[0];
  let confidence = null; // 1=baixa, 2=média, 3=alta

  panel.innerHTML = `
    <h2 class="section-title">🔁 Revisão espaçada</h2>
    <p class="lead" style="margin-top:-4px;">${reviewQueue.length} carta(s) restante(s) nesta sessão.</p>
    <div class="flash-outer">
      <div class="flashcard" id="flashcard">
        <div class="face front">
          <span class="concept-tag">${c.tag}</span>
          <div class="qtext">${c.title}</div>
          <div class="hint" id="flip-hint" style="display:none;">toque para virar</div>
        </div>
        <div class="face back">
          <div class="atext">${c.text}</div>
        </div>
      </div>
    </div>
    <div id="confidence-row">
      <p class="lead" style="text-align:center; margin-top:0;">Antes de ver a resposta: quão confiante você está de que lembra este conceito?</p>
      <div class="rate-row">
        <div class="rate-btn rate-again" data-conf="1">😟 Baixa<small>acho que não lembro</small></div>
        <div class="rate-btn rate-hard" data-conf="2">😐 Média<small>lembro em parte</small></div>
        <div class="rate-btn rate-easy" data-conf="3">😎 Alta<small>tenho certeza</small></div>
      </div>
    </div>
    <div id="rate-row" style="display:none;">
      <p class="lead" style="text-align:center; margin-top:0;">Como foi sua lembrança, de fato?</p>
      <div class="rate-row">
        <div class="rate-btn rate-again" data-q="1">Esqueci<small>revê amanhã</small></div>
        <div class="rate-btn rate-hard" data-q="3">Difícil<small>revê em breve</small></div>
        <div class="rate-btn rate-good" data-q="4">Bom<small>intervalo normal</small></div>
        <div class="rate-btn rate-easy" data-q="5">Fácil<small>intervalo maior</small></div>
      </div>
      <div id="calibration-msg"></div>
    </div>
  `;

  const flash = document.getElementById("flashcard");

  document.querySelectorAll("#confidence-row .rate-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      confidence = parseInt(btn.dataset.conf, 10);
      document.getElementById("confidence-row").style.display = "none";
      flash.classList.add("flipped");
      document.getElementById("rate-row").style.display = "block";
    });
  });

  document.querySelectorAll("#rate-row .rate-btn").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      e.stopPropagation();
      if(confidence === null) return; // segurança: não avalia sem julgamento prévio
      const q = parseInt(btn.dataset.q,10);
      const cardState = STATE.cards[c.id];
      cardState.lastConfidence = confidence;
      sm2Update(cardState, q);
      touchStreak();
      STATE.dailyProgress.reviewCount += 1;
      const xpGain = q===1?2:(q===3?5:(q===4?8:10));
      addXP(xpGain);

      // Calibração: confiança alta (3) presume acerto forte (q>=4); confiança baixa (1) presume falha (q<=1)
      const actuallyGood = q >= 4;
      const actuallyBad = q <= 1;
      let calibMsg = "";
      if(confidence === 3 && actuallyBad){
        STATE.calibration.overconfident += 1;
        calibMsg = `<div class="feedback bad">🔎 Você estava confiante, mas não lembrou — esse conceito merece atenção extra.</div>`;
      } else if(confidence === 1 && actuallyGood){
        STATE.calibration.underconfident += 1;
        calibMsg = `<div class="feedback ok">✨ Você sabia mais do que pensava! Sua confiança pode subir aqui.</div>`;
      } else {
        STATE.calibration.aligned += 1;
        calibMsg = `<div class="feedback ok">🎯 Boa calibração — sua confiança bateu com o resultado.</div>`;
      }
      const msgBox = document.getElementById("calibration-msg");
      if(msgBox) msgBox.innerHTML = calibMsg;

      reviewQueue.shift();
      if(reviewQueue.length === 0){ STATE.reviewSessions += 1; }
      await saveState();
      checkBadges();
      renderHeader();
      setTimeout(()=> renderReviewCard(), msgBox ? 900 : 0);
    });
  });
}

/* ---- Explicar (Técnica de Feynman) ---- */
let explainCurrent = null;

function pickExplainConcept(){
  const seen = CONCEPTS.filter(c => STATE.cards[c.id].seen);
  if(seen.length === 0) return null;
  const neverExplained = seen.filter(c => !STATE.cards[c.id].explainCount);
  const pool = neverExplained.length > 0 ? neverExplained : seen;
  return pool[Math.floor(Math.random()*pool.length)];
}

function renderExplain(){
  explainCurrent = pickExplainConcept();
  renderExplainCard();
}

function renderExplainCard(){
  const panel = document.getElementById("explain-panel");
  if(!explainCurrent){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🗣️</div>
        <h2 class="section-title" style="justify-content:center;">Nada para explicar ainda</h2>
        <p class="lead">Aprenda pelo menos um conceito na aba <b>Aprender</b> antes de praticar a explicação.</p>
        <button class="btn" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Começar a aprender</button>
      </div>`;
    return;
  }

  const c = explainCurrent;
  const cs = STATE.cards[c.id];
  panel.innerHTML = `
    <h2 class="section-title">🗣️ Técnica de Feynman</h2>
    <p class="lead" style="margin-top:-4px;">Explique o conceito abaixo com suas próprias palavras, como se estivesse ensinando alguém que nunca ouviu falar nisso. Não vale copiar frases prontas — o objetivo é você perceber sozinho(a) o que já entendeu bem e o que ainda está confuso.</p>
    <div class="concept-card">
      <span class="concept-tag">${c.tag}</span>
      <div class="concept-title">${c.title}</div>
      ${cs.explainCount > 0 ? `<p class="lead" style="margin-top:-6px;">Última nota: <b>${cs.lastExplainScore ?? "—"}/100</b> (tentativa ${cs.explainCount})</p>` : ""}
      <textarea id="explain-input" class="explain-textarea" rows="6" placeholder="Comece explicando aqui, com suas próprias palavras..."></textarea>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:10px; flex-wrap:wrap;">
        <span class="lead" id="explain-charcount" style="margin:0; font-size:11.5px;">0 caracteres (mínimo 30)</span>
        <button class="btn" id="explain-submit" disabled>🎓 Avaliar explicação</button>
      </div>
      <div id="explain-result"></div>
    </div>
  `;

  const input = document.getElementById("explain-input");
  const submitBtn = document.getElementById("explain-submit");
  const counter = document.getElementById("explain-charcount");
  input.addEventListener("input", ()=>{
    const len = input.value.trim().length;
    counter.textContent = `${len} caracteres (mínimo 30)`;
    submitBtn.disabled = len < 30;
  });
  submitBtn.addEventListener("click", ()=> handleExplainSubmit(c, input.value.trim()));
}

async function handleExplainSubmit(c, studentText){
  const resultBox = document.getElementById("explain-result");
  const submitBtn = document.getElementById("explain-submit");
  const previousScore = STATE.cards[c.id].lastExplainScore;
  submitBtn.disabled = true;
  submitBtn.textContent = "Avaliando...";
  resultBox.innerHTML = `<p class="lead" style="margin-top:12px;">🧠 Analisando sua explicação...</p>`;

  try{
    const res = await fetch("/api/avaliar-explicacao", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ title: c.title, referenceText: c.text, studentText })
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || `Falha ao avaliar (HTTP ${res.status})`);
    }
    const data = await res.json();
    renderExplainResult(c, data, previousScore);
  }catch(e){
    console.error(e);
    resultBox.innerHTML = `
      <div class="feedback bad" style="margin-top:12px;">
        Não foi possível avaliar sua explicação agora (${e.message}). Verifique se a chave da API está
        configurada no servidor (ANTHROPIC_API_KEY na Vercel), ou tente novamente em instantes.
      </div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "🎓 Avaliar explicação";
  }
}

function renderExplainResult(c, data, previousScore){
  const resultBox = document.getElementById("explain-result");
  const nota = Math.max(0, Math.min(100, Math.round(data.nota || 0)));
  const quality = [1,3,4,5].includes(data.qualidadeSM2)
    ? data.qualidadeSM2
    : (nota>=85 ? 5 : nota>=65 ? 4 : nota>=40 ? 3 : 1);

  const listHtml = (items, icon) => (items && items.length)
    ? `<ul style="margin:6px 0 0; padding-left:18px;">${items.map(i=>`<li style="margin-bottom:4px;">${icon} ${i}</li>`).join("")}</ul>`
    : `<p class="lead" style="margin:6px 0 0;">—</p>`;

  let comparisonHtml = "";
  if(previousScore != null){
    const delta = nota - previousScore;
    if(delta > 0){
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">📈 Você foi de <b>${previousScore}</b> para <b>${nota}</b> — melhorou ${delta} ponto(s)!</p>`;
    } else if(delta < 0){
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">📉 Você foi de <b>${previousScore}</b> para <b>${nota}</b> desta vez. Sem problema, isso também é informação útil.</p>`;
    } else {
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">➡️ Mesma nota da última vez (${previousScore}).</p>`;
    }
  }

  resultBox.innerHTML = `
    <div style="margin-top:16px; padding-top:14px; border-top:1px dashed var(--border);">
      <div class="score-big" style="font-size:32px;">${nota}/100</div>
      <div class="progressbar" style="margin-bottom:10px;"><div style="width:${nota}%"></div></div>
      ${comparisonHtml}
      <p class="feedback ${nota>=65?'ok':'bad'}">${data.feedback || ""}</p>
      <div class="grid2" style="margin-top:10px;">
        <div class="stat-card">
          <div class="label">✅ Você cobriu</div>
          ${listHtml(data.pontosCobertos, "✅")}
        </div>
        <div class="stat-card">
          <div class="label">⚠️ Ficou faltando</div>
          ${listHtml(data.pontosFaltando, "➡️")}
        </div>
      </div>
      ${data.equivocos && data.equivocos.length ? `
        <div class="stat-card" style="margin-top:10px; border-color:var(--danger);">
          <div class="label">❗ Possíveis equívocos</div>
          ${listHtml(data.equivocos, "❗")}
        </div>` : ""}
      <button class="btn" id="explain-next" style="margin-top:14px;">Próximo conceito →</button>
    </div>
  `;

  applyExplainResultToState(c, nota, quality);

  document.getElementById("explain-next").onclick = ()=>{
    renderExplain();
    renderHeader();
  };
}

async function applyExplainResultToState(c, nota, quality){
  const cardState = STATE.cards[c.id];
  cardState.explainCount = (cardState.explainCount || 0) + 1;
  cardState.lastExplainScore = nota;
  sm2Update(cardState, quality);
  touchStreak();
  const xpGain = Math.max(4, Math.round((nota/100) * 25));
  addXP(xpGain);
  await saveState();
  checkBadges();
  renderHeader();
}

/* ---- Quiz ---- */
let quizState = null;

function conceptWeakness(c){
  // Quanto maior, mais "fraco" (mais precisa de prática) o conceito está.
  const cs = STATE.cards[c.id];
  let w = Math.max(1, 5 - cs.reps); // menos repetições bem-sucedidas = mais peso
  if(cs.nextReview && cs.nextReview <= todayStr()) w += 3; // já venceu a revisão
  if(cs.lastExplainScore != null && cs.lastExplainScore < 60) w += 2; // explicou mal no modo Feynman
  if(cs.lastQuality != null && cs.lastQuality <= 2) w += 2; // última vez foi ruim
  return w;
}

function weightedSample(items, weightFn, n){
  const pool = items.map(it => ({ it, w: Math.max(0.0001, weightFn(it)) }));
  const result = [];
  while(result.length < n && pool.length > 0){
    const total = pool.reduce((s,p)=>s+p.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for(; idx < pool.length; idx++){ r -= pool[idx].w; if(r <= 0) break; }
    idx = Math.min(idx, pool.length - 1);
    result.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return result;
}

function renderQuizStart(){
  const panel = document.getElementById("quiz-panel");
  const seenCount = CONCEPTS.filter(c => STATE.cards[c.id].seen).length;
  const adaptiveN = Math.min(10, seenCount);
  panel.innerHTML = `
    <h2 class="section-title">🎯 Quiz</h2>

    <div class="concept-card" style="margin-bottom:14px;">
      <div class="concept-title" style="font-size:15px;">🧠 Quiz Adaptativo</div>
      <p class="lead" style="margin-top:-2px;">Foca nos conceitos que você ainda não domina bem — prioriza os que erraram
      recentemente, têm poucas repetições ou estão com revisão vencida. ${seenCount > 0
        ? `${adaptiveN} pergunta(s), sua melhor pontuação: <b>${STATE.quiz.bestAdaptive || 0}/${adaptiveN || "-"}</b>.`
        : "Aprenda ao menos 1 conceito para liberar este modo."}</p>
      <button class="btn" id="start-quiz-adaptive" ${seenCount === 0 ? "disabled" : ""}>🎯 Iniciar Quiz Adaptativo</button>
    </div>

    <div class="concept-card">
      <div class="concept-title" style="font-size:15px;">📋 Quiz Completo</div>
      <p class="lead" style="margin-top:-2px;">Um desafio com todos os ${CONCEPTS.length} conceitos deste módulo, em ordem aleatória.
      Sua melhor pontuação: <b>${STATE.quiz.best}/${CONCEPTS.length}</b>.</p>
      <button class="btn secondary" id="start-quiz-full">▶️ Iniciar Quiz Completo</button>
    </div>
  `;
  document.getElementById("start-quiz-full").onclick = ()=> startQuiz("full");
  const adaptiveBtn = document.getElementById("start-quiz-adaptive");
  if(adaptiveBtn) adaptiveBtn.onclick = ()=> startQuiz("adaptive");
}

function startQuiz(mode){
  mode = mode || "full";
  let order;
  if(mode === "adaptive"){
    const pool = CONCEPTS.filter(c => STATE.cards[c.id].seen);
    const n = Math.min(10, pool.length);
    order = weightedSample(pool, conceptWeakness, n);
  } else {
    order = shuffle(CONCEPTS);
  }
  quizState = { mode, order, index:0, correct:0, answered:false };
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const panel = document.getElementById("quiz-panel");
  const {order, index, correct} = quizState;
  if(index >= order.length){ finishQuiz(); return; }
  const c = order[index];
  panel.innerHTML = `
    <div class="quiz-progress">
      <span>Pergunta ${index+1} de ${order.length}</span>
      <span>Acertos: ${correct}</span>
    </div>
    <div class="progressbar" style="margin-bottom:16px;"><div style="width:${(index/order.length)*100}%"></div></div>
    <div class="concept-card">
      <span class="concept-tag">${c.tag}</span>
      <div class="qtext" style="margin-top:8px;">${c.q}</div>
      <div id="quiz-opts" style="margin-top:12px;"></div>
      <div id="quiz-feedback"></div>
    </div>
  `;
  const optsWrap = document.getElementById("quiz-opts");
  const shuffledOptions = c.options.map((text,i)=>({text, isCorrect:i===c.correct}));
  shuffle(shuffledOptions).forEach(opt=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt.text;
    b.onclick = ()=> handleQuizAnswer(c, opt.isCorrect, b, optsWrap);
    optsWrap.appendChild(b);
  });
}
async function handleQuizAnswer(c, isCorrect, btnEl, optsWrap){
  if(quizState.answered) return;
  quizState.answered = true;
  optsWrap.querySelectorAll(".opt").forEach(b=>{
    b.classList.add("disabled");
    if(b===btnEl) b.classList.add(isCorrect?"correct":"wrong");
  });
  if(isCorrect) quizState.correct++;

  const cardState = STATE.cards[c.id];
  if(cardState.seen){ sm2Update(cardState, isCorrect ? 5 : 2); }
  await saveState();

  const fb = document.getElementById("quiz-feedback");
  fb.className = "feedback " + (isCorrect?"ok":"bad");
  fb.textContent = isCorrect ? "Correto!" : "Não foi dessa vez.";
  const nextBtn = document.createElement("button");
  nextBtn.className = "btn";
  nextBtn.style.marginTop = "12px";
  nextBtn.textContent = "Próxima →";
  nextBtn.onclick = ()=>{
    quizState.index++;
    quizState.answered = false;
    renderQuizQuestion();
  };
  fb.appendChild(document.createElement("br"));
  fb.appendChild(nextBtn);
}
async function finishQuiz(){
  const {order, correct, mode} = quizState;
  touchStreak();
  STATE.quiz.played += 1;
  if(mode === "adaptive"){
    STATE.quiz.bestAdaptive = Math.max(STATE.quiz.bestAdaptive || 0, correct);
  } else {
    STATE.quiz.best = Math.max(STATE.quiz.best, correct);
  }
  const bonus = Math.round((correct/order.length)*30);
  addXP(bonus);
  await saveState();
  checkBadges();
  renderHeader();

  const panel = document.getElementById("quiz-panel");
  panel.innerHTML = `
    <h2 class="section-title" style="justify-content:center;">🏁 Resultado — ${mode === "adaptive" ? "Quiz Adaptativo" : "Quiz Completo"}</h2>
    <div class="score-big">${correct} / ${order.length}</div>
    <p class="lead" style="text-align:center;">Você ganhou +${bonus} XP neste desafio.</p>
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:10px;">
      <button class="btn" id="retry-quiz">🔁 Tentar novamente</button>
      <button class="btn secondary" onclick="switchTab('progresso')">📊 Ver progresso</button>
    </div>
  `;
  document.getElementById("retry-quiz").onclick = ()=> startQuiz(mode);
}

/* ---- Progresso ---- */
function renderProgress(){
  const li = levelInfo(STATE.xp);
  document.getElementById("prog-level-name").textContent = li.name;
  document.getElementById("prog-xp-bar").style.width = li.pct + "%";
  document.getElementById("prog-xp-text").textContent = li.next
    ? `${STATE.xp} XP — faltam ${li.next.min - STATE.xp} XP para o próximo nível`
    : `${STATE.xp} XP — nível máximo alcançado!`;

  const mastered = Object.values(STATE.cards).filter(c=>c.reps>=3).length;
  const masteryPct = CONCEPTS.length ? Math.round((mastered/CONCEPTS.length)*100) : 0;
  document.getElementById("prog-mastery").textContent = masteryPct + "%";
  document.getElementById("prog-mastery-bar").style.width = masteryPct + "%";

  const badgesGrid = document.getElementById("badges-grid");
  badgesGrid.innerHTML = "";
  BADGES.forEach(b=>{
    const unlocked = STATE.badges.includes(b.id);
    const div = document.createElement("div");
    div.className = "badge-item" + (unlocked?"":" locked");
    div.innerHTML = `<div class="ic">${b.ic}</div><div><b>${b.name}</b></div><div style="opacity:.8;">${b.desc}</div>`;
    badgesGrid.appendChild(div);
  });

  const list = document.getElementById("concept-list");
  list.innerHTML = "";
  CONCEPTS.forEach(c=>{
    const st = conceptStatus(c);
    const cs = STATE.cards[c.id];
    const row = document.createElement("div");
    row.className = "concept-row";
    row.innerHTML = `
      <div>
        <div style="font-weight:700;">${c.title}</div>
        <div style="color:var(--text-dim); font-size:11.5px;">${cs.seen ? "Próxima revisão: " + cs.nextReview : "Ainda não apresentado"}</div>
      </div>
      <span class="status-chip ${st.cls}">${st.label}</span>
    `;
    list.appendChild(row);
  });

  const calibAlignedEl = document.getElementById("calib-aligned");
  const calibOverEl = document.getElementById("calib-over");
  const calibUnderText = document.getElementById("calib-under-text");
  if(calibAlignedEl) calibAlignedEl.textContent = STATE.calibration.aligned;
  if(calibOverEl) calibOverEl.textContent = STATE.calibration.overconfident;
  if(calibUnderText){
    const totalJudg = STATE.calibration.aligned + STATE.calibration.overconfident + STATE.calibration.underconfident;
    calibUnderText.textContent = totalJudg > 0
      ? `Também houve ${STATE.calibration.underconfident} vez(es) em que você sabia mais do que pensava, de um total de ${totalJudg} julgamentos.`
      : "Ainda sem dados — faça algumas revisões na aba Revisar para começar a ver sua calibração aqui.";
  }

  const newLimitInput = document.getElementById("setting-new-limit");
  const reviewLimitInput = document.getElementById("setting-review-limit");
  if(newLimitInput) newLimitInput.value = STATE.settings.dailyNewLimit;
  if(reviewLimitInput) reviewLimitInput.value = STATE.settings.dailyReviewLimit;
  const saveBtn = document.getElementById("save-settings-btn");
  if(saveBtn){
    saveBtn.onclick = async ()=>{
      const newVal = Math.max(1, parseInt(newLimitInput.value,10) || 5);
      const reviewVal = Math.max(0, parseInt(reviewLimitInput.value,10) || 0);
      STATE.settings.dailyNewLimit = newVal;
      STATE.settings.dailyReviewLimit = reviewVal;
      await saveState();
      showToast("⚙️ Metas diárias salvas");
    };
  }
}

function applyConfigToDOM(){
  document.title = CONFIG.appTitle;
  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  setText("app-logo", CONFIG.logoEmoji);
  setText("app-title", CONFIG.appTitle);
  setText("app-subtitle", CONFIG.appSubtitle);
  setText("home-intro-text", CONFIG.homeIntro);
  const footer = document.getElementById("footer-credit");
  if(footer) footer.innerHTML = CONFIG.sourceCredit + "<br>Progresso salvo automaticamente.";
}

/* =====================================================================
   PONTO DE ENTRADA — chamado por app.html depois de buscar o JSON
   do módulo (CONFIG + CONCEPTS) em /content.
   ===================================================================== */
async function initApp(config, concepts){
  CONFIG = config;
  CONCEPTS = concepts;
  STATE = await loadState();
  bindTabs();
  applyConfigToDOM();
  renderHeader();
  renderProgress();
  switchTab("inicio");
}
