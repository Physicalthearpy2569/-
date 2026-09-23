/**
 * ต้องแก้ API_URL ให้เป็น URL ของ Web App ที่ deploy จาก Google Apps Script
 * (ดูขั้นตอนใน README.md)
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbzlg53dUi1aCRkSKZR88ooB607ReRLb78UWcn59nWV--oodxkuJzPMtfO0bZIgqb6Yj7g/exec';

const state = {
  token: localStorage.getItem('token') || null,
  role: localStorage.getItem('role') || null,
  displayName: localStorage.getItem('displayName') || '',
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  currentDate: null,
  currentDayDetail: null
};

/* ---------------- API helper (ใช้ GET เพื่อเลี่ยงปัญหา CORS preflight ของ Apps Script) ---------------- */

async function api(action, payload = {}) {
  if (state.token) payload.token = state.token;
  const url = `${API_URL}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok && data.error === 'กรุณาเข้าสู่ระบบใหม่') {
    logout();
  }
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------------- Auth ---------------- */

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';

  const res = await api('login', { username, password });
  if (!res.ok) { errEl.textContent = res.error; return; }

  state.token = res.token;
  state.role = res.role;
  state.displayName = res.displayName;
  localStorage.setItem('token', res.token);
  localStorage.setItem('role', res.role);
  localStorage.setItem('displayName', res.displayName);
  enterApp();
});

function logout() {
  state.token = null;
  localStorage.clear();
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden');
}
document.getElementById('logoutBtn').addEventListener('click', logout);

function enterApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('whoName').textContent = state.displayName;
  document.getElementById('whoRole').textContent = state.role === 'physio' ? 'นักกายภาพบำบัด' : 'เจ้าหน้าที่นัดหมาย';
  document.querySelectorAll('.physio-only').forEach(el => {
    el.style.display = state.role === 'physio' ? '' : 'none';
  });
  renderCalendar();
}

if (state.token) enterApp();

/* ---------------- Navigation ---------------- */

document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('calendarView').classList.toggle('hidden', view !== 'calendar');
    document.getElementById('settingsView').classList.toggle('hidden', view !== 'settings');
    if (view === 'settings') loadSettings();
  });
});

/* ---------------- ปฏิทิน ---------------- */

const MONTH_NAMES = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

document.getElementById('prevMonth').addEventListener('click', () => shiftMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => shiftMonth(1));

function shiftMonth(delta) {
  state.month += delta;
  if (state.month < 1) { state.month = 12; state.year--; }
  if (state.month > 12) { state.month = 1; state.year++; }
  renderCalendar();
}

async function renderCalendar() {
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[state.month - 1]} ${state.year + 543}`;
  const res = await api('getCalendar', { year: state.year, month: state.month });
  if (!res.ok) { toast(res.error); return; }

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  const firstDate = new Date(state.year, state.month - 1, 1);
  // ต้องการให้จันทร์เป็นคอลัมน์แรก: JS getDay() = 0(อา)-6(ส) -> แปลงเป็น 0(จ)-6(อา)
  const leadingBlank = (firstDate.getDay() + 6) % 7;

  for (let i = 0; i < leadingBlank; i++) {
    const blank = document.createElement('div');
    blank.className = 'day-cell other-month';
    grid.appendChild(blank);
  }

  res.data.forEach(day => {
    const cell = document.createElement('div');
    cell.className = 'day-cell' + (day.isClosed ? ' closed' : '');
    const dayNum = Number(day.date.split('-')[2]);

    const badges = [];
    if (day.opdCount) badges.push(`<span class="badge opd">OPD ${day.opdCount}</span>`);
    if (day.communityCount) badges.push(`<span class="badge community">ลงชุมชน ${day.communityCount}</span>`);
    day.busyTypes.forEach(t => badges.push(`<span class="badge busy">${t}</span>`));
    if (day.isClosed && day.isWeekend && day.busyTypes.length === 0 && !day.opdCount && !day.communityCount) {
      // วันหยุดสุดสัปดาห์ ไม่ต้องมี badge เพิ่ม
    } else if (day.isClosed && !day.isWeekend) {
      badges.push(`<span class="badge closed-tag">ปิด${day.closedReason ? ': ' + day.closedReason : ''}</span>`);
    }

    cell.innerHTML = `<div class="day-num">${dayNum}</div><div class="day-badges">${badges.join('')}</div>`;
    if (!day.isClosed) {
      cell.addEventListener('click', () => openDayPanel(day.date));
    }
    grid.appendChild(cell);
  });
}

/* ---------------- แผงรายละเอียดวัน ---------------- */

const dayPanel = document.getElementById('dayPanel');
const dayPanelBackdrop = document.getElementById('dayPanelBackdrop');

document.getElementById('closeDayPanel').addEventListener('click', closeDayPanel);
dayPanelBackdrop.addEventListener('click', closeDayPanel);

