/* =====================================================================
   MOTOR COMPARTILHADO DO APP DE ESTUDO
   =====================================================================
   Este arquivo NÃO contém conteúdo de nenhum tema — apenas a lógica de:
   repetição espaçada (FSRS), gamificação (XP/níveis/streak/badges) e
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
// Etapa 2 — "voltar ao trecho original": id do material da Biblioteca que
// originou este módulo (null pra módulos sem origem em PDF, ex.: fluxo de
// criar-modulo.html/catálogo estático). Cada conceito pode ter "sourcePage"
// (número da página) e "sourceExcerpt" (trecho curto do texto real daquela
// página, extraído em importar-livro.html — nunca escrito pela IA) — juntos
// dão a citação do trecho original e o link pro leitor.
let SOURCE_MATERIAL_ID = null;
// Etapa 3 — "associar anotação a conceitos ou módulos": id deste módulo
// (usado pra achar quais anotações do leitor foram vinculadas a ele) e a
// lista de anotações já filtradas (por app.html) pra este módulo.
let MODULE_ID = null;
let LINKED_NOTES = [];

function sourceLinkHtml(c){
  if(!SOURCE_MATERIAL_ID) return "";
  let html = "";
  if(c.sourceExcerpt){
    html += `<blockquote class="lead" style="font-style:italic; font-size:12px; margin:10px 0 0; padding:6px 10px; border-left:2px solid var(--border); background:rgba(255,255,255,0.03); border-radius:0 8px 8px 0;">"${escapeHtml(c.sourceExcerpt)}"</blockquote>`;
  }
  if(c.sourcePage){
    const url = `leitor.html?material=${encodeURIComponent(SOURCE_MATERIAL_ID)}&page=${encodeURIComponent(c.sourcePage)}`;
    html += `<a class="btn ghost" href="${url}" target="_blank" rel="noopener" style="margin-top:8px; display:inline-block; text-decoration:none; font-size:12.5px;">↩ Ver trecho original (pág. ${c.sourcePage})</a>`;
  }
  return html;
}

// Anotações feitas no leitor de PDF e vinculadas especificamente a este
// conceito (via linkedConceptId). Retorna [] quando não há nenhuma.
function notesForConcept(c){
  if(!LINKED_NOTES || LINKED_NOTES.length === 0) return [];
  return LINKED_NOTES.filter(n => n.linkedConceptId === c.id);
}

function linkedNotesHtml(c){
  const notes = notesForConcept(c);
  if(notes.length === 0) return "";
  const items = notes.map(n => `
    <li style="margin:4px 0;">
      <a href="leitor.html?material=${encodeURIComponent(SOURCE_MATERIAL_ID)}&page=${encodeURIComponent(n.pageNumber)}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;">
        📝 ${escapeHtml(n.text).slice(0, 140)}
      </a>
    </li>
  `).join("");
  return `
    <div style="margin-top:10px; font-size:12.5px; color:var(--text-dim);">
      <div style="font-weight:600; margin-bottom:2px;">Suas anotações sobre este conceito:</div>
      <ul style="margin:0; padding-left:18px;">${items}</ul>
    </div>
  `;
}

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
    // Campos do FSRS (repetição espaçada) — stability/difficulty ficam null
    // até a primeira revisão. interval/ef são mantidos só por compatibilidade
    // com progresso salvo antes da migração do SM-2 para o FSRS.
    cards[c.id] = {
      stability:null, difficulty:null, lastReviewDate:null,
      ef:2.5, interval:0, reps:0, nextReview: null, seen:false, lastQuality:null,
      explainCount:0, lastExplainScore:null, analogy:null
    };
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

// Gamificação desativada: XP, níveis, streak e badges saíram da interface.
// Num produto cujo propósito é impedir a sensação falsa de progresso, pontuar
// a tentativa recria a ilusão em outro lugar. Os campos continuam no STATE
// apenas para não invalidar o progresso já salvo de quem usou as versões
// anteriores — nada é exibido nem premiado.
const GAMIFICATION_ENABLED = false;

function addXP(n){
  if(!GAMIFICATION_ENABLED) return;
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
  if(!GAMIFICATION_ENABLED) return;
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

/* ---- FSRS (repetição espaçada) ----
   Substitui o SM-2 usado até a Fase 4. FSRS modela a memória de cada
   ficha com dois números que evoluem a cada revisão:
   - stability (S): quantos dias levam para a chance de lembrar cair a 90%.
   - difficulty (D): de 1 (fácil) a 10 (difícil), quão rápido a estabilidade
     cresce a cada acerto.
   A partir desses dois valores, calcula-se retrievability (R, a chance
   estimada de lembrar HOJE) e o próximo intervalo de revisão, mirando
   sempre 90% de chance de lembrança na hora da próxima revisão.

   Pesos padrão da comunidade open-spaced-repetition (FSRS-4.5) — não são
   ajustados por usuário aqui (isso exigiria um histórico de revisões para
   treinar um modelo por pessoa, fora do escopo deste app).
   Referência: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm */
