/**
 * ระบบนัดหมายผู้ป่วย รพ.สต. — Backend (Google Apps Script)
 * -----------------------------------------------------------
 * วิธีติดตั้ง (ดูละเอียดใน README.md):
 * 1. สร้าง Google Sheet ใหม่ 1 ไฟล์ แล้วเปิด Extensions > Apps Script
 * 2. วางไฟล์นี้ทับ Code.gs ที่มีอยู่
 * 3. รันฟังก์ชัน setupSheets() หนึ่งครั้ง (เมนู Run > setupSheets) เพื่อสร้างชีตและ
 *    ผู้ใช้เริ่มต้น แล้วอนุมัติสิทธิ์ที่ขอ
 * 4. Deploy > New deployment > Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    คัดลอก URL ที่ได้ไปใส่ในไฟล์ app.js (ตัวแปร API_URL)
 *
 * โครงสร้างชีตทั้งหมดถูกสร้างอัตโนมัติโดย setupSheets()
 */

const SHEET_USERS = 'Users';
const SHEET_SCHEDULE = 'Schedule';
const SHEET_CLOSED = 'ClosedDates';
const SHEET_BUSY = 'Busy';
const SHEET_APPTS = 'Appointments';

const BUSY_TYPES = ['ประชุม', 'ทำเอกสาร', 'อบรม', 'ลา'];
const APPT_TYPES = ['OPD', 'ลงชุมชน'];

/** เรียกครั้งเดียวตอนติดตั้ง เพื่อสร้างชีตทั้งหมด + ผู้ใช้เริ่มต้น */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_USERS, ['username', 'password', 'role', 'displayName']);
  ensureSheet_(ss, SHEET_SCHEDULE, ['day', 'isOpen', 'openTime', 'closeTime', 'slotMinutes']);
  ensureSheet_(ss, SHEET_CLOSED, ['date', 'reason']);
  ensureSheet_(ss, SHEET_BUSY, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  ensureSheet_(ss, SHEET_APPTS, ['id', 'date', 'startTime', 'endTime', 'type', 'firstName', 'lastName', 'moo', 'phone', 'nationalId', 'note', 'createdBy', 'createdAt', 'status']);

  // ผู้ใช้เริ่มต้น (เปลี่ยนรหัสผ่านทันทีหลังติดตั้งจริง)
  const usersSheet = ss.getSheetByName(SHEET_USERS);
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow(['physio', 'changeme123', 'physio', 'นักกายภาพบำบัด']);
    usersSheet.appendRow(['staff', 'changeme123', 'staff', 'เจ้าหน้าที่นัดหมาย']);
  }

  // ตารางเวลาเริ่มต้น: จันทร์–ศุกร์ เปิด 08:30–16:30 ช่องละ 30 นาที, เสาร์–อาทิตย์ปิด
  const schedSheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (schedSheet.getLastRow() < 2) {
    const days = [
      [1, true, '08:30', '16:30', 30],  // จันทร์
      [2, true, '08:30', '16:30', 30],  // อังคาร
      [3, true, '08:30', '16:30', 30],  // พุธ
      [4, true, '08:30', '16:30', 30],  // พฤหัสบดี
      [5, true, '08:30', '16:30', 30],  // ศุกร์
      [6, false, '', '', 30],           // เสาร์
      [0, false, '', '', 30]            // อาทิตย์
    ];
    days.forEach(d => schedSheet.appendRow(d));
  }

  // Secret key สำหรับเซ็น token (สร้างครั้งเดียว)
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  Logger.log('ติดตั้งเรียบร้อย! Deploy เป็น Web app ได้เลย');
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ---------------------------- Web entry point ---------------------------- */

