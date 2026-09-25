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
  currentDayDetail: null,
  clinicTypes: [],
  settingsLoaded: false
};

/* ---------------- API helper (ใช้ JSONP เพื่อเลี่ยงปัญหา CORS ของ Apps Script) ---------------- */

const JSONP_TIMEOUT_MS = 20000; // ถ้าเกิน 20 วิไม่มีการตอบกลับ ถือว่าเชื่อมต่อไม่สำเร็จ ไม่ปล่อยให้ค้างเงียบๆ ไม่มีที่สิ้นสุด

function jsonp_(action, payload) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const script = document.createElement('script');
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('timeout'));
    }, JSONP_TIMEOUT_MS);

    window[callbackName] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('network error'));
    };

    const url = `${API_URL}?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload))}&callback=${callbackName}`;
    script.src = url;
    document.body.appendChild(script);
  });
}

async function api(action, payload = {}) {
  if (state.token) payload.token = state.token;
  let data;
  try {
    data = await jsonp_(action, payload);
  } catch (e) {
    return { ok: false, error: 'เชื่อมต่อไม่สำเร็จ (หมดเวลารอ) กรุณาลองใหม่อีกครั้ง' };
  }
  if (!data.ok && data.error === 'กรุณาเข้าสู่ระบบใหม่') {
    logout();
  }
  // การกระทำใดๆ ที่ไม่ใช่ "get..." ถือว่าเป็นการแก้ไขข้อมูล ต้องล้างแคชปฏิทินที่ดักไว้ล่วงหน้าทันที
  // มิเช่นนั้นจะเห็นข้อมูลเก่าค้างอยู่หลังบันทึก/ยกเลิก/แก้ไขต่างๆ
  if (data.ok && action !== 'login' && action.indexOf('get') !== 0) {
    Object.keys(_calendarPrefetchCache_).forEach(k => delete _calendarPrefetchCache_[k]);
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

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
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
document.getElementById('logoutBtn')?.addEventListener('click', logout);

function enterApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
  document.getElementById('whoName').textContent = state.displayName;
  document.getElementById('whoRole').textContent = state.role === 'physio' ? 'นักกายภาพบำบัด' : 'เจ้าหน้าที่นัดหมาย';
  document.querySelectorAll('.physio-only').forEach(el => {
    el.style.display = state.role === 'physio' ? '' : 'none';
  });
  if (state.role === 'physio') refreshClinicTypes();
  renderCalendar();
}

/* ---------------- Navigation ---------------- */

document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const view = btn.dataset.view;
    document.getElementById('calendarView').classList.toggle('hidden', view !== 'calendar');
    document.getElementById('settingsView').classList.toggle('hidden', view !== 'settings');
    if (view === 'settings' && !state.settingsLoaded) loadSettings();
  });
});

/* ---------------- ปฏิทิน ---------------- */

const MONTH_NAMES = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

document.getElementById('prevMonth')?.addEventListener('click', () => shiftMonth(-1));
document.getElementById('nextMonth')?.addEventListener('click', () => shiftMonth(1));

function shiftMonth(delta) {
  state.month += delta;
  if (state.month < 1) { state.month = 12; state.year--; }
  if (state.month > 12) { state.month = 1; state.year++; }
  renderCalendar();
}

let _calendarReqId_ = 0; // กันปัญหาเดือนค้าง: ถ้ากดเปลี่ยนเดือนเร็วๆ ผลลัพธ์เก่าที่มาช้ากว่าจะถูกทิ้งไป ไม่ทับของใหม่
const _calendarPrefetchCache_ = {}; // เก็บผลลัพธ์เดือนที่ดึงไว้ล่วงหน้า key: "year-month"

function fetchCalendarMonth_(year, month) {
  const key = year + '-' + month;
  if (!_calendarPrefetchCache_[key]) {
    _calendarPrefetchCache_[key] = api('getCalendar', { year, month });
  }
  return _calendarPrefetchCache_[key];
}