const FSRS_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621
];
const FSRS_FACTOR = 19 / 81;
const FSRS_DECAY = -0.5;
const FSRS_DESIRED_RETENTION = 0.9;

function fsrsClampD(d){ return Math.min(10, Math.max(1, d)); }

// t = dias desde a última revisão, s = stability atual → probabilidade estimada de lembrar hoje.
function fsrsRetrievability(t, s){
  if(!s || s <= 0) return 0;
  return Math.pow(1 + FSRS_FACTOR * (t / s), FSRS_DECAY);
}
// Dado o stability, calcula em quantos dias a retrievability cai até a meta (90%).
function fsrsIntervalDays(s){
  return (s / FSRS_FACTOR) * (Math.pow(FSRS_DESIRED_RETENTION, 1 / FSRS_DECAY) - 1);
}
function fsrsInitialStability(g){ return FSRS_W[g - 1]; } // g=1..4 → W[0..3]
function fsrsInitialDifficulty(g){
  return fsrsClampD(FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1);
}
function fsrsNextDifficulty(d, g){
  const deltaD = -FSRS_W[6] * (g - 3);
  const dPrime = d + deltaD * ((10 - d) / 9);
  return fsrsClampD(FSRS_W[7] * fsrsInitialDifficulty(4) + (1 - FSRS_W[7]) * dPrime);
}
function fsrsStabilityAfterSuccess(d, s, r, g){
  const tD = 11 - d;
  const tS = Math.pow(s, -FSRS_W[9]);
  const tR = Math.exp(FSRS_W[10] * (1 - r)) - 1;
  const hardPenalty = g === 2 ? FSRS_W[15] : 1;
  const easyBonus = g === 4 ? FSRS_W[16] : 1;
  const alpha = 1 + tD * tS * tR * hardPenalty * easyBonus * Math.exp(FSRS_W[8]);
  return s * alpha;
}
function fsrsStabilityAfterFail(d, s, r){
  const dF = Math.pow(d, -FSRS_W[12]);
  const sF = Math.pow(s + 1, FSRS_W[13]) - 1;
  const rF = Math.exp(FSRS_W[14] * (1 - r));
  return Math.min(dF * sF * rF * FSRS_W[11], s);
}

// Converte a escala de qualidade usada no app (1=Esqueci, 2=Errou na
// checagem, 3=Difícil, 4=Bom, 5=Fácil) para a nota FSRS de 4 pontos
// (1=Forgot, 2=Hard, 3=Good, 4=Easy).
function qualityToFsrsGrade(quality){
  if(quality <= 2) return 1;
  if(quality === 3) return 2;
  if(quality === 4) return 3;
  return 4;
}