function closeDayPanel() {
  dayPanel.classList.add('hidden');
  dayPanelBackdrop.classList.add('hidden');
}

async function openDayPanel(dateStr) {
  state.currentDate = dateStr;
  const res = await api('getDayDetail', { date: dateStr });
  if (!res.ok) { toast(res.error); return; }
  state.currentDayDetail = res.data;

  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  document.getElementById('dayPanelTitle').textContent =
    `วัน${weekdays[d.getDay()]}ที่ ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear() + 543}`;

  const closedNote = document.getElementById('dayPanelClosedNote');
  if (!res.data.isOpen) {
    closedNote.textContent = res.data.closedReason ? `ปิดทำการ: ${res.data.closedReason}` : 'ปิดทำการวันนี้';
    closedNote.classList.remove('hidden');
  } else {
    closedNote.classList.add('hidden');
  }

  renderSlots(res.data.slots);
  renderApptList(res.data.appointments);

  dayPanel.classList.remove('hidden');
  dayPanelBackdrop.classList.remove('hidden');
}

function renderSlots(slots) {
  const box = document.getElementById('slotList');
  box.innerHTML = '';
  if (!slots.length) { box.innerHTML = '<span style="color:var(--ink-soft);font-size:13px;">ไม่มีช่วงเวลาให้บริการ</span>'; return; }
  slots.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'slot-btn ' + (s.available ? 'available' : 'taken');
    btn.textContent = s.start;
    btn.title = s.available ? 'ว่าง' : (s.busyType || (s.appointment ? `นัด: ${s.appointment.patientName}` : 'ไม่ว่าง'));
    if (s.available) btn.addEventListener('click', () => openApptModal(s.start));
    box.appendChild(btn);
  });
}

function renderApptList(appts) {
  const list = document.getElementById('apptList');
  list.innerHTML = '';
  if (!appts.length) { list.innerHTML = '<li style="border:none;color:var(--ink-soft);">ยังไม่มีนัดหมาย</li>'; return; }
  appts.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div><span class="appt-time">${a.startTime}-${a.endTime}</span>${a.firstName} ${a.lastName}
        <span class="badge ${a.type === 'OPD' ? 'opd' : 'community'}">${a.type}</span></div>
      <div style="color:var(--ink-soft);font-size:12px;">หมู่ ${a.moo}${a.phone ? ' · โทร ' + a.phone : ''}${a.nationalId ? ' · บัตร ปชช. ' + a.nationalId : ''}</div>
      <button class="appt-cancel" data-id="${a.id}">ยกเลิกนัด</button>
      <div style="clear:both"></div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('.appt-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ยืนยันยกเลิกนัดนี้?')) return;
      const res = await api('cancelAppointment', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      toast('ยกเลิกนัดแล้ว');
      openDayPanel(state.currentDate);
      renderCalendar();
    });
  });
}

/* ---------------- โมดัลเพิ่มนัดหมาย ---------------- */

const apptModal = document.getElementById('apptModal');
const apptModalBackdrop = document.getElementById('apptModalBackdrop');

function openApptModal(startTime) {
  document.getElementById('apptDate').value = state.currentDate;
  document.getElementById('apptError').textContent = '';
  document.getElementById('apptForm').reset();

  const startSel = document.getElementById('apptStart');
  startSel.innerHTML = '';
  const slotMinutes = state.currentDayDetail.schedule ? Number(state.currentDayDetail.schedule.slotMinutes) : 30;
  state.currentDayDetail.slots.filter(s => s.available).forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.start;
    opt.textContent = `${s.start} - ${s.end}`;
    startSel.appendChild(opt);
  });
  if (startTime) startSel.value = startTime;

  apptModal.classList.remove('hidden');
  apptModalBackdrop.classList.remove('hidden');
}
function closeApptModal() {
  apptModal.classList.add('hidden');
  apptModalBackdrop.classList.add('hidden');
}
document.getElementById('apptCancelBtn').addEventListener('click', closeApptModal);
apptModalBackdrop.addEventListener('click', closeApptModal);

document.getElementById('apptForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('apptDate').value;
  const startTime = document.getElementById('apptStart').value;
  const slot = state.currentDayDetail.slots.find(s => s.start === startTime);
  const endTime = slot ? slot.end : startTime;

  const res = await api('addAppointment', {
    date, startTime, endTime,
    type: document.getElementById('apptType').value,
    firstName: document.getElementById('apptFirstName').value.trim(),
    lastName: document.getElementById('apptLastName').value.trim(),
    moo: document.getElementById('apptMoo').value.trim(),
    phone: document.getElementById('apptPhone').value.trim(),
    nationalId: document.getElementById('apptNationalId').value.trim(),
    note: document.getElementById('apptNote').value.trim()
  });

  if (!res.ok) { document.getElementById('apptError').textContent = res.error; return; }
  toast('บันทึกนัดหมายแล้ว');
  closeApptModal();
  openDayPanel(date);
  renderCalendar();
});

