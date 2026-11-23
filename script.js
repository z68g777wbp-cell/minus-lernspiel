(() => {
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  const MOVE_MS = 650;
  const COVER_AFTER_MS = 1800;
  const HOLD_AFTER_RESULT_MS = 850;
  const STEP_LEVEL_HOLD_MS = 1000; // Stufen mit Rechenweg (2, 5, 6): 1 s nach der gelben Animation
  const DEAD_END_RESET_MS = 1000; // Rechenweg ohne Ziel: grünes Feld kurz zeigen, dann zurück auf Start
  const FULLSCREEN_EDGE = 8;      // Randabstand oben/unten im Vollbild
  const VIZ_FIELD_GAP = 10;       // entspricht margin-bottom von .vizField

  const TEN_SPACER = 16;
  const MAX_TENS_SLOTS = 9; // Bis zu neun positionsgetreue Spalten

  const state = {
    level: 1,
    roundTaskCount: 20,
    animationEnabled: true,
    directMode: false, // Schalter „ohne Rechenschritte“ (Stufen 2, 5, 6)
    startNumber: 0,
    subtrahend: 0,
    currentValue: 0,
    steps: [],

    vizShown: true,
    coverTimer: null,
    isAnimating: false,
    resetPending: false,
    resetTimer: null,

    wrongCountedThisTask: false,
    failedAttemptsThisTask: 0,
    taskFinished: false,
    taskStartedAt: 0,
    taskAttemptCount: 0,
    helpUsedThisTask: [],
    sessionStartedAt: 0,

    baseTens: 0,
    rodW: 28,

    reservedBreakSlot: null,
    currentChosenDelta: null,
    seenCalculations: new Set(),
    taskPool: [],
    taskPoolIndex: 0,

    stats: {
      correct: 0,
      wrong: 0,
      completed: 0,
      startTs: 0,
      elapsedSec: 0,
      tickTimer: null,
    }
  };

  const pendingLearningEvents = [];
  let platformBridgeReady = false;
  window.addEventListener("message", event=>{
    if(event.origin !== window.location.origin || event.source !== window.parent) return;
    if(event.data?.source === "denkavo-platform" && event.data?.type === "ready") {
      platformBridgeReady = true;
      while(pendingLearningEvents.length) {
        const item = pendingLearningEvents.shift();
        window.parent.postMessage(item, window.location.origin);
      }
    }
  });

  // ---------- Ensure base nodes ----------
  const app = ensureEl("div", "app", document.body);
  const vizPanel = ensureEl("div", "vizPanel", document.body);
  const vizWrap = ensureEl("div", "vizWrap", vizPanel);

  const pointsBtn = ensureEl("button", "pointsBtn", document.body);
  const nextBtn   = ensureEl("button", "nextBtn", document.body);
  const endBtn    = ensureEl("button", "endBtn", document.body);
  const homeBtn   = ensureEl("button", "homeBtn", document.body);
  const directBtn = ensureEl("button", "directBtn", document.body);
  const fsBtn     = ensureEl("button", "fsBtn", document.body);

  // Bildsymbol Animation: 2 Zehnerstangen und 3 Einerwürfel; ausgeschaltet durchgestrichen.
  const ANIMATION_ICON_SVG = (()=>{
    const rod = x => `<rect x="${x}" y="3" width="9" height="34" rx="2" fill="#bfdbfe" stroke="#6b9dd8" stroke-width="1.5"/>`
      + [...Array(9)].map((_,i)=>`<line x1="${x}" x2="${x+9}" y1="${3+3.4*(i+1)}" y2="${3+3.4*(i+1)}" stroke="#6b9dd8" stroke-width="0.8"/>`).join("");
    const cube = y => `<rect x="31" y="${y}" width="9" height="9" rx="2" fill="#bbf7d0" stroke="#65a887" stroke-width="1.5"/>`;
    return `<svg class="animIcon" viewBox="0 0 44 40" width="44" height="40" aria-hidden="true">${rod(4)}${rod(17)}${cube(3)}${cube(14)}${cube(25)}`
      + `<line class="animStrike" x1="2" y1="38" x2="42" y2="2" stroke="#b91c1c" stroke-width="3.5" stroke-linecap="round"/></svg>`;
  })();
  const FULLSCREEN_ICON_SVG = '<svg class="fsIcon" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="#263445" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const HOME_ICON_SVG = '<svg class="homeIcon" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3 11.2 12 4l9 7.2" fill="none" stroke="#263445" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10" fill="none" stroke="#263445" stroke-width="2.2" stroke-linejoin="round"/></svg>';

  const okCountEl  = ensureEl("span", "okCount", document.body);
  const badCountEl = ensureEl("span", "badCount", document.body);
  okCountEl.textContent = "0";
  badCountEl.textContent = "0";

  ensureShell();
  // Reste der ursprünglichen Startseite (leere Hüllen, „✓ ✗“) entfernen.
  // Alle benötigten Elemente wurden zuvor in die Spieloberfläche verschoben.
  ["hud","layout"].forEach(id=>document.getElementById(id)?.remove());

  // Events
  pointsBtn.onclick = () => {
    state.vizShown = !state.vizShown;
    if(state.vizShown && !state.helpUsedThisTask.includes("visualization")) state.helpUsedThisTask.push("visualization");
    state.animationEnabled = state.vizShown;
    vizPanel.style.display = state.vizShown ? "block" : "none";
    updateAnimationButton();
  };
  nextBtn.onclick = () => generateNewCalculation();
  endBtn.onclick = () => endSession();

  renderLevelButtons();
  fsBtn.disabled = !fullscreenSupported();
  fitToViewport();
  window.addEventListener("resize", () => {
    clearTimeout(window.__fitT);
    window.__fitT = setTimeout(()=>{
      fitToViewport();
      if(isFullscreen()) scrollToGameArea();
    }, 60);
  });

  // =========================================================
  // Vollbild: Jeder Tipp außerhalb des Vollbilds startet es (Hoch- und Querformat).
  // Im Vollbild liegt das Knopffeld oberhalb des Bildschirms (durch Scrollen erreichbar).
  // Geräte ohne Vollbild-Unterstützung (z. B. iPhone-Safari) bleiben unverändert.
  // =========================================================
  function fullscreenElement(){
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }
  function isFullscreen(){ return !!fullscreenElement() || document.webkitIsFullScreen === true; }
  // Vollbild startet nur über den eigenen Knopf. Keine doppelte Anfrage, solange eine läuft.
  const fsGuard = { pending:false };
  function fullscreenSupported(){
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen) && document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
  }
  function requestGameFullscreen(){
    if(isFullscreen()){ scrollToGameArea(); return; }
    if(fsGuard.pending) return;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if(!fn) return;
    fsGuard.pending = true;
    const done = () => { fsGuard.pending = false; };
    setTimeout(done, 1500);
    try {
      const result = fn.call(el);
      if(result && typeof result.then === "function") result.then(done, done);
    } catch(_) { done(); /* Vollbild nicht erlaubt: Spiel läuft normal weiter. */ }
  }
  function scrollToGameArea(){
    const contentRow = qs("#contentRow");
    if(!contentRow) return;
    if(isFullscreen()){
      const top = contentRow.getBoundingClientRect().top + window.scrollY - FULLSCREEN_EDGE;
      window.scrollTo(0, Math.max(0, top));
    } else {
      window.scrollTo(0, 0);
    }
  }
  function onFullscreenChange(){
    fsGuard.pending = false;
    document.documentElement.classList.toggle("is-fullscreen", isFullscreen());
    fitToViewport();
    requestAnimationFrame(()=>{
      fitToViewport();
      scrollToGameArea();
    });
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  updateCounters();
  setActiveLevel(1);

  // Lernplattform-Brücke: Das Spiel sendet nur Ereignisse an die umgebende
  // Plattform. Es enthält keine Datenbankzugänge und kennt keine Schüler-IDs.
  function emitLearning(type, payload={}){
    if(window.parent && window.parent !== window){
      const event = {source:"denkavo-minus", type, ...payload};
      if(platformBridgeReady) window.parent.postMessage(event, window.location.origin);
      else pendingLearningEvents.push(event);
    }
  }
  function currentCalculationSteps(){
    return state.steps.map((step,index)=>step && step.selectedValue !== null ? {step:index+1,delta:step.selectedValue,label:`Schritt ${index+1}`} : null).filter(Boolean);
  }
  function recordAnswerAttempt(answer, expected, isCorrect, stepIndex=null){
    state.taskAttemptCount += 1;
    emitLearning("attempt", {
      taskKey:`L${state.level}-${state.startNumber}-${state.subtrahend}`,
      taskLabel:`${state.startNumber} − ${state.subtrahend}`,
      givenAnswer:String(answer), expectedAnswer:String(expected), isCorrect:Boolean(isCorrect),
      attemptNumber:state.taskAttemptCount, durationMs:Math.max(0,Date.now()-state.taskStartedAt),
      stepIndex, calculationSteps:currentCalculationSteps(), helpUsed:[...state.helpUsedThisTask]
    });
  }
  function recordTaskResult(){
    emitLearning("task-complete", {
      taskKey:`L${state.level}-${state.startNumber}-${state.subtrahend}`,
      taskLabel:`${state.startNumber} − ${state.subtrahend}`,
      expectedAnswer:String(state.startNumber-state.subtrahend),
      isCorrect:!state.wrongCountedThisTask,
      attemptNumber:Math.max(1,state.taskAttemptCount),
      durationMs:Math.max(0,Date.now()-state.taskStartedAt),
      calculationSteps:currentCalculationSteps(), helpUsed:[...state.helpUsedThisTask]
    });
  }

  // =========================================================
  // DOM helpers
  // =========================================================
  function ensureEl(tag, id, parent, className=""){
    let el = document.getElementById(id);
    if(!el){
      el = document.createElement(tag);
      el.id = id;
      if(className) el.className = className;
      parent.appendChild(el);
    }
    return el;
  }

  function ensureShell(){
    if(document.getElementById("appShell")) return;

    const shell = document.createElement("div");
    shell.id = "appShell";

    const topRow = document.createElement("div");
    topRow.id = "topRow";

    const topLeft  = mkDiv("topLeft","topArea");
    const topMid   = mkDiv("topMid","topArea");
    const topRight = mkDiv("topRight","topArea");

    topRow.appendChild(topLeft);
    topRow.appendChild(topMid);
    topRow.appendChild(topRight);

    const contentRow = document.createElement("div");
    contentRow.id = "contentRow";

    const leftCol  = mkDiv("leftCol");
    const midCol   = mkDiv("midCol");
    const rightCol = mkDiv("rightCol");

    contentRow.appendChild(leftCol);
    contentRow.appendChild(midCol);
    contentRow.appendChild(rightCol);

    shell.appendChild(topRow);
    shell.appendChild(contentRow);
    document.body.prepend(shell);

    // level buttons
    let lvlBtns = qsa(".lvlBtn");
    if(lvlBtns.length < 6){
      const tmp = document.createElement("div");
      for(let i=lvlBtns.length+1;i<=6;i++){
        const b = document.createElement("button");
        b.className = "lvlBtn";
        b.dataset.level = String(i);
        tmp.appendChild(b);
      }
      document.body.appendChild(tmp);
      lvlBtns = qsa(".lvlBtn");
    }

    const levelWrap = document.createElement("div");
    levelWrap.id = "levelButtonsWrap";
    const labels = [
      ["ZR 10", ""],
      ["ZR 20", ""],
      ["ZR 100", "Z-E"],
      ["ZR 100", "ZE-E oUS"],
      ["ZR 100", "ZE-E mUS"],
      ["ZR 100", "ZE-ZE mUS"]
    ];
    lvlBtns.slice(0,6).forEach((b,i)=>{
      b.innerHTML = `<span class="lvlMain">${labels[i][0]}</span><span class="lvlSub">${labels[i][1] || "&nbsp;"}</span>`;
      b.setAttribute("aria-label", labels[i].filter(Boolean).join(": "));
      levelWrap.appendChild(b);
    });
    topLeft.appendChild(levelWrap);

    // counters
    const countsWrap = document.createElement("div");
    countsWrap.id = "countsWrap";

    const okBox = document.createElement("div");
    okBox.className = "countBox countOk";
    okBox.appendChild(okCountEl);

    const badBox = document.createElement("div");
    badBox.className = "countBox countBad";
    badBox.appendChild(badCountEl);

    countsWrap.appendChild(okBox);
    countsWrap.appendChild(badBox);
    topMid.appendChild(countsWrap);

    // right buttons
    pointsBtn.classList.add("ctrlBtn");
    pointsBtn.innerHTML = ANIMATION_ICON_SVG;
    pointsBtn.title = "Animation und Stellenwertdarstellung ein- oder ausschalten";
    pointsBtn.setAttribute("aria-label", "Animation ein- oder ausschalten");
    nextBtn.classList.add("ctrlBtn");
    nextBtn.textContent = "➜";
    endBtn.classList.add("ctrlBtn");
    endBtn.textContent = "Ende";

    const rightTopButtons = document.createElement("div");
    rightTopButtons.id = "rightTopButtons";
    homeBtn.type = "button";
    homeBtn.className = "ctrlBtn";
    homeBtn.innerHTML = HOME_ICON_SVG;
    homeBtn.title = "Zur Übersicht";
    homeBtn.setAttribute("aria-label", "Zur Übersicht");
    homeBtn.onclick = () => goHome();
    // Ohne umgebende Plattform (eigenständiges Spiel) gibt es keine Übersicht: Knopf ausblenden.
    if(window.parent === window) homeBtn.style.display = "none";
    directBtn.type = "button";
    directBtn.className = "ctrlBtn";
    directBtn.innerHTML = '<span class="directIcon" aria-hidden="true"><span class="directEq">=</span><span class="directBox"></span></span>';
    directBtn.title = "Ohne Rechenschritte: Ergebnis direkt eingeben";
    directBtn.setAttribute("aria-label", "Ohne Rechenschritte rechnen ein- oder ausschalten");
    directBtn.onclick = () => toggleDirectMode();
    fsBtn.type = "button";
    fsBtn.className = "ctrlBtn";
    fsBtn.innerHTML = FULLSCREEN_ICON_SVG;
    fsBtn.title = "Vollbild";
    fsBtn.setAttribute("aria-label", "Im Vollbild spielen");
    fsBtn.onclick = () => requestGameFullscreen();
    rightTopButtons.append(homeBtn, fsBtn, pointsBtn, directBtn, nextBtn, endBtn);
    topRight.appendChild(rightTopButtons);

    const roundControls = document.createElement("div");
    roundControls.id = "roundCountControls";
    roundControls.setAttribute("aria-label", "Aufgaben pro Runde");
    [5, 10, 20].forEach(count => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "roundCountBtn";
      b.dataset.roundCount = String(count);
      b.textContent = String(count);
      b.setAttribute("aria-label", `${count} Aufgaben pro Runde`);
      b.onclick = () => setRoundTaskCount(count);
      roundControls.appendChild(b);
    });
    topRight.appendChild(roundControls);
    updateAnimationButton();
    updateRoundCountButtons();

    // content
    leftCol.appendChild(vizPanel);
    midCol.appendChild(app);
    rightCol.appendChild(buildKeypad());

    function mkDiv(id, cls=""){
      const d=document.createElement("div");
      d.id=id;
      if(cls) d.className=cls;
      return d;
    }
  }

  function buildKeypad(){
    const kp=document.createElement("div");
    kp.id="keypad";

    const grid=document.createElement("div");
    grid.id="keypadGrid";
    for(let n=1;n<=9;n++){
      const b=document.createElement("button");
      b.className="keyBtn";
      b.dataset.key=String(n);
      b.textContent=String(n);
      b.onclick=()=>keypadTypeDigit(String(n));
      grid.appendChild(b);
    }

    const bottom=document.createElement("div");
    bottom.id="keypadBottom";

    const zero=document.createElement("button");
    zero.className="keyBtn";
    zero.id="key0";
    zero.dataset.key="0";
    zero.textContent="0";
    zero.onclick=()=>keypadTypeDigit("0");

    const del=document.createElement("button");
    del.className="keyBtn";
    del.id="keyDel";
    del.dataset.key="del";
    del.textContent="⌫";
    del.onclick=()=>keypadDelete();

    bottom.appendChild(zero);
    bottom.appendChild(del);

    kp.appendChild(grid);
    kp.appendChild(bottom);
    return kp;
  }

  // Bereits kontrollierte Felder sind gesperrt: Das Ziffernfeld schreibt nie hinein.
  function isLocked(inp){ return inp.dataset.locked === "1"; }
  function lockInput(inp){
    inp.dataset.locked = "1";
    inp.readOnly = true;
    inp.blur();
  }
  function unlockInput(inp){ delete inp.dataset.locked; }
  function getActiveInput(){
    const ae=document.activeElement;
    if(ae && ae.tagName==="INPUT" && ae.classList.contains("input-field") && !isLocked(ae)) return ae;
    const inputs=qsa('input.input-field', app).filter(i=>i.offsetParent!==null && !i.disabled && !isLocked(i));
    return inputs.length ? inputs[inputs.length-1] : null;
  }
  function keypadTypeDigit(d){
    const inp=getActiveInput();
    if(!inp) return;
    inp.value=(inp.value ?? "") + d;
    inp.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function keypadDelete(){
    const inp=getActiveInput();
    if(!inp) return;
    const cur=inp.value ?? "";
    inp.value=cur.slice(0,-1);
    inp.dispatchEvent(new Event("input",{bubbles:true}));
  }

  // =========================================================
  // Fit to viewport WITHOUT clipping:
  // We shrink cube until a full 10-cube rod fits into field height.
  // =========================================================
  function fitToViewport(){
    const topRow = qs("#topRow");
    const contentRow = qs("#contentRow");
    const leftCol = qs("#leftCol");
    if(!topRow || !contentRow || !leftCol) return;

    // Höhe des Spielbereichs: Im Vollbild füllt er genau den Bildschirm (Knopffeld liegt
    // darüber und ist durch Scrollen erreichbar), sonst den Platz unter dem Knopffeld.
    const shellH = window.innerHeight;
    let contentH;
    if(isFullscreen()){
      contentH = Math.max(240, shellH - 2*FULLSCREEN_EDGE);
    } else {
      const shell = qs("#appShell");
      const padBottom = shell ? parseFloat(getComputedStyle(shell).paddingBottom) || 0 : 0;
      const contentTop = contentRow.getBoundingClientRect().top + window.scrollY;
      contentH = Math.max(240, Math.floor(shellH - contentTop - padBottom));
    }
    contentRow.style.setProperty("height", `${contentH}px`, "important");
    document.documentElement.style.setProperty("--contentH", `${contentH}px`);

    const leftW = Math.max(260, leftCol.getBoundingClientRect().width);

    const slotGap = 10;
    const spacer = TEN_SPACER;
    const usableW = Math.max(240, leftW - 12);

    // Fit 10 columns in width
    let rodW = Math.floor((usableW - (9*slotGap) - spacer) / 10);
    rodW = clamp(16, 44, rodW);

    // Die drei Felder (orange, rot, gelb) stehen untereinander und teilen sich die
    // Höhe der Animationsspalte zu gleichen Teilen. Der Platz für Gelb ist immer reserviert.
    const leftCS = getComputedStyle(leftCol);
    const leftInnerH = leftCol.clientHeight - (parseFloat(leftCS.paddingTop)||0) - (parseFloat(leftCS.paddingBottom)||0);
    const panelPad = parseFloat(getComputedStyle(vizPanel).paddingBottom) || 0;
    const targetFieldH = Math.max(60, Math.floor((leftInnerH - panelPad - 3*VIZ_FIELD_GAP) / 3));

    // Start with width-based cube
    let cube = Math.floor(rodW * 0.65);
    cube = clamp(8, 24, cube);

    let cubeGap, gap5, rodPad, rodBorder, rodH, neededH;
    rodBorder = 2;

    // Shrink cube until rod fits (never clip)
    while(true){
      cubeGap = Math.max(2, Math.floor(cube * 0.18));
      gap5    = Math.max(6, Math.floor(cube * 0.45));
      rodPad  = Math.max(1, Math.floor(cube * 0.12));

      rodH = (10*cube) + (9*cubeGap) + gap5 + (2*rodPad) + (2*rodBorder);
      neededH = rodH + 28; // buffer for field padding

      if(neededH <= targetFieldH) break;
      cube -= 1;
      if(cube <= 4) break;
    }

    // Field height: at least what we need
    const fieldH = Math.max(targetFieldH, neededH);

    const root = document.documentElement.style;
    root.setProperty("--rodW", `${rodW}px`);
    root.setProperty("--cube", `${cube}px`);
    root.setProperty("--cubeGap", `${cubeGap}px`);
    root.setProperty("--cubeGap5", `${gap5}px`);
    root.setProperty("--rodPad", `${rodPad}px`);
    root.setProperty("--rodBorder", `${rodBorder}px`);
    root.setProperty("--fieldH", `${fieldH}px`);

    // Update runtime state based on measured DOM
    state.rodW = measureRodWidth();
    // Bereits angelegte Spalten an die neue Stangenbreite anpassen (z. B. nach dem
    // Wechsel ins Vollbild oder Drehen des Geräts mitten in einer Aufgabe).
    qsa('[data-slot], [data-ones-slot]', vizWrap).forEach(slot=>{
      slot.style.width = `${state.rodW}px`;
      slot.style.minWidth = `${state.rodW}px`;
    });

    updateAllOnesColsPositions("orange");
    updateAllOnesColsPositions("red");
    updateAllOnesColsPositions("yellow");

    function clamp(min,max,v){ return Math.max(min, Math.min(max, v)); }
  }

  // =========================================================
  // Levels
  // =========================================================
  function renderLevelButtons(){
    updateDirectButton();
    qsa(".lvlBtn").forEach(btn=>{
      const lvl = parseInt(btn.dataset.level,10);
      btn.disabled = false;
      btn.classList.toggle("active", lvl===state.level);
      btn.onclick = ()=>setActiveLevel(lvl);
    });
  }
  function setActiveLevel(level){
    state.level = level;
    state.steps = [];
    state.currentValue = 0;
    resetRoundStats();
    renderLevelButtons();
    generateNewCalculation();
  }

  function setRoundTaskCount(count){
    if(![5,10,20].includes(count)) return;
    state.roundTaskCount = count;
    resetRoundStats();
    updateRoundCountButtons();
    generateNewCalculation();
  }
  function updateRoundCountButtons(){
    qsa(".roundCountBtn").forEach(btn=>{
      const active = Number(btn.dataset.roundCount) === state.roundTaskCount;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
  function updateAnimationButton(){
    pointsBtn.classList.toggle("animation-active", !!state.animationEnabled);
    pointsBtn.setAttribute("aria-pressed", String(!!state.animationEnabled));
  }
  function levelHasSteps(level){ return [2,5,6].includes(level); }
  // Direkte Ergebniseingabe: Stufen 1, 3, 4 immer; Stufen 2, 5, 6 bei eingeschaltetem Schalter.
  function usesDirectInput(){ return !levelHasSteps(state.level) || state.directMode; }
  function updateDirectButton(){
    const available = levelHasSteps(state.level);
    directBtn.disabled = !available;
    directBtn.classList.toggle("direct-active", available && state.directMode);
    directBtn.setAttribute("aria-pressed", String(available && state.directMode));
  }
  function toggleDirectMode(){
    if(!levelHasSteps(state.level) || state.isAnimating || state.resetPending) return;
    state.directMode = !state.directMode;
    if(state.directMode){
      // Einschalten schaltet auch die Animation aus.
      state.vizShown = false;
      state.animationEnabled = false;
      vizPanel.style.display = "none";
      updateAnimationButton();
    }
    updateDirectButton();
    // Die laufende Rechnung beginnt in der neuen Form von vorne (keine neue Rechnung).
    if(!state.taskFinished) resetCurrentCalculation();
  }
  // Zurück zur Lern-Übersicht. Die Sitzung wird vorher beendet; die Plattform
  // speichert offene Ereignisse und wechselt dann zur Übersicht.
  function goHome(){
    if(state.sessionStartedAt){
      emitLearning("session-end", {startedAt:state.sessionStartedAt});
      state.sessionStartedAt = 0;
    }
    clearTimers();
    if(window.parent && window.parent !== window){
      emitLearning("exit", {});
    } else {
      window.location.href = "/lernen";
    }
  }

  // =========================================================
  // Generator
  // =========================================================
  function buildTaskPool(level){
    const tasks = [];
    const add = (m, s) => { if(m >= s && s > 0) tasks.push({m, s}); };

    if(level === 1){
      for(let m=2; m<=10; m++) for(let s=1; s<=m; s++) add(m,s);
    } else if(level === 2){
      for(let m=11; m<=20; m++) for(let s=(m%10)+1; s<=Math.min(9,m); s++) add(m,s);
    } else if(level === 3){
      for(let m=10; m<=90; m+=10) for(let s=1; s<=9; s++) add(m,s);
    } else if(level === 4){
      for(let z=1; z<=9; z++) for(let e=2; e<=9; e++) for(let s=1; s<e; s++) add(z*10+e,s);
    } else if(level === 5){
      for(let z=1; z<=9; z++) for(let e=1; e<=8; e++) for(let s=e+1; s<=9; s++) add(z*10+e,s);
    } else {
      for(let m=31; m<=95; m++){
        const e=m%10;
        for(let z=1; z<Math.floor(m/10); z++){
          for(let se=e+1; se<=9; se++) add(m,z*10+se);
        }
      }
    }
    // Shuffle once per round. Each equation is drawn from this bag only once.
    for(let i=tasks.length-1; i>0; i--){
      const j=Math.floor(Math.random()*(i+1));
      [tasks[i], tasks[j]]=[tasks[j], tasks[i]];
    }
    return tasks;
  }

  function generateTaskForLevel(level){
    let m=0, s=0;

    if(level === 1){
      // ZR 10: beide Zahlen höchstens 10, Subtrahend nicht größer als Minuend.
      m=rnd(2,10);
      s=rnd(1,m);
    } else if(level === 2 || level === 5){
      // ZR 20 (Level 2) und ZE-E mit Überschreiten (Level 5):
      // Die Einer des Subtrahenden sind größer als die Einer des Minuenden.
      if(level === 2){
        m=rnd(11,20);
        const startE=m%10;
        s=rnd(startE+1, Math.min(9,m));
      } else {
        const Z=rnd(1,9);
        const startE=rnd(1,8);
        m=Z*10+startE;
        s=rnd(startE+1, 9);
      }
    } else if(level === 3){
      // Z-E: glatte Zehner minus Einer.
      m=rnd(1,9)*10;
      s=rnd(1,9);
    } else if(level === 4){
      // ZE-E ohne Überschreiten des Zehners.
      const Z=rnd(1,9), E=rnd(2,9);
      m=Z*10+E;
      s=rnd(1,E-1);
    } else {
      // ZE-ZE mit Überschreiten des Zehners.
      m=rnd(31,95);
      const startE=m%10;
      const subE=rnd(startE+1,9);
      const subZ=rnd(1, Math.floor(m/10)-1)*10;
      s=subZ+subE;
    }
    return {m,s};
  }

  // =========================================================
  // Level 4 options + ensure correct option
  // =========================================================
  function getFirstStepOptions(subE, subZ, startE, subtr){
    if(state.level === 2 || state.level === 5){
      return [
        {text:`− ${subE}`, value:-subE, path:"all"},
        {text:`− ${startE}`, value:-startE, path:"existing"}
      ];
    }
    const subFolgeZ = subtr + 10 - subE;
    return [
      {text:`- ${subFolgeZ}`, value:-subFolgeZ},
      {text:`- ${subE}`, value:-subE},
      {text:`- ${startE}`, value:-startE},
      {text: state.level === 3 && subZ === 0 ? "− 10" : `− ${subZ === 0 ? 10 : subZ}`, value: -(subZ === 0 ? 10 : subZ)}
    ];
  }
  function getLevel3SecondStepOptions(){
    const startE = state.startNumber % 10;
    const remaining = state.subtrahend - startE;
    return [
      {text:`+ ${remaining}`, value:remaining},
      {text:`− ${remaining}`, value:-remaining},
      {text:`− ${startE}`, value:-startE},
      {text:`− ${state.subtrahend}`, value:-state.subtrahend}
    ];
  }
  function getSecondStepOptions(startN, subtr){
    const subE=subtr%10;
    const subZ=Math.floor(subtr/10)*10;
    const startE=startN%10;
    const subFolgeZ=subtr + 10 - subE;
    return [
      {text:`- ${subE}`, value:-subE},
      {text:`- ${subZ}`, value:-subZ},
      {text:`+ ${subFolgeZ - subtr}`, value: subFolgeZ - subtr},
      {text:`- ${startE}`, value:-startE},
      {text:`+ ${subE - startE}`, value: (subE - startE)},
      {text:`- ${(subE - startE)}`, value: -(subE - startE)}
    ];
  }
  function getThirdStepOptions(startN, subtr){
    const subE=subtr%10;
    const subZ=Math.floor(subtr/10)*10;
    const startE=startN%10;
    return [
      {text:`- ${subE}`, value:-subE},
      {text:`- ${subZ}`, value:-subZ},
      {text:`- ${(subE - startE)}`, value: -(subE - startE)}
    ];
  }
  function ensureOptionExistsToReachCorrect(stepIndex, options){
    if(state.level !== 6) return options;
    if(stepIndex !== 2) return options;

    const correctFinal = state.startNumber - state.subtrahend;
    const needed = correctFinal - state.currentValue;
    if(options.some(o => o.value === needed)) return options;

    const abs = Math.abs(needed);
    const text = needed < 0 ? `- ${abs}` : `+ ${abs}`;
    return [...options, {text, value: needed}];
  }

  // =========================================================
  // Counters + timer
  // =========================================================
  function clearTimers(){
    if(state.coverTimer){ clearTimeout(state.coverTimer); state.coverTimer=null; }
    if(state.resetTimer){ clearTimeout(state.resetTimer); state.resetTimer=null; }
  }
  function startTaskTimer(){
    // Die Zeit läuft über die gesamte 20-Aufgaben-Runde und wird nicht pro Aufgabe zurückgesetzt.
    if(!state.stats.startTs) state.stats.startTs = Date.now();
    if(!state.stats.tickTimer){
      state.stats.tickTimer = setInterval(()=>{
        state.stats.elapsedSec = Math.floor((Date.now()-state.stats.startTs)/1000);
      }, 250);
    }
  }
  function stopRoundTimer(){
    if(state.stats.startTs){
      state.stats.elapsedSec = Math.floor((Date.now()-state.stats.startTs)/1000);
    }
    if(state.stats.tickTimer){ clearInterval(state.stats.tickTimer); state.stats.tickTimer=null; }
  }
  function resetRoundStats(){
    if(state.sessionStartedAt){
      emitLearning("session-end", {startedAt:state.sessionStartedAt});
      state.sessionStartedAt = 0;
    }
    stopRoundTimer();
    state.stats.correct = 0;
    state.stats.wrong = 0;
    state.stats.completed = 0;
    state.stats.startTs = 0;
    state.stats.elapsedSec = 0;
    state.seenCalculations = new Set();
    state.taskPool = buildTaskPool(state.level);
    state.taskPoolIndex = 0;
    state.taskFinished = false;
    state.wrongCountedThisTask = false;
    state.sessionStartedAt = Date.now();
    emitLearning("session-start", {level:state.level, roundTaskCount:state.roundTaskCount, startedAt:state.sessionStartedAt});
    updateCounters();
  }
  function updateCounters(){
    okCountEl.textContent = String(state.stats.correct);
    badCountEl.textContent = String(state.stats.wrong);
  }
  function fmtTime(sec){
    const m=Math.floor(sec/60);
    const s=sec%60;
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  // =========================================================
  // Auto-check (1.25s debounce)
  // =========================================================
  function attachAutoCheck(inputEl, fnCheck, expectedValue){
    let timer = null;
    let checkStartedAt = 0;
    const scheduleCheck = (delay = 250) => {
      if (timer) clearTimeout(timer);
      checkStartedAt = Date.now();
      const run = () => {
        // The input may have been replaced by the next task while the timer waited.
        if (!inputEl.isConnected || state.taskFinished || isLocked(inputEl)) return;
        const raw = String(inputEl.value ?? "").trim();
        if (!/^\d+$/.test(raw)) return;
        const expected = typeof expectedValue === "function" ? expectedValue() : expectedValue;
        const requiredDigits = String(Math.max(0, Math.trunc(expected))).length;
        // Never check a partially entered multi-digit result.
        if (raw.length !== requiredDigits) return;
        const value = Number(raw);
        if (!Number.isFinite(value)) return;
        // Animations temporarily lock validation. Retry while the same input
        // still exists, instead of silently losing the child's auto-check.
        if (state.isAnimating) {
          if (Date.now() - checkStartedAt < 6000) timer = setTimeout(run, 100);
          return;
        }
        fnCheck(value);
      };
      timer = setTimeout(run, delay);
    };
    inputEl.addEventListener("input", () => scheduleCheck(250));
  }

  // =========================================================
  // UI render
  // =========================================================
  function clearApp(){ app.innerHTML=""; }

  function renderCalcLineWithInput(){
    const wrap=document.createElement("div");
    wrap.style.display="flex";
    wrap.style.justifyContent="center";
    wrap.style.alignItems="center";
    wrap.style.gap="10px";

    const txt=document.createElement("div");
    txt.id="calculation";
    txt.textContent=`${state.startNumber} - ${state.subtrahend} =`;
    wrap.appendChild(txt);

    const input=document.createElement("input");
    input.type="text";
    input.className="input-field";
    input.inputMode="none";
    input.readOnly=true;
    input.setAttribute("aria-label", "Ergebnis über das Ziffernfeld eingeben");
    wrap.appendChild(input);

    app.appendChild(wrap);

    attachAutoCheck(input, (v)=>validateFinalOnly(v, input), ()=>state.startNumber-state.subtrahend);
  }

  function renderCalculationHeader(text){
    const row=document.createElement("div");
    row.className="calcHeaderRow";
    const p=document.createElement("p");
    p.id="calculation";
    p.textContent=text;
    row.appendChild(p);
    app.appendChild(row);
  }
  // Ergebnisfeld bei der ursprünglichen Rechnung: erscheint leer mit dem Rechenschritt,
  // der zum Ziel führt; nach der Kontrolle wird das Ergebnis eingetragen (grün).
  // Das Feld ist immer gesperrt: Das Ziffernfeld schreibt nie hinein.
  function ensureHeaderResultField(){
    const row=qs(".calcHeaderRow", app);
    if(!row) return null;
    let f=qs("#headerResult", row);
    if(f) return f;
    f=document.createElement("input");
    f.type="text";
    f.id="headerResult";
    f.className="input-field";
    f.inputMode="none";
    f.readOnly=true;
    f.tabIndex=-1;
    f.dataset.locked="1";
    f.setAttribute("aria-label", "Ergebnis der Rechnung");
    row.appendChild(f);
    return f;
  }
  function removeHeaderResultField(){ qs("#headerResult", app)?.remove(); }
  function fillHeaderResultField(value){
    const f=ensureHeaderResultField();
    if(!f) return;
    f.value=String(value);
    f.classList.add("correct");
  }

  // Step UI: buttons -> after 3s blink once -> click creates equation row + input
  function renderStep(stepIndex, options){
    options = ensureOptionExistsToReachCorrect(stepIndex, options);

    const step=document.createElement("div");
    step.className="step";

    const btns=document.createElement("div");
    btns.className="buttons-container";

    const stepState = {
      selectedValue: null,
      inputEl: null,
      blinkTimer: null,
      chosen: false
    };

    options.forEach(opt=>{
      const b=document.createElement("div");
      b.className="button";
      b.textContent=opt.text;

      b.onclick=async ()=>{
        if(state.isAnimating || state.resetPending) return;
        if(stepState.chosen && stepState.selectedValue === opt.value) return;
        if((state.level===2 || state.level===5) && stepIndex===1 && opt.value !== -(state.subtrahend-(state.startNumber%10))){
          b.classList.add("incorrect");
          setTimeout(()=>b.classList.remove("incorrect"), 500);
          return;
        }

        // If the child changes the selected strategy, restore the visual model
        // and replay already accepted steps before applying the new choice.
        if(stepState.chosen){
          if(stepState.inputEl){ stepState.inputEl.closest(".eqRow")?.remove(); stepState.inputEl=null; }
          // Folgeschritte des bisherigen Wegs verschwinden.
          let next=step.nextElementSibling;
          while(next){ const n=next.nextElementSibling; if(next.classList.contains("step")) next.remove(); next=n; }
          state.steps.slice(stepIndex+1).forEach(st=>{ if(st && st.blinkTimer) clearTimeout(st.blinkTimer); });
          state.steps.length = stepIndex+1;
          await rebuildVisualizationBeforeStep(stepIndex);
        }
        stepState.chosen = true;
        btns.querySelectorAll(".button").forEach(x=>x.classList.remove("selected"));
        b.classList.add("selected");
        stepState.selectedValue = opt.value;
        state.currentChosenDelta = opt.value;

        if(stepState.blinkTimer){
          clearTimeout(stepState.blinkTimer);
          stepState.blinkTimer = null;
        }

        await applyVizDelta(opt.value);

        if(state.currentValue + opt.value === state.startNumber - state.subtrahend) ensureHeaderResultField();
        else removeHeaderResultField();

        const eq = document.createElement("div");
        eq.className="eqRow";
        const sign = opt.value < 0 ? "−" : "+";
        const abs = Math.abs(opt.value);

        const label = document.createElement("div");
        label.textContent = `${state.currentValue} ${sign} ${abs} =`;
        eq.appendChild(label);

        const input = document.createElement("input");
        input.type="text";
        input.className="input-field";
        input.inputMode="none";
        input.readOnly=true;
        input.setAttribute("aria-label", "Ergebnis über das Ziffernfeld eingeben");
        eq.appendChild(input);

        step.appendChild(eq);
        stepState.inputEl = input;

        attachAutoCheck(input, (v)=>validateStepInput(stepIndex, v), ()=>state.currentValue + stepState.selectedValue);
      };

      btns.appendChild(b);
    });

    step.appendChild(btns);
    app.appendChild(step);
    state.steps[stepIndex] = stepState;

    stepState.blinkTimer = setTimeout(()=>{
      if(stepState.chosen) return;
      qsa(".button", btns).forEach(btn=>{
        btn.classList.add("blink");
        setTimeout(()=>btn.classList.remove("blink"), 520);
      });
    }, 3000);
  }

  async function rebuildVisualizationBeforeStep(stepIndex){
    state.isAnimating = true;
    initViz(state.startNumber);
    state.currentValue = state.startNumber;
    state.currentChosenDelta = null;
    for(let i=0;i<stepIndex;i++){
      const previous=state.steps[i];
      if(previous && previous.selectedValue !== null){
        await applyVizDelta(previous.selectedValue);
        state.currentValue += previous.selectedValue;
      }
    }
    state.isAnimating = false;
  }

  function resetCurrentCalculation(){
    if(state.taskFinished) return;
    clearTimers();
    clearApp();
    state.isAnimating = false;
    state.resetPending = false;
    state.steps = [];
    state.currentValue = state.startNumber;
    state.currentChosenDelta = null;
    state.failedAttemptsThisTask = 0;
    initViz(state.startNumber);
    vizPanel.style.display = state.vizShown ? "block" : "none";
    state.coverTimer = setTimeout(async ()=>{
      coverOrange(true);
      if(usesDirectInput()) await animateAutoSubtrahendToRed();
    }, COVER_AFTER_MS);
    if(usesDirectInput()){
      renderCalcLineWithInput();
    } else {
      renderCalculationHeader(`${state.startNumber} − ${state.subtrahend} =`);
      const subE=state.subtrahend%10;
      const subZ=Math.floor(state.subtrahend/10)*10;
      renderStep(0,getFirstStepOptions(subE,subZ,state.startNumber%10,state.subtrahend));
    }
    setTimeout(()=>{
      fitToViewport();
      updateAllOnesColsPositions("orange");
      updateAllOnesColsPositions("red");
      updateAllOnesColsPositions("yellow");
    },0);
  }

  function showSuccess(){
    const p=document.createElement("p");
    p.className="success";
    p.textContent="Prima!";
    app.appendChild(p);
    setTimeout(()=>p.remove(), 1200);
  }

  // =========================================================
  // Validation
  // =========================================================
  function validateFinalOnly(v, inputEl){
    if(state.isAnimating || state.taskFinished) return;
    const correct = state.startNumber - state.subtrahend;

    if(v===correct){
      recordAnswerAttempt(v, correct, true, null);
      inputEl.classList.remove("incorrect");
      inputEl.classList.add("correct");
      lockInput(inputEl);
      onSolvedCorrect();
    } else {
      recordAnswerAttempt(v, correct, false, null);
      markTaskWrong();
      state.failedAttemptsThisTask += 1;
      inputEl.classList.add("incorrect");
      lockInput(inputEl); // während der roten Rückmeldung gesperrt
      if(state.failedAttemptsThisTask >= 3){
        setTimeout(()=>resetCurrentCalculation(), 650);
        return;
      }
      setTimeout(()=>{
        inputEl.value="";
        inputEl.classList.remove("incorrect");
        unlockInput(inputEl);

        state.vizShown = true;
        state.animationEnabled = true;
        updateAnimationButton();
        vizPanel.style.display = "block";
        setOrangeOpacity(1);
        setCover("orange", false);

      }, 1000);
    }
  }

  function markTaskWrong(){
    // Pro Aufgabe zählt höchstens ein Fehler. Sobald ein Rechenschritt
    // beim ersten Versuch falsch war, bleibt die gesamte Aufgabe falsch.
    if(state.wrongCountedThisTask) return;
    state.wrongCountedThisTask = true;
    state.stats.wrong += 1;
    updateCounters();
  }

  function validateStepInput(stepIndex, v){
    if(state.isAnimating || state.taskFinished) return;

    const step = state.steps[stepIndex];
    if(!step || step.selectedValue===null || !step.inputEl) return;

    const input = step.inputEl;
    const correctFinal = state.startNumber - state.subtrahend;

    if(v===correctFinal){
      recordAnswerAttempt(v, correctFinal, true, stepIndex+1);
      input.classList.remove("incorrect");
      input.classList.add("correct");
      lockInput(input);
      fillHeaderResultField(correctFinal);
      onSolvedCorrect();
      return;
    }

    const expected = state.currentValue + step.selectedValue;
    if(v===expected){
      recordAnswerAttempt(v, expected, true, stepIndex+1);
      input.classList.remove("incorrect");
      input.classList.add("correct");
      // Ein korrektes Zwischenergebnis wird gesperrt. Das Kind arbeitet
      // ausschließlich mit dem nächsten Rechenschritt weiter.
      lockInput(input);
      input.setAttribute("aria-label", "Richtiges Zwischenergebnis, Eingabe gesperrt");
      state.currentValue = expected;

      if(stepIndex===0){
        if(state.level === 2 || state.level === 5){
          renderStep(1, getLevel3SecondStepOptions());
        } else {
          renderStep(1, getSecondStepOptions(state.startNumber, state.subtrahend));
        }
      } else if(stepIndex===1 && state.level === 6){
        renderStep(2, getThirdStepOptions(state.startNumber, state.subtrahend));
      } else {
        // Letzter möglicher Rechenschritt richtig gerechnet, Rechnung aber nicht gelöst:
        // Der Rechenweg führt nicht zum Ziel. Aufgabe zählt als Fehler; dieselbe
        // Rechnung und die Animation werden auf Start zurückgesetzt (keine neue Rechnung).
        markTaskWrong();
        state.resetPending = true;
        state.resetTimer = setTimeout(()=>{ state.resetTimer=null; resetCurrentCalculation(); }, DEAD_END_RESET_MS);
      }
    } else {
      recordAnswerAttempt(v, expected, false, stepIndex+1);
      input.classList.add("incorrect");
      lockInput(input); // während der roten Rückmeldung gesperrt
      markTaskWrong();
      state.failedAttemptsThisTask += 1;
      if(state.failedAttemptsThisTask >= 3){
        setTimeout(()=>resetCurrentCalculation(), 650);
        return;
      }

      setTimeout(()=>{
        input.value="";
        input.classList.remove("incorrect");
        unlockInput(input);

        state.vizShown = true;
        state.animationEnabled = true;
        updateAnimationButton();
        vizPanel.style.display = "block";
        setOrangeOpacity(1);
        setCover("orange", false);

      }, 1000);
    }
  }

  function onSolvedCorrect(){
    if(state.taskFinished) return;
    state.taskFinished = true;
    recordTaskResult();
    if(state.coverTimer){ clearTimeout(state.coverTimer); state.coverTimer=null; }
    if(!state.wrongCountedThisTask){
      state.stats.correct += 1;
    }
    state.stats.completed += 1;
    updateCounters();
    showSuccess();

    animateDifferenceToYellowParallel().then(()=>{
      setTimeout(()=>{
        if(state.stats.completed >= state.roundTaskCount){
          showRoundResult();
        } else {
          generateNewCalculation();
        }
      }, [2,5,6].includes(state.level) ? STEP_LEVEL_HOLD_MS : HOLD_AFTER_RESULT_MS);
    });
  }

  function showRoundResult(){
    emitLearning("session-end", {startedAt:state.sessionStartedAt});
    state.sessionStartedAt = 0;
    clearTimers();
    stopRoundTimer();
    const overlay=document.createElement("div");
    overlay.className="sessionOverlay roundOverlay";
    const card=document.createElement("div");
    card.className="sessionCard roundCard";
    const score=state.stats.correct;
    const totalSec=state.stats.elapsedSec;

    // Rückmeldung abhängig von der gewählten Rundengröße.
    const starThreshold = state.roundTaskCount === 20 ? 18 : state.roundTaskCount;
    const thumbsThreshold = state.roundTaskCount === 5 ? 4 : state.roundTaskCount === 10 ? 8 : 15;
    let celebration="";
    if(score >= starThreshold){
      celebration='<div class="celebration stars" aria-label="Sternenregen">⭐ ✨ 🌟 ⭐ ✨ 🌟 ⭐</div>';
      startStarRain(overlay);
    } else if(score >= thumbsThreshold){
      celebration='<div class="celebration thumbs" aria-label="Daumen hoch">👍</div>';
    }

    card.innerHTML=`<div class="roundFeedback" aria-live="polite"><div class="bigScore">${score}</div><div class="scoreLabel">von ${state.roundTaskCount} richtig</div><div class="roundTime">Zeit: ${fmtTime(totalSec)}</div>${celebration}</div>`;
    const btn=document.createElement("button");
    btn.textContent="Noch einmal spielen";
    btn.onclick=()=>{
      overlay.remove();
      resetRoundStats();
      generateNewCalculation();
    };
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function startStarRain(overlay){
    const layer=document.createElement("div");
    layer.className="starRain";
    overlay.appendChild(layer);
    for(let i=0;i<42;i++){
      const star=document.createElement("span");
      star.textContent=["⭐","✨","🌟"][i%3];
      star.style.left=`${Math.random()*100}%`;
      star.style.animationDelay=`${Math.random()*1.8}s`;
      star.style.animationDuration=`${2.4+Math.random()*2}s`;
      layer.appendChild(star);
    }
  }

  // =========================================================
  // Task start
  // =========================================================
  function generateNewCalculation(){
    if(state.stats.completed >= state.roundTaskCount) return;
    clearTimers();
    clearApp();

    state.isAnimating = false;
    state.resetPending = false;
    state.taskFinished = false;
    state.steps = [];
    state.currentValue = 0;
    state.wrongCountedThisTask = false;
    state.failedAttemptsThisTask = 0;
    state.taskAttemptCount = 0;
    state.helpUsedThisTask = state.vizShown ? ["visualization"] : [];

    // Aufgaben werden aus einem einmalig gemischten Pool gezogen: keine Wiederholung
    // innerhalb eines Durchgangs, auch wenn der Zufallsgenerator dieselbe Rechnung wählen würde.
    if(state.taskPoolIndex >= state.taskPool.length){
      // Sicherheitsnetz: sollte ein Pool je aufgebraucht sein, nicht stillschweigend wiederholen.
      showRoundResult();
      return;
    }
    const {m, s} = state.taskPool[state.taskPoolIndex++];
    const key = `${m}-${s}`;
    state.seenCalculations.add(key);
    state.startNumber = m;
    state.subtrahend = s;
    state.currentValue = m;
    state.taskStartedAt = Date.now();

    state.baseTens = Math.floor(m/10);

    const startE = m % 10;
    const subE = s % 10;
    state.reservedBreakSlot = (startE < subE) ? state.baseTens : null;

    // IMPORTANT: apply sizing after numbers are known
    fitToViewport();

    initViz(m);
    vizPanel.style.display = state.vizShown ? "block" : "none";

    startTaskTimer();

    state.coverTimer = setTimeout(async ()=>{
      coverOrange(true);
      if(usesDirectInput()){
        await animateAutoSubtrahendToRed();
      }
    }, COVER_AFTER_MS);

    if(usesDirectInput()){
      renderCalcLineWithInput();
    } else {
      renderCalculationHeader(`${m} − ${s} =`);
      const subZ = Math.floor(s/10)*10;
      renderStep(0, getFirstStepOptions(subE, subZ, startE, s));
    }

    // second pass align after DOM paint
    setTimeout(()=> {
      fitToViewport();
      updateAllOnesColsPositions("orange");
      updateAllOnesColsPositions("red");
      updateAllOnesColsPositions("yellow");
    }, 0);
  }

  // =========================================================
  // Visualization
  // =========================================================
  function initViz(minuend){
    vizWrap.innerHTML="";

    vizWrap.appendChild(buildField("vizField vizOrange","orange"));
    vizWrap.appendChild(buildField("vizField vizRed","red"));
    const y=buildField("vizField vizYellow","yellow");
    y.style.display="none";
    vizWrap.appendChild(y);

    ensureSlots("orange");
    ensureSlots("red");
    ensureSlots("yellow");

    fillFieldWithNumber("orange", minuend);
    clearFieldBlocks("red");
    clearFieldBlocks("yellow");

    setCover("orange", false);
    setOrangeOpacity(1);

    updateAllOnesColsPositions("orange");
    updateAllOnesColsPositions("red");
    updateAllOnesColsPositions("yellow");
  }

  function buildField(className,key){
    const f=document.createElement("div");
    f.className=className;
    f.dataset.field=key;

    const cover=document.createElement("div");
    cover.className="vizCover";
    cover.dataset.cover="1";
    f.appendChild(cover);

    const row=document.createElement("div");
    row.className="blocksRow";
    row.style.position="relative";
    f.appendChild(row);

    const tensRow=document.createElement("div");
    tensRow.className="tensRow";
    tensRow.dataset.tensrow="1";
    row.appendChild(tensRow);

    const onesLayer=document.createElement("div");
    onesLayer.dataset.onesLayer="1";
    onesLayer.style.position="absolute";
    onesLayer.style.left="10px";
    onesLayer.style.top="10px";
    onesLayer.style.right="10px";
    onesLayer.style.bottom="10px";
    row.appendChild(onesLayer);

    return f;
  }

  function fieldEl(key){ return qs(`[data-field="${key}"]`, vizWrap); }

  function makeRod(){
    const rod=document.createElement("div");
    rod.className="tenRod";
    rod.dataset.rod="1";
    for(let c=0;c<10;c++){
      const cube=document.createElement("div");
      cube.className="unitCube"+(c===4?" group5":"");
      rod.appendChild(cube);
    }
    return rod;
  }
  function makeOne(i, colId){
    const one=document.createElement("div");
    one.className="unitCube"+(i===4?" group5":"");
    one.dataset.one="1";
    one.dataset.col = String(colId);
    return one;
  }

  function measureRodWidth(){
    const temp = makeRod();
    temp.style.visibility="hidden";
    temp.style.position="absolute";
    temp.style.left="-9999px";
    document.body.appendChild(temp);
    const w = temp.getBoundingClientRect().width || 28;
    temp.remove();
    return w;
  }

  // Urspruengliche Einer stehen unmittelbar rechts vom letzten Zehner.
  function ensureSlots(fieldKey){
    const f = fieldEl(fieldKey);
    if(!f) return;
    const tensRow = qs('[data-tensrow="1"]', f);
    if(!tensRow) return;

    if(qs('[data-slot="1"]', tensRow) || qs('[data-ones-slot="1"]', tensRow)) return;

    tensRow.innerHTML="";

    for(let i=1;i<=MAX_TENS_SLOTS;i++){
      if(i===6){
        const sp=document.createElement("div");
        sp.className="tensSpacer";
        tensRow.appendChild(sp);
      }
      const slot=document.createElement("div");
      slot.dataset.slot = String(i);
      slot.style.width = `${state.rodW}px`;
      slot.style.minWidth = `${state.rodW}px`;
      slot.style.flex = "0 0 auto";
      slot.style.display="flex";
      slot.style.alignItems="flex-start";
      tensRow.appendChild(slot);
    }

    const onesSlot=document.createElement("div");
    onesSlot.dataset.onesSlot="1";
    onesSlot.style.width = `${state.rodW}px`;
    onesSlot.style.minWidth = `${state.rodW}px`;
    onesSlot.style.flex = "0 0 auto";
    onesSlot.style.pointerEvents="none";
    tensRow.appendChild(onesSlot);
  }

  function getSlotEl(fieldKey, idx){
    const f = fieldEl(fieldKey);
    if(!f) return null;
    const tensRow = qs('[data-tensrow="1"]', f);
    return qs(`[data-slot="${idx}"]`, tensRow);
  }
  function getOnesSlotEl(fieldKey){
    const f = fieldEl(fieldKey);
    if(!f) return null;
    const tensRow = qs('[data-tensrow="1"]', f);
    return qs('[data-ones-slot="1"]', tensRow);
  }
  function getOnesLayer(fieldKey){
    const f = fieldEl(fieldKey);
    if(!f) return null;
    return qs('[data-ones-layer="1"]', f);
  }

  function getOrCreateOnesCol(fieldKey, colId){
    const layer = getOnesLayer(fieldKey);
    if(!layer) return null;

    let col = qs(`[data-ones-col="${colId}"]`, layer);
    if(col) return col;

    col = document.createElement("div");
    col.className = "onesCol" + (colId === "main" ? " mainOnesCol" : " brokenOnesCol");
    col.dataset.onesCol = String(colId);
    layer.appendChild(col);

    updateOnesColPosition(fieldKey, colId);
    return col;
  }

  function updateOnesColPosition(fieldKey, colId){
    const layer = getOnesLayer(fieldKey);
    if(!layer) return;
    const col = qs(`[data-ones-col="${colId}"]`, layer);
    if(!col) return;

    // 34: Einer Spalte 4, aufgeloester Zehner Spalte 3.
    // 74: Einer Spalte 8, aufgeloester Zehner Spalte 7.
    // Auch beim Verschieben in Rot/Gelb bleiben diese Positionen gleich.
    const anchor = colId === "main"
      ? (getSlotEl(fieldKey, state.baseTens + 1) || getOnesSlotEl(fieldKey))
      : getSlotEl(fieldKey, Number(colId));
    if(!anchor) return;
    // Align with the cubes inside the rod, not with the outside edge of its slot.
    // The overlay layer is inset, so use screen coordinates relative to that layer.
    const rodInset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rodPad")) +
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rodBorder"));
    col.style.left = `${anchor.getBoundingClientRect().left + rodInset - layer.getBoundingClientRect().left}px`;
  }

  function updateAllOnesColsPositions(fieldKey){
    const layer = getOnesLayer(fieldKey);
    if(!layer) return;
    // Alle Felder (orange, rot, gelb): Einer bauen sich von oben auf (5er-Abstand).
    const fromBottom = false;
    qsa('[data-ones-col]', layer).forEach(col=>{
      updateOnesColPosition(fieldKey, col.dataset.onesCol);
      col.classList.toggle("onesFromBottom", fromBottom);
      col.classList.toggle("onesFromTop", !fromBottom);
      // Die 5er-Trennung sitzt immer zwischen dem fünften und sechsten
      // Würfel, unabhängig davon, ob die Spalte oben oder unten verankert ist.
      const cubes = qsa('.unitCube', col);
      cubes.forEach((cube, index)=>cube.classList.toggle('group5', index === 4));
    });
  }

  function clearFieldBlocks(key){
    ensureSlots(key);

    for(let i=1;i<=MAX_TENS_SLOTS;i++){
      const slot=getSlotEl(key,i);
      if(slot) slot.innerHTML="";
    }

    const layer=getOnesLayer(key);
    if(layer) layer.innerHTML="";

    getOrCreateOnesCol(key,"main");
    updateAllOnesColsPositions(key);
  }

  function placeRodInSlot(fieldKey, idx, rodEl){
    const slot = getSlotEl(fieldKey, idx);
    if(!slot) return;
    slot.innerHTML="";
    rodEl.dataset.slotIndex = String(idx);
    slot.appendChild(rodEl);
  }

  function fillFieldWithNumber(key,n){
    clearFieldBlocks(key);

    const tens=Math.floor(n/10);
    const ones=n%10;

    for(let i=1;i<=tens;i++){
      placeRodInSlot(key, i, makeRod());
    }

    const mainCol = getOrCreateOnesCol(key,"main");
    for(let i=0;i<ones;i++){
      mainCol.appendChild(makeOne(i,"main"));
    }

    updateAllOnesColsPositions(key);
  }

  function setCover(key,on){
    const f=fieldEl(key);
    if(!f) return;
    const cover=qs('[data-cover="1"]', f);
    const tensRow=qs('[data-tensrow="1"]', f);
    const layer=getOnesLayer(key);
    cover.classList.toggle("on", !!on);
    tensRow.style.visibility = on ? "hidden":"visible";
    if(layer) layer.style.visibility = on ? "hidden":"visible";
  }
  function coverOrange(on){ setCover("orange", on); }
  function setOrangeOpacity(op){
    const f=fieldEl("orange");
    if(f) f.style.opacity = String(op);
  }

  function occupiedRodSlots(fieldKey){
    const f = fieldEl(fieldKey);
    if(!f) return [];
    const tensRow = qs('[data-tensrow="1"]', f);
    const slots = qsa('[data-slot]', tensRow);
    const occ=[];
    slots.forEach(s=>{
      const rod = qs('.tenRod', s);
      if(rod) occ.push({idx:parseInt(s.dataset.slot,10), rod});
    });
    occ.sort((a,b)=>a.idx-b.idx);
    return occ;
  }

  function breakSpecificTenToOnes(fieldKey, slotIdx){
    const slot = getSlotEl(fieldKey, slotIdx);
    const rod = slot ? qs('.tenRod', slot) : null;
    if(!rod) return false;

    rod.remove();

    const col = getOrCreateOnesCol(fieldKey, String(slotIdx));
    col.innerHTML="";
    for(let i=0;i<10;i++){
      col.appendChild(makeOne(i, String(slotIdx)));
    }

    if(fieldKey==="orange" && state.reservedBreakSlot === slotIdx){
      state.reservedBreakSlot = null;
    }

    updateAllOnesColsPositions(fieldKey);
    return true;
  }

  function breakOneTenInField(fieldKey){
    if(fieldKey==="orange" && state.reservedBreakSlot){
      const slot=getSlotEl("orange", state.reservedBreakSlot);
      if(slot && qs(".tenRod", slot)){
        return breakSpecificTenToOnes("orange", state.reservedBreakSlot);
      }
    }
    const occ = occupiedRodSlots(fieldKey);
    if(!occ.length) return false;
    return breakSpecificTenToOnes(fieldKey, occ[occ.length-1].idx);
  }

  // Level 4: Zehner möglichst weit rechts wegnehmen.
  // Wenn Einer fehlen, bleibt der rechteste Zehner stehen und wird aufgelöst.
  function pickLeftmostRods(fieldKey, count){
    const occ = occupiedRodSlots(fieldKey);
    let avoid=null;
    // Beim Schritt zum nächsten Zehner (z. B. -40 bei 53-37)
    // werden die Zehner ganz rechts beginnend weggenommen. Bei -Z (z. B. -30)
    // bleibt der rechte Zehner stehen, damit genau die linken drei wandern.
    if(fieldKey==="orange" && state.reservedBreakSlot){
      const subE=state.subtrahend%10;
      const nextTenDelta=-(state.subtrahend + 10 - subE);
      if(state.currentChosenDelta !== nextTenDelta){
        const slot=getSlotEl("orange", state.reservedBreakSlot);
        if(slot && qs(".tenRod", slot)) avoid=state.reservedBreakSlot;
      }
    }
    const filtered = avoid && count < occ.length
      ? occ.filter(x=>x.idx!==avoid)
      : occ;
    if(state.level === 6){
      // Bei Level 6 folgen die Zehner stets von rechts nach links dem gewählten
      // Rechenweg. So liegen die verbleibenden Einer nach -nächster Zehner
      // in den gewünschten benachbarten Spalten.
      return filtered.slice().sort((a,b)=>b.idx-a.idx).slice(0,count).map(x=>x.rod);
    }
    return filtered.slice(0, count).map(x=>x.rod);
  }

  function pickOnesFromExistingCols(fieldKey, countNeeded, preferBroken=false){
    const layer=getOnesLayer(fieldKey);
    if(!layer) return [];

    const cols=qsa('[data-ones-col]', layer);
    const main = cols.find(c=>c.dataset.onesCol==="main");
    const broken = cols.filter(c=>c.dataset.onesCol!=="main")
      .sort((a,b)=>parseInt(b.dataset.onesCol,10)-parseInt(a.dataset.onesCol,10));

    const order=[];
    if(preferBroken) order.push(...broken);
    if(main) order.push(main);
    if(!preferBroken) order.push(...broken);

    const picked=[];
    for(const col of order){
      const cubes=qsa(".unitCube", col);
      // In beiden Orientierungen liegt das zu entfernende Ende beim letzten
      // DOM-Kind: Minuend/Differenz werden von unten, Subtrahend von oben abgetragen.
      while(cubes.length && picked.length<countNeeded){
        picked.push(cubes.pop());
      }
      if(picked.length>=countNeeded) break;
    }
    return picked;
  }

  function makePlaceholderFor(el){
    const ph=document.createElement("div");
    if(el.classList.contains("tenRod")){
      ph.style.width = `${state.rodW}px`;
      ph.style.minWidth = `${state.rodW}px`;
      ph.style.height = `${el.getBoundingClientRect().height}px`;
    } else {
      const r=el.getBoundingClientRect();
      ph.style.width = `${r.width}px`;
      ph.style.height = `${r.height}px`;
    }
    ph.style.visibility="hidden";
    ph.dataset.ph="1";
    return ph;
  }

  function cloneFromEl(src){
    if(src.classList.contains("tenRod")){
      const r=makeRod();
      r.classList.add("fly");
      return r;
    }
    const c=document.createElement("div");
    c.className="fly unitCube";
    return c;
  }

  function animateMoveRodsBySlot(fromKey,toKey,rods){
    return new Promise((resolve)=>{
      if(!rods.length) return resolve();
      state.isAnimating=true;

      const moves=rods.map(rodEl=>{
        const fromSlot = rodEl.parentElement;
        const slotIdx = parseInt(fromSlot.dataset.slot,10);
        const targetSlot = getSlotEl(toKey, slotIdx);

        const ph=makePlaceholderFor(rodEl);
        targetSlot.appendChild(ph);
        return {rodEl, ph};
      });

      requestAnimationFrame(()=>{
        const flyList=moves.map(m=>{
          const srcRect=m.rodEl.getBoundingClientRect();
          const tgtRect=m.ph.getBoundingClientRect();

          const fly=cloneFromEl(m.rodEl);
          fly.style.left=`${srcRect.left}px`;
          fly.style.top =`${srcRect.top}px`;
          document.body.appendChild(fly);

          const dx=tgtRect.left-srcRect.left;
          const dy=tgtRect.top -srcRect.top;

          requestAnimationFrame(()=>fly.style.transform=`translate(${dx}px, ${dy}px)`);
          return {...m, fly};
        });

        setTimeout(()=>{
          flyList.forEach(m=>{
            m.fly.remove();
            m.ph.replaceWith(m.rodEl);
          });
          updateAllOnesColsPositions(fromKey);
          updateAllOnesColsPositions(toKey);
          state.isAnimating=false;
          resolve();
        }, MOVE_MS+60);
      });
    });
  }

  function animateMoveOnes(fromKey,toKey,ones){
    return new Promise((resolve)=>{
      if(!ones.length) return resolve();
      state.isAnimating=true;

      const moves=ones.map(oneEl=>{
        const colId = oneEl.dataset.col || "main";
        const targetCol = getOrCreateOnesCol(toKey, colId);

        const ph=makePlaceholderFor(oneEl);
        targetCol.appendChild(ph);
        return {oneEl, ph};
      });

      updateAllOnesColsPositions(toKey);

      requestAnimationFrame(()=>{
        const flyList=moves.map(m=>{
          const srcRect=m.oneEl.getBoundingClientRect();
          const tgtRect=m.ph.getBoundingClientRect();

          const fly=cloneFromEl(m.oneEl);
          fly.style.left=`${srcRect.left}px`;
          fly.style.top =`${srcRect.top}px`;
          document.body.appendChild(fly);

          const dx=tgtRect.left-srcRect.left;
          const dy=tgtRect.top -srcRect.top;

          requestAnimationFrame(()=>fly.style.transform=`translate(${dx}px, ${dy}px)`);
          return {...m, fly};
        });

        setTimeout(()=>{
          flyList.forEach(m=>{
            m.fly.remove();
            m.ph.replaceWith(m.oneEl);
          });
          updateAllOnesColsPositions(fromKey);
          updateAllOnesColsPositions(toKey);
          state.isAnimating=false;
          resolve();
        }, MOVE_MS+60);
      });
    });
  }

  // Fuer eine direkte Einer-Subtraktion, die den vorhandenen Einerrest
  // ueberschreitet, wird der letzte Zehner aufgeloest und zuerst dort
  // abgezogen. Bei Teilschritten (-4, danach -4) werden die freien Einer
  // dagegen zuerst entfernt. Es wird nie mehr als ein Zehner aufgeloest.
  async function moveOnesForSubtraction(fromKey, toKey, amount){
    const layer = getOnesLayer(fromKey);
    const main = layer ? qs('[data-ones-col="main"]', layer) : null;
    const freeCount = main ? qsa('.unitCube', main).length : 0;
    const preferBroken = amount > freeCount;
    const existing = layer ? qsa('[data-ones-col]:not([data-ones-col="main"]) .unitCube', layer).length : 0;
    if(amount > freeCount + existing){
      const didBreak = breakOneTenInField(fromKey);
      if(!didBreak) return;
    }
    const picked = pickOnesFromExistingCols(fromKey, amount, preferBroken);
    await animateMoveOnes(fromKey, toKey, picked);
  }

  async function applyVizDelta(delta){
    if(delta===0) return;
    coverOrange(true);

    const fromKey = delta<0 ? "orange":"red";
    const toKey   = delta<0 ? "red":"orange";
    const amount = Math.abs(delta);

    const tensNeed = Math.floor(amount/10);
    const onesNeed = amount%10;

    if(tensNeed>0){
      const rods = pickLeftmostRods(fromKey, tensNeed);
      await animateMoveRodsBySlot(fromKey, toKey, rods);
    }
    if(onesNeed>0) await moveOnesForSubtraction(fromKey,toKey,onesNeed);
    // Beim letzten +E-Schritt werden keine Zehner bewegt; nur die Einer
    // wandern zurück. Das orange Feld bleibt dabei wie vorgesehen abgedeckt.
    updateAllOnesColsPositions(fromKey);
    updateAllOnesColsPositions(toKey);
  }

  async function animateAutoSubtrahendToRed(){
    coverOrange(true);
    const amount=state.subtrahend;
    const tensNeed=Math.floor(amount/10);
    const onesNeed=amount%10;
    if(tensNeed>0){
      const rods = pickLeftmostRods("orange", tensNeed);
      await animateMoveRodsBySlot("orange","red",rods);
    }
    if(onesNeed>0) await moveOnesForSubtraction("orange","red",onesNeed);
  }

  async function animateDifferenceToYellowParallel(){
    const yellow=fieldEl("yellow");
    yellow.style.display="block";

    setOrangeOpacity(0.5);
    coverOrange(true);

    const rods = occupiedRodSlots("orange").map(x=>x.rod);
    const layer = getOnesLayer("orange");
    const ones = layer ? qsa(".unitCube", layer) : [];

    await Promise.all([
      animateMoveRodsBySlot("orange","yellow",rods),
      animateMoveOnes("orange","yellow",ones)
    ]);
  }

  // =========================================================
  // Session end overlay
  // =========================================================
  function endSession(){
    emitLearning("session-end", {startedAt:state.sessionStartedAt});
    state.sessionStartedAt = 0;
    const totalSec = state.stats.elapsedSec;
    clearTimers();

    const overlay=document.createElement("div");
    overlay.className="sessionOverlay";

    const card=document.createElement("div");
    card.className="sessionCard";
    card.innerHTML=`
      <h2>Sitzung beendet</h2>
      <div class="row"><span>Richtig</span><span>${state.stats.correct}</span></div>
      <div class="row"><span>Falsch</span><span>${state.stats.wrong}</span></div>
      <div class="row"><span>Zeit</span><span>${fmtTime(totalSec)}</span></div>
    `;

    const btn=document.createElement("button");
    btn.textContent="Schließen";
    btn.onclick=()=>overlay.remove();

    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }
})();