function doGet(e) {
  try {
    const action = e.parameter.action;
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    const result = route_(action, payload);
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
}

function route_(action, payload) {
  // Actions ที่ไม่ต้อง login
  if (action === 'login') return login_(payload);

  // Actions ที่ต้อง login (ตรวจ token)
  const auth = verifyToken_(payload.token);
  if (!auth.ok) return { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' };

  switch (action) {
    case 'getCalendar': return getCalendar_(payload);
    case 'getDayDetail': return getDayDetail_(payload);
    case 'addAppointment': return addAppointment_(payload, auth);
    case 'cancelAppointment': return cancelAppointment_(payload, auth);

    case 'getSchedule': return requirePhysio_(auth, () => getSchedule_());
    case 'setSchedule': return requirePhysio_(auth, () => setSchedule_(payload));
    case 'getClosedDates': return requirePhysio_(auth, () => getClosedDates_());
    case 'addClosedDate': return requirePhysio_(auth, () => addClosedDate_(payload));
    case 'removeClosedDate': return requirePhysio_(auth, () => removeClosedDate_(payload));
    case 'addBusy': return requirePhysio_(auth, () => addBusy_(payload));
    case 'removeBusy': return requirePhysio_(auth, () => removeBusy_(payload));

    default: return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
  }
}

function requirePhysio_(auth, fn) {
  if (auth.role !== 'physio') return { ok: false, error: 'สิทธิ์ไม่พอ (เฉพาะนักกายภาพ)' };
  return fn();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------- Auth ---------------------------- */

function login_(payload) {
  const rows = sheetData_(SHEET_USERS);
  const u = rows.find(r => r.username === payload.username && r.password === payload.password);
  if (!u) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  const exp = Date.now() + 1000 * 60 * 60 * 12; // token อายุ 12 ชม.
  const raw = `${u.username}|${u.role}|${exp}`;
  const sig = sign_(raw);
  return {
    ok: true,
    token: `${raw}|${sig}`,
    role: u.role,
    displayName: u.displayName
  };
}

function sign_(raw) {
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  const bytes = Utilities.computeHmacSha256Signature(raw, secret);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function verifyToken_(token) {
  if (!token) return { ok: false };
  const parts = token.split('|');
  if (parts.length !== 4) return { ok: false };
  const [username, role, exp, sig] = parts;
  const raw = `${username}|${role}|${exp}`;
  if (sign_(raw) !== sig) return { ok: false };
  if (Date.now() > Number(exp)) return { ok: false };
  return { ok: true, username, role };
}

/* ---------------------------- Sheet helpers ---------------------------- */

function sheetData_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values.map((row, i) => {
    const obj = {};
    headers.forEach((h, idx) => obj[h] = row[idx]);
    obj._row = i + 2; // เลขแถวจริงในชีต (1 = header)
    return obj;
  });
}

function appendRow_(name, obj, headers) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  sheet.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
}

function deleteRow_(name, rowIndex) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name).deleteRow(rowIndex);
}

function fmtDate_(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------------------------- Schedule ---------------------------- */

function getSchedule_() {
  return { ok: true, data: sheetData_(SHEET_SCHEDULE) };
}

function setSchedule_(payload) {
  // payload.days = [{day, isOpen, openTime, closeTime, slotMinutes}, ...]
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHEDULE);
  payload.days.forEach(d => {
    const rows = sheetData_(SHEET_SCHEDULE);
    const match = rows.find(r => Number(r.day) === Number(d.day));
    const rowIdx = match._row;
    sheet.getRange(rowIdx, 1, 1, 5).setValues([[d.day, d.isOpen, d.openTime, d.closeTime, d.slotMinutes]]);
  });
  return { ok: true };
}

/* ---------------------------- Closed dates ---------------------------- */

function getClosedDates_() {
  return { ok: true, data: sheetData_(SHEET_CLOSED).map(r => ({ ...r, date: fmtDate_(r.date) })) };
}

function addClosedDate_(payload) {
  appendRow_(SHEET_CLOSED, { date: payload.date, reason: payload.reason || '' }, ['date', 'reason']);
  return { ok: true };
}

function removeClosedDate_(payload) {
  const rows = sheetData_(SHEET_CLOSED);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_CLOSED, match._row);
  return { ok: true };
}

/* ---------------------------- Busy (นักกายภาพไม่ว่าง) ---------------------------- */

