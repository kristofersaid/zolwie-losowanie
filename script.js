const API_URL = "api/auth.php";

const $ = (selector) => document.querySelector(selector);

const authSection = $("#auth-section");
const accountSection = $("#account-section");
const teacherClassSection = $("#teacher-class-section");
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
  teacherClassSection.hidden = !(loggedIn && account.role === "teacher");
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
    const remove = document.createElement("button");
    remove.className = "student-remove";
    remove.type = "button";
    remove.textContent = "Usuń";
    remove.dataset.studentRemove = student.id;
    remove.title = "Usuń ucznia";
    remove.setAttribute("aria-label", `Usuń ucznia ${student.fullName}`);
    remove.addEventListener("click", () => removeStudent(student));
    li.append(name, stats, remove);
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
    if (pebbleTurtles) pebbleTurtles.replaceChildren();
  } else if (!pebbleRacing && pebbleRaceState.length === 0) {
    // pokaż żółwie na starcie przed wyścigiem
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
  }
}

function resetPebbleView() {
  stopPebbleRace();
  pebbleFinishOrder = 0;
  pebbleRaceState = [];
  activeStudent = null;
  if (pebbleWinner) { pebbleWinner.hidden = true; pebbleWinner.textContent = ""; }
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
    const turtleW = 38;
    const startLeft = 100;
    const endLeft = Math.max(startLeft, trackW - 150 - turtleW);
    const x = startLeft + Math.max(0, Math.min(100, racer.position)) / 100 * (endLeft - startLeft);
    wrap.style.left = `${x}px`;
    wrap.style.transform = "none";
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
    speed: 10 + Math.random() * 6,
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
  let allFinished = true;
  pebbleRaceState.forEach((racer) => {
    if (racer.finished) return;
    const jitter = 0.85 + Math.random() * 0.3;
    racer.position += racer.speed * dt * jitter;
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
      span.textContent = point.type === "plus" ? "+" : "−";
      span.title = point.createdAt;
      return span;
    }));
    row.append(name, dots);
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
  if (document.querySelector(`[data-lesson-mark="${type}"]`)?.disabled) return;
  document.querySelectorAll("[data-lesson-mark]").forEach((button) => { button.disabled = true; });
  try {
    await callApi("add-grade", { method: "POST", body: JSON.stringify({ studentId: activeStudent.id, type }) });
    showToast(type === "plus" ? "Dodano plus." : type === "minus" ? "Dodano minus." : "Oznaczono jako nieobecny(a).");
    activeStudent = null;
    await loadStudents();
  } catch (error) {
    showToast(error.message);
    document.querySelectorAll("[data-lesson-mark]").forEach((button) => { button.disabled = false; });
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
    teacherClassSection.hidden = false;
    teacherStudentsSection.hidden = false;
    $("#join-key-display").value = teacherClass ? teacherClass.joinKey : "";
    $("#teacher-class-name").textContent = teacherClass ? teacherClass.name : "";
  } else {
    studentSection.hidden = false;
  }
}

function renderTeacherClass() {
  $("#join-key-display").value = teacherClass ? teacherClass.joinKey : "";
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

$("#copy-key").addEventListener("click", () => {
  const input = $("#join-key-display");
  navigator.clipboard.writeText(input.value).then(
    () => showToast("Skopiowano klucz klasy."),
    () => showToast("Nie udało się skopiować klucza.")
  );
});

$("#regenerate-key").addEventListener("click", async () => {
  if (!window.confirm("Wygenerować nowy klucz klasy? Dotychczasowy przestanie działać.")) return;
  try {
    const data = await callApi("regenerate-key", { method: "POST", body: JSON.stringify({}) });
    teacherClass = data.class;
    renderTeacherClass();
    showToast("Wygenerowano nowy klucz.");
  } catch (error) {
    showToast(error.message);
  }
});

/* ---------- Init ---------- */

async function init() {
  syncRoleFields();
  try {
    const data = await callApi("me", { method: "GET" });
    account = data.account;
    csrfToken = data.csrfToken;
    teacherClass = data.class || null;
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