function fsrsUpdate(cardState, quality){
  const g = qualityToFsrsGrade(quality);
  const today = todayStr();

  if(cardState.stability == null || cardState.difficulty == null){
    // Primeira vez desta ficha no FSRS. Se ela já tinha progresso do
    // algoritmo antigo (SM-2, antes da Fase 4), reaproveita o intervalo
    // já calculado como estimativa inicial de estabilidade, em vez de
    // reiniciar do zero — assim quem já vinha estudando não perde todo
    // o histórico de repetição ao ganhar esta atualização.
    cardState.stability = (cardState.seen && cardState.interval > 0)
      ? Math.max(1, cardState.interval)
      : fsrsInitialStability(g);
    cardState.difficulty = fsrsInitialDifficulty(g);
  } else {
    const elapsedDays = cardState.lastReviewDate ? Math.max(0, daysBetween(cardState.lastReviewDate, today)) : 0;
    const r = fsrsRetrievability(elapsedDays, cardState.stability);
    cardState.stability = (g === 1)
      ? fsrsStabilityAfterFail(cardState.difficulty, cardState.stability, r)
      : fsrsStabilityAfterSuccess(cardState.difficulty, cardState.stability, r, g);
    cardState.difficulty = fsrsNextDifficulty(cardState.difficulty, g);
  }

  // "reps" não participa mais do cálculo do intervalo — fica só para
  // exibição na tela de Progresso e para as conquistas (badges).
  cardState.reps = (g === 1) ? 0 : (cardState.reps || 0) + 1;

  const intervalDays = Math.max(1, Math.round(fsrsIntervalDays(cardState.stability)));
  cardState.interval = intervalDays;
  cardState.nextReview = addDays(today, intervalDays);
  cardState.lastReviewDate = today;
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
  // T2: sair da tela de estudo (aprender/revisar/quiz/explicar) pra
  // qualquer outra aba é um bom momento pra garantir que o progresso
  // recente já foi pro Firestore, sem esperar o debounce normal. Não
  // trava a troca de aba — dispara e segue (o storage.js já lida com
  // não sobrepor gravações).
  if(CONFIG && typeof StorageAdapter !== "undefined" && StorageAdapter.flush) StorageAdapter.flush(CONFIG.storageKey).catch(()=>{});

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
  const due = dueCards().length;
  const elDueStat = document.getElementById("stat-due");
  if(elDueStat) elDueStat.textContent = due;
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
          <button class="btn" onclick="switchTab('explicar')">🗣️ Explicar agora</button>
          <button class="btn secondary" onclick="switchTab('revisar')">🔁 Revisão rápida</button>
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
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="concept-title">${escapeHtml(c.title)}</div>
      <div class="concept-text">${escapeHtml(c.text)}</div>
      ${sourceLinkHtml(c)}
      ${linkedNotesHtml(c)}
      <div id="analogy-box">
        ${STATE.cards[c.id].analogy ? renderAnalogyHtml(STATE.cards[c.id].analogy) : `<button class="btn ghost" id="analogy-btn">💡 Ver explicação com analogia</button>`}
      </div>
      <div class="quiz-q">
        <div class="qtext">✅ Checagem rápida: ${escapeHtml(c.q)}</div>
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

  const analogyBtn = document.getElementById("analogy-btn");
  if(analogyBtn) analogyBtn.onclick = ()=> loadAnalogy(c);
}

function renderAnalogyHtml(text){
  return `<div class="feedback ok" style="margin-top:10px;"><b>💡 Outra forma de pensar nisso:</b><br>${escapeHtml(text)}</div>`;
}

async function loadAnalogy(c){
  const box = document.getElementById("analogy-box");
  box.innerHTML = `<p class="lead" style="margin-top:10px;">🧠 Pensando numa analogia...</p>`;
  try{
    const resp = await authedFetch("/api/gerar-analogia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: c.title, referenceText: c.text })
    });
    const data = await resp.json();
    if(!resp.ok){
      box.innerHTML = `<div class="feedback bad" style="margin-top:10px;">${escapeHtml(data.error || "Não foi possível gerar a analogia agora.")}</div>`;
      return;
    }
    STATE.cards[c.id].analogy = data.analogia;
    await saveState();
    box.innerHTML = renderAnalogyHtml(data.analogia);
  }catch(e){
    console.error(e);
    box.innerHTML = `<div class="feedback bad" style="margin-top:10px;">Erro ao gerar analogia. Tente novamente.</div>`;
  }
}