function addBusy_(payload) {
  appendRow_(SHEET_BUSY, {
    id: Utilities.getUuid(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    type: payload.type,
    note: payload.note || ''
  }, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  return { ok: true };
}

function removeBusy_(payload) {
  const rows = sheetData_(SHEET_BUSY);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_BUSY, match._row);
  return { ok: true };
}

/* ---------------------------- Appointments ---------------------------- */

function addAppointment_(payload, auth) {
  if (APPT_TYPES.indexOf(payload.type) === -1) return { ok: false, error: 'ประเภทนัดไม่ถูกต้อง' };
  if (!payload.firstName || !payload.lastName) return { ok: false, error: 'กรุณากรอกชื่อและนามสกุล' };
  if (!payload.moo) return { ok: false, error: 'กรุณากรอกหมู่' };
  if (payload.nationalId && !/^\d{13}$/.test(String(payload.nationalId).replace(/-/g, ''))) {
    return { ok: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
  }

  const check = isSlotAvailable_(payload.date, payload.startTime, payload.endTime);
  if (!check.ok) return check;

  appendRow_(SHEET_APPTS, {
    id: Utilities.getUuid(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    type: payload.type,
    firstName: payload.firstName,
    lastName: payload.lastName,
    moo: payload.moo,
    phone: payload.phone || '',
    nationalId: payload.nationalId || '',
    note: payload.note || '',
    createdBy: auth.username,
    createdAt: new Date().toISOString(),
    status: 'active'
  }, ['id', 'date', 'startTime', 'endTime', 'type', 'firstName', 'lastName', 'moo', 'phone', 'nationalId', 'note', 'createdBy', 'createdAt', 'status']);

  return { ok: true };
}

function cancelAppointment_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  sheet.getRange(match._row, 14).setValue('cancelled'); // คอลัมน์ status
  return { ok: true };
}

function isSlotAvailable_(date, startTime, endTime) {
  const closed = sheetData_(SHEET_CLOSED).some(r => fmtDate_(r.date) === date);
  if (closed) return { ok: false, error: 'วันนี้ปิดทำการ' };

  const dow = new Date(date + 'T00:00:00').getDay();
  const sched = sheetData_(SHEET_SCHEDULE).find(r => Number(r.day) === dow);
  if (!sched || sched.isOpen !== true) return { ok: false, error: 'วันนี้ไม่เปิดให้บริการ' };
  if (startTime < sched.openTime || endTime > sched.closeTime) {
    return { ok: false, error: 'อยู่นอกเวลาทำการ (' + sched.openTime + '-' + sched.closeTime + ')' };
  }

  const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

  const busyToday = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === date);
  for (const b of busyToday) {
    if (overlaps(startTime, endTime, b.startTime, b.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้นักกายภาพไม่ว่าง (' + b.type + ')' };
    }
  }

  const apptsToday = sheetData_(SHEET_APPTS).filter(r => fmtDate_(r.date) === date && r.status === 'active');
  for (const a of apptsToday) {
    if (overlaps(startTime, endTime, a.startTime, a.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้มีนัดอยู่แล้ว' };
    }
  }

  return { ok: true };
}

/* ---------------------------- Calendar / detail views ---------------------------- */

/** ดึงข้อมูลสรุปทั้งเดือน เพื่อวาดปฏิทิน (payload: {year, month}) */
function getCalendar_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month); // 1-12
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  const closedDates = sheetData_(SHEET_CLOSED).map(r => fmtDate_(r.date));
  const schedule = sheetData_(SHEET_SCHEDULE);
  const busy = sheetData_(SHEET_BUSY);
  const appts = sheetData_(SHEET_APPTS).filter(r => r.status === 'active');

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtDate_(d);
    const dow = d.getDay();
    const sched = schedule.find(s => Number(s.day) === dow);
    const isWeekend = dow === 0 || dow === 6;
    const isClosed = closedDates.indexOf(dateStr) !== -1 || !sched || sched.isOpen !== true;

    const dayBusy = busy.filter(b => fmtDate_(b.date) === dateStr).map(b => b.type);
    const dayAppts = appts.filter(a => fmtDate_(a.date) === dateStr);
    const opdCount = dayAppts.filter(a => a.type === 'OPD').length;
    const communityCount = dayAppts.filter(a => a.type === 'ลงชุมชน').length;

    days.push({
      date: dateStr,
      isWeekend,
      isClosed,
      closedReason: isClosed ? (closedDates.indexOf(dateStr) !== -1 ? (sheetData_(SHEET_CLOSED).find(r => fmtDate_(r.date) === dateStr) || {}).reason : '') : '',
      busyTypes: [...new Set(dayBusy)],
      opdCount,
      communityCount
    });
  }

  return { ok: true, data: days };
}

/** รายละเอียดของวันเดียว: ช่องเวลาว่าง + รายการนัด + busy (payload: {date}) */
function getDayDetail_(payload) {
  const date = payload.date;
  const dow = new Date(date + 'T00:00:00').getDay();
  const sched = sheetData_(SHEET_SCHEDULE).find(r => Number(r.day) === dow);
  const closedRow = sheetData_(SHEET_CLOSED).find(r => fmtDate_(r.date) === date);

  const busy = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === date);
  const appts = sheetData_(SHEET_APPTS)
    .filter(r => fmtDate_(r.date) === date && r.status === 'active')
    .sort((a, b) => a.startTime < b.startTime ? -1 : 1);

  let slots = [];
  if (sched && sched.isOpen === true && !closedRow) {
    slots = buildSlots_(sched.openTime, sched.closeTime, sched.slotMinutes, busy, appts);
  }

  return {
    ok: true,
    data: {
      date,
      isOpen: !!(sched && sched.isOpen === true) && !closedRow,
      closedReason: closedRow ? closedRow.reason : '',
      schedule: sched || null,
      busy,
      appointments: appts,
      slots
    }
  };
}

function buildSlots_(openTime, closeTime, slotMinutes, busy, appts) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const toTime = m => ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);

  const start = toMin(openTime), end = toMin(closeTime), step = Number(slotMinutes) || 30;
  const slots = [];
  for (let t = start; t < end; t += step) {
    const sStr = toTime(t), eStr = toTime(t + step);
    const busyHit = busy.find(b => sStr < b.endTime && b.startTime < eStr);
    const apptHit = appts.find(a => sStr < a.endTime && a.startTime < eStr);
    slots.push({
      start: sStr,
      end: eStr,
      available: !busyHit && !apptHit,
      busyType: busyHit ? busyHit.type : null,
      appointment: apptHit || null
    });
  }
  return slots;
}