async function renderCalendar() {
  const reqId = ++_calendarReqId_;
  document.getElementById('monthLabel').textContent = `${MONTH_NAMES[state.month - 1]} ${state.year + 543}`;
  document.getElementById('prevMonth').disabled = true;
  document.getElementById('nextMonth').disabled = true;

  const grid = document.getElementById('calendarGrid');
  grid.classList.add('loading');

  const res = await fetchCalendarMonth_(state.year, state.month);

  document.getElementById('prevMonth').disabled = false;
  document.getElementById('nextMonth').disabled = false;
  if (reqId !== _calendarReqId_) return; // มีการเรียกครั้งใหม่กว่าเกิดขึ้นแล้ว ผลลัพธ์นี้เก่าเกินไป ไม่ต้องเอามาแสดง
  grid.classList.remove('loading');
  if (!res.ok) {
    delete _calendarPrefetchCache_[state.year + '-' + state.month]; // เผื่อโหลดพลาด ครั้งหน้าจะได้ลองใหม่
    toast(res.error);
    return;
  }

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
    cell.className = 'day-cell' + (day.isClosed ? ' closed' : '') + (day.clinicColor ? ' has-clinic' : '');
    if (day.clinicColor) cell.style.setProperty('--clinic-color', day.clinicColor);
    const dayNum = Number(day.date.split('-')[2]);

    const clinicLine = day.clinicName
      ? `<div class="clinic-line" style="color:${day.clinicColor}" title="${(day.clinicNote || '').replace(/"/g, '')}">${day.clinicName}</div>`
      : '';

    const badges = [];
    if (day.isSpecialOpen) badges.push(`<span class="badge special-tag">เปิดพิเศษ</span>`);
    if (!day.isClosed && day.slotsAvailable !== null && day.slotsAvailable !== undefined) {
      badges.push(`<span class="badge avail-tag">ว่างอีก ${day.slotsAvailable}</span>`);
    }
    if (day.opdCount) badges.push(`<span class="badge opd">OPD ${day.opdCount}</span>`);
    if (day.communityCount) badges.push(`<span class="badge community">ลงชุมชน ${day.communityCount}</span>`);
    day.busyTypes.forEach(t => badges.push(`<span class="badge busy">${t}</span>`));
    if (day.isClosed && day.isWeekend && day.busyTypes.length === 0 && !day.opdCount && !day.communityCount) {
      // วันหยุดสุดสัปดาห์ ไม่ต้องมี badge เพิ่ม
    } else if (day.isClosed && !day.isWeekend) {
      badges.push(`<span class="badge closed-tag">ปิด${day.closedReason ? ': ' + day.closedReason : ''}</span>`);
    }

    cell.innerHTML = `${clinicLine}<div class="day-num">${dayNum}</div><div class="day-badges">${badges.join('')}</div>`;
    // นักกายภาพคลิกวันปิดได้ด้วย เพื่อใช้ปุ่ม "เปิดรับพิเศษวันนี้"; เจ้าหน้าที่นัดคลิกได้เฉพาะวันเปิด
    if (!day.isClosed || state.role === 'physio') {
      cell.addEventListener('click', () => openDayPanel(day.date));
    }
    grid.appendChild(cell);
  });

  // ดึงเดือนก่อนหน้า/ถัดไปดักไว้เงียบๆ เบื้องหลัง เพื่อให้กดเปลี่ยนเดือนครั้งถัดไปไวขึ้นทันที
  // หน่วงไว้สักครู่ก่อน จะได้ไม่ไปแย่งคิวกับคำขอของเดือนปัจจุบันที่ผู้ใช้กำลังรออยู่
  setTimeout(() => { if (reqId === _calendarReqId_) prefetchAdjacentMonths_(); }, 1500);
}

function prefetchAdjacentMonths_() {
  let py = state.year, pm = state.month - 1;
  if (pm < 1) { pm = 12; py--; }
  let ny = state.year, nm = state.month + 1;
  if (nm > 12) { nm = 1; ny++; }
  fetchCalendarMonth_(py, pm);
  fetchCalendarMonth_(ny, nm);
}

/* ---------------- แผงรายละเอียดวัน ---------------- */

const dayPanel = document.getElementById('dayPanel');
const dayPanelBackdrop = document.getElementById('dayPanelBackdrop');

