const API_URL = "api/auth.php";

const $ = (selector) => document.querySelector(selector);

const authSection = $("#auth-section");
const accountSection = $("#account-section");
const teacherInviteSection = $("#teacher-invite-section");
const teacherStudentsSection = $("#teacher-students-section");
const studentSection = $("#student-section");
const loginForm = $("#login-form");
const registerForm = $("#register-form");
const regRole = $("#reg-role");
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

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("is-visible"), 3000);
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

function resetPebbleView() {
  stopPebbleRace();
  pebbleFinishOrder = 0;
  pebbleRaceState = [];
  activeStudent = null;
  if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
  const wa = $("#winner-actions");
  if (wa) wa.hidden = true;
  if (pebbleTurtles) pebbleTurtles.replaceChildren();
  if (lessonRandom) lessonRandom.disabled = !hasStudentsForPebble();
}

function renderPebbleTurtles() {
  if (!pebbleTurtles || !pebbleTrack) return;
  if (pebbleRaceState.length === 0) { pebbleTurtles.replaceChildren(); return; }
  const count = pebbleRaceState.length;
  const trackH = pebbleTrack.clientHeight || 400;
  const trackW = pebbleTrack.clientWidth || 1000;
  const turtleH = 26;
  const desiredGap = 50;
  let gap = desiredGap;
  if (count > 1) {
    const needed = count * turtleH + (count - 1) * desiredGap;
    if (needed > trackH) gap = Math.max(4, (trackH - count * turtleH) / (count - 1));
  } else gap = 0;
  const totalH = count * turtleH + Math.max(0, count - 1) * gap;
  const startY = (trackH - totalH) / 2;
  const labels = pebbleRaceState.map((racer, index) => {
    const baseTop = startY + index * (turtleH + gap) + turtleH / 2;
    const label = document.createElement("span");
    label.className = "turtle-pebble-label turtle-label-static";
    label.textContent = racer.student.fullName;
    label.style.top = `${baseTop - 10}px`;
    return label;
  });
  const turtles = pebbleRaceState.map((racer, index) => {
    const baseTop = startY + index * (turtleH + gap) + turtleH / 2;
    const wave = Math.sin((racer.position / 100) * Math.PI * 3 + index * 0.7) * 6;
    const wrap = document.createElement("div");
    wrap.className = `turtle-pebble${racer.finished ? " is-finished" : ""}`;
    wrap.style.setProperty("--turtle-color", racer.color);
    const startPct = 5.64;
    const endPct = 91.54;
    const xPct = startPct + Math.max(0, Math.min(100, racer.position)) / 100 * (endPct - startPct);
    wrap.style.left = `${xPct}%`;
    wrap.style.transform = "translateX(-50%)";
    wrap.style.top = `${baseTop + wave - 13}px`;
    const icon = document.createElement("span");
    icon.className = "turtle-icon";
    icon.style.setProperty("--turtle-color", racer.color);
    icon.setAttribute("aria-label", racer.student.fullName);
    wrap.append(icon);
    return wrap;
  });
  pebbleTurtles.replaceChildren(...labels, ...turtles);
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
  pebbleFinishOrder = 0;
  resetLights();
  pebbleRaceState = students.map((student, index) => ({
    student,
    color: raceColors[index % raceColors.length],
    position: 0,
    speed: 6 + Math.random() * 7,
    finished: false,
    finishedOrder: null,
  }));
  renderPebbleTurtles();
  if (pebbleWinner) pebbleWinner.hidden = true;
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
  renderPebbleTurtles();
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
    showToast("Konto utworzone.");
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
  } else {
    renderStudentPoints().catch((error) => showToast(error.message));
  }
  openMenu();
}

function syncUI() {
  if (!account) return;
  if (account.role === "teacher") {
    teacherInviteSection.hidden = false;
    teacherStudentsSection.hidden = false;
    $("#teacher-class-name").textContent = teacherClass ? teacherClass.name : "";
    loadClasses().then(() => loadInvites().catch(()=>{})).catch(()=>{});
  } else {
    studentSection.hidden = false;
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
  if (event.key === "Escape" && !menuOverlay.hidden) closeMenu();
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

loginForm.addEventListener("submit", handleLogin);
registerForm.addEventListener("submit", handleRegister);
$("#logout-button").addEventListener("click", handleLogout);

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
      copy.textContent = "Kopiuj";
      copy.title = "Kopiuj kod";
      copy.style.color = "var(--purple)";
      copy.style.borderColor = "color-mix(in srgb, var(--purple) 42%, var(--line))";
      copy.style.background = "color-mix(in srgb, var(--purple) 7%, var(--surface))";
      copy.addEventListener("click", () => {
        navigator.clipboard.writeText(row.code).then(
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

$("#generate-invite")?.addEventListener("click", async () => {
  try {
    const data = await callApi("generate-invite", { method: "POST", body: JSON.stringify({}) });
    await loadInvites();
    showToast("Wygenerowano kod jednorazowy: " + data.code);
  } catch (error) { showToast(error.message); }
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
  const wrap = $("#class-switcher-wrap");
  if (!wrap || wrap.hidden) return;
  if (!wrap.contains(e.target)) {
    $("#class-switcher-options").hidden = true;
    $("#class-switcher-trigger")?.setAttribute("aria-expanded", "false");
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

const _origCallApi = callApi;
callApi = async function(action, opts={}) {
  if (account && account.role === "teacher" && currentClassId) {
    if (["students","list-invites","generate-invite","delete-invite","add-grade","remove-student","pending-grades"].includes(action)) {
      opts.query = { ...(opts.query||{}), classId: currentClassId };
      if (["generate-invite","delete-invite","add-grade","remove-student"].includes(action)) {
        try { const b = JSON.parse(opts.body||"{}"); b.classId = currentClassId; opts.body = JSON.stringify(b); } catch {}
      }
    }
  }
  return _origCallApi(action, opts);
};

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
    if (account.role === "teacher") {
      renderTeacherClass();
      await loadStudents();
    } else {
      await renderStudentPoints().catch(() => {});
      initPebbleAvailability();
    }
  } catch (error) {
    applyContent();
    initPebbleAvailability();
  }
}

init();
