// ============================================================
// Weekly Grid — grid.js
// Reads the same class data saved by the Board page (index.html)
// and lays it out as a Mon–Sun timetable. Also manages an
// entirely optional "exams & things to do" list.
// ============================================================

const CLASSES_KEY = "classBoard.classes.v1";
const TZ_KEY = "classBoard.tz.v1";
const TASKS_KEY = "classBoard.tasks.v1";

const DAY_LABELS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Columns rendered left to right, Monday first, Sunday last.
const COLUMN_DAYS = [1, 2, 3, 4, 5, 6, 0];

const TYPE_LABELS = {
  exam: "Exam",
  requirement: "Requirement",
  activity: "Activity",
  other: "Other",
};

const COLOR_HEX = {
  amber: "#e8a33d",
  sage: "#6fa287",
  sky: "#5f9bd1",
  rose: "#d1738f",
};

let tz = localStorage.getItem(TZ_KEY) || "local";

// ---------- DOM refs ----------
const clockEl = document.getElementById("clock");
const clockDateEl = document.getElementById("clockDate");
const clockZoneEl = document.getElementById("clockZone");
const gridHead = document.getElementById("gridHead");
const gridBody = document.getElementById("gridBody");
const gridEmptyNote = document.getElementById("gridEmptyNote");

const taskToggle = document.getElementById("taskToggle");
const taskForm = document.getElementById("taskForm");
const cancelTaskFormBtn = document.getElementById("cancelTaskForm");
const taskFormError = document.getElementById("taskFormError");
const taskList = document.getElementById("taskList");
const taskEmpty = document.getElementById("taskEmpty");
const taskTemplate = document.getElementById("taskTemplate");

// ============================================================
// Storage helpers
// ============================================================
function loadClasses() {
  try {
    const raw = localStorage.getItem(CLASSES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Could not read saved classes:", e);
    return [];
  }
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Could not read saved tasks:", e);
    return [];
  }
}