document.getElementById('closeDayPanel')?.addEventListener('click', closeDayPanel);
dayPanelBackdrop?.addEventListener('click', closeDayPanel);

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
  renderClinicDisplay(res.data.clinic);
  renderClinicEditor(res.data.clinic);
  renderDayToggleActions(res.data);

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
  state.currentAppts = appts; // เก็บไว้ใช้เปิดดูรายละเอียด
  appts.forEach(a => {
    const li = document.createElement('li');
    li.dataset.viewId = a.id;
    li.style.cursor = 'pointer';
    li.innerHTML = `
      <div><span class="appt-time">${a.startTime}-${a.endTime}</span>${a.firstName} ${a.lastName}
        <span class="badge ${a.type === 'OPD' ? 'opd' : 'community'}">${a.type}</span></div>
      <div style="color:var(--ink-soft);font-size:12px;">หมู่ ${a.moo}${a.phone ? ' · โทร ' + a.phone : ''}</div>
      <button class="appt-cancel" data-id="${a.id}">ยกเลิกนัด</button>
      <div style="clear:both"></div>`;
    list.appendChild(li);
  });
  list.querySelectorAll('li[data-view-id]').forEach(li => {
    li.addEventListener('click', (e) => {
      if (e.target.closest('.appt-cancel')) return; // กดปุ่มยกเลิก ไม่ต้องเปิดรายละเอียด
      const appt = state.currentAppts.find(a => a.id === li.dataset.viewId);
      if (appt) openApptDetail(appt);
    });
  });
  list.querySelectorAll('.appt-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ยืนยันยกเลิกนัดนี้?')) return;
      btn.disabled = true;
      btn.textContent = 'กำลังยกเลิก...';
      const res = await api('cancelAppointment', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); btn.disabled = false; btn.textContent = 'ยกเลิกนัด'; return; }
      toast('ยกเลิกนัดแล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]); // เรียกพร้อมกัน ลดเวลารอ
    });
  });
}

/* ---------------- ดูรายละเอียดนัดหมาย ---------------- */

const apptDetailModal = document.getElementById('apptDetailModal');
const apptDetailModalBackdrop = document.getElementById('apptDetailModalBackdrop');

function openApptDetail(a) {
  const rows = [
    ['ประเภทนัด', a.type],
    ['เวลา', `${a.startTime} - ${a.endTime}`],
    ['ชื่อ-นามสกุล', `${a.firstName} ${a.lastName}`],
    ['หมู่', a.moo || '-'],
    ['เบอร์โทร', a.phone || '-'],
    ['เลขบัตรประชาชน', a.nationalId || '-'],
    ['หมายเหตุ', a.note || '-'],
    ['บันทึกโดย', a.createdBy || '-']
  ];
  document.getElementById('apptDetailBody').innerHTML = rows.map(([label, value]) =>
    `<div class="detail-row"><span class="detail-label">${label}</span><span class="detail-value">${value}</span></div>`
  ).join('');
  document.getElementById('apptDetailCancelBtn').dataset.id = a.id;
  apptDetailModal?.classList.remove('hidden');
  apptDetailModalBackdrop?.classList.remove('hidden');
}
function closeApptDetail() {
  apptDetailModal?.classList.add('hidden');
  apptDetailModalBackdrop?.classList.add('hidden');
}
document.getElementById('apptDetailCloseBtn')?.addEventListener('click', closeApptDetail);
apptDetailModalBackdrop?.addEventListener('click', closeApptDetail);
document.getElementById('apptDetailCancelBtn')?.addEventListener('click', async (e) => {
  if (!confirm('ยืนยันยกเลิกนัดนี้?')) return;
  const id = e.target.dataset.id;
  e.target.disabled = true;
  const res = await api('cancelAppointment', { id });
  e.target.disabled = false;
  if (!res.ok) { toast(res.error); return; }
  toast('ยกเลิกนัดแล้ว');
  closeApptDetail();
  await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
});

/* ---------------- คลินิกประจำวัน (แสดง + แก้ไข) ---------------- */

async function refreshClinicTypes() {
  const res = await api('getClinicTypes');
  if (res.ok) state.clinicTypes = res.data;
}

function renderClinicDisplay(clinic) {
  const box = document.getElementById('clinicDisplay');
  if (!clinic) {
    box.innerHTML = '<span style="color:var(--ink-soft);font-size:13px;">ยังไม่กำหนดคลินิกวันนี้</span>';
    return;
  }
  box.innerHTML = `<span class="badge clinic-tag" style="background:${clinic.color}">${clinic.name}</span>` +
    (clinic.fromRule ? '<span style="color:var(--ink-soft);font-size:11px;margin-left:6px;">(ตามกฎอัตโนมัติ)</span>' : '') +
    (clinic.note ? `<div style="color:var(--ink-soft);font-size:12px;margin-top:6px;">${clinic.note}</div>` : '');
}

