// ============================================================
// Class Schedule Board — script.js
// Persists to localStorage. Recomputes "live / upcoming / done"
// status every second against the chosen time zone.
// ============================================================

const STORAGE_KEY = "classBoard.classes.v1";
const TZ_KEY = "classBoard.tz.v1";
const VIEW_KEY = "classBoard.view.v1";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Order for "whole week" sorting, starting Monday, Sunday last.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const state = {
  classes: loadClasses(),
  tz: localStorage.getItem(TZ_KEY) || "local",
  view: localStorage.getItem(VIEW_KEY) || "today",
  selectedDays: new Set(),
  selectedColor: "amber",
};

// ---------- DOM refs ----------
const clockEl = document.getElementById("clock");
const clockDateEl = document.getElementById("clockDate");
const clockZoneEl = document.getElementById("clockZone");
const nowStrip = document.getElementById("nowStrip");
const nowValue = document.getElementById("nowValue");

const formToggle = document.getElementById("formToggle");
const addForm = document.getElementById("addForm");
const cancelFormBtn = document.getElementById("cancelForm");
const formError = document.getElementById("formError");
const dayPicker = document.getElementById("dayPicker");
const colorPicker = document.getElementById("colorPicker");

const scheduleList = document.getElementById("scheduleList");
const emptyState = document.getElementById("emptyState");
const countBadge = document.getElementById("countBadge");
const rowTemplate = document.getElementById("rowTemplate");

const COLOR_HEX = {
  amber: "#e8a33d",
  sage: "#6fa287",
  sky: "#5f9bd1",
  rose: "#d1738f",
};

// ============================================================
// Storage helpers
// ============================================================
function loadClasses() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Could not read saved classes:", e);
    return [];
  }
}

function saveClasses() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.classes));
}

