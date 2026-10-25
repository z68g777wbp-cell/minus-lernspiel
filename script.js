(() => {
  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];
  const rnd = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  const ROUND_TASKS = 20;
  const MOVE_MS = 650;
  const COVER_AFTER_MS = 1800;
  const HOLD_AFTER_RESULT_MS = 850;

  const TEN_SPACER = 16;
  const MAX_TENS_SLOTS = 9; // Bis zu neun positionsgetreue Spalten

  const state = {
    level: 1,
    startNumber: 0,
    subtrahend: 0,
    currentValue: 0,
    steps: [],

    vizShown: true,
    coverTimer: null,
    isAnimating: false,

    wrongCountedThisTask: false,
    taskFinished: false,

    baseTens: 0,
    rodW: 28,

    reservedBreakSlot: null,
    currentChosenDelta: null,

    stats: {
      correct: 0,
      wrong: 0,
      completed: 0,
      startTs: 0,
      elapsedSec: 0,
      tickTimer: null,
    }
  };

  // ---------- Ensure base nodes ----------
  const app = ensureEl("div", "app", document.body);
  const vizPanel = ensureEl("div", "vizPanel", document.body);
  const vizWrap = ensureEl("div", "vizWrap", vizPanel);

  const pointsBtn = ensureEl("button", "pointsBtn", document.body);
  const nextBtn   = ensureEl("button", "nextBtn", document.body);
  const endBtn    = ensureEl("button", "endBtn", document.body);

  const okCountEl  = ensureEl("span", "okCount", document.body);
  const badCountEl = ensureEl("span", "badCount", document.body);
  okCountEl.textContent = "0";
  badCountEl.textContent = "0";

  ensureShell();

  // Events
  pointsBtn.onclick = () => {
    state.vizShown = !state.vizShown;
    vizPanel.style.display = state.vizShown ? "block" : "none";
  };
  nextBtn.onclick = () => generateNewCalculation();
  endBtn.onclick = () => endSession();

  renderLevelButtons();
  fitToViewport();
  window.addEventListener("resize", () => {
    clearTimeout(window.__fitT);
    window.__fitT = setTimeout(fitToViewport, 60);
  });

  updateCounters();
  setActiveLevel(1);

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
    pointsBtn.innerHTML = '<span class="placeValueIcon"><span class="placeZ">Z</span><span class="placeE">E</span></span> <span>Stellenwerte</span>';
    pointsBtn.title = "Bildliche Darstellung von Zehnern (Z) und Einern (E) ein- oder ausblenden";
    nextBtn.classList.add("ctrlBtn");
    nextBtn.textContent = "➜";
    endBtn.classList.add("ctrlBtn");
    endBtn.textContent = "Ende";

    topRight.appendChild(pointsBtn);
    topRight.appendChild(nextBtn);
    topRight.appendChild(endBtn);

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
      b.textContent=String(n);
      b.onclick=()=>keypadTypeDigit(String(n));
      grid.appendChild(b);
    }

    const bottom=document.createElement("div");
    bottom.id="keypadBottom";

    const zero=document.createElement("button");
    zero.className="keyBtn";
    zero.id="key0";
    zero.textContent="0";
    zero.onclick=()=>keypadTypeDigit("0");

    const del=document.createElement("button");
    del.className="keyBtn";
    del.id="keyDel";
    del.textContent="⌫";
    del.onclick=()=>keypadDelete();

    bottom.appendChild(zero);
    bottom.appendChild(del);

    kp.appendChild(grid);
    kp.appendChild(bottom);
    return kp;
  }

  function getActiveInput(){
    const ae=document.activeElement;
    if(ae && ae.tagName==="INPUT" && ae.type==="number") return ae;
    const inputs=qsa('input[type="number"]', app).filter(i=>i.offsetParent!==null && !i.disabled);
    return inputs.length ? inputs[inputs.length-1] : null;
  }
  function keypadTypeDigit(d){
    const inp=getActiveInput();
    if(!inp) return;
    inp.value=(inp.value ?? "") + d;
    inp.focus();
    inp.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function keypadDelete(){
    const inp=getActiveInput();
    if(!inp) return;
    const cur=inp.value ?? "";
    inp.value=cur.slice(0,-1);
    inp.focus();
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

    const topH = topRow.getBoundingClientRect().height;
    const shellH = window.innerHeight;
    const padding = 12*2 + 10;
    const contentH = Math.max(240, shellH - topH - padding);
    contentRow.style.height = `${contentH}px`;

    const leftW = Math.max(260, leftCol.getBoundingClientRect().width);

    const slotGap = 10;
    const spacer = TEN_SPACER;
    const usableW = Math.max(240, leftW - 12);

    // Fit 10 columns in width
    let rodW = Math.floor((usableW - (9*slotGap) - spacer) / 10);
    rodW = clamp(16, 44, rodW);

    // Choose target field height (screen friendly)
    const targetFieldH = clamp(160, Math.floor(contentH * 0.32), 360);

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
      if(cube <= 7) break;
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

    updateAllOnesColsPositions("orange");
    updateAllOnesColsPositions("red");
    updateAllOnesColsPositions("yellow");

    function clamp(min,max,v){ return Math.max(min, Math.min(max, v)); }
  }

  // =========================================================
  // Levels
  // =========================================================
  function renderLevelButtons(){
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

  // =========================================================
  // Generator
  // =========================================================
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
      {text:`- ${subZ}`, value:-subZ}
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
    stopRoundTimer();
    state.stats.correct = 0;
    state.stats.wrong = 0;
    state.stats.completed = 0;
    state.stats.startTs = 0;
    state.stats.elapsedSec = 0;
    state.taskFinished = false;
    state.wrongCountedThisTask = false;
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
  function attachAutoCheck(inputEl, fnCheck){
    let t=null;
    inputEl.addEventListener("input", ()=>{
      if(t) clearTimeout(t);
      t=setTimeout(()=>{
        const v=parseInt(inputEl.value,10);
        if(Number.isNaN(v)) return;
        fnCheck(v);
      }, 1250);
    });
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
    input.type="number";
    input.className="input-field";
    wrap.appendChild(input);

    app.appendChild(wrap);
    input.focus();

    attachAutoCheck(input, (v)=>validateFinalOnly(v, input));
  }

  function renderCalculationHeader(text){
    const p=document.createElement("p");
    p.id="calculation";
    p.textContent=text;
    app.appendChild(p);
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
        if(state.isAnimating) return;
        if(stepState.chosen) return;
        if((state.level===2 || state.level===5) && stepIndex===1 && opt.value !== -(state.subtrahend-(state.startNumber%10))){
          b.classList.add("incorrect");
          setTimeout(()=>b.classList.remove("incorrect"), 500);
          return;
        }

        // Level 3 offers two possible first strategies. The chosen strategy
        // alone determines the animation; do not animate before the click.
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

        const eq = document.createElement("div");
        eq.className="eqRow";
        const sign = opt.value < 0 ? "−" : "+";
        const abs = Math.abs(opt.value);

        const label = document.createElement("div");
        label.textContent = `${state.currentValue} ${sign} ${abs} =`;
        eq.appendChild(label);

        const input = document.createElement("input");
        input.type="number";
        input.className="input-field";
        input.inputMode="numeric";
        eq.appendChild(input);

        step.appendChild(eq);
        stepState.inputEl = input;

        input.focus();
        attachAutoCheck(input, (v)=>validateStepInput(stepIndex, v));
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
      inputEl.classList.remove("incorrect");
      inputEl.classList.add("correct");
      onSolvedCorrect();
    } else {
      markTaskWrong();
      inputEl.classList.add("incorrect");
      setTimeout(()=>{
        inputEl.value="";
        inputEl.classList.remove("incorrect");

        state.vizShown = true;
        vizPanel.style.display = "block";
        setOrangeOpacity(1);
        setCover("orange", false);

        inputEl.focus();
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
      input.classList.remove("incorrect");
      input.classList.add("correct");
      onSolvedCorrect();
      return;
    }

    const expected = state.currentValue + step.selectedValue;
    if(v===expected){
      input.classList.remove("incorrect");
      input.classList.add("correct");
      // Ein korrektes Zwischenergebnis wird gesperrt. Das Kind arbeitet
      // ausschließlich mit dem nächsten Rechenschritt weiter.
      input.readOnly = true;
      input.setAttribute("aria-label", "Richtiges Zwischenergebnis, Eingabe gesperrt");
      input.blur();
      state.currentValue = expected;

      if(stepIndex===0){
        if(state.level === 2 || state.level === 5){
          renderStep(1, getLevel3SecondStepOptions());
        } else {
          renderStep(1, getSecondStepOptions(state.startNumber, state.subtrahend));
        }
      } else if(stepIndex===1 && state.level === 6){
        renderStep(2, getThirdStepOptions(state.startNumber, state.subtrahend));
      }
    } else {
      input.classList.add("incorrect");
      markTaskWrong();

      setTimeout(()=>{
        input.value="";
        input.classList.remove("incorrect");

        state.vizShown = true;
        vizPanel.style.display = "block";
        setOrangeOpacity(1);
        setCover("orange", false);

        input.focus();
      }, 1000);
    }
  }

  function onSolvedCorrect(){
    if(state.taskFinished) return;
    state.taskFinished = true;
    if(state.coverTimer){ clearTimeout(state.coverTimer); state.coverTimer=null; }
    if(!state.wrongCountedThisTask){
      state.stats.correct += 1;
    }
    state.stats.completed += 1;
    updateCounters();
    showSuccess();

    animateDifferenceToYellowParallel().then(()=>{
      setTimeout(()=>{
        if(state.stats.completed >= ROUND_TASKS){
          showRoundResult();
        } else {
          generateNewCalculation();
        }
      }, HOLD_AFTER_RESULT_MS);
    });
  }

  function showRoundResult(){
    clearTimers();
    stopRoundTimer();
    const overlay=document.createElement("div");
    overlay.className="sessionOverlay roundOverlay";
    const card=document.createElement("div");
    card.className="sessionCard roundCard";
    const score=state.stats.correct;
    const totalSec=state.stats.elapsedSec;

    // Rückmeldung wie vereinbart: Ergebnis, „von 20 richtig“ und Zeit.
    // 18–20: Sternenregen; 15–17: Daumen hoch; 0–14: keine zusätzliche Grafik.
    let celebration="";
    if(score >= 18){
      celebration='<div class="celebration stars" aria-label="Sternenregen">⭐ ✨ 🌟 ⭐ ✨ 🌟 ⭐</div>';
      startStarRain(overlay);
    } else if(score >= 15){
      celebration='<div class="celebration thumbs" aria-label="Daumen hoch">👍</div>';
    }

    card.innerHTML=`<div class="roundFeedback" aria-live="polite"><div class="bigScore">${score}</div><div class="scoreLabel">von ${ROUND_TASKS} richtig</div><div class="roundTime">Zeit: ${fmtTime(totalSec)}</div>${celebration}</div>`;
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
    if(state.stats.completed >= ROUND_TASKS) return;
    clearTimers();
    clearApp();

    state.isAnimating = false;
    state.taskFinished = false;
    state.steps = [];
    state.currentValue = 0;
    state.wrongCountedThisTask = false;

    const {m,s} = generateTaskForLevel(state.level);
    state.startNumber = m;
    state.subtrahend = s;
    state.currentValue = m;

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
      if([1,3,4].includes(state.level)){
        await animateAutoSubtrahendToRed();
      }
    }, COVER_AFTER_MS);

    if([1,3,4].includes(state.level)){
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
    // Minuend (orange) und Differenz (gelb): Einer liegen oben.
    // Subtrahend (rot): Einer liegen unten.
    const fromBottom = fieldKey === "red";
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