function renderClinicEditor(clinic) {
  const editor = document.getElementById('clinicEditor');
  if (state.role !== 'physio') { editor.classList.add('hidden'); return; }
  editor.classList.remove('hidden');

  const select = document.getElementById('clinicSelect');
  select.innerHTML =
    '<option value="">-- ใช้ค่าอัตโนมัติ (ถ้ามีกฎ) --</option>' +
    '<option value="__NONE__">ไม่มีคลินิก (เฉพาะวันนี้)</option>' +
    state.clinicTypes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  // ถ้าคลินิกที่แสดงมาจากกฎอัตโนมัติ ให้ปล่อยช่องเลือกเป็นค่าว่าง (ยังไม่ได้ override เฉพาะวันนี้)
  select.value = (clinic && !clinic.fromRule) ? clinic.id : '';
  document.getElementById('clinicNoteInput').value = (clinic && !clinic.fromRule) ? clinic.note : '';
}

document.getElementById('saveClinicBtn')?.addEventListener('click', async () => {
  const date = state.currentDate;
  const clinicTypeId = document.getElementById('clinicSelect').value;
  const note = document.getElementById('clinicNoteInput').value.trim();
  const btn = document.getElementById('saveClinicBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  const res = clinicTypeId
    ? await api('setClinicDay', { date, clinicTypeId, note })
    : await api('removeClinicDay', { date });

  btn.disabled = false;
  btn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  toast('บันทึกคลินิกวันนี้แล้ว');
  await Promise.all([openDayPanel(date), renderCalendar()]);
});

/* ---------------- ปิดรับ/เปิดรับพิเศษวันนี้ (นักกายภาพ) ---------------- */

function renderDayToggleActions(dayDetail) {
  const box = document.getElementById('dayToggleActions');
  if (state.role !== 'physio') { box.innerHTML = ''; return; }
  box.innerHTML = '';

  if (dayDetail.isOpen && dayDetail.isSpecialOpen) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'ยกเลิกเปิดรับพิเศษวันนี้';
    btn.addEventListener('click', async () => {
      const res = await api('removeSpecialOpen', { date: state.currentDate });
      if (!res.ok) { toast(res.error); return; }
      toast('ยกเลิกเปิดรับพิเศษแล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
    });
    box.appendChild(btn);
  } else if (dayDetail.isOpen) {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'ปิดรับวันนี้';
    btn.addEventListener('click', async () => {
      const reason = prompt('ระบุเหตุผล (ไม่บังคับ):', '') || '';
      const res = await api('addClosedDate', { date: state.currentDate, reason });
      if (!res.ok) { toast(res.error); return; }
      toast('ปิดรับวันนี้แล้ว');
      await Promise.all([openDayPanel(state.currentDate), renderCalendar()]);
    });
    box.appendChild(btn);
  } else {
    const btn = document.createElement('button');
    btn.className = 'secondary';
    btn.textContent = 'เปิดรับพิเศษวันนี้';
    btn.addEventListener('click', () => openSpecialModal(state.currentDate));
    box.appendChild(btn);
  }
}

const specialModal = document.getElementById('specialModal');
const specialModalBackdrop = document.getElementById('specialModalBackdrop');

function openSpecialModal(date) {
  document.getElementById('specialDate').value = date;
  document.getElementById('specialError').textContent = '';
  document.getElementById('specialForm').reset();
  // ใช้เวลาเปิด-ปิดปกติของวันนี้ (ตามตารางประจำสัปดาห์) เป็นค่าตั้งต้น ถ้ามี จะได้ไม่ต้องพิมพ์เอง
  const weekly = state.currentDayDetail && state.currentDayDetail.weeklySchedule;
  document.getElementById('specialStart').value = (weekly && weekly.openTime) || '08:30';
  document.getElementById('specialEnd').value = (weekly && weekly.closeTime) || '16:30';
  document.getElementById('specialSlotMinutes').value = (weekly && weekly.slotMinutes) || 30;
  specialModal.classList.remove('hidden');
  specialModalBackdrop.classList.remove('hidden');
}
function closeSpecialModal() {
  specialModal.classList.add('hidden');
  specialModalBackdrop.classList.add('hidden');
}
document.getElementById('specialCancelBtn')?.addEventListener('click', closeSpecialModal);
specialModalBackdrop?.addEventListener('click', closeSpecialModal);

document.getElementById('specialForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('specialDate').value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addSpecialOpen', {
    date,
    openTime: document.getElementById('specialStart').value,
    closeTime: document.getElementById('specialEnd').value,
    slotMinutes: Number(document.getElementById('specialSlotMinutes').value),
    note: document.getElementById('specialNote').value.trim()
  });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('specialError').textContent = res.error; return; }
  toast('เปิดรับพิเศษวันนี้แล้ว');
  closeSpecialModal();
  await Promise.all([openDayPanel(date), renderCalendar()]);
});

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
document.getElementById('apptCancelBtn')?.addEventListener('click', closeApptModal);
apptModalBackdrop?.addEventListener('click', closeApptModal);