// ============================================================
// Time zone aware "now"
// ============================================================
function getZoneName(tzChoice) {
  if (tzChoice === "ph") return "Asia/Manila";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getNowParts(tzChoice) {
  const zone = getZoneName(tzChoice);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date())) {
    parts[p.type] = p.value;
  }
  const weekdayIndex = DAY_LABELS.indexOf(parts.weekday);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const second = parseInt(parts.second, 10);
  return {
    zone,
    weekday: weekdayIndex,
    hour,
    minute,
    second,
    minutesSinceMidnight: hour * 60 + minute,
    dateLabel: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
    timeLabel: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
  };
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timeStrToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function minutesToLabel(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad(m)} ${period}`;
}

// ============================================================
// Clock + now-strip tick
// ============================================================
function tickClock() {
  const now = getNowParts(state.tz);
  clockEl.textContent = now.timeLabel;
  clockDateEl.textContent = now.dateLabel;
  clockZoneEl.textContent = state.tz === "ph" ? "Asia/Manila (UTC+8)" : `${now.zone} (local)`;
  return now;
}

function updateNowStrip(now, liveClasses) {
  if (liveClasses.length === 0) {
    nowStrip.classList.remove("is-live");
    nowValue.textContent = "Nothing scheduled";
  } else {
    nowStrip.classList.add("is-live");
    const first = liveClasses[0];
    const extra = liveClasses.length - 1;
    nowValue.textContent =
      extra > 0
        ? `${first.subject} (+${extra} more)`
        : `${first.subject}${first.room ? " — " + first.room : ""}`;
  }
}

// ============================================================
// Status computation for a single class
// ============================================================
function computeStatus(cls, now) {
  const isToday = cls.days.includes(now.weekday);
  const start = timeStrToMinutes(cls.start);
  const end = timeStrToMinutes(cls.end);

  if (!isToday) {
    return { state: "other-day", isToday: false };
  }
  if (now.minutesSinceMidnight >= start && now.minutesSinceMidnight < end) {
    return { state: "live", isToday: true, minutesLeft: end - now.minutesSinceMidnight };
  }
  if (now.minutesSinceMidnight < start) {
    return { state: "upcoming", isToday: true, minutesUntil: start - now.minutesSinceMidnight };
  }
  return { state: "done", isToday: true };
}

function formatCountdown(mins) {
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

// ============================================================
// Rendering
// ============================================================
function sortForView(classes, view, now) {
  const copy = [...classes];
  if (view === "today") {
    return copy
      .filter((c) => c.days.includes(now.weekday))
      .sort((a, b) => timeStrToMinutes(a.start) - timeStrToMinutes(b.start));
  }
  // Whole week: sort by earliest day (Mon-first order), then start time.
  const earliestOrder = (c) =>
    Math.min(...c.days.map((d) => WEEK_ORDER.indexOf(d)), WEEK_ORDER.length);
  return copy.sort((a, b) => {
    const dayDiff = earliestOrder(a) - earliestOrder(b);
    if (dayDiff !== 0) return dayDiff;
    return timeStrToMinutes(a.start) - timeStrToMinutes(b.start);
  });
}

function renderSchedule(now) {
  const list = sortForView(state.classes, state.view, now);
  scheduleList.innerHTML = "";

  countBadge.textContent = `${list.length} class${list.length === 1 ? "" : "es"}`;
  emptyState.hidden = state.classes.length !== 0;
  emptyState.querySelector("p").textContent =
    state.classes.length === 0 ? "No classes on the board yet." : "";

  const liveClasses = [];

  for (const cls of list) {
    const status = computeStatus(cls, now);
    if (status.state === "live") liveClasses.push(cls);

    const node = rowTemplate.content.cloneNode(true);
    const row = node.querySelector(".row");
    const flapText = node.querySelector(".flap-text");
    const subjectEl = node.querySelector(".row-subject");
    const timeEl = node.querySelector(".row-time");
    const daysEl = node.querySelector(".row-days");
    const roomEl = node.querySelector(".row-room");
    const deleteBtn = node.querySelector(".row-delete");

    row.style.setProperty("--tag-color", COLOR_HEX[cls.color] || COLOR_HEX.amber);
    subjectEl.textContent = cls.subject;
    timeEl.textContent = `${minutesToLabel(timeStrToMinutes(cls.start))}–${minutesToLabel(
      timeStrToMinutes(cls.end)
    )}`;
    daysEl.textContent = formatDays(cls.days);
    roomEl.textContent = cls.room || "";
    deleteBtn.addEventListener("click", () => deleteClass(cls.id));

    if (status.state === "live") {
      row.classList.add("is-live");
      flapText.textContent = "NOW";
    } else if (status.state === "upcoming" && status.minutesUntil <= 180) {
      flapText.textContent = formatCountdown(status.minutesUntil).toUpperCase();
    } else if (status.state === "done") {
      row.classList.add("is-done");
      flapText.textContent = "DONE";
    } else {
      flapText.textContent = minutesToLabel(timeStrToMinutes(cls.start));
    }

    scheduleList.appendChild(node);
  }

  updateNowStrip(now, liveClasses);
}

function formatDays(days) {
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b));
  return sorted.map((d) => DAY_LABELS[d]).join(" ");
}

// ============================================================
// Main tick loop
// ============================================================
function tick() {
  const now = tickClock();
  renderSchedule(now);
}

setInterval(tick, 1000);
tick();

// ============================================================
// Time zone switch
// ============================================================
document.querySelectorAll(".tz-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tz-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.tz = btn.dataset.tz;
    localStorage.setItem(TZ_KEY, state.tz);
    tick();
  });
});

// ============================================================
// View switch (today / whole week)
// ============================================================
document.querySelectorAll(".view-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    state.view = btn.dataset.view;
    localStorage.setItem(VIEW_KEY, state.view);
    tick();
  });
});

// ============================================================
// Add-class form: open/close
// ============================================================
formToggle.addEventListener("click", () => {
  const isOpen = !addForm.hidden;
  addForm.hidden = isOpen;
  formToggle.setAttribute("aria-expanded", String(!isOpen));
  formToggle.querySelector("span").textContent = isOpen ? "Add a class" : "Add a class";
});

cancelFormBtn.addEventListener("click", () => {
  resetForm();
  addForm.hidden = true;
  formToggle.setAttribute("aria-expanded", "false");
});

// Day chip multi-select
dayPicker.querySelectorAll(".day-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const day = Number(chip.dataset.day);
    if (state.selectedDays.has(day)) {
      state.selectedDays.delete(day);
      chip.classList.remove("is-active");
    } else {
      state.selectedDays.add(day);
      chip.classList.add("is-active");
    }
  });
});

// Color swatch select
colorPicker.querySelectorAll(".color-swatch").forEach((sw) => {
  sw.addEventListener("click", () => {
    colorPicker.querySelectorAll(".color-swatch").forEach((s) => s.classList.remove("is-active"));
    sw.classList.add("is-active");
    state.selectedColor = sw.dataset.color;
  });
});

// ============================================================
// Add-class form: submit
// ============================================================
document.getElementById("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  formError.hidden = true;

  const subject = document.getElementById("subject").value.trim();
  const room = document.getElementById("room").value.trim();
  const start = document.getElementById("startTime").value;
  const end = document.getElementById("endTime").value;
  const days = [...state.selectedDays];

  if (!subject) return showFormError("Give the class a subject name.");
  if (!start || !end) return showFormError("Set a start and end time.");
  if (timeStrToMinutes(end) <= timeStrToMinutes(start)) {
    return showFormError("End time has to be after the start time.");
  }
  if (days.length === 0) return showFormError("Pick at least one day.");

  state.classes.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    subject,
    room,
    start,
    end,
    days,
    color: state.selectedColor,
  });
  saveClasses();
  resetForm();
  addForm.hidden = true;
  formToggle.setAttribute("aria-expanded", "false");
  tick();
});

function showFormError(msg) {
  formError.textContent = msg;
  formError.hidden = false;
}

function resetForm() {
  document.getElementById("subject").value = "";
  document.getElementById("room").value = "";
  document.getElementById("startTime").value = "";
  document.getElementById("endTime").value = "";
  state.selectedDays.clear();
  dayPicker.querySelectorAll(".day-chip").forEach((c) => c.classList.remove("is-active"));
  state.selectedColor = "amber";
  colorPicker.querySelectorAll(".color-swatch").forEach((s, i) => {
    s.classList.toggle("is-active", i === 0);
  });
  formError.hidden = true;
}

// ============================================================
// Delete a class
// ============================================================
function deleteClass(id) {
  state.classes = state.classes.filter((c) => c.id !== id);
  saveClasses();
  tick();
}

// ============================================================
// Initial UI sync (restore saved tz/view button states)
// ============================================================
(function initControls() {
  document.querySelectorAll(".tz-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tz === state.tz);
  });
  document.querySelectorAll(".view-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.view === state.view);
  });
})();