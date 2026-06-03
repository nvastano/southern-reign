// ─── EVENT DATA ───────────────────────────────────────────────────────────────
// Add / edit events here. date format: "YYYY-MM-DD"
// type: "tournament" | "practice" | "event"
const EVENTS = [
  // Examples — replace with real schedule
  { date: "2026-06-07", title: "Practice", type: "practice", detail: "6:00 PM – 8:00 PM" },
  { date: "2026-06-10", title: "Practice", type: "practice", detail: "6:00 PM – 8:00 PM" },
  { date: "2026-06-14", title: "Summer Kickoff Tournament", type: "tournament", detail: "TBD – Location TBA" },
  { date: "2026-06-15", title: "Summer Kickoff Tournament", type: "tournament", detail: "TBD – Location TBA" },
  { date: "2026-06-17", title: "Practice", type: "practice", detail: "6:00 PM – 8:00 PM" },
  { date: "2026-06-21", title: "Practice", type: "practice", detail: "6:00 PM – 8:00 PM" },
  { date: "2026-06-24", title: "Practice", type: "practice", detail: "6:00 PM – 8:00 PM" },
  { date: "2026-07-04", title: "No Practice – Holiday", type: "event", detail: "Happy 4th of July!" },
  { date: "2026-07-11", title: "Tournament", type: "tournament", detail: "TBD – Location TBA" },
  { date: "2026-07-12", title: "Tournament", type: "tournament", detail: "TBD – Location TBA" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June",
                 "July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function eventsOn(dateStr) {
  return EVENTS.filter(e => e.date === dateStr);
}

function fmt(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m-1]} ${d}, ${y}`;
}

function typeLabel(type) {
  return type === "tournament" ? "🏆 Tournament"
       : type === "practice"   ? "⚾ Practice"
       :                         "📌 Team Event";
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const today = new Date();
let current = { year: today.getFullYear(), month: today.getMonth() };

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderCalendar() {
  const { year, month } = current;
  document.getElementById("calTitle").textContent = `${MONTHS[month]} ${year}`;

  const body = document.getElementById("calBody");
  body.innerHTML = "";

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  // prev month padding
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    body.appendChild(makeCell(d, `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`, true));
  }

  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    body.appendChild(makeCell(d, dateStr, false, dateStr === todayStr));
  }

  // next month padding
  const total = firstDay + daysInMonth;
  const remainder = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= remainder; d++) {
    const m = month === 11 ? 1 : month + 2;
    const y = month === 11 ? year + 1 : year;
    body.appendChild(makeCell(d, `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`, true));
  }

  hideDetail();
  renderUpcoming();
}

function makeCell(dayNum, dateStr, otherMonth, isToday = false) {
  const cell = document.createElement("div");
  cell.className = "cal-day" +
    (otherMonth ? " other-month" : "") +
    (isToday    ? " today"       : "");

  const numEl = document.createElement("div");
  numEl.className = "day-num";
  numEl.textContent = dayNum;
  cell.appendChild(numEl);

  const evs = eventsOn(dateStr);
  if (evs.length > 0) {
    cell.classList.add("has-events");
    evs.slice(0, 2).forEach(ev => {
      const pill = document.createElement("div");
      pill.className = `event-pill pill-${ev.type}`;
      pill.textContent = ev.title;
      cell.appendChild(pill);
    });
    if (evs.length > 2) {
      const more = document.createElement("div");
      more.className = "more-events";
      more.textContent = `+${evs.length - 2} more`;
      cell.appendChild(more);
    }
    cell.addEventListener("click", () => showDetail(dateStr, evs));
  }

  return cell;
}

// ─── DETAIL PANEL ─────────────────────────────────────────────────────────────
function showDetail(dateStr, evs) {
  const panel = document.getElementById("eventDetail");
  document.getElementById("detailDate").textContent = fmt(dateStr);
  const list = document.getElementById("detailList");
  list.innerHTML = "";
  evs.forEach(ev => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${typeLabel(ev.type)}</span><strong>${ev.title}</strong>${ev.detail ? ` — ${ev.detail}` : ""}`;
    list.appendChild(li);
  });
  panel.classList.remove("hidden");
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideDetail() {
  document.getElementById("eventDetail").classList.add("hidden");
}

// ─── UPCOMING LIST ────────────────────────────────────────────────────────────
function renderUpcoming() {
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const upcoming = EVENTS
    .filter(e => e.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  const list = document.getElementById("upcomingList");
  const none = document.getElementById("noUpcoming");
  list.innerHTML = "";

  if (upcoming.length === 0) {
    none.classList.remove("hidden");
    return;
  }
  none.classList.add("hidden");

  upcoming.forEach(ev => {
    const item = document.createElement("div");
    item.className = `upcoming-item type-${ev.type}`;
    item.innerHTML = `
      <div class="upcoming-date">${fmt(ev.date)}</div>
      <div class="upcoming-info">
        <h4>${ev.title}</h4>
        ${ev.detail ? `<p>${ev.detail}</p>` : ""}
      </div>`;
    list.appendChild(item);
  });
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────────
document.getElementById("prevMonth").addEventListener("click", () => {
  current.month--;
  if (current.month < 0) { current.month = 11; current.year--; }
  renderCalendar();
});

document.getElementById("nextMonth").addEventListener("click", () => {
  current.month++;
  if (current.month > 11) { current.month = 0; current.year++; }
  renderCalendar();
});

document.getElementById("closeDetail").addEventListener("click", hideDetail);

// ─── INIT ─────────────────────────────────────────────────────────────────────
renderCalendar();