document.getElementById('apptForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('apptDate').value;
  const startTime = document.getElementById('apptStart').value;
  const slot = state.currentDayDetail.slots.find(s => s.start === startTime);
  const endTime = slot ? slot.end : startTime;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

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

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('apptError').textContent = res.error; return; }
  toast('บันทึกนัดหมายแล้ว');
  closeApptModal();
  await Promise.all([openDayPanel(date), renderCalendar()]); // เรียกพร้อมกันแทนเรียงลำดับ ลดเวลารอ
});

/* ---------------- โมดัลตั้งช่วงไม่ว่าง (นักกายภาพ) ---------------- */

const busyModal = document.getElementById('busyModal');
const busyModalBackdrop = document.getElementById('busyModalBackdrop');

document.getElementById('physioBusyBtn')?.addEventListener('click', () => {
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
document.getElementById('busyCancelBtn')?.addEventListener('click', closeBusyModal);
busyModalBackdrop?.addEventListener('click', closeBusyModal);

document.getElementById('busyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('busyDate').value;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addBusy', {
    date,
    startTime: document.getElementById('busyStart').value,
    endTime: document.getElementById('busyEnd').value,
    type: document.getElementById('busyType').value,
    note: document.getElementById('busyNote').value.trim()
  });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { document.getElementById('busyError').textContent = res.error; return; }
  toast('บันทึกช่วงไม่ว่างแล้ว');
  closeBusyModal();
  await Promise.all([openDayPanel(date), renderCalendar()]); // เรียกพร้อมกันแทนเรียงลำดับ ลดเวลารอ
});

/* ---------------- ตั้งค่า (เฉพาะนักกายภาพ) ---------------- */

const DAY_LABELS = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 0: 'อาทิตย์' };

async function loadSettings() {
  const [schedRes, closedRes, clinicRes, ruleRes] = await Promise.all([
    api('getSchedule'), api('getClosedDates'), api('getClinicTypes'), api('getClinicRules')
  ]); // เรียกพร้อมกัน ลดเวลารอ

  if (schedRes.ok) renderScheduleForm(schedRes.data); else toast('โหลดเวลาเปิด-ปิดไม่สำเร็จ: ' + schedRes.error);
  if (closedRes.ok) renderClosedList(closedRes.data); else toast('โหลดวันปิดไม่สำเร็จ: ' + closedRes.error);
  if (clinicRes.ok) { state.clinicTypes = clinicRes.data; renderClinicTypesList(clinicRes.data); renderRuleClinicSelect(clinicRes.data); } else toast('โหลดประเภทคลินิกไม่สำเร็จ: ' + clinicRes.error);
  if (ruleRes.ok) renderClinicRulesList(ruleRes.data); else toast('โหลดกฎคลินิกไม่สำเร็จ: ' + ruleRes.error);

  // ให้โหลดใหม่อัตโนมัติได้อีกครั้งถ้ารอบนี้มีบางส่วนล้มเหลว (ไม่ล็อกว่า "โหลดแล้ว" ทั้งที่ข้อมูลไม่ครบ)
  state.settingsLoaded = schedRes.ok && closedRes.ok && clinicRes.ok && ruleRes.ok;
}

document.getElementById('refreshSettingsBtn')?.addEventListener('click', loadSettings);

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

document.getElementById('saveScheduleBtn')?.addEventListener('click', async (e) => {
  const btn = e.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';
  const days = [0,1,2,3,4,5,6].map(dayNum => ({
    day: dayNum,
    isOpen: dayNum === 0 || dayNum === 6 ? false : document.querySelector(`.sched-open[data-day="${dayNum}"]`).checked,
    openTime: document.querySelector(`.sched-start[data-day="${dayNum}"]`)?.value || '',
    closeTime: document.querySelector(`.sched-end[data-day="${dayNum}"]`)?.value || '',
    slotMinutes: Number(document.querySelector(`.sched-slot[data-day="${dayNum}"]`)?.value || 30)
  }));
  const res = await api('setSchedule', { days });
  btn.disabled = false;
  btn.textContent = originalText;
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

document.getElementById('closedDateForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = document.getElementById('closedDateInput').value;
  const reason = document.getElementById('closedReasonInput').value.trim();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';
  const res = await api('addClosedDate', { date, reason });
  submitBtn.disabled = false;
  submitBtn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('closedDateForm').reset();
  loadSettings();
  renderCalendar();
});

/* ---------------- ประเภทคลินิก (ตั้งค่า) ---------------- */

function renderClinicTypesList(rows) {
  const list = document.getElementById('clinicTypeList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีประเภทคลินิก</li>'; return; }
  rows.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="color-swatch" style="background:${r.color}"></span>${r.name}</span><button data-id="${r.id}">ลบ</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('ลบประเภทคลินิกนี้? (วันที่เคยกำหนดคลินิกนี้ไว้จะถูกล้างไปด้วย)')) return;
      const res = await api('removeClinicType', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      loadSettings();
      renderCalendar();
    });
  });
}

