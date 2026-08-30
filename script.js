const API_URL = "api/auth.php";

const $ = (selector) => document.querySelector(selector);

const authSection = $("#auth-section");
const accountSection = $("#account-section");
const teacherInviteSection = $("#teacher-invite-section");
const teacherStudentsSection = $("#teacher-students-section");
const teacherNameRequestsSection = $("#teacher-name-requests-section");
const studentSection = $("#student-section");
const studentDisplayNameInput = $("#student-display-name");
const studentSaveNameBtn = $("#student-save-name");
const studentNameError = $("#student-name-error");
const loginForm = $("#login-form");
const registerForm = $("#register-form");
const regRole = $("#reg-role");
const regRoleTrigger = $("#reg-role-trigger");
const regRoleLabel = $("#reg-role-label");
const regRoleOptions = $("#reg-role-options");
const regRoleWrap = $("#reg-role-wrap");
const regTeacherOnly = document.querySelector(".reg-teacher-only");
const regStudentOnly = document.querySelector(".reg-student-only");
const toast = $("#toast");
const menuButton = $("#menu-button");
const menuOverlay = $("#menu-overlay");
const menuClose = $("#menu-close");
const lessonRandom = $("#lesson-random");
const pebbleTrack = $("#pebble-track");
const pebbleTurtles = $("#pebble-turtles");
const pebbleWinner = $("#pebble-winner");

const raceColors = ["#7657f6", "#ef5a6f", "#1d9d69", "#f0a12b", "#1597b8", "#d05b9d", "#687080", "#8b6f47"];

let account = null;
let csrfToken = "";
let teacherClass = null;
let students = [];
let activeStudent = null;
let pebbleRaceState = [];
let pebbleRaf = null;
let pebbleLightTimer = null;
let pebbleSeqTimer = null;
let pebbleFinishOrder = 0;
let pebbleRacing = false;
let pebbleLastTime = 0;
let availableCharacters = [];
let characterFrames = new Map();
let characterZoom = new Map();
let characterFlipX = new Map();
let characterFlipY = new Map();
let characterOffsetX = new Map();
let characterOffsetY = new Map();

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    try {
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("execCommand failed"));
    } catch (err) {
      try { document.body.removeChild(ta); } catch {}
      reject(err);
    }
  });
}

function setError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