async function handleLearnAnswer(isCorrect, btnEl, optsWrap){
  const buttons = optsWrap.querySelectorAll(".opt");
  buttons.forEach(b=> b.classList.add("disabled"));
  buttons.forEach(b=>{ if(b === btnEl) b.classList.add(isCorrect ? "correct" : "wrong"); });

  const c = CONCEPTS[learnIndex];
  const cardState = STATE.cards[c.id];
  const wasNew = !cardState.seen;
  fsrsUpdate(cardState, isCorrect ? 4 : 2);
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
          <span class="concept-tag">${escapeHtml(c.tag)}</span>
          <div class="qtext">${escapeHtml(c.title)}</div>
          <div class="hint" id="flip-hint" style="display:none;">toque para virar</div>
        </div>
        <div class="face back">
          <div class="atext">${c.text}</div>
        </div>
      </div>
    </div>
    <div style="text-align:center;">${sourceLinkHtml(c)}${linkedNotesHtml(c)}</div>
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
      fsrsUpdate(cardState, q);
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

// Ordem de prioridade do que é pedido para explicar. O vencimento vem primeiro:
// é o que fecha o ciclo entre a avaliação da explicação (que já alimenta o FSRS)
// e a cobrança seguinte. Antes esta função sorteava sem olhar nextReview, então
// um conceito vencido podia nunca voltar — a repetição espaçada agendava, mas
// nada consultava esse agendamento.
function pickExplainConcept(){
  const seen = CONCEPTS.filter(c => STATE.cards[c.id].seen);
  if(seen.length === 0) return null;

  const today = todayStr();
  // 1) vencidos, do mais atrasado para o menos
  const due = seen
    .filter(c => STATE.cards[c.id].nextReview <= today)
    .sort((a,b) => String(STATE.cards[a.id].nextReview).localeCompare(String(STATE.cards[b.id].nextReview)));
  if(due.length > 0) return due[0];

  // 2) nada vencido: conceitos que ainda nunca foram explicados
  const neverExplained = seen.filter(c => !STATE.cards[c.id].explainCount);
  if(neverExplained.length > 0) return neverExplained[Math.floor(Math.random()*neverExplained.length)];

  // 3) tudo em dia: revisão livre, sorteada
  return seen[Math.floor(Math.random()*seen.length)];
}

// Quantos conceitos estão vencidos e portanto serão pedidos antes dos demais.
function dueForExplanation(){
  const today = todayStr();
  return CONCEPTS.filter(c => STATE.cards[c.id].seen && STATE.cards[c.id].nextReview <= today);
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
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="concept-title">${escapeHtml(c.title)}</div>
      ${cs.explainCount > 0 ? `<p class="lead" style="margin-top:-6px;">Última nota: <b>${cs.lastExplainScore ?? "—"}/100</b> (tentativa ${cs.explainCount})</p>` : ""}
      ${cs.seen && cs.nextReview <= todayStr()
        ? `<p class="lead" style="margin-top:-6px;">🗣️ Este conceito voltou hoje${cs.explainCount > 0 ? " porque a última explicação indicou que ele ainda não estava firme" : ""}. Faltam ${Math.max(0, dueForExplanation().length - 1)} depois deste.</p>`
        : `<p class="lead" style="margin-top:-6px;">✅ Nada vencido no momento — este é um treino extra, por sua conta.</p>`}
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
    const res = await authedFetch("/api/avaliar-explicacao", {
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
        Não foi possível avaliar sua explicação agora (${escapeHtml(e.message || "erro inesperado")}). Tente novamente em instantes.
      </div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "🎓 Avaliar explicação";
  }
}

function renderExplainResult(c, data, previousScore){
  const resultBox = document.getElementById("explain-result");
  const nota = Math.max(0, Math.min(100, Math.round(data.nota || 0)));
  // Limiares alinhados ao servidor (api/avaliar-explicacao.js). Mais rigorosos
  // que os anteriores (85/65/40) de propósito: uma nota generosa manda o conceito
  // para semanas depois, que é justamente o que o modo Feynman existe para evitar.
  const qualityByScore = nota>=90 ? 5 : nota>=70 ? 4 : nota>=45 ? 3 : 1;
  const quality = [1,3,4,5].includes(data.qualidadeSM2)
    ? Math.min(data.qualidadeSM2, qualityByScore)
    : qualityByScore;

  const listHtml = (items, icon) => (items && items.length)
    ? `<ul style="margin:6px 0 0; padding-left:18px;">${items.map(i=>`<li style="margin-bottom:4px;">${icon} ${escapeHtml(i)}</li>`).join("")}</ul>`
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
      <p class="feedback ${nota>=70?'ok':'bad'}">${escapeHtml(data.feedback || "")}</p>
      ${data.mecanismoCentral ? `
        <div class="stat-card" style="margin-top:10px;">
          <div class="label">🔑 O mecanismo central deste conceito</div>
          <p class="lead" style="margin:6px 0 0;">${escapeHtml(data.mecanismoCentral)}</p>
          ${data.mecanismoNoTexto
            ? `<p class="lead" style="margin:6px 0 0;">✅ Você enunciou: “${escapeHtml(data.mecanismoNoTexto)}”</p>`
            : `<p class="lead" style="margin:6px 0 0;">➡️ Não encontrei no seu texto uma frase que diga <b>como</b> isso funciona — só os elementos envolvidos. É esse o próximo passo.</p>`}
        </div>` : ""}
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

  applyExplainResultToState(c, nota, quality, previousScore);

  document.getElementById("explain-next").onclick = ()=>{
    renderExplain();
    renderHeader();
  };
}

async function applyExplainResultToState(c, nota, quality, previousScore){
  const cardState = STATE.cards[c.id];
  cardState.explainCount = (cardState.explainCount || 0) + 1;
  cardState.lastExplainScore = nota;
  fsrsUpdate(cardState, quality);
  touchStreak();
  // XP premia demonstração de entendimento e progresso real entre tentativas.
  // Antes era Math.max(4, nota/100*25), o que dava mais pontos a uma explicação
  // fluente e vazia (nota 72) do que a um erro conceitual honesto (nota 35) —
  // incoerente num produto cujo propósito é justamente não recompensar a ilusão.
  const improvement = previousScore != null ? Math.max(0, nota - previousScore) : 0;
  const xpGain = (nota >= 70 ? Math.round((nota/100) * 25) : 0)
    + Math.round(improvement / 5)
    + 2; // participação: escrever e receber o diagnóstico já vale algo
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
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="qtext" style="margin-top:8px;">${escapeHtml(c.q)}</div>
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
  if(cardState.seen){ fsrsUpdate(cardState, isCorrect ? 5 : 2); }
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
  await saveState();
  checkBadges();
  renderHeader();

  const panel = document.getElementById("quiz-panel");
  panel.innerHTML = `
    <h2 class="section-title" style="justify-content:center;">🏁 Resultado — ${mode === "adaptive" ? "Quiz Adaptativo" : "Quiz Completo"}</h2>
    <div class="score-big">${correct} / ${order.length}</div>
    <p class="lead" style="text-align:center;">Reconhecer a alternativa certa é mais fácil do que explicar. Se quiser saber se entendeu mesmo, escreva o conceito na aba Explicar.</p>
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:10px;">
      <button class="btn" id="retry-quiz">🔁 Tentar novamente</button>
      <button class="btn secondary" onclick="switchTab('explicar')">🗣️ Ir para Explicar</button>
    </div>
  `;
  document.getElementById("retry-quiz").onclick = ()=> startQuiz(mode);
}

/* ---- Progresso ---- */
function renderProgress(){
  // Progresso deixou de ser pontuação e passou a ser capacidade de explicar:
  // quantos conceitos você já conseguiu enunciar bem, e quantos estão devendo.
  const explained = Object.values(STATE.cards).filter(c => c.lastExplainScore != null);
  const solid = explained.filter(c => c.lastExplainScore >= 70).length;
  const shaky = explained.length - solid;
  const neverExplained = Object.values(STATE.cards).filter(c => c.seen && c.lastExplainScore == null).length;
  const solidPct = CONCEPTS.length ? Math.round((solid / CONCEPTS.length) * 100) : 0;

  const levelNameEl = document.getElementById("prog-level-name");
  if(levelNameEl) levelNameEl.textContent = `${solid} de ${CONCEPTS.length} conceitos você já conseguiu explicar bem`;
  const xpBarEl = document.getElementById("prog-xp-bar");
  if(xpBarEl) xpBarEl.style.width = solidPct + "%";
  const xpTextEl = document.getElementById("prog-xp-text");
  if(xpTextEl){
    xpTextEl.textContent = explained.length === 0
      ? "Você ainda não explicou nenhum conceito. É a aba Explicar que move este número."
      : `${shaky} explicação(ões) ainda fraca(s) e ${neverExplained} conceito(s) vistos que você nunca tentou explicar.`;
  }

  const mastered = Object.values(STATE.cards).filter(c=>c.reps>=3).length;
  const masteryPct = CONCEPTS.length ? Math.round((mastered/CONCEPTS.length)*100) : 0;
  const masteryEl = document.getElementById("prog-mastery");
  if(masteryEl) masteryEl.textContent = masteryPct + "%";
  const masteryBarEl = document.getElementById("prog-mastery-bar");
  if(masteryBarEl) masteryBarEl.style.width = masteryPct + "%";

  // Badges saíram da interface junto com a gamificação.
  const badgesGrid = document.getElementById("badges-grid");
  if(badgesGrid){
    const badgesPanel = badgesGrid.closest(".panel");
    if(badgesPanel) badgesPanel.style.display = "none";
  }

  const list = document.getElementById("concept-list");
  list.innerHTML = "";
  CONCEPTS.forEach(c=>{
    const st = conceptStatus(c);
    const cs = STATE.cards[c.id];
    const row = document.createElement("div");
    row.className = "concept-row";
    row.innerHTML = `
      <div>
        <div style="font-weight:700;">${escapeHtml(c.title)}</div>
        <div style="color:var(--text-dim); font-size:11.5px;">${cs.seen
          ? (cs.lastExplainScore != null
              ? `Última explicação: ${cs.lastExplainScore}/100 · volta em ${cs.nextReview}`
              : `Nunca explicado · volta em ${cs.nextReview}`)
          : "Ainda não apresentado"}</div>
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

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Renderiza o resumo do módulo (CONFIG.homeIntro) como texto formatado: linhas
// normais viram parágrafos, linhas começando com "• " viram itens de lista —
// para o resumo gerado por IA (introdução + tópicos principais) aparecer
// como uma lista de verdade, em vez de tudo grudado numa linha só.
function renderHomeIntroHtml(text){
  if(!text) return "";
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  let html = "";
  let inList = false;
  lines.forEach(line=>{
    const isBullet = /^[•\-*]\s+/.test(line);
    const content = escapeHtml(line.replace(/^[•\-*]\s+/, ""));
    if(isBullet){
      if(!inList){ html += "<ul>"; inList = true; }
      html += `<li>${content}</li>`;
    } else {
      if(inList){ html += "</ul>"; inList = false; }
      html += `<p>${content}</p>`;
    }
  });
  if(inList) html += "</ul>";
  return html;
}

function applyConfigToDOM(){
  document.title = CONFIG.appTitle;
  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  setText("app-logo", CONFIG.logoEmoji);
  setText("app-title", CONFIG.appTitle);
  setText("app-subtitle", CONFIG.appSubtitle);
  const introEl = document.getElementById("home-intro-text");
  if(introEl) introEl.innerHTML = renderHomeIntroHtml(CONFIG.homeIntro);
  const footer = document.getElementById("footer-credit");
  if(footer) footer.innerHTML = escapeHtml(CONFIG.sourceCredit || "") + "<br>Progresso salvo automaticamente.";
}

/* =====================================================================
   PONTO DE ENTRADA — chamado por app.html depois de buscar o JSON
   do módulo (CONFIG + CONCEPTS) em /content.
   ===================================================================== */
// T2: garante que o progresso pendente (ainda não gravado no Firestore
// por causa do debounce em storage.js) não se perde em situações onde a
// pessoa não passa por switchTab — minimizar a aba, trocar de app no
// celular, fechar a aba, navegar pra outro módulo. "visibilitychange"
// cobre a imensa maioria dos casos (dispara ao minimizar/trocar de aba/
// app, e também antes da navegação sair da página, na prática, na
// maioria dos navegadores); "pagehide" é a rede de segurança adicional
// pro caso de navegação/fechamento que "visibilitychange" não pegar —
// de propósito NÃO depende só de "beforeunload" (que não é confiável em
// mobile e é cada vez mais restrito por navegadores modernos).
let flushListenersBound = false;
function bindStateFlushListeners(){
  if(flushListenersBound) return;
  flushListenersBound = true;
  const flushNow = ()=>{
    if(!CONFIG || typeof StorageAdapter === "undefined" || !StorageAdapter.flush) return;
    StorageAdapter.flush(CONFIG.storageKey).catch(()=>{});
  };
  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden) flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

async function initApp(config, concepts, sourceMaterialId, moduleId, linkedNotes){
  CONFIG = config;
  CONCEPTS = concepts;
  SOURCE_MATERIAL_ID = sourceMaterialId || null;
  MODULE_ID = moduleId || null;
  LINKED_NOTES = Array.isArray(linkedNotes) ? linkedNotes : [];
  STATE = await loadState();
  bindTabs();
  bindStateFlushListeners();
  applyConfigToDOM();
  renderHeader();
  renderProgress();
  switchTab("inicio");
}