document.getElementById('clinicTypeForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('clinicTypeName').value.trim();
  const color = document.getElementById('clinicTypeColor').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';
  const res = await api('addClinicType', { name, color });
  submitBtn.disabled = false;
  submitBtn.textContent = originalText;
  if (!res.ok) { toast(res.error); return; }
  document.getElementById('clinicTypeForm').reset();
  document.getElementById('clinicTypeColor').value = '#2B6E63';
  loadSettings();
});

/* ---------------- กฎคลินิกอัตโนมัติ (ตั้งค่า) ---------------- */

const RULE_WEEKDAY_LABELS = { '0': 'อาทิตย์', '1': 'จันทร์', '2': 'อังคาร', '3': 'พุธ', '4': 'พฤหัสบดี', '5': 'ศุกร์', '6': 'เสาร์' };
const RULE_NTH_LABELS = { every: 'ทุกสัปดาห์', '1': 'สัปดาห์ที่ 1', '2': 'สัปดาห์ที่ 2', '3': 'สัปดาห์ที่ 3', '4': 'สัปดาห์ที่ 4', last: 'สัปดาห์สุดท้าย' };

function renderRuleClinicSelect(clinicTypes) {
  const select = document.getElementById('ruleClinicSelect');
  select.innerHTML = clinicTypes.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

function renderClinicRulesList(rows) {
  const list = document.getElementById('clinicRuleList');
  list.innerHTML = '';
  if (!rows.length) { list.innerHTML = '<li style="background:none;color:var(--ink-soft);">ยังไม่มีกฎอัตโนมัติ</li>'; return; }
  rows.forEach(r => {
    const clinicType = state.clinicTypes.find(c => c.id === r.clinicTypeId);
    const clinicName = clinicType ? clinicType.name : '(ไม่พบคลินิก)';
    const weekdayLabel = RULE_WEEKDAY_LABELS[String(r.weekday)] || r.weekday;
    const nthLabel = RULE_NTH_LABELS[String(r.nth)] || r.nth;
    const li = document.createElement('li');
    li.innerHTML = `<span>${clinicName} — ${nthLabel === 'ทุกสัปดาห์' ? 'ทุกวัน' + weekdayLabel : `วัน${weekdayLabel} (${nthLabel})`}${r.note ? ' — ' + r.note : ''}</span><button data-id="${r.id}">ลบ</button>`;
    list.appendChild(li);
  });
  list.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await api('removeClinicRule', { id: btn.dataset.id });
      if (!res.ok) { toast(res.error); return; }
      loadSettings();
      renderCalendar();
    });
  });
}

document.getElementById('clinicRuleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const clinicTypeId = document.getElementById('ruleClinicSelect').value;
  const weekday = document.getElementById('ruleWeekday').value;
  const nth = document.getElementById('ruleNth').value;
  const note = document.getElementById('ruleNote').value.trim();
  if (!clinicTypeId) { toast('กรุณาเพิ่มประเภทคลินิกก่อน'); return; }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'กำลังบันทึก...';

  const res = await api('addClinicRule', { clinicTypeId, weekday, nth, note });

  submitBtn.disabled = false;
  submitBtn.textContent = originalText;

  if (!res.ok) { toast(res.error); return; }
  document.getElementById('clinicRuleForm').reset();
  toast('เพิ่มกฎอัตโนมัติแล้ว');
  loadSettings();
  renderCalendar();
});

/* ---------------- เริ่มระบบ ---------------- */
// วางไว้ท้ายไฟล์เสมอ เพื่อให้ตัวแปร/ฟังก์ชันทั้งหมด (เช่น MONTH_NAMES) ถูกประกาศครบก่อนเรียกใช้งาน
if (state.token) enterApp();