async function callApi(action, options = {}) {
  const isFormData = options.body instanceof FormData;
  const query = options.query ? `&${new URLSearchParams(options.query).toString()}` : "";
  const { query: _query, ...fetchOptions } = options;
  const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}${query}`, {
    credentials: "same-origin",
    ...fetchOptions,
    headers: {
      ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Nie udało się wykonać operacji.");
  }
  return data;
}

/* ---------- Auth / UI states ---------- */

function applyContent() {
  const loggedIn = Boolean(account);
  authSection.hidden = loggedIn;
  accountSection.hidden = !loggedIn;
  teacherInviteSection.hidden = !(loggedIn && account.role === "teacher");
  teacherStudentsSection.hidden = !(loggedIn && account.role === "teacher");
  if (teacherNameRequestsSection) teacherNameRequestsSection.hidden = !(loggedIn && account.role === "teacher");
  const refreshBtn = document.querySelector("#class-refresh-btn");
  if (refreshBtn) refreshBtn.hidden = !loggedIn;
  studentSection.hidden = !(loggedIn && account.role === "student");

  if (loggedIn) {
    $("#account-name").textContent = account.fullName || account.login;
    $("#account-role").textContent = account.role === "teacher" ? "Nauczyciel" : "Uczeń";
  }

  if (!loggedIn) {
    resetPebbleView();
  }
}

/* ---------- Students + grades ---------- */

function renderStudentList() {
  $("#students-count").textContent = students.length;
  const list = $("#student-list");
  list.replaceChildren(...students.map((student) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "student-name";
    name.textContent = student.fullName;
    const stats = document.createElement("span");
    stats.className = "student-stats";
    stats.setAttribute("aria-label", `Plusy: ${student.plusCount}, minusy: ${student.minusCount}`);
    const plus = createStat(student.plusCount, "plus");
    const minus = createStat(student.minusCount, "minus");
    stats.append(plus, minus);
    const gradeActions = document.createElement("div");
    gradeActions.className = "student-grade-actions";
    for (const t of ["plus", "minus", "absent"]) {
      const b = document.createElement("button");
      b.className = `grade-mini is-${t}`;
      b.type = "button";
      b.textContent = t === "plus" ? "+" : t === "minus" ? "−" : "nb";
      b.title = t === "plus" ? "Dodaj plus" : t === "minus" ? "Dodaj minus" : "Oznacz nieobecność";
      b.addEventListener("click", () => addGradeForStudent(student, t, b));
      gradeActions.append(b);
    }
    const remove = document.createElement("button");
    remove.className = "student-remove";
    remove.type = "button";
    remove.textContent = "Usuń";
    remove.dataset.studentRemove = student.id;
    remove.title = "Usuń ucznia";
    remove.setAttribute("aria-label", `Usuń ucznia ${student.fullName}`);
    remove.addEventListener("click", () => removeStudent(student));
    li.append(name, stats, gradeActions, remove);
    return li;
  }));
}

function createStat(count, type) {
  const span = document.createElement("span");
  span.className = `student-stat is-${type}`;
  span.textContent = `${type === "plus" ? "+" : "−"} ${count}`;
  return span;
}

async function loadStudents() {
  const data = await callApi("students", { method: "GET" });
  students = data.students || [];
  activeStudent = null;
  renderStudentList();
  if (account && account.role === "teacher") renderPendingGrades();
  initPebbleAvailability();
}

/* ---------- Pebble race (żółwie po kamyczkach) ---------- */

function hasStudentsForPebble() {
  return Boolean(account && account.role === "teacher" && students.length > 0);
}

function initPebbleAvailability() {
  const has = hasStudentsForPebble();
  if (lessonRandom) lessonRandom.disabled = !has || pebbleRacing;
  if (!has) {
    if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
    const wa = $("#winner-actions");
    if (wa) wa.hidden = true;
    if (pebbleTurtles) pebbleTurtles.replaceChildren();
    pebbleRaceState = [];
  } else if (!pebbleRacing) {
    // pokaż żółwie z aktualnej klasy od razu (bez klikania Start)
    pebbleRaceState = students.map((student, index) => ({
      student,
      color: raceColors[index % raceColors.length],
      position: 0,
      speed: 0.8 + Math.random() * 0.4,
      finished: false,
      finishedOrder: null,
    }));
    renderPebbleTurtles();
    if (pebbleWinner) pebbleWinner.hidden = true;
    const wa = $("#winner-actions");
    if (wa) wa.hidden = true;
  }
}

$("#class-refresh-btn")?.addEventListener("click", async () => {
  const btn = $("#class-refresh-btn");
  if (btn) btn.disabled = true;
  try {
    if (account?.role === "teacher") {
      await loadStudents();
      await Promise.all([loadInvites().catch(() => {}), loadNameRequests().catch(() => {}), loadCharacters().catch(()=>{})]);
      showToast("Listy odświeżone.");
    } else if (account?.role === "student") {
      await Promise.all([
        renderStudentPoints().catch(() => {}),
        loadMyNameRequest().catch(() => {}),
        loadCharacters().catch(()=>{}),
        (async () => {
          try {
            const me = await callApi("me", { method: "GET" });
            if (me.account) {
              account = me.account;
              csrfToken = me.csrfToken || csrfToken;
              const accName = document.querySelector("#account-name");
              if (accName) accName.textContent = account.fullName || account.login;
              if (studentDisplayNameInput) studentDisplayNameInput.value = account.fullName;
            }
          } catch {}
        })()
      ]);
      showToast("Odświeżono.");
    } else {
      showToast("Odświeżono.");
    }
  } catch (e) {
    showToast(e.message || "Nie udało się odświeżyć.");
  } finally {
    if (btn) btn.disabled = false;
  }
});

let pebbleElements = [];
let preloadedChars = new Set();

function preloadCharacterFrames() {
  for (const ch of availableCharacters) {
    if (ch.id === 'turtle' || preloadedChars.has(ch.id)) continue;
    preloadedChars.add(ch.id);
    for (let i = 0; i < ch.frames; i++) {
      const im = new Image();
      im.decoding = "async";
      im.src = `images/characters/${ch.id}/${ch.id}_${i}.png`;
    }
  }
}

function resetPebbleView() {
  stopPebbleRace();
  pebbleFinishOrder = 0;
  pebbleRaceState = [];
  pebbleElements = [];
  activeStudent = null;
  if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
  const wa = $("#winner-actions");
  if (wa) wa.hidden = true;
  if (pebbleTurtles) pebbleTurtles.replaceChildren();
  if (lessonRandom) lessonRandom.disabled = !hasStudentsForPebble();
}

function ensurePebbleElements() {
  if (!pebbleTurtles || !pebbleTrack) return;
  const count = pebbleRaceState.length;
  if (count === 0) { pebbleTurtles.replaceChildren(); pebbleElements = []; return; }
  if (pebbleElements.length === count && pebbleTurtles.children.length === count * 2) return;
  const trackH = pebbleTrack.clientHeight || 400;
  const turtleH = 26;
  const desiredGap = 50;
  let gap = desiredGap;
  if (count > 1) {
    const needed = count * turtleH + (count - 1) * desiredGap;
    if (needed > trackH) gap = Math.max(4, (trackH - count * turtleH) / (count - 1));
  } else gap = 0;
  const totalH = count * turtleH + Math.max(0, count - 1) * gap;
  const startY = (trackH - totalH) / 2;
  pebbleTurtles.replaceChildren();
  pebbleElements = pebbleRaceState.map((racer, index) => {
    const baseTop = startY + index * (turtleH + gap) + turtleH / 2;
    const label = document.createElement("span");
    label.className = "turtle-pebble-label turtle-label-static";
    label.textContent = racer.student.fullName;
    label.style.top = `${baseTop - 10}px`;
    const wrap = document.createElement("div");
    wrap.className = "turtle-pebble";
    wrap.style.setProperty("--turtle-color", racer.color);
    wrap.dataset.index = String(index);
    const charId = racer.student.character;
    const isTurtle = !charId || charId === 'turtle';
    const hasChar = charId && characterFrames.has(charId) && !isTurtle;
    let imgEl = null;
    let iconEl = null;
    if (hasChar) {
      const img = document.createElement("img");
      img.className = "racer-char";
      img.alt = racer.student.fullName;
      img.decoding = "async";
      img.loading = "eager";
      const zoom = characterZoom.get(charId) || 1;
      const flipX = characterFlipX.get(charId) || false;
      const flipY = characterFlipY.get(charId) || false;
      const offX = characterOffsetX.get(charId) || 0;
      const offY = characterOffsetY.get(charId) || 0;
      const sx = zoom * (flipX ? -1 : 1);
      const sy = zoom * (flipY ? -1 : 1);
      const parts = [];
      if (offX !== 0 || offY !== 0) parts.push(`translate(${offX}px, ${offY}px)`);
      if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
      if (parts.length) { img.style.transform = parts.join(" "); img.style.transformOrigin = "center"; }
      const charWrap = document.createElement("div");
      charWrap.className = "racer-char-wrap";
      charWrap.append(img);
      wrap.append(charWrap);
      imgEl = img;
      // ustaw pierwszą klatkę od razu, bez migania
      const frames = characterFrames.get(charId) || 1;
      const fi = Math.floor(Date.now() / 120) % frames;
      img.src = `images/characters/${charId}/${charId}_${fi}.png`;
    } else {
      const icon = document.createElement("span");
      icon.className = "turtle-icon";
      icon.style.setProperty("--turtle-color", racer.color);
      icon.setAttribute("aria-label", racer.student.fullName);
      if (isTurtle && charId === 'turtle') {
        const z = characterZoom.get('turtle') || 1;
        const fx = characterFlipX.get('turtle') || false;
        const fy = characterFlipY.get('turtle') || false;
        const ox = characterOffsetX.get('turtle') || 0;
        const oy = characterOffsetY.get('turtle') || 0;
        const sxT = z * (fx ? -1 : 1);
        const syT = z * (fy ? -1 : 1);
        const partsT = [];
        if (ox !== 0 || oy !== 0) partsT.push(`translate(${ox}px, ${oy}px)`);
        if (sxT !== 1 || syT !== 1) partsT.push(`scale(${sxT}, ${syT})`);
        if (partsT.length) { icon.style.transform = partsT.join(" "); icon.style.transformOrigin = "center"; }
      }
      wrap.append(icon);
      iconEl = icon;
    }
    pebbleTurtles.append(label, wrap);
    return { label, wrap, imgEl, iconEl, baseTop, index };
  });
}

function renderPebbleTurtles() {
  if (!pebbleTurtles || !pebbleTrack) return;
  if (pebbleRaceState.length === 0) { pebbleTurtles.replaceChildren(); pebbleElements = []; return; }
  preloadCharacterFrames();
  ensurePebbleElements();
  updatePebblePositions();
}

function updatePebblePositions() {
  if (pebbleElements.length !== pebbleRaceState.length) return;
  const now = Date.now();
  pebbleRaceState.forEach((racer, i) => {
    const el = pebbleElements[i];
    if (!el) return;
    const wave = Math.sin((racer.position / 100) * Math.PI * 3 + i * 0.7) * 6;
    const startPct = 6.5;
    const endPct = 91.54;
    const xPct = startPct + Math.max(0, Math.min(100, racer.position)) / 100 * (endPct - startPct);
    el.wrap.style.left = `${xPct}%`;
    el.wrap.style.transform = "translateX(-50%)";
    el.wrap.style.top = `${el.baseTop + wave - 13}px`;
    el.wrap.classList.toggle("is-finished", !!racer.finished);
    if (el.imgEl) {
      const charId = racer.student.character;
      const frames = characterFrames.get(charId) || 1;
      const frameIdx = Math.floor(now / 120 + i * 1.7) % frames;
      const newSrc = `images/characters/${charId}/${charId}_${frameIdx}.png`;
      if (el.imgEl.getAttribute("src") !== newSrc) el.imgEl.src = newSrc;
    }
  });
}

function resetLights() {
  clearTimeout(pebbleLightTimer);
  clearTimeout(pebbleSeqTimer);
  document.querySelectorAll("[data-start-light]").forEach((el) => el.classList.remove("is-lit"));
}

function startLightSequence() {
  const lights = [
    document.querySelector('[data-start-light="orange-one"]'),
    document.querySelector('[data-start-light="orange-two"]'),
    document.querySelector('[data-start-light="yellow-three"]'),
    document.querySelector('[data-start-light="green"]'),
  ].filter(Boolean);
  let i = 0;
  const next = () => {
    lights[i]?.classList.add("is-lit");
    if (i >= lights.length - 1) {
      pebbleLastTime = performance.now();
      pebbleRaf = requestAnimationFrame(animatePebble);
      return;
    }
    i += 1;
    pebbleSeqTimer = setTimeout(next, 650);
  };
  pebbleLightTimer = setTimeout(next, 500);
}

function startPebbleRace() {
  if (!hasStudentsForPebble() || pebbleRacing) return;
  const pendingContainer = $("#pending-grades");
  if (pendingContainer) pendingContainer.replaceChildren();
  pebbleFinishOrder = 0;
  resetLights();
  // ukryj poprzedniego zwycięzcę i przyciski +/-/nb zanim wystartuje kolejny wyścig
  activeStudent = null;
  if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
  const wa = document.querySelector("#winner-actions");
  if (wa) wa.hidden = true;
  document.querySelectorAll("[data-winner-mark]").forEach((b) => { b.disabled = false; });
  pebbleRaceState = students.map((student, index) => ({
    student,
    color: raceColors[index % raceColors.length],
    position: 0,
    speed: 6 + Math.random() * 7,
    finished: false,
    finishedOrder: null,
  }));
  renderPebbleTurtles();
  pebbleRacing = true;
  if (lessonRandom) lessonRandom.disabled = true;
  startLightSequence();
}

function animatePebble(now) {
  if (!pebbleRacing) return;
  const dt = Math.min(0.05, (now - pebbleLastTime) / 1000);
  pebbleLastTime = now;
  const active = pebbleRaceState.filter((r) => !r.finished);
  const avgPos = active.length ? active.reduce((s, r) => s + r.position, 0) / active.length : 0;
  let allFinished = true;
  pebbleRaceState.forEach((racer) => {
    if (racer.finished) return;
    racer.speed += (Math.random() - 0.5) * 1.0;
    if (racer.position < avgPos - 7) racer.speed += 0.25;
    else if (racer.position > avgPos + 7) racer.speed -= 0.2;
    racer.speed = Math.max(5, Math.min(15, racer.speed));
    const jitter = 0.75 + Math.random() * 0.5;
    racer.position += racer.speed * dt * jitter * 0.85;
    if (racer.position >= 100) {
      racer.position = 100;
      racer.finished = true;
      racer.finishedOrder = ++pebbleFinishOrder;
    } else {
      allFinished = false;
    }
  });
  updatePebblePositions();
  if (allFinished) finishPebbleRace();
  else pebbleRaf = requestAnimationFrame(animatePebble);
}

function stopPebbleRace() {
  if (pebbleRaf) cancelAnimationFrame(pebbleRaf);
  pebbleRaf = null;
  clearTimeout(pebbleLightTimer);
  clearTimeout(pebbleSeqTimer);
  resetLights();
  pebbleRacing = false;
}

function finishPebbleRace() {
  stopPebbleRace();
  // ostatni żółw na mecie odpowiada (najwolniejszy)
  const last = pebbleRaceState.reduce((slow, r) => {
    if (!slow) return r;
    return (r.finishedOrder ?? 0) > (slow.finishedOrder ?? 0) ? r : slow;
  }, null);
  const winner = last || pebbleRaceState[pebbleRaceState.length - 1];
  if (winner) {
    activeStudent = winner.student;
    if (pebbleWinner) {
      pebbleWinner.textContent = `${activeStudent.fullName} — odpowiada!`;
      pebbleWinner.hidden = false;
    }
    const wa = $("#winner-actions");
    if (wa) wa.hidden = false;
    showToast(`${activeStudent.fullName} jest ostatni na kamyczkach i odpowiada.`);
  }
  if (lessonRandom) lessonRandom.disabled = false;
}

async function removeStudent(student) {
  if (!account || account.role !== "teacher") return;
  if (!window.confirm(`Usunąć ucznia ${student.fullName}? Ta operacja usunie też jego plusy/minusy.`)) return;
  const button = document.querySelector(`[data-student-remove="${student.id}"]`);
  if (button) button.disabled = true;
  try {
    await callApi("remove-student", {
      method: "POST",
      body: JSON.stringify({ studentId: student.id }),
    });
    showToast(`Usunięto ucznia ${student.fullName}.`);
    await loadStudents();
  } catch (error) {
    showToast(error.message);
    if (button) button.disabled = false;
  }
}

async function renderPendingGrades() {
  const data = await callApi("pending-grades", { method: "GET" });
  const container = $("#pending-grades");
  const rows = data.students || [];
  if (rows.length === 0) {
    container.replaceChildren();
    const p = document.createElement("p");
    p.className = "pending-empty";
    p.textContent = "Brak nierozliczonych plusów/minusów.";
    container.append(p);
    return;
  }
  container.replaceChildren(...rows.map((student) => {
    const row = document.createElement("div");
    row.className = "pending-row";
    const name = document.createElement("strong");
    name.textContent = student.fullName;
    const dots = document.createElement("div");
    dots.className = "dots";
    dots.append(...student.points.map((point) => {
      const span = document.createElement("span");
      span.className = `pending-dot is-${point.type}`;
      span.textContent = point.type === "plus" ? "+" : point.type === "minus" ? "−" : "nb";
      span.title = point.createdAt;
      return span;
    }));
    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";
    right.style.marginLeft = "auto";
    const settle = document.createElement("button");
    settle.className = "student-remove";
    settle.type = "button";
    settle.textContent = "rozliczone";
    settle.title = "Rozlicz ucznia";
    settle.style.color = "var(--green)";
    settle.style.borderColor = "color-mix(in srgb, var(--green) 40%, var(--line))";
    settle.style.background = "color-mix(in srgb, var(--green) 8%, var(--surface))";
    settle.addEventListener("click", async () => {
      settle.disabled = true;
      try {
        await callApi("settle-grades", { method: "POST", body: JSON.stringify({ studentId: student.id }) });
        showToast(`Rozliczono ${student.fullName}.`);
        await loadStudents();
      } catch (e) { showToast(e.message); settle.disabled = false; }
    });
    right.append(dots, settle);
    row.append(name, right);
    return row;
  }));
}

async function renderStudentPoints() {
  const data = await callApi("pending-grades", { method: "GET" });
  const container = $("#student-points");
  const points = data.points || [];
  if (points.length === 0) {
    container.replaceChildren();
    const p = document.createElement("p");
    p.className = "grade-empty";
    p.textContent = "Nie masz jeszcze punktów.";
    container.append(p);
    return;
  }
  container.replaceChildren(...points.map((point) => {
    const span = document.createElement("span");
    span.className = `grade-point is-${point.type}`;
    span.textContent = point.type === "plus" ? "+" : point.type === "minus" ? "−" : "nb";
    span.title = point.createdAt;
    return span;
  }));
}

async function markStudent(type) {
  if (!account || account.role !== "teacher" || !activeStudent) return;
  const btns = document.querySelectorAll("[data-winner-mark]");
  btns.forEach((b) => { b.disabled = true; });
  try {
    await callApi("add-grade", { method: "POST", body: JSON.stringify({ studentId: activeStudent.id, type }) });
    showToast(type === "plus" ? "Dodano plus." : type === "minus" ? "Dodano minus." : "Oznaczono jako nieobecny(a).");
    activeStudent = null;
    const wa = $("#winner-actions");
    if (wa) wa.hidden = true;
    if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
    await loadStudents();
  } catch (error) {
    showToast(error.message);
    btns.forEach((b) => { b.disabled = false; });
  }
}

async function addGradeForStudent(student, type, button) {
  if (!account || account.role !== "teacher") return;
  if (button) button.disabled = true;
  try {
    await callApi("add-grade", { method: "POST", body: JSON.stringify({ studentId: student.id, type }) });
    showToast(type === "plus" ? `Dodano plus dla ${student.fullName}.` : type === "minus" ? `Dodano minus dla ${student.fullName}.` : `Oznaczono ${student.fullName} jako nieobecny(a).`);
    await loadStudents();
  } catch (error) {
    showToast(error.message);
    if (button) button.disabled = false;
  }
}

/* ---------- Auth actions ---------- */

function clearAuthInputs() {
  $("#login-username").value = "";
  $("#login-password").value = "";
  $("#reg-name").value = "";
  $("#reg-login").value = "";
  $("#reg-password").value = "";
  $("#reg-confirm").value = "";
}

function syncRoleFields() {
  const isStudent = regRole.value === "student";
  regTeacherOnly.hidden = isStudent;
  regStudentOnly.hidden = !isStudent;
  if (regRoleLabel) regRoleLabel.textContent = regRole.value === "teacher" ? "Nauczyciel" : "Uczeń";
  if (regRoleOptions) {
    regRoleOptions.querySelectorAll("li").forEach((li) => li.classList.toggle("is-selected", li.dataset.value === regRole.value));
  }
}

async function handleLogin(event) {
  event.preventDefault();
  setError($("#login-error"), "");
  try {
    const data = await callApi("login", {
      method: "POST",
      body: JSON.stringify({ login: $("#login-username").value, password: $("#login-password").value }),
    });
    applySession(data);
    showToast("Zalogowano.");
  } catch (error) {
    setError($("#login-error"), error.message);
  }
}

async function handleRegister(event) {
  event.preventDefault();
  setError($("#register-error"), "");
  try {
    const body = {
      role: regRole.value,
      fullName: $("#reg-name").value,
      login: $("#reg-login").value,
      password: $("#reg-password").value,
      confirmPassword: $("#reg-confirm").value,
    };
    if (regRole.value === "teacher") body.className = $("#reg-class-name").value;
    else body.joinKey = $("#reg-join-key").value;
    const data = await callApi("register", { method: "POST", body: JSON.stringify(body) });
    applySession(data);
    if (account && account.role === "teacher") showToast("Konto utworzone. Lista uczniów zaktualizowana automatycznie.");
    else showToast("Konto utworzone.");
  } catch (error) {
    setError($("#register-error"), error.message);
  }
}

function applySession(data) {
  account = data.account;
  csrfToken = data.csrfToken;
  teacherClass = data.class || null;
  currentClassId = teacherClass ? teacherClass.id : null;
  clearAuthInputs();
  applyContent();
  syncUI();
  if (account.role === "teacher") {
    renderTeacherClass();
    loadStudents().catch((error) => showToast(error.message));
    loadNameRequests().catch(()=>{});
    loadCharacters().catch(()=>{});
  } else {
    renderStudentPoints().catch((error) => showToast(error.message));
    loadMyNameRequest().catch(()=>{});
    loadCharacters().catch(()=>{});
  }
  openMenu();
}

function syncUI() {
  if (!account) return;
  if (account.role === "teacher") {
    teacherInviteSection.hidden = false;
    teacherStudentsSection.hidden = false;
    const nrSection = document.querySelector("#teacher-name-requests-section");
    if (nrSection) nrSection.hidden = false;
    $("#teacher-class-name").textContent = teacherClass ? teacherClass.name : "";
    loadClasses().then(() => { loadInvites().catch(()=>{}); loadNameRequests().catch(()=>{}); }).catch(()=>{});
    loadCharacters().catch(()=>{});
  } else {
    studentSection.hidden = false;
    if (studentDisplayNameInput) studentDisplayNameInput.value = account.fullName || "";
    if (studentNameError) studentNameError.hidden = true;
    loadMyNameRequest().catch(()=>{});
    loadCharacters().catch(()=>{});
  }
}

function renderTeacherClass() {
  $("#teacher-class-name").textContent = teacherClass ? teacherClass.name : "";
}

async function handleLogout() {
  try {
    await callApi("logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    // Logout proceeds even if the server session is already gone.
  }
  account = null;
  csrfToken = "";
  teacherClass = null;
  students = [];
  resetPebbleView();
  applyContent();
  showToast("Wylogowano.");
  openMenu();
}

/* ---------- Events ---------- */

/* ---------- Menu (popup) ---------- */

function openMenu() {
  menuOverlay.hidden = false;
  menuButton.hidden = true;
  menuButton.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  menuOverlay.hidden = true;
  menuButton.hidden = false;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.focus();
}

menuButton.addEventListener("click", openMenu);
menuClose.addEventListener("click", closeMenu);
document.querySelector("[data-menu-backdrop]")?.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (qrOverlay && !qrOverlay.hidden) { closeQrPopup(); return; }
  if (document.querySelector("#new-class-overlay") && !$("#new-class-overlay").hidden) { closeNewClassPopup(); return; }
  if (!menuOverlay.hidden) closeMenu();
});

lessonRandom?.addEventListener("click", startPebbleRace);
document.querySelectorAll("[data-winner-mark]").forEach((btn) => btn.addEventListener("click", () => markStudent(btn.dataset.winnerMark)));

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-auth-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
    loginForm.hidden = tab.dataset.authTab !== "login";
    registerForm.hidden = tab.dataset.authTab !== "register";
  });
});

regRole.addEventListener("change", syncRoleFields);

regRoleTrigger?.addEventListener("click", () => {
  if (!regRoleOptions || !regRoleTrigger) return;
  const willOpen = regRoleOptions.hidden;
  if (willOpen) {
    regRoleOptions.querySelectorAll("li").forEach((li) => li.classList.toggle("is-selected", li.dataset.value === regRole.value));
  }
  regRoleOptions.hidden = !willOpen;
  regRoleTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
});
regRoleOptions?.querySelectorAll("li").forEach((li) => {
  li.addEventListener("click", () => {
    regRole.value = li.dataset.value;
    if (regRoleLabel) regRoleLabel.textContent = li.textContent;
    regRoleOptions.querySelectorAll("li").forEach((el) => el.classList.toggle("is-selected", el === li));
    regRoleOptions.hidden = true;
    regRoleTrigger?.setAttribute("aria-expanded", "false");
    syncRoleFields();
    regRole.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

loginForm.addEventListener("submit", handleLogin);
registerForm.addEventListener("submit", handleRegister);
$("#logout-button").addEventListener("click", handleLogout);

async function loadMyNameRequest() {
  if (!account || account.role !== "student") return;
  try {
    const data = await callApi("my-name-request", { method: "GET" });
    const pending = data.pending;
    const box = document.querySelector("#student-name-pending");
    const pendOld = document.querySelector("#student-pending-old");
    const pendNew = document.querySelector("#student-pending-new");
    if (pending) {
      if (box) box.hidden = false;
      if (pendOld) pendOld.textContent = pending.oldName;
      if (pendNew) pendNew.textContent = pending.newName;
      if (studentDisplayNameInput) studentDisplayNameInput.disabled = true;
      if (studentSaveNameBtn) { studentSaveNameBtn.disabled = true; studentSaveNameBtn.textContent = "Oczekuje..."; }
      if (studentNameError) studentNameError.hidden = true;
    } else {
      if (box) box.hidden = true;
      if (studentDisplayNameInput) studentDisplayNameInput.disabled = false;
      if (studentSaveNameBtn) { studentSaveNameBtn.disabled = false; studentSaveNameBtn.textContent = "Zapisz"; }
      // odśwież konto — mogło zostać zatwierdzone
      try {
        const me = await callApi("me", { method: "GET" });
        if (me.account && me.account.fullName !== account.fullName) {
          account = me.account;
          csrfToken = me.csrfToken || csrfToken;
          const accName = document.querySelector("#account-name");
          if (accName) accName.textContent = account.fullName || account.login;
          if (studentDisplayNameInput) studentDisplayNameInput.value = account.fullName;
          showToast("Nauczyciel zatwierdził nową nazwę: " + account.fullName);
        }
      } catch {}
    }
  } catch {}
}

studentSaveNameBtn?.addEventListener("click", async () => {
  const newName = studentDisplayNameInput?.value?.trim() ?? "";
  if (!newName) {
    if (studentNameError) { studentNameError.textContent = "Podaj wyświetlaną nazwę."; studentNameError.hidden = false; }
    return;
  }
  if (studentNameError) studentNameError.hidden = true;
  studentSaveNameBtn.disabled = true;
  const origText = studentSaveNameBtn.textContent;
  studentSaveNameBtn.textContent = "Wysyłanie...";
  try {
    const data = await callApi("request-name-change", { method: "POST", body: JSON.stringify({ fullName: newName }) });
    showToast(data.message || "Wysłano prośbę do nauczyciela.");
    await loadMyNameRequest();
  } catch (e) {
    if (studentNameError) { studentNameError.textContent = e.message; studentNameError.hidden = false; }
    showToast(e.message);
    studentSaveNameBtn.disabled = false;
    studentSaveNameBtn.textContent = origText;
  }
});
studentDisplayNameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    studentSaveNameBtn?.click();
  }
});

async function loadInvites() {
  if (!account || account.role !== "teacher") return;
  try {
    const data = await callApi("list-invites", { method: "GET" });
    const container = $("#invite-list");
    if (!container) return;
    if (data.codes.length === 0) {
      container.replaceChildren();
      const p = document.createElement("p");
      p.className = "pending-empty";
      p.textContent = "Brak kodów jednorazowych.";
      container.append(p);
      return;
    }
    container.replaceChildren(...data.codes.map((row) => {
      const div = document.createElement("div");
      div.className = `invite-row${row.used ? " is-used" : ""}`;
      const code = document.createElement("code");
      code.textContent = row.code;
      const badgeWrap = document.createElement("div");
      badgeWrap.style.flex = "1 1 auto";
      badgeWrap.style.display = "flex";
      badgeWrap.style.justifyContent = "center";
      const badge = document.createElement("span");
      badge.className = "badge-used";
      badge.textContent = row.used ? "użyty" : "aktywny";
      badge.style.background = row.used ? "var(--surface-muted)" : "var(--purple-soft)";
      badge.style.color = row.used ? "var(--text-soft)" : "var(--purple)";
      badgeWrap.append(badge);
      const actions = document.createElement("div");
      actions.className = "invite-actions";
      const copy = document.createElement("button");
      copy.className = "student-remove";
      copy.type = "button";
      copy.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Kopiuj';
      copy.title = "Kopiuj kod";
      copy.style.color = "var(--purple)";
      copy.style.borderColor = "color-mix(in srgb, var(--purple) 42%, var(--line))";
      copy.style.background = "color-mix(in srgb, var(--purple) 7%, var(--surface))";
      copy.addEventListener("click", () => {
        copyText(row.code).then(
          () => showToast("Skopiowano " + row.code),
          () => showToast("Nie udało się skopiować.")
        );
      });
      const del = document.createElement("button");
      del.className = "student-remove";
      del.type = "button";
      del.textContent = "Usuń";
      del.title = "Usuń kod";
      del.addEventListener("click", async () => {
        try {
          await callApi("delete-invite", { method: "POST", body: JSON.stringify({ code: row.code }) });
          showToast("Usunięto kod.");
          await loadInvites();
        } catch (e) { showToast(e.message); }
      });
      actions.append(copy, del);
      div.append(code, badgeWrap, actions);
      return div;
    }));
  } catch (e) {}
}

async function loadNameRequests() {
  if (!account || account.role !== "teacher") return;
  try {
    const data = await callApi("list-name-requests", { method: "GET" });
    const requests = data.requests || [];
    const list = document.querySelector("#name-requests-list");
    const countBadge = document.querySelector("#name-requests-count");
    const section = document.querySelector("#teacher-name-requests-section");
    if (countBadge) countBadge.textContent = requests.length;
    if (section) section.hidden = false;
    if (!list) return;
    if (requests.length === 0) {
      list.replaceChildren();
      const p = document.createElement("p");
      p.className = "pending-empty";
      p.textContent = "Brak próśb o zmianę nazwy.";
      list.append(p);
      return;
    }
    list.replaceChildren(...requests.map((req) => {
      const row = document.createElement("div");
      row.className = "pending-row";
      row.style.flexWrap = "wrap";
      const info = document.createElement("div");
      info.style.display = "grid";
      info.style.gap = "2px";
      const nameLine = document.createElement("div");
      nameLine.style.fontSize = "13px";
      const oldSpan = document.createElement("span");
      oldSpan.textContent = req.oldName;
      oldSpan.style.textDecoration = "line-through";
      oldSpan.style.color = "var(--text-soft)";
      const arrow = document.createElement("span");
      arrow.textContent = " → ";
      arrow.style.color = "var(--text-soft)";
      const newSpan = document.createElement("span");
      newSpan.textContent = req.newName;
      newSpan.style.color = "var(--purple)";
      newSpan.style.fontWeight = "800";
      nameLine.append(oldSpan, arrow, newSpan);
      const meta = document.createElement("div");
      meta.className = "form-hint";
      meta.textContent = `${req.login} • ${new Date(req.createdAt).toLocaleString("pl-PL")}`;
      info.append(nameLine, meta);
      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "6px";
      actions.style.marginLeft = "auto";
      const approve = document.createElement("button");
      approve.className = "student-remove";
      approve.type = "button";
      approve.textContent = "Zatwierdź";
      approve.style.color = "var(--green)";
      approve.style.borderColor = "color-mix(in srgb, var(--green) 40%, var(--line))";
      approve.style.background = "color-mix(in srgb, var(--green) 8%, var(--surface))";
      const reject = document.createElement("button");
      reject.className = "student-remove";
      reject.type = "button";
      reject.textContent = "Odrzuć";
      approve.addEventListener("click", async () => {
        approve.disabled = true; reject.disabled = true;
        try {
          await callApi("decide-name-request", { method: "POST", body: JSON.stringify({ requestId: req.id, decision: "approve" }) });
          showToast(`Zatwierdzono: ${req.newName}`);
          await loadNameRequests();
          await loadStudents();
        } catch (e) { showToast(e.message); approve.disabled = false; reject.disabled = false; }
      });
      reject.addEventListener("click", async () => {
        approve.disabled = true; reject.disabled = true;
        try {
          await callApi("decide-name-request", { method: "POST", body: JSON.stringify({ requestId: req.id, decision: "reject" }) });
          showToast("Odrzucono prośbę.");
          await loadNameRequests();
        } catch (e) { showToast(e.message); approve.disabled = false; reject.disabled = false; }
      });
      actions.append(approve, reject);
      row.append(info, actions);
      return row;
    }));
  } catch (e) {}
}

async function loadCharacters() {
  try {
    const data = await callApi("list-characters", { method: "GET" });
    availableCharacters = data.characters || [];
    characterFrames.clear();
    characterZoom.clear();
    characterFlipX.clear();
    characterFlipY.clear();
    characterOffsetX.clear();
    characterOffsetY.clear();
    availableCharacters.forEach((c) => {
      characterFrames.set(c.id, c.frames);
      characterZoom.set(c.id, typeof c.zoom === 'number' ? c.zoom : 1.0);
      characterFlipX.set(c.id, !!c.flipX);
      characterFlipY.set(c.id, !!c.flipY);
      characterOffsetX.set(c.id, typeof c.offsetX === 'number' ? c.offsetX : 0);
      characterOffsetY.set(c.id, typeof c.offsetY === 'number' ? c.offsetY : 0);
    });
    renderCharacterGrid();
  } catch (e) {}
}

function renderCharacterGrid() {
  const grid = document.querySelector("#character-grid");
  const err = document.querySelector("#character-error");
  if (!grid) return;
  if (availableCharacters.length === 0) {
    grid.replaceChildren();
    const p = document.createElement("p");
    p.className = "pending-empty";
    p.textContent = "Brak postaci.";
    grid.append(p);
    return;
  }
  const selected = account?.character || null;
  const effectiveSelected = selected || 'turtle';
  grid.replaceChildren(...availableCharacters.map((ch) => {
    const isTurtle = ch.id === 'turtle';
    const card = document.createElement("button");
    card.type = "button";
    card.className = `character-card${effectiveSelected === ch.id ? " is-selected" : ""}`;
    card.dataset.char = ch.id;
    card.title = ch.name;
    let previewEl;
    if (isTurtle) {
      const turtle = document.createElement("span");
      turtle.className = "turtle-icon";
      turtle.style.setProperty("--turtle-color", "#1d9d69");
      turtle.style.display = "block";
      turtle.style.width = "38px";
      turtle.style.height = "26px";
      const zoom = ch.zoom || 1;
      const flipX = !!ch.flipX;
      const flipY = !!ch.flipY;
      const offX = ch.offsetX || 0;
      const offY = ch.offsetY || 0;
      const sx = zoom * (flipX ? -1 : 1);
      const sy = zoom * (flipY ? -1 : 1);
      const parts = [];
      if (offX !== 0 || offY !== 0) parts.push(`translate(${offX}px, ${offY}px)`);
      if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
      if (parts.length) {
        turtle.style.transform = parts.join(" ");
        turtle.style.transformOrigin = "center";
      }
      const wrap = document.createElement("div");
      wrap.style.width = "48px";
      wrap.style.height = "48px";
      wrap.style.display = "grid";
      wrap.style.placeItems = "center";
      wrap.append(turtle);
      previewEl = wrap;
    } else {
      const img = document.createElement("img");
      img.src = ch.preview;
      img.alt = ch.name;
      img.loading = "lazy";
      const zoom = ch.zoom || 1;
      const flipX = !!ch.flipX;
      const flipY = !!ch.flipY;
      const offX = ch.offsetX || 0;
      const offY = ch.offsetY || 0;
      const sx = zoom * (flipX ? -1 : 1);
      const sy = zoom * (flipY ? -1 : 1);
      const parts = [];
      if (offX !== 0 || offY !== 0) parts.push(`translate(${offX}px, ${offY}px)`);
      if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
      if (parts.length) {
        img.style.transform = parts.join(" ");
        img.style.transformOrigin = "center";
      }
      previewEl = img;
    }
    const label = document.createElement("span");
    label.textContent = ch.name;
    card.append(previewEl, label);
    card.addEventListener("click", () => selectCharacter(ch.id, card));
    return card;
  }));
  if (err) err.hidden = true;
}

async function selectCharacter(charId, cardEl) {
  const err = document.querySelector("#character-error");
  if (err) err.hidden = true;
  const prevSelected = document.querySelector(".character-card.is-selected");
  if (cardEl) {
    document.querySelectorAll(".character-card").forEach((c) => c.classList.remove("is-selected"));
    cardEl.classList.add("is-selected");
  }
  try {
    const data = await callApi("set-character", { method: "POST", body: JSON.stringify({ character: charId }) });
    account = data.account;
    csrfToken = data.csrfToken || csrfToken;
    const accName = document.querySelector("#account-name");
    if (accName) accName.textContent = account.fullName || account.login;
    showToast(data.message || "Wybrano postać.");
    // odśwież wyścig jeśli jest widoczny
    if (hasStudentsForPebble()) {
      await loadStudents();
    }
  } catch (e) {
    if (prevSelected) {
      document.querySelectorAll(".character-card").forEach((c) => c.classList.remove("is-selected"));
      prevSelected.classList.add("is-selected");
    } else if (cardEl) {
      cardEl.classList.remove("is-selected");
    }
    if (err) { err.textContent = e.message; err.hidden = false; }
    showToast(e.message);
  }
}

$("#generate-invite")?.addEventListener("click", async () => {
  try {
    const data = await callApi("generate-invite", { method: "POST", body: JSON.stringify({}) });
    await loadInvites();
    showToast("Wygenerowano kod jednorazowy: " + data.code);
  } catch (error) { showToast(error.message); }
});

/* ---------- QR for invite code (wielorazowy, usuwany przy zamknięciu) ---------- */
const qrOverlay = $("#qr-overlay");
const qrImage = $("#qr-image");
const qrCodeText = $("#qr-code-text");
const qrCanvas = $("#qr-canvas");
let activeQrCode = null;
let qrGenerating = false;

function openQrPopup(code) {
  if (!qrOverlay || !qrCodeText || !qrImage) return;
  activeQrCode = code;
  qrCodeText.textContent = code;
  const url = `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
  const encoded = encodeURIComponent(url);
  qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`;
  qrImage.alt = `Kod QR ${code}`;
  qrImage.hidden = false;
  if (qrCanvas) qrCanvas.hidden = true;
  qrOverlay.hidden = false;
  qrImage.onerror = () => {
    qrImage.hidden = true;
    showToast("Nie udało się załadować QR — skopiuj kod ręcznie.");
  };
}
async function closeQrPopup() {
  if (!qrOverlay || qrOverlay.hidden) return;
  const codeToDelete = activeQrCode || qrCodeText?.textContent?.trim() || "";
  qrOverlay.hidden = true;
  activeQrCode = null;
  if (codeToDelete) {
    try {
      await callApi("delete-qr-invite", { method: "POST", body: JSON.stringify({ code: codeToDelete }) });
    } catch (e) {
      // ignoruj błąd usuwania, kod mógł już być usunięty
    }
  }
}

$("#show-qr-btn")?.addEventListener("click", async () => {
  if (qrGenerating) return;
  if (qrOverlay && !qrOverlay.hidden) {
    await closeQrPopup();
  }
  qrGenerating = true;
  const btn = $("#show-qr-btn");
  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Generowanie..."; }
  try {
    const data = await callApi("generate-qr-invite", { method: "POST", body: JSON.stringify({}) });
    openQrPopup(data.code);
  } catch (e) {
    showToast(e.message);
  } finally {
    qrGenerating = false;
    if (btn) { btn.disabled = false; btn.textContent = "Pokaż kod QR"; }
  }
});
$("#qr-close")?.addEventListener("click", closeQrPopup);
$("#qr-close-bottom")?.addEventListener("click", closeQrPopup);
qrOverlay?.querySelector("[data-qr-backdrop]")?.addEventListener("click", closeQrPopup);
$("#qr-copy-code")?.addEventListener("click", () => {
  const code = qrCodeText?.textContent?.trim();
  if (!code) return;
  copyText(code).then(() => showToast("Skopiowano " + code), () => showToast("Nie udało się skopiować."));
});

let currentClassId = null;

async function loadClasses() {
  if (!account || account.role !== "teacher") return;
  try {
    const data = await callApi("list-classes", { method: "GET" });
    const classes = data.classes || [];
    const sel = $("#class-switcher");
    const label = $("#teacher-class-name");
    const wrap = $("#class-switcher-wrap");
    const trigger = $("#class-switcher-trigger");
    const trigLabel = $("#class-switcher-label");
    const opts = $("#class-switcher-options");
    if (classes.length <= 1) {
      if (label) { label.hidden = false; label.textContent = teacherClass ? teacherClass.name : ""; }
      if (sel) sel.hidden = true;
      if (wrap) wrap.hidden = true;
      currentClassId = teacherClass ? teacherClass.id : null;
      return;
    }
    if (label) label.hidden = true;
    if (sel) sel.hidden = true;
    if (wrap) wrap.hidden = false;
    // hidden select for form compat
    if (sel) {
      sel.replaceChildren(...classes.map((c) => {
        const o = document.createElement("option");
        o.value = c.id;
        o.textContent = c.name;
        if (teacherClass && c.id === teacherClass.id) o.selected = true;
        return o;
      }));
    }
    if (!currentClassId && teacherClass) currentClassId = teacherClass.id;
    else if (currentClassId) {
      // keep
    } else currentClassId = classes[0].id;
    const current = classes.find((c) => c.id === currentClassId) || classes[0];
    if (trigLabel) trigLabel.textContent = current.name;
    if (opts) {
      const rebuild = () => {
        opts.replaceChildren(...classes.map((c) => {
          const li = document.createElement("li");
          li.textContent = c.name;
          li.dataset.value = c.id;
          li.setAttribute("role", "option");
          if (c.id === currentClassId) li.classList.add("is-selected");
          li.addEventListener("click", async () => {
            currentClassId = c.id;
            if (teacherClass) teacherClass.name = c.name;
            trigLabel.textContent = c.name;
            opts.querySelectorAll("li").forEach((el) => el.classList.toggle("is-selected", parseInt(el.dataset.value,10)===c.id));
            opts.hidden = true;
            trigger.setAttribute("aria-expanded", "false");
            if (sel) sel.value = c.id;
            await loadStudents();
            await loadInvites();
            await loadNameRequests().catch(()=>{});
            initPebbleAvailability();
          });
          return li;
        }));
      };
      rebuild();
    }
  } catch (e) {}
}

$("#class-switcher-trigger")?.addEventListener("click", () => {
  const opts = $("#class-switcher-options");
  const trg = $("#class-switcher-trigger");
  if (!opts || !trg) return;
  const willOpen = opts.hidden;
  if (willOpen) {
    opts.querySelectorAll("li").forEach((el) => el.classList.toggle("is-selected", parseInt(el.dataset.value,10)===currentClassId));
  }
  opts.hidden = !willOpen;
  trg.setAttribute("aria-expanded", willOpen ? "true" : "false");
});
document.addEventListener("click", (e) => {
  const classWrap = $("#class-switcher-wrap");
  if (classWrap && !classWrap.hidden && !classWrap.contains(e.target)) {
    $("#class-switcher-options").hidden = true;
    $("#class-switcher-trigger")?.setAttribute("aria-expanded", "false");
  }
  if (regRoleWrap && regRoleOptions && !regRoleOptions.hidden && !regRoleWrap.contains(e.target)) {
    regRoleOptions.hidden = true;
    regRoleTrigger?.setAttribute("aria-expanded", "false");
  }
});

function openNewClassPopup() {
  $("#new-class-overlay").hidden = false;
  $("#new-class-name").value = "";
  $("#new-class-error").hidden = true;
  $("#new-class-name").focus();
}
function closeNewClassPopup() {
  $("#new-class-overlay").hidden = true;
}
$("#new-class-btn")?.addEventListener("click", openNewClassPopup);
$("#new-class-cancel")?.addEventListener("click", closeNewClassPopup);
$("#new-class-overlay")?.querySelector("[data-new-class-backdrop]")?.addEventListener("click", closeNewClassPopup);
$("#class-switcher")?.addEventListener("change", async (e) => {
  currentClassId = parseInt(e.target.value, 10);
  const sel = e.target.options[e.target.selectedIndex];
  if (teacherClass) teacherClass.name = sel.textContent;
  await loadStudents();
  await loadInvites();
  await loadNameRequests().catch(()=>{});
  initPebbleAvailability();
});
$("#new-class-submit")?.addEventListener("click", async () => {
  const name = $("#new-class-name").value.trim();
  const err = $("#new-class-error");
  if (!name) { err.textContent = "Podaj nazwę klasy."; err.hidden = false; return; }
  try {
    const data = await callApi("create-class", { method: "POST", body: JSON.stringify({ name }) });
    closeNewClassPopup();
    showToast("Utworzono klasę " + data.class.name);
    location.reload();
  } catch (e) { err.textContent = e.message; err.hidden = false; }
});

$("#delete-class-btn")?.addEventListener("click", async () => {
  if (!account || account.role !== "teacher") return;
  const currentId = currentClassId || teacherClass?.id;
  const className = teacherClass ? teacherClass.name : (document.querySelector("#teacher-class-name")?.textContent?.trim() || "tę klasę");
  if (!currentId) {
    showToast("Brak klasy do usunięcia.");
    return;
  }
  if (!window.confirm(`Czy usunąć klasę "${className}"?`)) return;
  if (!window.confirm(`Czy na pewno? Tej operacji nie można cofnąć. Zostaną usunięci uczniowie, kody i oceny z klasy "${className}".`)) return;
  const btn = document.querySelector("#delete-class-btn");
  if (btn) btn.disabled = true;
  try {
    const data = await callApi("delete-class", { method: "POST", body: JSON.stringify({ classId: currentId }) });
    showToast(data.message || "Usunięto klasę.");
    location.reload();
  } catch (e) {
    showToast(e.message);
    if (btn) btn.disabled = false;
  }
});

const _origCallApi = callApi;
callApi = async function(action, opts={}) {
  if (account && account.role === "teacher" && currentClassId) {
    if (["students","list-invites","generate-invite","generate-qr-invite","delete-invite","delete-qr-invite","add-grade","remove-student","pending-grades","list-name-requests","decide-name-request","delete-class"].includes(action)) {
      opts.query = { ...(opts.query||{}), classId: currentClassId };
      if (["generate-invite","generate-qr-invite","delete-invite","delete-qr-invite","add-grade","remove-student","decide-name-request","delete-class"].includes(action)) {
        try { const b = JSON.parse(opts.body||"{}"); b.classId = currentClassId; opts.body = JSON.stringify(b); } catch {}
      }
    }
  }
  return _origCallApi(action, opts);
};

function handleInviteCodeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("code") || params.get("joinKey") || params.get("join_key") || params.get("invite") || params.get("kod");
    if (!raw) return false;
    const clean = raw.trim().toUpperCase();
    if (!clean || !/^[A-Z0-9]{4,24}$/.test(clean)) return false;
    document.querySelectorAll("[data-auth-tab]").forEach((t) => t.classList.toggle("is-active", t.dataset.authTab === "register"));
    if (loginForm) loginForm.hidden = true;
    if (registerForm) registerForm.hidden = false;
    if (regRole) {
      regRole.value = "student";
      syncRoleFields();
    }
    const joinInput = document.querySelector("#reg-join-key");
    if (joinInput) joinInput.value = clean;
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- Init ---------- */

async function init() {
  syncRoleFields();
  try {
    const data = await callApi("me", { method: "GET" });
    account = data.account;
    csrfToken = data.csrfToken;
    teacherClass = data.class || null;
    currentClassId = teacherClass ? teacherClass.id : null;
    applyContent();
    syncUI();
    if (!account) {
      openMenu();
      handleInviteCodeFromUrl();
      initPebbleAvailability();
      return;
    }
    if (account.role === "teacher") {
      renderTeacherClass();
      await loadStudents();
      await loadNameRequests().catch(()=>{});
      await loadCharacters().catch(()=>{});
    } else {
      await renderStudentPoints().catch(() => {});
      await loadMyNameRequest().catch(()=>{});
      await loadCharacters().catch(()=>{});
      initPebbleAvailability();
    }
  } catch (error) {
    applyContent();
    initPebbleAvailability();
    openMenu();
    handleInviteCodeFromUrl();
  }
}

init();

setInterval(() => {
  if (!account) return;
  if (account.role === "teacher" && !document.querySelector("#teacher-name-requests-section")?.hidden) {
    loadNameRequests().catch(()=>{});
  } else if (account.role === "student" && !document.querySelector("#student-section")?.hidden) {
    loadMyNameRequest().catch(()=>{});
  }
}, 12000);