function saveTasks(tasks) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// ============================================================
// Time helpers (tz-aware, mirrors script.js on the Board page)
// ============================================================
function getZoneName(tzChoice) {
  if (tzChoice === "ph") return "Asia/Manila";
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function pad(n) {
  return String(n).padStart(2, "0");
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
  for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;

  // Also get an ISO-sortable y-m-d for comparing with <input type="date">.
  const isoFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const isoDate = isoFmt.format(new Date());

  const weekdayIndex = DAY_LABELS_SHORT.indexOf(parts.weekday);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);

  return {
    zone,
    weekday: weekdayIndex,
    minutesSinceMidnight: hour * 60 + minute,
    isoDate,
    dateLabel: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
    timeLabel: `${pad(hour)}:${pad(parseInt(parts.minute, 10))}:${pad(parseInt(parts.second, 10))}`,
  };
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
// Build the time-slot range that the grid covers
// ============================================================
function computeSlotRange(classes) {
  const DEFAULT_START = 7 * 60; // 7:00 AM
  const DEFAULT_END = 19 * 60; // 7:00 PM

  if (classes.length === 0) {
    return { start: DEFAULT_START, end: DEFAULT_END };
  }

  let earliest = Math.min(...classes.map((c) => timeStrToMinutes(c.start)));
  let latest = Math.max(...classes.map((c) => timeStrToMinutes(c.end)));

  // Round out to the nearest hour, with a little breathing room, but
  // never narrower than the default 7am–7pm window.
  earliest = Math.floor(earliest / 60) * 60;
  latest = Math.ceil(latest / 60) * 60;

  return {
    start: Math.min(earliest, DEFAULT_START),
    end: Math.max(latest, DEFAULT_END),
  };
}

function buildSlots(range) {
  const slots = [];
  for (let m = range.start; m < range.end; m += 30) {
    slots.push(m);
  }
  return slots;
}

// ============================================================
// Render table head
// ============================================================
function renderHead(now) {
  gridHead.innerHTML = "";

  const dayRow = document.createElement("tr");
  const timeHeadTop = document.createElement("th");
  timeHeadTop.className = "time-head";
  timeHeadTop.rowSpan = 2;
  timeHeadTop.textContent = "Time";
  dayRow.appendChild(timeHeadTop);

  const subRow = document.createElement("tr");

  COLUMN_DAYS.forEach((dayIndex) => {
    const th = document.createElement("th");
    th.className = "day-head";
    th.colSpan = 2;
    th.textContent = DAY_LABELS_SHORT[dayIndex];
    if (dayIndex === now.weekday) th.classList.add("is-today");
    dayRow.appendChild(th);

    const subjTh = document.createElement("th");
    subjTh.className = "sub-head";
    subjTh.textContent = "Subj";
    const roomTh = document.createElement("th");
    roomTh.className = "sub-head";
    roomTh.textContent = "Room";
    subRow.appendChild(subjTh);
    subRow.appendChild(roomTh);
  });

  gridHead.appendChild(dayRow);
  gridHead.appendChild(subRow);
}

// ============================================================
// Render table body
// ============================================================
function renderBody(classes, now) {
  gridBody.innerHTML = "";
  const range = computeSlotRange(classes);
  const slots = buildSlots(range);

  // Pre-index: for quick lookup of which class occupies (day, slot).
  // occupancy[dayIndex][slotStart] = { cls, isFirstSlot }
  const occupancy = {};
  COLUMN_DAYS.forEach((d) => (occupancy[d] = {}));

  for (const cls of classes) {
    const start = timeStrToMinutes(cls.start);
    const end = timeStrToMinutes(cls.end);
    for (const day of cls.days) {
      if (!(day in occupancy)) continue;
      for (const slot of slots) {
        if (slot >= start && slot < end) {
          occupancy[day][slot] = { cls, isFirstSlot: slot === Math.floor(start / 30) * 30 };
        }
      }
    }
  }

  slots.forEach((slotStart) => {
    const slotEnd = slotStart + 30;
    const tr = document.createElement("tr");
    if (now.minutesSinceMidnight >= slotStart && now.minutesSinceMidnight < slotEnd) {
      tr.classList.add("is-now-row");
    }

    const timeTd = document.createElement("td");
    timeTd.className = "time-cell";
    timeTd.textContent = `${minutesToLabel(slotStart)}–${minutesToLabel(slotEnd)}`;
    tr.appendChild(timeTd);

    COLUMN_DAYS.forEach((dayIndex) => {
      const entry = occupancy[dayIndex][slotStart];
      const subjTd = document.createElement("td");
      const roomTd = document.createElement("td");
      subjTd.className = "slot-cell";
      roomTd.className = "slot-cell";

      if (dayIndex === now.weekday) {
        subjTd.classList.add("is-today-col");
        roomTd.classList.add("is-today-col");
      }

      if (entry) {
        const { cls, isFirstSlot } = entry;
        subjTd.classList.add("has-class");
        roomTd.classList.add("has-class");
        if (!isFirstSlot) {
          subjTd.classList.add("is-ditto");
          roomTd.classList.add("is-ditto");
          subjTd.textContent = "-do-";
          roomTd.textContent = "-do-";
        } else {
          subjTd.textContent = cls.subject;
          roomTd.textContent = cls.room || "—";
        }

        const isLive =
          dayIndex === now.weekday &&
          now.minutesSinceMidnight >= timeStrToMinutes(cls.start) &&
          now.minutesSinceMidnight < timeStrToMinutes(cls.end);

        if (isLive) {
          subjTd.classList.add("is-live");
          roomTd.classList.add("is-live");
          subjTd.style.setProperty("--tag-color", COLOR_HEX[cls.color] || COLOR_HEX.amber);
          roomTd.style.setProperty("--tag-color", COLOR_HEX[cls.color] || COLOR_HEX.amber);
        }
      }

      tr.appendChild(subjTd);
      tr.appendChild(roomTd);
    });

    gridBody.appendChild(tr);
  });
}

// ============================================================
// Main tick
// ============================================================
function tick() {
  const now = getNowParts(tz);
  clockEl.textContent = now.timeLabel;
  clockDateEl.textContent = now.dateLabel;
  clockZoneEl.textContent = tz === "ph" ? "Asia/Manila (UTC+8)" : `${now.zone} (local)`;

  const classes = loadClasses();
  gridEmptyNote.hidden = classes.length !== 0;

  renderHead(now);
  renderBody(classes, now);
  renderTasks(now);
}

setInterval(tick, 1000);
tick();

// Keep the grid in sync if the tz is changed on the Board page in
// another tab, or classes are added there while this tab is open.
window.addEventListener("storage", (e) => {
  if (e.key === TZ_KEY) tz = localStorage.getItem(TZ_KEY) || "local";
  if (e.key === CLASSES_KEY || e.key === TZ_KEY || e.key === TASKS_KEY) tick();
});

// ============================================================
// Optional: exams & things to do
// ============================================================
taskToggle.addEventListener("click", () => {
  const isOpen = !taskForm.hidden;
  taskForm.hidden = isOpen;
  taskToggle.setAttribute("aria-expanded", String(!isOpen));
});

cancelTaskFormBtn.addEventListener("click", () => {
  resetTaskForm();
  taskForm.hidden = true;
  taskToggle.setAttribute("aria-expanded", "false");
});

taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  taskFormError.hidden = true;

  const title = document.getElementById("taskTitle").value.trim();
  const type = document.getElementById("taskType").value;
  const date = document.getElementById("taskDate").value;
  const time = document.getElementById("taskTime").value; // optional
  const notes = document.getElementById("taskNotes").value.trim(); // optional

  if (!title) return showTaskError("Give it a title.");
  if (!date) return showTaskError("Pick a date.");

  const tasks = loadTasks();
  tasks.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    title,
    type,
    date,
    time,
    notes,
    done: false,
  });
  saveTasks(tasks);
  resetTaskForm();
  taskForm.hidden = true;
  taskToggle.setAttribute("aria-expanded", "false");
  tick();
});