/* ---------------- โมดัลตั้งช่วงไม่ว่าง (นักกายภาพ) ---------------- */

const busyModal = document.getElementById('busyModal');
const busyModalBackdrop = document.getElementById('busyModalBackdrop');

document.getElementById('physioBusyBtn').addEventListener('click', () => {
  document.getElementById('busyDate').value = state.currentDate;
  document.getElementById('busyForm').reset();
  document.getElementById('busyError').textContent = '';
  busyModal.classList.remove('hidden');
  busyModalBackdrop.classList.remove('hidden');
});
function closeBusyModal() {
  busyModal.classList.add('hidden');
  busyModalBackdrop.classList.add('hidden');
}
document.getElementById('busyCancelBtn').addEventListener('click', closeBusyModal);
busyModalBackdrop.addEventListener('click', closeBusyModal);

document.getElementById('busyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('busyDate').value;
  const res = await api('addBusy', {
    date,
    startTime: document.getElementById('busyStart').value,
    endTime: document.getElementById('busyEnd').value,
    type: document.getElementById('busyType').value,
    note: document.getElementById('busyNote').value.trim()
  });
  if (!res.ok) { document.getElementById('busyError').textContent = res.error; return; }
  toast('บันทึกช่วงไม่ว่างแล้ว');
  closeBusyModal();
  openDayPanel(date);
  renderCalendar();
});

/* ---------------- ตั้งค่า (เฉพาะนักกายภาพ) ---------------- */

const DAY_LABELS = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 0: 'อาทิตย์' };

async function loadSettings() {
  const schedRes = await api('getSchedule');
  if (schedRes.ok) renderScheduleForm(schedRes.data);
  const closedRes = await api('getClosedDates');
  if (closedRes.ok) renderClosedList(closedRes.data);
}

function renderScheduleForm(rows) {
  const box = document.getElementById('scheduleForm');
  box.innerHTML = '';
  // เรียงจันทร์(1)-ศุกร์(5) ก่อน แล้วค่อยเสาร์(6)-อาทิตย์(0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  order.forEach(dayNum => {
    const row = rows.find(r => Number(r.day) === dayNum) || { day: dayNum, isOpen: false, openTime: '08:30', closeTime: '16:30', slotMinutes: 30 };
    const div = document.createElement('div');
    div.className = 'schedule-row';
    const isWeekendFixed = dayNum === 0 || dayNum === 6;
    div.innerHTML = `
      <span>${DAY_LABELS[dayNum]}</span>
      <label><input type="checkbox" data-day="${dayNum}" class="sched-open" ${row.isOpen ? 'checked' : ''} ${isWeekendFixed ? 'disabled title="เสาร์-อาทิตย์ปิดโดยอัตโนมัติ"' : ''}/> เปิด</label>
      <input type="time" class="sched-start" data-day="${dayNum}" value="${row.openTime || '08:30'}" ${isWeekendFixed ? 'disabled' : ''}/>
      <input type="time" class="sched-end" data-day="${dayNum}" value="${row.closeTime || '16:30'}" ${isWeekendFixed ? 'disabled' : ''}/>
      <input type="number" class="sched-slot" data-day="${dayNum}" min="10" step="5" value="${row.slotMinutes || 30}" title="นาที/ช่อง" ${isWeekendFixed ? 'disabled' : ''}/>
    `;
    box.appendChild(div);
  });
}

document.getElementById('saveScheduleBtn').addEventListener('click', async () => {
  const days = [0,1,2,3,4,5,6].map(dayNum => ({
    day: dayNum,
    isOpen: dayNum === 0 || dayNum === 6 ? false : document.querySelector(`.sched-open[data-day="${dayNum}"]`).checked,
    openTime: document.querySelector(`.sched-start[data-day="${dayNum}"]`)?.value || '',
    closeTime: document.querySelector(`.sched-end[data-day="${dayNum}"]`)?.value || '',
    slotMinutes: Number(document.querySelector(`.sched-slot[data-day="${dayNum}"]`)?.value || 30)
  }));
  const res = await api('setSchedule', { days });
  if (!res.ok) { toast(res.error); return; }
  toast('บันทึกเวลาเปิด-ปิดแล้ว');
  renderCalendar();
});

function renderClosedList(rows) {
  const list = document.getElementById('closedDateList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีวันปิดเพิ่มเติม</li>'; return; }
  rows.sort((a,b) => a.date < b.date ? -1 : 1).forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${r.date}${r.reason ? ' — ' + r.reason : ''}</span><button data-date="${r.date}">ลบ</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeClosedDate', { date: btn.dataset.date });
      if (!res.ok) { toast(res.error); return; }
      loadSettings();
      renderCalendar();
    });
  });
}

document.getElementById('closedDateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('closedDateInput').value;
  const reason = document.getElementById('closedReasonInput').value.trim();
  const res = await api('addClosedDate', { date, reason });
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('closedDateForm').reset();
  loadSettings();
  renderCalendar();
});