function showTaskError(msg) {
  taskFormError.textContent = msg;
  taskFormError.hidden = false;
}

function resetTaskForm() {
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskType").value = "other";
  document.getElementById("taskDate").value = "";
  document.getElementById("taskTime").value = "";
  document.getElementById("taskNotes").value = "";
  taskFormError.hidden = true;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00");
  const b = new Date(isoB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function renderTasks(now) {
  const tasks = loadTasks();
  taskList.innerHTML = "";
  taskEmpty.hidden = tasks.length !== 0;

  const sorted = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const dateDiff = a.date.localeCompare(b.date);
    if (dateDiff !== 0) return dateDiff;
    return (a.time || "99:99").localeCompare(b.time || "99:99");
  });

  for (const task of sorted) {
    const node = taskTemplate.content.cloneNode(true);
    const row = node.querySelector(".task-row");
    const checkbox = node.querySelector(".task-done-box");
    const tagEl = node.querySelector(".task-tag");
    const titleEl = node.querySelector(".task-title");
    const dateEl = node.querySelector(".task-date");
    const notesEl = node.querySelector(".task-notes");
    const deleteBtn = node.querySelector(".task-delete");

    checkbox.checked = task.done;
    tagEl.textContent = TYPE_LABELS[task.type] || "Other";
    titleEl.textContent = task.title;

    const diff = daysBetween(now.isoDate, task.date);
    let dateText = formatTaskDate(task.date, task.time);
    if (diff === 0) dateText += " · Today";
    else if (diff === 1) dateText += " · Tomorrow";
    else if (diff > 1) dateText += ` · in ${diff}d`;
    else dateText += " · past";
    dateEl.textContent = dateText;
    notesEl.textContent = task.notes || "";

    if (task.done) {
      row.classList.add("is-done");
    } else if (diff === 0) {
      row.classList.add("is-today");
    } else if (diff > 0 && diff <= 3) {
      row.classList.add("is-soon");
    }

    checkbox.addEventListener("change", () => {
      const all = loadTasks();
      const t = all.find((x) => x.id === task.id);
      if (t) {
        t.done = checkbox.checked;
        saveTasks(all);
        tick();
      }
    });

    deleteBtn.addEventListener("click", () => {
      const all = loadTasks().filter((x) => x.id !== task.id);
      saveTasks(all);
      tick();
    });

    taskList.appendChild(node);
  }
}

function formatTaskDate(isoDate, time) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const label = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (!time) return label;
  const [h, min] = time.split(":").map(Number);
  return `${label}, ${minutesToLabel(h * 60 + min)}`;
}