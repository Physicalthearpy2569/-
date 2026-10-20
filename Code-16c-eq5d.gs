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
const SHEET_SCHEDULE_SLOTS = 'ScheduleSlots';
const SHEET_CLOSED = 'ClosedDates';
const SHEET_BUSY = 'Busy';
const SHEET_APPTS = 'Appointments';
const SHEET_CLINIC_TYPES = 'ClinicTypes';
const SHEET_CLINIC_DAYS = 'ClinicDays';
const SHEET_CLINIC_RULES = 'ClinicRules';
const SHEET_SPECIAL_OPEN = 'SpecialOpen';
const SHEET_SPECIAL_SLOTS = 'SpecialOpenSlots';
const SHEET_ICD10 = 'Icd10Codes';
const SHEET_ICD9 = 'Icd9Codes';
const ICD10_AUTO_CODE = 'Z501';
const ICD9_AUTO_CODE = '9339';
const SHEET_EXTRA_SLOTS = 'ExtraSlots';
const SHEET_BUSY_RULES = 'BusyRules';

// ทะเบียนคนไข้: 1 คน = 1 แถว = 1 PTN (Physical Therapy Number) ใช้เป็นรหัสหลักผูกนัดทุกครั้งของคนเดียวกันเข้าด้วยกัน
const SHEET_PATIENTS = 'Patients';
const PATIENT_HEADERS = ['ptn', 'firstName', 'lastName', 'nationalId', 'phone', 'moo', 'createdAt', 'updatedAt'];
// รูปแบบ PTN = PTN + ปี พ.ศ. 2 หลักของปีที่มาครั้งแรก + ขีด + เลขลำดับ 4 หลักของปีนั้น เช่น PTN69-0001 = คนแรกที่มาครั้งแรกในปี 2569
// (4 หลักรองรับคนไข้ใหม่ปีละ 9,999 คน ถ้าปีไหนเกิน เลขจะยาวขึ้นเป็น 5 หลักเองโดยไม่ชนกับเลขเดิม)
// เลขลำดับเริ่มนับ 1 ใหม่ทุกปี (แบบเดียวกับ HN ของโรงพยาบาล) ปีและเลขลำดับไม่เปลี่ยนอีกตลอดไปแม้คนไข้จะมาปีถัดๆ ไป
// PTN ที่ออกด้วยรูปแบบเก่า (PT00001) หรือจำนวนหลักไม่ตรง (PTN69-00001) จะถูกแปลงเป็นรูปแบบนี้ให้อัตโนมัติเมื่อรัน setupPatients()
const PTN_PREFIX = 'PTN';
const PTN_DIGITS = 4;
const PTN_FISCAL_YEAR = false; // false = นับปีตามปฏิทิน (ม.ค.-ธ.ค.), true = นับตามปีงบประมาณ (ต.ค.-ก.ย.)

// รุ่นของโค้ดหลังบ้าน — หน้าเว็บ (app.js) ใช้ค่านี้ตรวจว่าเว็บแอปถูกอัปเดตเป็นเวอร์ชันใหม่แล้วหรือยัง
// (วางโค้ดใหม่ใน Apps Script แล้วแต่ยังไม่ได้กด "จัดการการทำให้ใช้งานได้ > เวอร์ชันใหม่" เว็บจะยังเรียกโค้ดรุ่นเก่าอยู่)
const BACKEND_VERSION = '2026-10-16c';

const BUSY_TYPES = ['ประชุม', 'ทำเอกสาร', 'อบรม', 'ลา', 'ไปราชการ'];
const APPT_TYPES = ['OPD', 'ลงชุมชน'];

/**
 * "อุ่นเครื่อง" — ให้ตั้ง trigger เรียกฟังก์ชันนี้อัตโนมัติทุก 10 นาที
 * (Triggers > Add Trigger > เลือกฟังก์ชัน keepWarm > Time-driven > Minutes timer > Every 10 minutes)
 * สิ่งที่ทำ: อ่านชีตที่แคชไว้ (ตารางเวลา วันปิด คลินิก ผู้ใช้) และคำนวณปฏิทินเดือนปัจจุบันเก็บลงแคชล่วงหน้า
 * ผู้ใช้คนแรกของแต่ละช่วงจะได้ข้อมูลจากแคชที่พร้อมอยู่แล้ว ไม่ต้องรออ่านชีตหลายแผ่นสดๆ
 * (ชื่อฟังก์ชันห้ามลงท้ายด้วย _ ไม่งั้นจะไม่ขึ้นในรายการให้เลือกตอนสร้าง trigger)
 */
function keepWarm() {
  _sheetCache_ = {};
  CACHED_SHEETS_.forEach(name => sheetData_(name));
  const now = new Date();
  getCalendar_({ year: now.getFullYear(), month: now.getMonth() + 1 });
}

/** เรียกครั้งเดียวตอนติดตั้ง เพื่อสร้างชีตทั้งหมด + ผู้ใช้เริ่มต้น */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_USERS, ['username', 'password', 'role', 'displayName']);
  ensureSheet_(ss, SHEET_SCHEDULE, ['day', 'isOpen']);
  ensureSheet_(ss, SHEET_SCHEDULE_SLOTS, ['id', 'weekday', 'startTime', 'endTime']);
  ensureSheet_(ss, SHEET_CLOSED, ['date', 'reason']);
  ensureSheet_(ss, SHEET_BUSY, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  ensureSheet_(ss, SHEET_APPTS, ['id', 'date', 'startTime', 'endTime', 'type', 'firstName', 'lastName', 'moo', 'phone', 'nationalId', 'note', 'createdBy', 'createdAt', 'status', 'attendedAt', 'attendedBy', 'icd10', 'icd9']);
  ensureColumns_(ss.getSheetByName(SHEET_APPTS), ['attendedAt', 'attendedBy']); // ชีตเดิมที่ติดตั้งไว้ก่อนหน้า: เพิ่มคอลัมน์ให้อัตโนมัติ
  ensureSheet_(ss, SHEET_CLINIC_TYPES, ['id', 'name', 'color']);
  ensureSheet_(ss, SHEET_CLINIC_DAYS, ['date', 'clinicTypeId', 'note']);
  ensureSheet_(ss, SHEET_CLINIC_RULES, ['id', 'clinicTypeId', 'weekday', 'nth', 'note']);
  ensureSheet_(ss, SHEET_SPECIAL_OPEN, ['date', 'note']);
  ensureSheet_(ss, SHEET_SPECIAL_SLOTS, ['id', 'date', 'startTime', 'endTime']);
  ensureSheet_(ss, SHEET_ICD10, ['id', 'code', 'label', 'isAuto']);
  ensureSheet_(ss, SHEET_ICD9, ['id', 'code', 'label', 'isAuto']);
  ensureSheet_(ss, SHEET_EXTRA_SLOTS, ['id', 'date', 'startTime', 'endTime', 'note']);
  ensureSheet_(ss, SHEET_BUSY_RULES, ['id', 'patternType', 'dayOfMonth', 'weekday', 'nth', 'startTime', 'endTime', 'type', 'note']);
  ensureColumns_(ss.getSheetByName(SHEET_APPTS), ['icd10', 'icd9']); // ชีตเดิมที่ติดตั้งไว้ก่อนหน้า: เพิ่มคอลัมน์ให้อัตโนมัติ
  ensurePatientInfra_(); // ชีตทะเบียนคนไข้ (Patients) + คอลัมน์ ptn ในชีต Appointments
  ensureApptTextColumns_(); // คอลัมน์เบอร์โทร/รหัส ICD/PTN ของชีตนัดเป็นข้อความธรรมดา

  // รหัสอัตโนมัติเริ่มต้น (แก้ไข/เพิ่ม/ลบเองได้ในหน้า "ตั้งค่า" ภายหลัง — ยกเว้นแถวนี้ที่แนะนำให้เก็บไว้)
  const icd10Sheet = ss.getSheetByName(SHEET_ICD10);
  if (icd10Sheet.getLastRow() < 2) {
    icd10Sheet.appendRow([Utilities.getUuid(), ICD10_AUTO_CODE, 'ทำกายภาพบำบัด', true]);
  }
  const icd9Sheet = ss.getSheetByName(SHEET_ICD9);
  if (icd9Sheet.getLastRow() < 2) {
    icd9Sheet.appendRow([Utilities.getUuid(), ICD9_AUTO_CODE, 'ประเมินทางกายภาพบำบัด', true]);
  }

  // ตัวอย่างประเภทคลินิก (แก้ไข/เพิ่ม/ลบเองได้ในหน้า "ตั้งค่า" ภายหลัง)
  const clinicSheet = ss.getSheetByName(SHEET_CLINIC_TYPES);
  if (clinicSheet.getLastRow() < 2) {
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกข้อเข่า', '#2B6E63']);
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกป้องกันล้ม', '#C97A3D']);
    clinicSheet.appendRow([Utilities.getUuid(), 'คลินิกลดปวด', '#6B5CA5']);
  }

  // ผู้ใช้เริ่มต้น (เปลี่ยนรหัสผ่านทันทีหลังติดตั้งจริง)
  const usersSheet = ss.getSheetByName(SHEET_USERS);
  if (usersSheet.getLastRow() < 2) {
    usersSheet.appendRow(['physio', 'changeme123', 'physio', 'นักกายภาพบำบัด']);
    usersSheet.appendRow(['staff', 'changeme123', 'staff', 'เจ้าหน้าที่นัดหมาย']);
  }

  // ตารางเวลาเริ่มต้น: จันทร์–ศุกร์ เปิด, เสาร์–อาทิตย์ปิด (กำหนดช่วงเวลานัดเองได้ในหน้า "ตั้งค่า")
  const schedSheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (schedSheet.getLastRow() < 2) {
    const days = [
      [1, true],  // จันทร์
      [2, true],  // อังคาร
      [3, true],  // พุธ
      [4, true],  // พฤหัสบดี
      [5, true],  // ศุกร์
      [6, false], // เสาร์
      [0, false]  // อาทิตย์
    ];
    days.forEach(d => schedSheet.appendRow(d));
  }

  // ช่วงเวลาเริ่มต้นตัวอย่าง (จันทร์-ศุกร์ 08:30-16:30 ช่วงเดียว) — เข้าไปแก้เป็นช่วงเวลาที่ต้องการเองได้ในหน้า "ตั้งค่า"
  const slotsSheet = ss.getSheetByName(SHEET_SCHEDULE_SLOTS);
  if (slotsSheet.getLastRow() < 2) {
    [1, 2, 3, 4, 5].forEach(weekday => {
      slotsSheet.appendRow([Utilities.getUuid(), weekday, '08:30', '16:30']);
    });
  }

  // Secret key สำหรับเซ็น token (สร้างครั้งเดียว)
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) {
    props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  Logger.log('ติดตั้งเรียบร้อย! Deploy เป็น Web app ได้เลย');
}

/** เพิ่มหัวคอลัมน์ที่ยังไม่มีต่อท้ายแถวหัวตาราง (ใช้กับชีตที่ติดตั้งไว้แล้ว ไม่กระทบข้อมูลเดิม) */
function ensureColumns_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  let last = row.length;
  while (last > 0 && row[last - 1] === '') last--; // ตำแหน่งหัวคอลัมน์สุดท้ายที่มีข้อความจริง
  const existing = row.slice(0, last);
  headers.forEach(h => {
    if (existing.indexOf(h) === -1) {
      sheet.getRange(1, existing.length + 1).setValue(h);
      existing.push(h);
    }
  });
}

/** เลขคอลัมน์ (เริ่มที่ 1) ของหัวคอลัมน์ที่ระบุ */
function colIndex_(sheet, header) {
  const row = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  const i = row.indexOf(header);
  if (i === -1) throw new Error('ไม่พบคอลัมน์ ' + header);
  return i + 1;
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
  _sheetCache_ = {}; // เคลียร์แคชทุกครั้งที่มีการเรียกใหม่ (กันข้อมูลค้างข้ามคำขอ)
  try {
    const action = e.parameter.action;
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    const result = route_(action, payload);
    return output_(result, e.parameter.callback);
  } catch (err) {
    return output_({ ok: false, error: err.message }, e.parameter.callback);
  }
}

function route_(action, payload) {
  // Actions ที่ไม่ต้อง login
  if (action === 'ping') return { ok: true, data: { pong: true, version: BACKEND_VERSION } }; // ใช้ปลุก/เช็คว่าสคริปต์ยัง "อุ่น" อยู่ไหม เบาที่สุดเท่าที่จะทำได้ (ไม่แตะชีตเลย)
  if (action === 'login') return login_(payload);

  // Actions ที่ต้อง login (ตรวจ token)
  const auth = verifyToken_(payload.token);
  if (!auth.ok) return { ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' };

  // ข้อมูลก้อนใหญ่ (เช่น เวชระเบียนทั้งชุด) ยาวเกินจะใส่ใน URL เดียว หน้าเว็บจึงส่งมาเป็นชิ้น ๆ ก่อน แล้วเรียกคำสั่งจริงพร้อมเลขอ้างอิง
  if (action === 'uploadChunk') return uploadChunk_(payload, auth);
  if (payload.__upload) {
    const full = assembleUpload_(payload.__upload, auth);
    if (!full.ok) return full;
    full.payload.token = payload.token;
    payload = full.payload;
  }

  switch (action) {
    case 'getCalendar': return getCalendar_(payload);
    case 'getDayDetail': return getDayDetail_(payload);
    case 'addAppointment': return addAppointment_(payload, auth);
    case 'cancelAppointment': return cancelAppointment_(payload, auth);
    case 'markAttended': return requirePhysio_(auth, () => markAttended_(payload, auth));
    case 'updateAppointmentIcd': return requirePhysio_(auth, () => updateAppointmentIcd_(payload));
    case 'updateAppointmentInfo': return updateAppointmentInfo_(payload);
    case 'getPatients': return getPatients_();
    case 'getPatientSummary': return getPatientSummary_(payload);
    case 'getRecordSetup': return requirePhysio_(auth, () => getRecordSetup_());
    case 'getPatientRecords': return requirePhysio_(auth, () => getPatientRecords_(payload, auth));
    case 'getRecentRecords': return requirePhysio_(auth, () => getRecentRecords_(auth));
    case 'getRecord': return requirePhysio_(auth, () => getRecord_(payload, auth));
    case 'saveRecord': return requirePhysio_(auth, () => saveRecord_(payload, auth));
    case 'deleteRecord': return requirePhysio_(auth, () => deleteRecord_(payload, auth));
    case 'getRecordContext': return requirePhysio_(auth, () => getRecordContext_(payload, auth));
    case 'setRecordOptions': return requirePhysio_(auth, () => setRecordOptions_(payload, auth));
    case 'seedRecordOptions': return requirePhysio_(auth, () => seedRecordOptions_(auth));
    case 'markSatisfaction': return requirePhysio_(auth, () => markSatisfaction_(payload, auth));

    case 'getSettingsBundle': return requirePhysio_(auth, () => getSettingsBundle_());
    case 'getSchedule': return requirePhysio_(auth, () => getSchedule_());
    case 'setSchedule': return requirePhysio_(auth, () => setSchedule_(payload));
    case 'getClosedDates': return requirePhysio_(auth, () => getClosedDates_());
    case 'addClosedDate': return requirePhysio_(auth, () => addClosedDate_(payload));
    case 'removeClosedDate': return requirePhysio_(auth, () => removeClosedDate_(payload));
    case 'addBusy': return requirePhysio_(auth, () => addBusy_(payload));
    case 'updateBusy': return requirePhysio_(auth, () => updateBusy_(payload));
    case 'removeBusy': return requirePhysio_(auth, () => removeBusy_(payload));

    case 'getIcd10Codes': return getIcd10Codes_();
    case 'addIcd10Code': return requirePhysio_(auth, () => addIcd10Code_(payload));
    case 'removeIcd10Code': return requirePhysio_(auth, () => removeIcd10Code_(payload));
    case 'getIcd9Codes': return getIcd9Codes_();
    case 'addIcd9Code': return requirePhysio_(auth, () => addIcd9Code_(payload));
    case 'removeIcd9Code': return requirePhysio_(auth, () => removeIcd9Code_(payload));

    case 'getClinicTypes': return requirePhysio_(auth, () => getClinicTypes_());
    case 'addClinicType': return requirePhysio_(auth, () => addClinicType_(payload));
    case 'removeClinicType': return requirePhysio_(auth, () => removeClinicType_(payload));
    case 'updateClinicType': return requirePhysio_(auth, () => updateClinicType_(payload));
    case 'setClinicDay': return requirePhysio_(auth, () => setClinicDay_(payload));
    case 'removeClinicDay': return requirePhysio_(auth, () => removeClinicDay_(payload));
    case 'getClinicRules': return requirePhysio_(auth, () => getClinicRules_());
    case 'getDashboard': return requirePhysio_(auth, () => getDashboard_(payload));
    case 'getOutcomes': return requirePhysio_(auth, () => getOutcomes_(payload, auth));
    case 'getDashboardCompare': return requirePhysio_(auth, () => getDashboardCompare_(payload));
    case 'addClinicRule': return requirePhysio_(auth, () => addClinicRule_(payload));
    case 'removeClinicRule': return requirePhysio_(auth, () => removeClinicRule_(payload));
    case 'updateClinicRule': return requirePhysio_(auth, () => updateClinicRule_(payload));
    case 'addSpecialOpen': return requirePhysio_(auth, () => addSpecialOpen_(payload));
    case 'removeSpecialOpen': return requirePhysio_(auth, () => removeSpecialOpen_(payload));
    case 'addExtraSlot': return requirePhysio_(auth, () => addExtraSlot_(payload));
    case 'removeExtraSlot': return requirePhysio_(auth, () => removeExtraSlot_(payload));
    case 'syncHolidays': return requirePhysio_(auth, () => syncHolidays_(payload));
    case 'getBusyRules': return requirePhysio_(auth, () => getBusyRules_());
    case 'addBusyRule': return requirePhysio_(auth, () => addBusyRule_(payload));
    case 'removeBusyRule': return requirePhysio_(auth, () => removeBusyRule_(payload));

    default: return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
  }
}

/* ---------------------------- รับข้อมูลก้อนใหญ่เป็นชิ้น ---------------------------- */
// หน้าเว็บคุยกับสคริปต์ผ่าน URL (JSONP) ซึ่งยาวได้จำกัด ข้อความภาษาไทย 1 ตัวอักษรกินที่ใน URL ถึง 9 ตัว
// ชิ้นส่วนถูกพักไว้ในแคชของสคริปต์ไม่กี่นาที แยกตามผู้ใช้ที่ล็อกอิน แล้วประกอบกลับตอนเรียกคำสั่งจริง
const UPLOAD_MAX_PARTS = 80;
function uploadKey_(username, id, i) {
  return 'up_' + username + '_' + id + '_' + i;
}
function uploadChunk_(payload, auth) {
  const id = String(payload.id || ''), i = Number(payload.i), n = Number(payload.n), part = payload.part;
  if (!/^[A-Za-z0-9]{8,40}$/.test(id) || !(n >= 1 && n <= UPLOAD_MAX_PARTS) || !(i >= 0 && i < n) || Math.floor(i) !== i || Math.floor(n) !== n ||
      typeof part !== 'string' || part.length > 4000) {
    return { ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
  }
  CacheService.getScriptCache().put(uploadKey_(auth.username, id, i), part, 900);
  return { ok: true };
}
function assembleUpload_(u, auth) {
  const id = String((u && u.id) || ''), n = Number(u && u.n);
  if (!/^[A-Za-z0-9]{8,40}$/.test(id) || !(n >= 1 && n <= UPLOAD_MAX_PARTS) || Math.floor(n) !== n) return { ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
  const cache = CacheService.getScriptCache();
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(uploadKey_(auth.username, id, i));
  const got = cache.getAll(keys);
  const parts = keys.map(k => got[k]);
  if (parts.some(p => typeof p !== 'string')) return { ok: false, error: 'ส่งข้อมูลไม่ครบ กรุณากดบันทึกอีกครั้ง' };
  let obj;
  try { obj = JSON.parse(parts.join('')); } catch (e) { return { ok: false, error: 'ข้อมูลที่ส่งมาไม่สมบูรณ์ กรุณากดบันทึกอีกครั้ง' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'ข้อมูลที่ส่งมาไม่ถูกต้อง' };
  try { cache.removeAll(keys); } catch (e) { /* หมดอายุเองใน 15 นาที */ }
  delete obj.__upload;
  return { ok: true, payload: obj };
}

function requirePhysio_(auth, fn) {
  if (auth.role !== 'physio') return { ok: false, error: 'สิทธิ์ไม่พอ (เฉพาะนักกายภาพ)' };
  return fn();
}

/**
 * รันฟังก์ชันนี้ "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก installKeepWarm จาก dropdown ข้างปุ่ม "เรียกใช้" แล้วกด Run)
 * เพื่อตั้ง time-driven trigger ให้เรียก keepWarm() (ฟังก์ชันที่มีอยู่แล้วด้านบน) ทุก 10 นาทีอัตโนมัติ
 * ไม่ต้องไปตั้งเองผ่านเมนู Triggers — ฟังก์ชันนี้สร้าง trigger ให้เสร็จในคลิกเดียว และกันไม่ให้ตั้งซ้ำถ้ารันมากกว่า 1 ครั้ง
 * (หมายเหตุ: ฟังก์ชันนี้ตั้งใจตั้งชื่อ "ไม่ลงท้ายด้วย _" เพื่อนเดียวกับ keepWarm — ฟังก์ชันที่ลงท้ายด้วย _ จะไม่โชว์ในเมนู Run/Triggers ของ Apps Script)
 */
function installKeepWarm() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
}

function output_(obj, callback) {
  // ใช้ JSONP (ส่งกลับเป็น <script> ที่เรียก callback) เพื่อเลี่ยงข้อจำกัด CORS
  // ของ Apps Script เวลาเรียกจากเว็บที่อยู่คนละโดเมน (เช่น GitHub Pages)
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------- Auth ---------------------------- */

// ใส่รหัสผ่านผิดติดกันเกินจำนวนนี้ บัญชีนั้นถูกล็อกชั่วคราว (กันการเดารหัสผ่านไปเรื่อย ๆ)
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_SEC = 900;
const DEFAULT_PASSWORD = 'changeme123';

function login_(payload) {
  const username = String(payload.username === undefined || payload.username === null ? '' : payload.username);
  const password = String(payload.password === undefined || payload.password === null ? '' : payload.password);
  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail_' + username.toLowerCase().slice(0, 80);
  let fails = 0;
  try { fails = Number(cache.get(failKey) || 0); } catch (e) { /* แคชใช้ไม่ได้ก็ไม่ล็อก */ }
  if (fails >= LOGIN_MAX_FAILS) return { ok: false, error: 'ใส่รหัสผ่านผิดหลายครั้ง บัญชีนี้ถูกล็อกชั่วคราว 15 นาที แล้วค่อยลองใหม่' };

  const rows = sheetData_(SHEET_USERS);
  const u = (username && password) ? rows.find(r => String(r.username) === username && String(r.password) === password) : null;
  if (!u) {
    try { cache.put(failKey, String(fails + 1), LOGIN_LOCK_SEC); } catch (e) { /* ไม่เป็นไร */ }
    return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }
  try { cache.remove(failKey); } catch (e) { /* ไม่เป็นไร */ }

  const exp = Date.now() + 1000 * 60 * 60 * 12; // token อายุ 12 ชม.
  const raw = `${u.username}|${u.role}|${exp}`;
  const sig = sign_(raw);
  return {
    ok: true,
    token: `${raw}|${sig}`,
    role: u.role,
    displayName: u.displayName,
    // ยังใช้รหัสผ่านเริ่มต้นหรือสั้นเกินไป: หน้าเว็บจะเตือนให้เปลี่ยน
    weakPassword: password === DEFAULT_PASSWORD || password.length < 8
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

let _sheetCache_ = {};
const CACHED_SHEETS_ = [SHEET_SCHEDULE, SHEET_SCHEDULE_SLOTS, SHEET_CLOSED, SHEET_USERS, SHEET_CLINIC_TYPES, SHEET_CLINIC_DAYS, SHEET_CLINIC_RULES, SHEET_SPECIAL_OPEN, SHEET_SPECIAL_SLOTS, SHEET_ICD10, SHEET_ICD9, SHEET_EXTRA_SLOTS, SHEET_BUSY_RULES]; // ชีตที่เปลี่ยนไม่บ่อย เก็บแคชข้ามคำขอได้เพื่อความเร็ว
const CACHE_TTL_SEC_ = 1800; // 30 นาที (ข้อมูลกลุ่มนี้เปลี่ยนไม่บ่อย และมีการล้างแคชทันทีทุกครั้งที่มีการแก้ไขอยู่แล้ว)

function sheetData_(name) {
  if (_sheetCache_[name]) return _sheetCache_[name]; // ลดการอ่านชีตซ้ำภายในคำขอเดียวกัน

  let data = null;
  const useServerCache = CACHED_SHEETS_.indexOf(name) !== -1;
  if (useServerCache) {
    try {
      const cached = CacheService.getScriptCache().get('sheet_' + name);
      if (cached) data = JSON.parse(cached);
    } catch (e) { /* แคชใช้ไม่ได้ก็อ่านจากชีตตามปกติ */ }
  }

  if (!data) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    const values = sheet.getDataRange().getValues();
    const headers = values.shift();
    const TIME_FIELDS = ['openTime', 'closeTime', 'startTime', 'endTime'];
    data = values.map((row, i) => {
      const obj = {};
      headers.forEach((h, idx) => {
        let v = row[idx];
        // Google Sheets มักแปลงข้อความเวลาเช่น "08:30" ให้กลายเป็นค่า Date ให้เองอัตโนมัติ
        // ต้องแปลงกลับเป็นข้อความ "HH:mm" ทุกครั้งที่อ่าน มิเช่นนั้นโค้ดคำนวณช่วงเวลาจะพัง
        if (TIME_FIELDS.indexOf(h) !== -1 && v instanceof Date) {
          v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
        }
        obj[h] = v;
      });
      obj._row = i + 2; // เลขแถวจริงในชีต (1 = header)
      return obj;
    });
    if (useServerCache) {
      try { CacheService.getScriptCache().put('sheet_' + name, JSON.stringify(data), CACHE_TTL_SEC_); } catch (e) { /* ข้อมูลใหญ่เกินแคชได้ก็ข้ามไป */ }
    }
  }

  _sheetCache_[name] = data;
  return data;
}

function invalidateCache_(name) {
  delete _sheetCache_[name];
  if (CACHED_SHEETS_.indexOf(name) !== -1) {
    try { CacheService.getScriptCache().remove('sheet_' + name); } catch (e) { /* ไม่เป็นไร */ }
  }
}

function appendRow_(name, obj, headers) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  sheet.appendRow(headers.map(h => obj[h] !== undefined ? obj[h] : ''));
  invalidateCache_(name);
}

/**
 * เพิ่มแถวโดยวางค่าตาม "หัวคอลัมน์จริงในชีต" (ไม่อิงลำดับตายตัว) — ใช้กับชีตที่มีการเพิ่มคอลัมน์ภายหลัง เช่น ptn
 * textHeaders = คอลัมน์ที่ต้องเก็บเป็น "ข้อความ" ตามที่ส่งมาทุกตัวอักษร (เบอร์โทร รหัส ICD PTN)
 * ไม่ใช้ sheet.appendRow เพราะต้องตั้งรูปแบบช่องเป็นข้อความ "ก่อน" เขียนค่าทุกครั้ง จึงจะแน่ใจได้ว่าชีตไม่แปลง
 * "9339,9319" เป็นเลขตัวเดียว หรือตัดเลข 0 หน้าเบอร์โทร — ใช้ตัวล็อกกันสองคนบันทึกพร้อมกันแล้วเขียนทับแถวเดียวกัน
 */
function appendRowByHeaders_(name, obj, textHeaders) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    const row = sheet.getLastRow() + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    (textHeaders || []).forEach(h => {
      const i = headers.indexOf(h);
      if (i !== -1) sheet.getRange(row, i + 1).setNumberFormat('@');
    });
    sheet.getRange(row, 1, 1, headers.length)
      .setValues([headers.map(h => (h !== '' && obj[h] !== undefined) ? obj[h] : '')]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  invalidateCache_(name);
}

/** เขียนค่า 1 ช่องเป็นข้อความเสมอ (ตั้งรูปแบบช่องเป็นข้อความก่อนเขียน) */
function setTextCell_(sheet, row, header, value) {
  sheet.getRange(row, colIndex_(sheet, header)).setNumberFormat('@').setValue(String(value === undefined || value === null ? '' : value));
}
const APPT_TEXT_HEADERS = ['phone', 'icd10', 'icd9', 'ptn'];

function deleteRow_(name, rowIndex) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name).deleteRow(rowIndex);
  invalidateCache_(name);
}

function fmtDate_(d) {
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------------------------- วันหยุดราชการ (sync) ---------------------------- */
// ดึงจาก "ไฟล์ ICS สาธารณะ" ของปฏิทินวันหยุดไทยของ Google โดยตรงผ่าน UrlFetchApp
// (ไม่ใช้ CalendarApp.getCalendarById เพราะวิธีนั้นต้องให้บัญชีเจ้าของสเปรดชีต "สมัครรับ" ปฏิทินนั้นไว้ก่อนเท่านั้นถึงจะหาเจอ
//  ทำให้สับสน/พังง่ายถ้าใช้คนละบัญชีหรือยังไม่เคยเพิ่ม ส่วนไฟล์ ICS สาธารณะเปิดอ่านได้เลยไม่ต้องสมัครรับ)

function parseIcsHolidayEvents_(icsText) {
  const events = [];
  const blocks = icsText.split('BEGIN:VEVENT').slice(1);
  blocks.forEach(block => {
    const dateMatch = block.match(/DTSTART;VALUE=DATE:(\d{8})/);
    const summaryMatch = block.match(/SUMMARY:(.*)/);
    if (!dateMatch) return;
    const raw = dateMatch[1]; // YYYYMMDD
    const dateStr = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    const title = summaryMatch ? summaryMatch[1].trim().replace(/\\,/g, ',') : 'วันหยุดราชการ';
    events.push({ date: dateStr, title: title });
  });
  return events;
}

function syncHolidays_(payload) {
  const year = Number(payload && payload.year) || new Date().getFullYear();
  const icsUrl = 'https://calendar.google.com/calendar/ical/en.thai%23holiday%40group.v.calendar.google.com/public/basic.ics';
  // บาง endpoint ของ Google เองก็บล็อก request ที่ขึ้น User-Agent เป็น "Google-Apps-Script" แบบ default
  // ใส่ User-Agent แบบเบราว์เซอร์ทั่วไปไปด้วยเพื่อเลี่ยงการถูกบล็อก และลองซ้ำ 1 ครั้งเผื่อเป็นปัญหาชั่วคราว (เช่น 500)
  const fetchOpts = {
    muteHttpExceptions: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
  };
  let allEvents;
  try {
    let resp = UrlFetchApp.fetch(icsUrl, fetchOpts);
    if (resp.getResponseCode() >= 500) {
      Utilities.sleep(1000);
      resp = UrlFetchApp.fetch(icsUrl, fetchOpts); // ลองซ้ำอีก 1 ครั้งเผื่อเป็นปัญหาชั่วคราวฝั่งเซิร์ฟเวอร์
    }
    if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());
    allEvents = parseIcsHolidayEvents_(resp.getContentText());
  } catch (e) {
    return { ok: false, error: 'เชื่อมต่อปฏิทินวันหยุดราชการไม่สำเร็จ (' + e.message + ')' };
  }
  const events = allEvents.filter(ev => ev.date.indexOf(String(year)) === 0);

  const existingDates = sheetData_(SHEET_CLOSED).map(r => fmtDate_(r.date));
  const seen = {};
  const toAdd = events.filter(ev => {
    if (existingDates.indexOf(ev.date) !== -1) return false; // มีอยู่แล้วในชีต
    if (seen[ev.date]) return false; // กันกรณี ICS มีวันซ้ำ (เช่นสงกรานต์หลายรายการ)
    seen[ev.date] = true;
    return true;
  });

  // เขียนทีเดียวเป็นแถวต่อเนื่อง (ไม่ loop เขียนทีละแถว) เพื่อความเร็ว — ลด API call จาก N ครั้งเหลือครั้งเดียว
  if (toAdd.length) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLOSED);
    const startRow = sheet.getLastRow() + 1;
    const values = toAdd.map(ev => [ev.date, ev.title]);
    sheet.getRange(startRow, 1, values.length, 2).setValues(values);
    invalidateCache_(SHEET_CLOSED);
    bumpCalendarVersion_();
  }
  const added = toAdd.length;
  return { ok: true, added: added, totalFound: events.length, year: year };
}

/* ---------------------------- Schedule ---------------------------- */

/**
 * รวมข้อมูลตั้งต้นทั้งหมดของหน้า "ตั้งค่า" ไว้ในคำขอเดียว (แทนที่จะแยกยิง 7 คำขอ)
 * เพราะข้อมูลแต่ละชุดถูกอ่านจากแคช/ชีตแบบเบาอยู่แล้ว ส่วนที่หนักจริงๆ คือค่าใช้จ่ายในการ "ยิงคำขอ" แต่ละครั้งไปกลับ
 * (การเชื่อมต่อ Apps Script Web App แต่ละครั้งมีค่าใช้จ่ายคงที่พอสมควร) รวมเป็นคำขอเดียวจึงเร็วขึ้นมากตอนเปิดหน้านี้ครั้งแรก
 */
function getSettingsBundle_() {
  return {
    ok: true,
    data: {
      schedule: getSchedule_().data,
      closedDates: getClosedDates_().data,
      clinicTypes: getClinicTypes_().data,
      clinicRules: getClinicRules_().data,
      icd10: getIcd10Codes_().data,
      icd9: getIcd9Codes_().data,
      busyRules: getBusyRules_().data
    }
  };
}

function getSchedule_() {
  return {
    ok: true,
    data: {
      days: sheetData_(SHEET_SCHEDULE),
      slots: sheetData_(SHEET_SCHEDULE_SLOTS)
    }
  };
}

/**
 * บันทึกตารางเวลาทั้งหมดใหม่ทีเดียว (ทั้งวันเปิด-ปิด และรายการช่วงเวลาแบบกำหนดเอง)
 * payload.days = [{day, isOpen}, ...]
 * payload.slots = [{weekday, start, end}, ...] — รายการช่วงเวลาทั้งหมดของทุกวัน (แทนที่ของเก่าทั้งชุด)
 */
function setSchedule_(payload) {
  // กันข้อมูลเพี้ยน: ช่วงเวลาที่เวลาสิ้นสุด "ไม่มากกว่า" เวลาเริ่ม (เช่น เผลอเลื่อนนาฬิกาเกินเที่ยงคืนไปเป็น 00:00) ห้ามบันทึก
  // เพราะจะทำให้ระบบเทียบเวลาทับซ้อนผิดพลาดไปทั้งหมด (ช่องที่ควรปิดจะกลายเป็นว่างแทน) — เคยเกิดปัญหานี้มาแล้วจริง
  const badSlot = (payload.slots || []).find(s => !s.start || !s.end || s.start >= s.end);
  if (badSlot) {
    return { ok: false, error: `ช่วงเวลา "${badSlot.start || '?'}-${badSlot.end || '?'}" ไม่ถูกต้อง (เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม) กรุณาตรวจสอบและแก้ไขก่อนบันทึก` };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHEDULE);
  const rows = sheetData_(SHEET_SCHEDULE); // อ่านครั้งเดียว ไม่อ่านซ้ำในลูป (จุดที่ทำให้ช้า)
  (payload.days || []).forEach(d => {
    const match = rows.find(r => Number(r.day) === Number(d.day));
    if (!match) return;
    sheet.getRange(match._row, 1, 1, 2).setValues([[d.day, d.isOpen]]);
  });
  invalidateCache_(SHEET_SCHEDULE);

  // แทนที่รายการช่วงเวลาทั้งหมดใหม่ทั้งชีต (ลบของเก่าทิ้งแล้วเขียนใหม่ทั้งหมด ง่ายและชัวร์กว่าการไล่ upsert ทีละแถว)
  const slotsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHEDULE_SLOTS);
  const lastRow = slotsSheet.getLastRow();
  if (lastRow > 1) slotsSheet.getRange(2, 1, lastRow - 1, slotsSheet.getLastColumn()).clearContent();
  const slotRows = (payload.slots || []).map(s => [Utilities.getUuid(), s.weekday, s.start, s.end]);
  if (slotRows.length) slotsSheet.getRange(2, 1, slotRows.length, 4).setValues(slotRows);
  invalidateCache_(SHEET_SCHEDULE_SLOTS);

  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- Closed dates ---------------------------- */

function getClosedDates_() {
  return { ok: true, data: sheetData_(SHEET_CLOSED).map(r => ({ ...r, date: fmtDate_(r.date) })) };
}

function addClosedDate_(payload) {
  appendRow_(SHEET_CLOSED, { date: payload.date, reason: payload.reason || '' }, ['date', 'reason']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClosedDate_(payload) {
  const rows = sheetData_(SHEET_CLOSED);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_CLOSED, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- Busy (นักกายภาพไม่ว่าง) ---------------------------- */

function addBusy_(payload) {
  if (!payload.startTime || !payload.endTime || payload.startTime >= payload.endTime) {
    return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด กรุณาตรวจสอบเวลาที่กรอก' };
  }
  appendRow_(SHEET_BUSY, {
    id: Utilities.getUuid(),
    date: payload.date,
    startTime: payload.startTime,
    endTime: payload.endTime,
    type: payload.type,
    note: payload.note || ''
  }, ['id', 'date', 'startTime', 'endTime', 'type', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeBusy_(payload) {
  const rows = sheetData_(SHEET_BUSY);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_BUSY, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขช่วงไม่ว่างที่เพิ่มไว้แล้ว (payload: {id, date, startTime, endTime, type, note}) — รายการที่มาจาก "กฎอัตโนมัติ" แก้ตรงนี้ไม่ได้ ต้องไปแก้ที่หน้าตั้งค่า */
function updateBusy_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบรายการที่จะแก้ไข' };
  if (!payload.startTime || !payload.endTime || payload.startTime >= payload.endTime) {
    return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด กรุณาตรวจสอบเวลาที่กรอก' };
  }
  const rows = sheetData_(SHEET_BUSY);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบรายการที่จะแก้ไข (อาจถูกลบไปแล้ว)' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BUSY);
  sheet.getRange(match._row, colIndex_(sheet, 'date')).setValue(payload.date);
  sheet.getRange(match._row, colIndex_(sheet, 'startTime')).setValue(payload.startTime);
  sheet.getRange(match._row, colIndex_(sheet, 'endTime')).setValue(payload.endTime);
  sheet.getRange(match._row, colIndex_(sheet, 'type')).setValue(payload.type);
  sheet.getRange(match._row, colIndex_(sheet, 'note')).setValue(payload.note || '');
  invalidateCache_(SHEET_BUSY);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- ประเภทคลินิกประจำวัน ---------------------------- */

function getClinicTypes_() {
  return { ok: true, data: sheetData_(SHEET_CLINIC_TYPES) };
}

function addClinicType_(payload) {
  if (!payload.name) return { ok: false, error: 'กรุณากรอกชื่อคลินิก' };
  appendRow_(SHEET_CLINIC_TYPES, {
    id: Utilities.getUuid(),
    name: payload.name,
    color: payload.color || '#2B6E63'
  }, ['id', 'name', 'color']);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขชื่อ/สีของประเภทคลินิก (id เดิม จึงไม่กระทบวันที่/กฎที่ผูกไว้) */
function updateClinicType_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบคลินิกที่จะแก้ไข' };
  if (!payload.name) return { ok: false, error: 'กรุณากรอกชื่อคลินิก' };
  const match = sheetData_(SHEET_CLINIC_TYPES).find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบคลินิกที่จะแก้ไข (อาจถูกลบไปแล้ว)' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_TYPES);
  sheet.getRange(match._row, colIndex_(sheet, 'name')).setValue(payload.name);
  sheet.getRange(match._row, colIndex_(sheet, 'color')).setValue(payload.color || '#2B6E63');
  invalidateCache_(SHEET_CLINIC_TYPES);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicType_(payload) {
  const rows = sheetData_(SHEET_CLINIC_TYPES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_CLINIC_TYPES, match._row);
  // ลบการกำหนดวันที่/กฎอัตโนมัติที่ผูกกับคลินิกนี้ทิ้งไปด้วย จะได้ไม่มีข้อมูลค้าง
  const dayRows = sheetData_(SHEET_CLINIC_DAYS).filter(r => r.clinicTypeId === payload.id);
  dayRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_CLINIC_DAYS, r._row));
  const ruleRows = sheetData_(SHEET_CLINIC_RULES).filter(r => r.clinicTypeId === payload.id);
  ruleRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_CLINIC_RULES, r._row));
  bumpCalendarVersion_();
  return { ok: true };
}

/** กำหนด/แก้ไขคลินิกประจำวันนั้น (upsert ตามวันที่) clinicTypeId เป็น '__NONE__' ได้ เพื่อบังคับ "ไม่มีคลินิก" เฉพาะวันนี้ แม้จะมีกฎอัตโนมัติตรงกันก็ตาม */
function setClinicDay_(payload) {
  if (!payload.date || !payload.clinicTypeId) return { ok: false, error: 'ข้อมูลไม่ครบ' };
  const rows = sheetData_(SHEET_CLINIC_DAYS);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_DAYS);
    sheet.getRange(match._row, 1, 1, 3).setValues([[payload.date, payload.clinicTypeId, payload.note || '']]);
    invalidateCache_(SHEET_CLINIC_DAYS);
  } else {
    appendRow_(SHEET_CLINIC_DAYS, { date: payload.date, clinicTypeId: payload.clinicTypeId, note: payload.note || '' }, ['date', 'clinicTypeId', 'note']);
  }
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicDay_(payload) {
  const rows = sheetData_(SHEET_CLINIC_DAYS);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_CLINIC_DAYS, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/* ---------------------------- กฎคลินิกอัตโนมัติ (ตามวันในสัปดาห์/เดือน) ---------------------------- */
// เช่น "คลินิกป้องกันล้ม ทุกวันอังคารที่ 4 ของเดือน" — ตั้งครั้งเดียว ระบบคำนวณให้ทุกเดือนเอง
// nth: 'every' = ทุกสัปดาห์, '1'-'4' = สัปดาห์ที่ 1-4 ของเดือน, 'last' = สัปดาห์สุดท้ายของเดือน

function getClinicRules_() {
  return { ok: true, data: sheetData_(SHEET_CLINIC_RULES) };
}

function addClinicRule_(payload) {
  if (!payload.clinicTypeId || payload.weekday === undefined || !payload.nth) {
    return { ok: false, error: 'ข้อมูลไม่ครบ' };
  }
  appendRow_(SHEET_CLINIC_RULES, {
    id: Utilities.getUuid(),
    clinicTypeId: payload.clinicTypeId,
    weekday: payload.weekday,
    nth: payload.nth,
    note: payload.note || ''
  }, ['id', 'clinicTypeId', 'weekday', 'nth', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไขกฎคลินิกอัตโนมัติ (เปลี่ยนคลินิก/วัน/สัปดาห์ที่/note) */
function updateClinicRule_(payload) {
  if (!payload.id) return { ok: false, error: 'ไม่พบกฎที่จะแก้ไข' };
  if (!payload.clinicTypeId || payload.weekday === undefined || !payload.nth) return { ok: false, error: 'ข้อมูลไม่ครบ' };
  const match = sheetData_(SHEET_CLINIC_RULES).find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบกฎที่จะแก้ไข (อาจถูกลบไปแล้ว)' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLINIC_RULES);
  sheet.getRange(match._row, colIndex_(sheet, 'clinicTypeId')).setValue(payload.clinicTypeId);
  sheet.getRange(match._row, colIndex_(sheet, 'weekday')).setValue(payload.weekday);
  sheet.getRange(match._row, colIndex_(sheet, 'nth')).setValue(payload.nth);
  sheet.getRange(match._row, colIndex_(sheet, 'note')).setValue(payload.note || '');
  invalidateCache_(SHEET_CLINIC_RULES);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeClinicRule_(payload) {
  const rows = sheetData_(SHEET_CLINIC_RULES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_CLINIC_RULES, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** หาว่าวันที่นี้เป็น "ครั้งที่เท่าไหร่" ของวันในสัปดาห์นั้น ภายในเดือน และเป็นครั้งสุดท้ายหรือไม่ */
function weekdayOccurrenceInfo_(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfMonth = d.getDate();
  const occurrence = Math.floor((dayOfMonth - 1) / 7) + 1; // ครั้งที่ 1-5 ของวันในสัปดาห์นี้ภายในเดือน
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const isLast = (dayOfMonth + 7) > daysInMonth;
  return { weekday: d.getDay(), occurrence, isLast };
}

/**
 * หาคลินิกที่ควรแสดงสำหรับวันที่นี้ เรียงลำดับความสำคัญ:
 * 1) กำหนดไว้เฉพาะวันนั้นตรงๆ (ClinicDays) — override กฎอัตโนมัติเสมอ
 * 2) กฎอัตโนมัติ (ClinicRules) ที่ตรงกับวันในสัปดาห์ + ครั้งที่ในเดือน
 */
function resolveClinicForDate_(dateStr) {
  const clinicDay = sheetData_(SHEET_CLINIC_DAYS).find(r => fmtDate_(r.date) === dateStr);
  if (clinicDay) {
    if (clinicDay.clinicTypeId === '__NONE__') return null; // บังคับ "ไม่มีคลินิก" เฉพาะวันนี้ แม้มีกฎอัตโนมัติตรงกัน
    const type = sheetData_(SHEET_CLINIC_TYPES).find(c => c.id === clinicDay.clinicTypeId);
    return type ? { id: type.id, name: type.name, color: type.color, note: clinicDay.note, fromRule: false } : null;
  }

  const info = weekdayOccurrenceInfo_(dateStr);
  const rules = sheetData_(SHEET_CLINIC_RULES).filter(r => Number(r.weekday) === info.weekday);
  const match = rules.find(r =>
    r.nth === 'every' ||
    String(r.nth) === String(info.occurrence) ||
    (r.nth === 'last' && info.isLast)
  );
  if (match) {
    const type = sheetData_(SHEET_CLINIC_TYPES).find(c => c.id === match.clinicTypeId);
    return type ? { id: type.id, name: type.name, color: type.color, note: match.note || '', fromRule: true } : null;
  }
  return null;
}

/* ---------------------------- เปิดรับพิเศษ (override วันที่ปกติปิด) ---------------------------- */

/** payload.slots = [{start, end}, ...] — รายการช่วงเวลาที่กำหนดเองสำหรับวันนี้วันเดียว */
function addSpecialOpen_(payload) {
  if (!payload.date || !payload.slots || !payload.slots.length) return { ok: false, error: 'กรุณาระบุช่วงเวลาอย่างน้อย 1 ช่วง' };
  const badSlot = payload.slots.find(s => !s.start || !s.end || s.start >= s.end);
  if (badSlot) return { ok: false, error: `ช่วงเวลา "${badSlot.start || '?'}-${badSlot.end || '?'}" ไม่ถูกต้อง (เวลาสิ้นสุดต้องมากกว่าเวลาเริ่ม)` };

  // upsert แถวหลัก (date, note)
  const rows = sheetData_(SHEET_SPECIAL_OPEN);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SPECIAL_OPEN);
    sheet.getRange(match._row, 1, 1, 2).setValues([[payload.date, payload.note || '']]);
    invalidateCache_(SHEET_SPECIAL_OPEN);
  } else {
    appendRow_(SHEET_SPECIAL_OPEN, { date: payload.date, note: payload.note || '' }, ['date', 'note']);
  }

  // แทนที่ช่วงเวลาของวันนี้ใหม่ทั้งหมด (ลบของเดิมทิ้งก่อนแล้วค่อยเพิ่มใหม่)
  const existingSlots = sheetData_(SHEET_SPECIAL_SLOTS).filter(r => fmtDate_(r.date) === payload.date);
  existingSlots.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_SPECIAL_SLOTS, r._row));
  payload.slots.forEach(s => {
    appendRow_(SHEET_SPECIAL_SLOTS, { id: Utilities.getUuid(), date: payload.date, startTime: s.start, endTime: s.end }, ['id', 'date', 'startTime', 'endTime']);
  });

  bumpCalendarVersion_();
  return { ok: true };
}

function removeSpecialOpen_(payload) {
  const rows = sheetData_(SHEET_SPECIAL_OPEN);
  const match = rows.find(r => fmtDate_(r.date) === payload.date);
  if (match) deleteRow_(SHEET_SPECIAL_OPEN, match._row);
  const slotRows = sheetData_(SHEET_SPECIAL_SLOTS).filter(r => fmtDate_(r.date) === payload.date);
  slotRows.sort((a, b) => b._row - a._row).forEach(r => deleteRow_(SHEET_SPECIAL_SLOTS, r._row));
  bumpCalendarVersion_();
  return { ok: true };
}

/**
 * หาว่าวันที่ที่กำหนด "เปิด/ปิด" จริงๆ และมีช่วงเวลาอะไรบ้าง โดยเรียงลำดับความสำคัญ:
 * 1) เปิดรับพิเศษ (SpecialOpen) — override ทุกอย่าง แม้วันนั้นจะปิดตามตารางประจำสัปดาห์
 * 2) วันปิดเฉพาะกิจ/วันหยุด (ClosedDates)
 * 3) ตารางเวลาเปิด-ปิดประจำสัปดาห์ (Schedule + ScheduleSlots)
 * คืนค่า slotDefs = [{start, end}, ...] เรียงตามเวลา — ช่วงเวลาที่กำหนดเองไว้ ไม่ใช่การหารเท่าๆ กัน
 */
function resolveDayOpen_(date) {
  const sortSlots = arr => arr.slice().sort((a, b) => a.start < b.start ? -1 : (a.start > b.start ? 1 : 0));
  const dedupe = arr => { const seen = {}; return arr.filter(s => { const k = s.start + '-' + s.end; if (seen[k]) return false; seen[k] = true; return true; }); };

  let base;
  const special = sheetData_(SHEET_SPECIAL_OPEN).find(r => fmtDate_(r.date) === date);
  if (special) {
    const slotDefs = sheetData_(SHEET_SPECIAL_SLOTS)
      .filter(r => fmtDate_(r.date) === date)
      .map(r => ({ start: r.startTime, end: r.endTime }));
    base = { isOpen: true, slotDefs, source: 'special', note: special.note };
  } else {
    const closedRow = sheetData_(SHEET_CLOSED).find(r => fmtDate_(r.date) === date);
    if (closedRow) {
      base = { isOpen: false, reason: closedRow.reason, source: 'closed' };
    } else {
      const dow = new Date(date + 'T00:00:00').getDay();
      const sched = sheetData_(SHEET_SCHEDULE).find(r => Number(r.day) === dow);
      if (sched && sched.isOpen === true) {
        const slotDefs = sheetData_(SHEET_SCHEDULE_SLOTS)
          .filter(r => Number(r.weekday) === dow)
          .map(r => ({ start: r.startTime, end: r.endTime }));
        base = { isOpen: true, slotDefs, source: 'weekly' };
      } else {
        base = { isOpen: false, source: 'weekly' };
      }
    }
  }

  // กฎปิดอัตโนมัติตามวันที่ในเดือน (เช่น ปิดทั้งวันทุกวันสิ้นเดือน) — มีผลเหนือตารางประจำสัปดาห์ แต่ไม่เหนือ "เปิดรับพิเศษ"
  if (base.source !== 'special') {
    const recurringReason = getRecurringClosedReason_(date);
    if (recurringReason && base.isOpen) {
      base = { isOpen: false, reason: recurringReason, source: 'recurringClosed' };
    }
  }

  // ช่วงเวลาพิเศษเสริม (ExtraSlots) — เพิ่มเติมเข้าไปจากตารางปกติเฉพาะวันนั้นวันเดียว ไม่ไปแก้ตารางประจำสัปดาห์
  // ถ้าวันนั้นปิดอยู่ แต่มีการเพิ่มช่วงเวลาพิเศษไว้ ให้ถือว่าเปิดเฉพาะช่วงที่เพิ่มนั้น
  const extra = sheetData_(SHEET_EXTRA_SLOTS)
    .filter(r => fmtDate_(r.date) === date)
    .map(r => ({ start: r.startTime, end: r.endTime }));
  if (extra.length) {
    const merged = sortSlots(dedupe((base.isOpen ? base.slotDefs : []).concat(extra)));
    return Object.assign({}, base, { isOpen: true, slotDefs: merged, hasExtraSlots: true });
  }
  if (base.isOpen) base.slotDefs = sortSlots(base.slotDefs);
  return base;
}

/* ---------------------------- ปิด/ไม่ว่างอัตโนมัติ (ตามวันที่ในเดือน) ---------------------------- */
// ต่างจาก ClinicRules (ตามวันในสัปดาห์) ตรงนี้ยึดตาม "วันที่" ของเดือน เช่น วันที่ 1, วันสุดท้ายของเดือน
// dayOfMonth: '1'-'31' หรือ 'last' (วันสุดท้ายของเดือนนั้นๆ)
// ถ้าไม่ระบุ startTime/endTime (ว่างทั้งคู่) = ปิดทั้งวัน; ถ้าระบุ = บล็อกเฉพาะช่วงเวลานั้น (เหมือนตั้งไม่ว่าง)

function getBusyRules_() {
  return { ok: true, data: sheetData_(SHEET_BUSY_RULES) };
}

function addBusyRule_(payload) {
  const patternType = payload.patternType === 'weekday' ? 'weekday' : 'dom';
  if (patternType === 'dom' && !payload.dayOfMonth) return { ok: false, error: 'กรุณาระบุวันที่ในเดือน' };
  if (patternType === 'weekday' && (payload.weekday === undefined || payload.weekday === '' || !payload.nth)) {
    return { ok: false, error: 'กรุณาระบุวันในสัปดาห์และความถี่' };
  }
  const hasRange = payload.startTime && payload.endTime;
  if (hasRange && payload.startTime >= payload.endTime) return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด' };
  appendRow_(SHEET_BUSY_RULES, {
    id: Utilities.getUuid(),
    patternType: patternType,
    dayOfMonth: patternType === 'dom' ? payload.dayOfMonth : '',
    weekday: patternType === 'weekday' ? payload.weekday : '',
    nth: patternType === 'weekday' ? payload.nth : '',
    startTime: hasRange ? payload.startTime : '',
    endTime: hasRange ? payload.endTime : '',
    type: payload.type || 'ประชุม',
    note: payload.note || ''
  }, ['id', 'patternType', 'dayOfMonth', 'weekday', 'nth', 'startTime', 'endTime', 'type', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeBusyRule_(payload) {
  const rows = sheetData_(SHEET_BUSY_RULES);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_BUSY_RULES, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** วันที่นี้ตรงกับเงื่อนไข "วันที่ X ของเดือน" หรือ "วันสุดท้ายของเดือน" หรือไม่ */
function matchesDayOfMonth_(ruleValue, dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (String(ruleValue) === 'last') {
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === daysInMonth;
  }
  return Number(ruleValue) === d.getDate();
}

/** วันที่นี้ตรงกับกฎหรือไม่ รองรับทั้งแบบ "วันที่ X ในเดือน" (dom) และ "วันในสัปดาห์ + ความถี่" (weekday) เหมือนกฎคลินิกอัตโนมัติ */
function matchesBusyRule_(rule, dateStr) {
  if (rule.patternType === 'weekday') {
    const info = weekdayOccurrenceInfo_(dateStr);
    if (Number(rule.weekday) !== info.weekday) return false;
    return rule.nth === 'every' || String(rule.nth) === String(info.occurrence) || (rule.nth === 'last' && info.isLast);
  }
  return matchesDayOfMonth_(rule.dayOfMonth, dateStr);
}

/** เหตุผลวันปิดทั้งวันจากกฎอัตโนมัติ (ถ้ามีมากกว่า 1 กฎตรงกัน จะรวมข้อความ) หรือ null ถ้าไม่มี */
function getRecurringClosedReason_(dateStr) {
  const rules = sheetData_(SHEET_BUSY_RULES).filter(r => !r.startTime && matchesBusyRule_(r, dateStr));
  if (!rules.length) return null;
  return rules.map(r => r.note || r.type || 'ปิดประจำเดือน').join(', ');
}

/** ช่วงเวลาไม่ว่างจากกฎอัตโนมัติที่ตรงกับวันนี้ (รูปแบบเดียวกับแถวในชีต Busy) */
function getRecurringBusyBlocks_(dateStr) {
  return sheetData_(SHEET_BUSY_RULES)
    .filter(r => r.startTime && r.endTime && matchesBusyRule_(r, dateStr))
    .map(r => ({ id: 'rule-' + r.id, date: dateStr, startTime: r.startTime, endTime: r.endTime, type: r.type || 'ประชุม', note: r.note || '' }));
}

/** รวม Busy ของวันนั้น (ที่เพิ่มเองรายวัน) เข้ากับ Busy จากกฎอัตโนมัติ */
function getBusyForDate_(dateStr) {
  const direct = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === dateStr);
  return direct.concat(getRecurringBusyBlocks_(dateStr));
}

/* ---------------------------- ช่วงเวลาพิเศษเสริม (เฉพาะวันเดียว) ---------------------------- */
// ต่างจาก "เปิดรับพิเศษ" ตรงที่นี่คือ "เพิ่ม" ช่วงเวลาเข้าไปจากของเดิมที่มีอยู่แล้ว ไม่ใช่การเปิดวันทั้งวันใหม่

function addExtraSlot_(payload) {
  if (!payload.date || !payload.start || !payload.end) return { ok: false, error: 'กรุณาระบุวันที่และช่วงเวลา' };
  if (payload.start >= payload.end) return { ok: false, error: 'เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด' };
  appendRow_(SHEET_EXTRA_SLOTS, {
    id: Utilities.getUuid(), date: payload.date, startTime: payload.start, endTime: payload.end, note: payload.note || ''
  }, ['id', 'date', 'startTime', 'endTime', 'note']);
  bumpCalendarVersion_();
  return { ok: true };
}

function removeExtraSlot_(payload) {
  const rows = sheetData_(SHEET_EXTRA_SLOTS);
  const match = rows.find(r => r.id === payload.id);
  if (match) deleteRow_(SHEET_EXTRA_SLOTS, match._row);
  bumpCalendarVersion_();
  return { ok: true };
}

/** แก้ไข/เพิ่มรหัส ICD ของนัดที่บันทึกไปแล้ว (payload: {id, icd10:[], icd9:[]}) — ทำได้แม้นัดนั้นผ่านไปแล้วหรือมาแล้ว ยกเว้นนัดที่ถูกยกเลิก */
function updateAppointmentIcd_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว แก้ไขรหัส ICD ไม่ได้' };

  const icd10 = icdInput_(payload.icd10, ICD10_AUTO_CODE);
  if (icd10.length > 2) return { ok: false, error: 'ระบุรหัส ICD-10 ได้ไม่เกิน 2 รหัส' };

  const icd9 = icdInput_(payload.icd9, ICD9_AUTO_CODE);
  if (icd9.length > 6) return { ok: false, error: 'ระบุรหัส ICD-9 ได้ไม่เกิน 6 รหัส' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['icd10', 'icd9']); // เผื่อยังไม่ได้รัน setupSheets ใหม่
  ensureApptTextColumns_(); // ไม่งั้น "9339,9319" จะถูกชีตแปลงเป็นเลขตัวเดียว
  setTextCell_(sheet, match._row, 'icd10', icd10.join(','));
  setTextCell_(sheet, match._row, 'icd9', icd9.join(','));
  invalidateCache_(SHEET_APPTS);
  return { ok: true };
}

/** แก้ไขเลขบัตรประชาชนของนัดที่บันทึกไปแล้ว (payload: {id, nationalId}) — เจ้าหน้าที่นัดก็แก้ได้ ไม่จำกัดแค่นักกายภาพ */
function updateAppointmentInfo_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' };

  const nid = String(payload.nationalId || '').trim();
  if (nid && !/^\d{13}$/.test(nid.replace(/-/g, ''))) {
    return { ok: false, error: 'เลขบัตรประชาชนต้องมี 13 หลัก' };
  }

  // แก้ไขได้ทุกช่อง: ประเภท/เวลา/ชื่อ/นามสกุล/หมู่/เบอร์/หมายเหตุ/เลขบัตร (ช่องไหนไม่ได้ส่งมา = ไม่แตะ ใช้ร่วมกับโค้ดเวอร์ชันเก่าที่ส่งแค่เลขบัตรได้)
  const has = k => payload[k] !== undefined;
  if (has('type') && APPT_TYPES.indexOf(payload.type) === -1) return { ok: false, error: 'ประเภทนัดไม่ถูกต้อง' };
  if (has('firstName') && !String(payload.firstName).trim()) return { ok: false, error: 'กรุณากรอกชื่อ' };
  if (has('lastName') && !String(payload.lastName).trim()) return { ok: false, error: 'กรุณากรอกนามสกุล' };
  if (has('moo') && !String(payload.moo).trim()) return { ok: false, error: 'กรุณากรอกหมู่' };

  // เปลี่ยนเวลา: ตรวจว่าช่วงใหม่ว่างจริง (ไม่นับนัดนี้เองเป็นตัวชน)
  const timeChanged = has('startTime') && has('endTime') &&
    (payload.startTime !== match.startTime || payload.endTime !== match.endTime);
  if (timeChanged) {
    const check = isSlotAvailable_(fmtDate_(match.date), payload.startTime, payload.endTime, match.id);
    if (!check.ok) return check;
  }

  // ผูกนัดนี้กับทะเบียนคนไข้ใหม่ตามข้อมูลหลังแก้ไข (เช่น แก้ชื่อที่พิมพ์ผิด เติมเลขบัตร เปลี่ยนเบอร์)
  const newFirst = has('firstName') ? payload.firstName : match.firstName;
  const newLast = has('lastName') ? payload.lastName : match.lastName;
  const link = linkPatient_({
    firstName: newFirst,
    lastName: newLast,
    nationalId: nid,
    phone: has('phone') ? payload.phone : match.phone,
    moo: has('moo') ? payload.moo : match.moo
  }, {
    oldPtn: match.ptn,
    apptId: match.id,
    date: fmtDate_(match.date),
    nameEdited: nameKey_(newFirst, newLast) !== nameKey_(match.firstName, match.lastName)
  });
  if (!link.ok) return link;
  ensureApptTextColumns_();

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  const set = (col, val) => sheet.getRange(match._row, colIndex_(sheet, col)).setValue(val);
  if (String(match.ptn || '') !== link.ptn) setTextCell_(sheet, match._row, 'ptn', link.ptn);
  set('nationalId', nid);
  if (has('type')) set('type', payload.type);
  if (timeChanged) { set('startTime', payload.startTime); set('endTime', payload.endTime); }
  if (has('firstName')) set('firstName', String(payload.firstName).trim());
  if (has('lastName')) set('lastName', String(payload.lastName).trim());
  if (has('moo')) set('moo', String(payload.moo).trim());
  if (has('phone')) setTextCell_(sheet, match._row, 'phone', String(payload.phone || '').trim());
  if (has('note')) set('note', String(payload.note || '').trim());
  invalidateCache_(SHEET_APPTS);
  bumpCalendarVersion_();
  return { ok: true, ptn: link.ptn, isNewPatient: link.isNew, patient: link.patient };
}

/* ---------------------------- รหัส ICD-10 / ICD-9 ---------------------------- */
// ช่องแรกของแต่ละประเภทถูกล็อกเป็นรหัสอัตโนมัติ (isAuto=true) เสมอ ช่องที่เหลือเลือกจากรายการนี้เอง
//
// ปัญหาที่ต้องระวัง: Google Sheet แปลงข้อความที่มีแต่ตัวเลขกับจุลภาคเป็น "ตัวเลข" ให้เอง
// รหัส ICD-9 หลายรหัสที่บันทึกเป็น "9339,9319" จึงกลายเป็นเลขตัวเดียว 93399319 (จุลภาคที่คั่นรหัสหาย)
// และรหัสในชีตรายการรหัสก็กลายเป็นตัวเลข ทำให้หน้าเว็บเทียบกับรหัสที่เลือกไว้ไม่ตรง
// วิธีแก้: 1) ตั้งคอลัมน์เป็น "ข้อความธรรมดา" ก่อนเขียน (ensureApptTextColumns_) ข้อมูลใหม่จึงไม่ถูกแปลง
//          2) ตอนอ่าน แปลงค่าที่เคยถูกรวมเป็นเลขตัวเดียวกลับเป็นรายการรหัส (icdCodes_) โดยไม่แก้ข้อมูลเดิมในชีต

/** ตั้งคอลัมน์เบอร์โทร/รหัส ICD/PTN ของชีตนัดเป็นข้อความธรรมดา (ทำครั้งเดียว ข้อมูลเดิมในชีตไม่ถูกแก้) */
function ensureApptTextColumns_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('APPT_TEXT_COLS') === '1') return;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['icd10', 'icd9', 'ptn']);
  ['phone', 'icd10', 'icd9', 'ptn'].forEach(h => {
    sheet.getRange(1, colIndex_(sheet, h), sheet.getMaxRows(), 1).setNumberFormat('@');
  });
  props.setProperty('APPT_TEXT_COLS', '1');
}

/**
 * รายการรหัสจากชีตรหัส โดยให้ code เป็นข้อความเสมอ (ในชีตอาจถูกเก็บเป็นตัวเลข เช่น 9339)
 * รหัสอัตโนมัติ (Z501 / 9339) ถือเป็น isAuto เสมอแม้ช่อง isAuto ในชีตจะไม่ใช่ TRUE และถ้ามีซ้ำในรายการจะส่งไปแถวเดียว
 * ไม่งั้นรหัสอัตโนมัติจะไปโผล่เป็นตัวเลือกในช่องที่ 2 เป็นต้นไป แล้วถูกเลือกซ้ำได้
 */
function icdCodeList_(sheetName) {
  const autoCode = sheetName === SHEET_ICD10 ? ICD10_AUTO_CODE : (sheetName === SHEET_ICD9 ? ICD9_AUTO_CODE : '');
  let seenAuto = false;
  const out = [];
  sheetData_(sheetName).forEach(r => {
    const code = normText_(r.code);
    if (!code) return;
    const isAuto = code === autoCode || r.isAuto === true || String(r.isAuto).toLowerCase() === 'true';
    if (code === autoCode) { if (seenAuto) return; seenAuto = true; }
    out.push(Object.assign({}, r, { code: code, isAuto: isAuto }));
  });
  return out;
}

/** รหัสที่หน้าเว็บส่งมาตอนบันทึก -> รายการที่จะเก็บ: รหัสอัตโนมัติอยู่ช่องแรกเสมอ ไม่ซ้ำ ไม่มีค่าว่าง */
function icdInput_(codes, autoCode) {
  const out = [autoCode];
  (Array.isArray(codes) ? codes : []).forEach(c => {
    const v = normText_(c);
    if (v && out.indexOf(v) === -1) out.push(v);
  });
  return out;
}

/** แบ่งข้อความตัวเลขยาวๆ ออกเป็นรหัสที่รู้จัก — คืนผลเฉพาะเมื่อแบ่งได้แบบเดียวเท่านั้น (ไม่กำกวม) */
function segmentCodes_(s, known) {
  const results = [];
  const walk = (pos, acc) => {
    if (results.length > 1) return;
    if (pos === s.length) { results.push(acc.slice()); return; }
    known.forEach(k => {
      if (k && s.substr(pos, k.length) === k) { acc.push(k); walk(pos + k.length, acc); acc.pop(); }
    });
  };
  walk(0, []);
  return results.length === 1 ? results[0] : null;
}

/**
 * แปลงค่าในคอลัมน์ icd10/icd9 ของนัดเป็นรายการรหัส (ข้อความ)
 * known = รหัสที่มีในชีตรายการรหัส ใช้กู้รหัส ICD-9 ที่ถูกชีตรวมเป็นเลขตัวเดียว (ส่งมาเฉพาะ ICD-9)
 * กู้ได้เมื่อรวมกันไม่เกิน 15 หลัก (ประมาณ 3 รหัส) เกินกว่านั้นชีตเก็บตัวเลขไม่ครบ กู้คืนไม่ได้ จะคืนค่าตามที่เห็นในชีต
 */
function icdCodes_(value, known) {
  const s = normText_(value);
  if (!s) return [];
  if (s.indexOf(',') !== -1) return s.split(',').map(x => x.trim()).filter(Boolean);
  if (known && /^\d+$/.test(s) && s.length > 4 && s.length <= 15 && known.indexOf(s) === -1) {
    const seg = segmentCodes_(s, known.filter(k => /^\d+$/.test(k)));
    if (seg) return seg;
    if (s.length % 4 === 0) return s.match(/\d{4}/g); // รหัสหัตถการ ICD-9 ที่ใช้กันเป็นเลข 4 หลัก
  }
  return [s];
}
function knownIcd9_() {
  return icdCodeList_(SHEET_ICD9).map(r => r.code).filter(Boolean);
}
/** สำเนาของแถวนัดที่ส่งให้หน้าเว็บ: รหัส ICD และเบอร์โทรเป็นข้อความที่ถูกต้องเสมอ */
function apptForClient_(a, known9) {
  return Object.assign({}, a, {
    icd10: icdCodes_(a.icd10).join(','),
    icd9: icdCodes_(a.icd9, known9).join(','),
    phone: normPhone_(a.phone),
    ptn: normText_(a.ptn)
  });
}

function getIcd10Codes_() {
  return { ok: true, data: icdCodeList_(SHEET_ICD10) };
}
function addIcd10Code_(payload) {
  if (!payload.code || !payload.label) return { ok: false, error: 'กรุณากรอกทั้งรหัสและคำอธิบาย' };
  appendRow_(SHEET_ICD10, { id: Utilities.getUuid(), code: payload.code, label: payload.label, isAuto: false }, ['id', 'code', 'label', 'isAuto']);
  return { ok: true };
}
function removeIcd10Code_(payload) {
  const rows = sheetData_(SHEET_ICD10);
  const match = rows.find(r => r.id === payload.id);
  if (match && match.isAuto === true) return { ok: false, error: 'ลบรหัสอัตโนมัติหลักไม่ได้' };
  if (match) deleteRow_(SHEET_ICD10, match._row);
  return { ok: true };
}

function getIcd9Codes_() {
  return { ok: true, data: icdCodeList_(SHEET_ICD9) };
}
function addIcd9Code_(payload) {
  if (!payload.code || !payload.label) return { ok: false, error: 'กรุณากรอกทั้งรหัสและคำอธิบาย' };
  appendRow_(SHEET_ICD9, { id: Utilities.getUuid(), code: payload.code, label: payload.label, isAuto: false }, ['id', 'code', 'label', 'isAuto']);
  return { ok: true };
}
function removeIcd9Code_(payload) {
  const rows = sheetData_(SHEET_ICD9);
  const match = rows.find(r => r.id === payload.id);
  if (match && match.isAuto === true) return { ok: false, error: 'ลบรหัสอัตโนมัติหลักไม่ได้' };
  if (match) deleteRow_(SHEET_ICD9, match._row);
  return { ok: true };
}

/* ---------------------------- ทะเบียนคนไข้ / PTN ---------------------------- */
// หลักการ: ข้อมูลที่ไม่ค่อยเปลี่ยนของคนไข้ (ชื่อ นามสกุล เลขบัตร เบอร์ หมู่) เก็บไว้ที่ชีต Patients ที่เดียว
// แต่ละนัดในชีต Appointments มีคอลัมน์ ptn ชี้กลับมาที่คนไข้คนนั้น — นับจำนวนครั้ง/ดูประวัติรายคนได้จาก ptn
// "คนเดียวกัน" ตัดสินจาก 1) PTN ที่ผู้ใช้กดเลือกเอง 2) เลขบัตรประชาชน 13 หลักตรงกัน 3) ชื่อ+นามสกุลตรงกันและมีอยู่คนเดียวในทะเบียน

/** สร้างชีต Patients และคอลัมน์ ptn ในชีต Appointments ถ้ายังไม่มี (เรียกซ้ำได้ ไม่กระทบข้อมูลเดิม) */
function ensurePatientInfra_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apptSheet = ss.getSheetByName(SHEET_APPTS);
  let sheet = ss.getSheetByName(SHEET_PATIENTS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PATIENTS);
    // ตั้งทั้งคอลัมน์เป็น "ข้อความธรรมดา" ก่อนใส่ข้อมูล ไม่งั้นเลข 0 นำหน้าเบอร์โทรจะหาย
    sheet.getRange(1, 1, sheet.getMaxRows(), PATIENT_HEADERS.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, PATIENT_HEADERS.length).setValues([PATIENT_HEADERS]);
    sheet.setFrozenRows(1);
    // เบอร์โทรในชีตนัดก็เช่นกัน: นัดที่ลงหลังจากนี้จะเก็บเป็นข้อความ เลข 0 นำหน้าไม่หาย (นัดเก่าไม่ถูกแก้)
    apptSheet.getRange(1, colIndex_(apptSheet, 'phone'), apptSheet.getMaxRows(), 1).setNumberFormat('@');
    invalidateCache_(SHEET_PATIENTS);
  }
  ensureColumns_(apptSheet, ['ptn']);
  return sheet;
}

function normText_(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
}
/** เลขบัตร 13 หลัก (ตัดขีด/ช่องว่างออก) ถ้าไม่ครบ 13 หลักคืนค่าว่าง */
function normNid_(v) {
  const d = String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
  return d.length === 13 ? d : '';
}
/** เบอร์โทร: เติมเลข 0 นำหน้ากลับให้เบอร์ที่ชีตเคยแปลงเป็นตัวเลขจนเลข 0 หาย (เช่น 860341397 -> 0860341397) */
function normPhone_(v) {
  let s = normText_(v);
  if (/^\d{8,9}$/.test(s) && s.charAt(0) !== '0') s = '0' + s;
  return s;
}
/** ค่าที่มีแต่เครื่องหมาย เช่น "." หรือ "-" (พิมพ์ไว้เพื่อให้ผ่านช่องบังคับกรอก) ไม่นับเป็นข้อมูลจริง */
function meaningful_(v) {
  const s = normText_(v);
  return /[0-9A-Za-z฀-๿]/.test(s) ? s : '';
}
function nameKey_(first, last) {
  return (normText_(first) + '|' + normText_(last)).toLowerCase();
}

/** ปี พ.ศ. 2 หลักของวันที่ 'yyyy-MM-dd' (ใช้เป็นปีใน PTN) — วันที่ไม่ถูกต้องใช้วันนี้แทน */
function ptnYear_(dateStr) {
  let s = String(dateStr === undefined || dateStr === null ? '' : dateStr);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) s = todayStr_();
  let be = Number(s.slice(0, 4)) + 543;
  if (PTN_FISCAL_YEAR && Number(s.slice(5, 7)) >= 10) be++;
  return ('0' + (be % 100)).slice(-2);
}
function formatPtn_(yy, n) {
  let s = String(n);
  while (s.length < PTN_DIGITS) s = '0' + s;
  return PTN_PREFIX + yy + '-' + s;
}
/** แยก PTN ที่มีปีเป็น { yy, n } — ถ้าไม่ใช่รูปแบบที่มีปี (เช่น PT00001 ของรุ่นก่อน) คืน null */
function parsePtn_(ptn) {
  const m = /^PTN(\d{2})-(\d+)$/.exec(normText_(ptn));
  return m ? { yy: m[1], n: Number(m[2]) } : null;
}
/** PTN เดียวกันในจำนวนหลักมาตรฐาน (PTN69-00001 -> PTN69-0001) — ปีและเลขลำดับไม่เปลี่ยน ถ้าไม่ใช่รูปแบบที่มีปีคืนค่าว่าง */
function canonPtn_(ptn) {
  const p = parsePtn_(ptn);
  return p ? formatPtn_(p.yy, p.n) : '';
}
/** เลขลำดับถัดไปของปี yy: ดูทั้งทะเบียนและ PTN ที่เคยใช้ในชีตนัด เลขที่เคยออกแล้วจะไม่ถูกนำกลับมาใช้กับคนอื่น */
function nextPtnNumber_(yy, patients, appts) {
  let max = 0;
  const see = v => { const p = parsePtn_(v); if (p && p.yy === yy && p.n > max) max = p.n; };
  patients.forEach(p => see(p.ptn));
  (appts || []).forEach(a => see(a.ptn));
  return max + 1;
}

/** อ่านทะเบียนคนไข้ทั้งหมด (ยังไม่มีชีต = ยังไม่มีคนไข้) */
function patientsData_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PATIENTS)) return [];
  return sheetData_(SHEET_PATIENTS).filter(p => normText_(p.ptn));
}

/** ข้อมูลคนไข้ที่ส่งให้หน้าเว็บ (เฉพาะช่องที่ใช้เติมในฟอร์มนัด) */
function publicPatient_(p) {
  return {
    ptn: normText_(p.ptn),
    firstName: normText_(p.firstName),
    lastName: normText_(p.lastName),
    nationalId: normNid_(p.nationalId) || normText_(p.nationalId),
    phone: normPhone_(p.phone),
    moo: normText_(p.moo)
  };
}

function getPatients_() {
  return { ok: true, data: patientsData_().map(publicPatient_) };
}

/**
 * สรุปประวัติของคนไข้ 1 คน สำหรับแสดงในฟอร์มนัดเมื่อเลือกคนไข้เดิม
 * payload: { ptn, date, startTime } — date/startTime = นัดที่กำลังจะลง ใช้หาว่า "ครั้งก่อน" คือครั้งไหน
 * payload.full = true (หน้าค้นหาคนไข้): history คือนัดทุกรายการของคนนี้รวมที่ยกเลิก พร้อมหมายเหตุ
 */
function getPatientSummary_(payload) {
  const ptn = normText_(payload.ptn);
  if (!ptn) return { ok: false, error: 'ไม่ได้ระบุ PTN' };
  const today = todayStr_();
  const known9 = knownIcd9_();
  const rows = [];
  sheetData_(SHEET_APPTS).forEach(a => {
    if (!a.id || !a.date || normText_(a.ptn) !== ptn) return;
    let date;
    try { date = fmtDate_(a.date); } catch (e) { return; }
    rows.push({
      date: date,
      startTime: normText_(a.startTime),
      endTime: normText_(a.endTime),
      type: a.type,
      status: a.status,
      attended: !!a.attendedAt,
      icd10: icdCodes_(a.icd10),
      icd9: icdCodes_(a.icd9, known9),
      note: normText_(a.note)
    });
  });
  const stamp = r => r.date + ' ' + r.startTime;
  rows.sort((x, y) => stamp(x) < stamp(y) ? 1 : (stamp(x) > stamp(y) ? -1 : 0)); // ใหม่สุดก่อน

  const active = rows.filter(r => r.status === 'active');
  const attended = active.filter(r => r.attended);
  const upcoming = active.filter(r => r.date >= today && !r.attended).reverse(); // ใกล้สุดก่อน
  // "ครั้งก่อน" = นัดล่าสุดที่อยู่ก่อนนัดที่กำลังจะลง
  const refDate = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date || '')) ? payload.date : today;
  const ref = refDate + ' ' + (normText_(payload.startTime) || '99:99');
  const previous = active.find(r => stamp(r) < ref) || null;
  const pick = r => ({ date: r.date, startTime: r.startTime, endTime: r.endTime, type: r.type, attended: r.attended, icd10: r.icd10, icd9: r.icd9 });
  const pickFull = r => Object.assign(pick(r), { status: r.status, note: r.note });
  const HISTORY_LIMIT = 300;
  const reg = patientsData_().find(p => normText_(p.ptn) === ptn);

  return {
    ok: true,
    data: {
      ptn: ptn,
      patient: reg ? publicPatient_(reg) : null,
      today: today,
      attendedCount: attended.length,
      appointmentCount: active.length,
      cancelledCount: rows.length - active.length,
      firstVisit: attended.length ? attended[attended.length - 1].date : '',
      lastVisit: attended.length ? attended[0].date : '',
      upcoming: upcoming.map(pick),
      previous: previous ? pick(previous) : null,
      history: payload.full === true ? rows.slice(0, HISTORY_LIMIT).map(pickFull) : active.slice(0, 5).map(pick),
      historyTotal: payload.full === true ? rows.length : active.length
    }
  };
}

/**
 * เขียนข้อมูลคนไข้ลงแถวที่ต่อเนื่องกัน เริ่มที่ startRow (เฉพาะคอลัมน์ของระบบ ไม่แตะคอลัมน์อื่นที่ผู้ใช้อาจเพิ่มเองในชีต)
 * เขียนเป็น "ข้อความธรรมดา" เสมอ เลข 0 นำหน้าเบอร์โทรจะได้ไม่หาย
 */
function writePatientRows_(sheet, startRow, recs) {
  if (!recs.length) return;
  const needRows = startRow + recs.length - 1 - sheet.getMaxRows();
  if (needRows > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needRows); // ชีตเต็มแล้ว: เพิ่มแถวให้พอก่อนเขียน
  const lastCol = Math.max(sheet.getLastColumn(), PATIENT_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const val = (rec, h) => String(rec[h] === undefined || rec[h] === null ? '' : rec[h]);
  if (PATIENT_HEADERS.every((h, i) => headers[i] === h)) {
    // คอลัมน์เรียงตามมาตรฐาน: เขียนทีเดียวทั้งก้อน (เร็วกว่าเขียนทีละช่องมาก)
    sheet.getRange(startRow, 1, recs.length, PATIENT_HEADERS.length)
      .setNumberFormat('@')
      .setValues(recs.map(rec => PATIENT_HEADERS.map(h => val(rec, h))));
  } else {
    recs.forEach((rec, r) => {
      PATIENT_HEADERS.forEach(h => {
        const i = headers.indexOf(h);
        if (i !== -1) sheet.getRange(startRow + r, i + 1).setNumberFormat('@').setValue(val(rec, h));
      });
    });
  }
  invalidateCache_(SHEET_PATIENTS);
}
function writePatientRow_(sheet, row, rec) {
  writePatientRows_(sheet, row, [rec]);
}

/** จำนวนนัด (ทุกสถานะ) ที่ผูกกับ PTN นี้ ไม่นับนัดที่ระบุใน excludeApptId */
function countApptsWithPtn_(ptn, excludeApptId) {
  return sheetData_(SHEET_APPTS).filter(a => a.id && String(a.ptn || '') === String(ptn) && a.id !== excludeApptId).length;
}

/**
 * หาคนไข้ในทะเบียนที่ตรงกับข้อมูลที่กรอก ถ้าไม่มีให้ออก PTN ใหม่ แล้วคืน PTN กลับไปผูกกับนัด
 * input: { firstName, lastName, nationalId, phone, moo }
 * opts.pickedPtn = PTN ที่ผู้ใช้กดเลือกจากรายชื่อคนไข้เดิมตอนทำนัดใหม่
 * opts.oldPtn / opts.apptId = PTN เดิมและ id ของนัดที่กำลังถูกแก้ไข
 *
 * ลำดับการตัดสิน:
 *  1) กดเลือกคนไข้เดิมมา -> ใช้คนนั้น (ถ้าเลขบัตรที่กรอกเป็นของอีกคนในทะเบียน จะแจ้งเตือนและไม่บันทึก)
 *  2) เลขบัตรตรงกับคนในทะเบียน -> คนนั้น
 *  3) (ตอนแก้ไขนัด) ไม่ได้แก้ชื่อ -> คนเดิมของนัดนี้ (ถือว่าเป็นการแก้เลขบัตร/เบอร์/หมู่ของคนนั้น)
 *  4) ชื่อ+นามสกุลตรงกับคนในทะเบียน "คนเดียว" และเลขบัตรไม่ขัดกัน -> คนนั้น
 *  5) (ตอนแก้ไขนัด) แก้ชื่อ และคนเดิมของนัดนี้ไม่มีนัดอื่นเลย -> แก้ทะเบียนของคนเดิมให้ตรงกับนัด (กรณีพิมพ์ชื่อผิดตอนลงนัดครั้งแรก)
 *  6) นอกนั้น -> คนไข้ใหม่ ออก PTN ถัดไป
 * ข้อมูลในทะเบียนจะถูกอัปเดตเบอร์/หมู่/เลขบัตรตามที่กรอกล่าสุด แต่ไม่ถูกทับด้วยค่าว่าง (ยกเว้นกรณีข้อ 5)
 * opts.nameEdited = true เมื่อผู้ใช้แก้ชื่อหรือนามสกุลของนัดในการบันทึกครั้งนี้
 * opts.date = วันที่ของนัด ('yyyy-MM-dd') ใช้กำหนดปีใน PTN เมื่อเป็นคนไข้ใหม่
 */
function linkPatient_(input, opts) {
  opts = opts || {};
  // opts.locked = true เมื่อผู้เรียกถือล็อกของสคริปต์อยู่แล้ว (syncAppSheet) — ไม่ล็อก/ปลดล็อกซ้ำ
  const lock = opts.locked === true ? null : LockService.getScriptLock();
  try {
    if (lock) lock.waitLock(15000); // กันสองเครื่องลงคนไข้ใหม่พร้อมกันแล้วได้ PTN ซ้ำ
  } catch (e) {
    return { ok: false, error: 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง' };
  }
  try {
    const sheet = ensurePatientInfra_();
    delete _sheetCache_[SHEET_PATIENTS]; // อ่านทะเบียนสดหลังได้ล็อก
    const patients = patientsData_();

    const first = normText_(input.firstName), last = normText_(input.lastName);
    const nid = normNid_(input.nationalId);
    const phone = normPhone_(meaningful_(input.phone));
    const moo = meaningful_(input.moo);
    const key = nameKey_(first, last);

    const byPtn = ptn => normText_(ptn) ? (patients.find(p => normText_(p.ptn) === normText_(ptn)) || null) : null;
    const idOwner = nid ? (patients.find(p => normNid_(p.nationalId) === nid) || null) : null;
    const picked = byPtn(opts.pickedPtn);
    const old = byPtn(opts.oldPtn);

    // rename = แก้ชื่อในทะเบียนตามที่กรอก, mirror = ทะเบียนของคนนี้มีแค่นัดนี้นัดเดียว ให้ข้อมูลในทะเบียนตรงกับนัดทุกช่อง
    let target = null, rename = false, mirror = false;
    if (picked) {
      if (idOwner && idOwner !== picked) {
        return { ok: false, error: 'เลขบัตรนี้อยู่ในทะเบียนของ ' + normText_(idOwner.ptn) + ' (' + normText_(idOwner.firstName) + ' ' + normText_(idOwner.lastName) + ') แล้ว กรุณาตรวจสอบเลขบัตร' };
      }
      target = picked;
    } else if (idOwner) {
      target = idOwner;
      rename = idOwner === old && opts.nameEdited === true; // เลขบัตรยืนยันว่าเป็นคนเดิม และผู้ใช้ตั้งใจแก้ชื่อ = แก้ตัวสะกดในทะเบียนด้วย
    } else if (old && (opts.nameEdited !== true || nameKey_(old.firstName, old.lastName) === key)) {
      target = old; // ไม่ได้เปลี่ยนชื่อ = ยังเป็นคนเดิม (เป็นการแก้เลขบัตร/เบอร์/หมู่ของคนนั้น)
    } else {
      // ชื่อตรงกัน และเลขบัตรไม่ขัดกัน (ฝั่งใดฝั่งหนึ่งยังไม่มีเลขบัตร) — ต้องเหลือคนเดียวเท่านั้นถึงจะถือว่าเป็นคนเดียวกัน
      const sameName = patients.filter(p => nameKey_(p.firstName, p.lastName) === key && (!nid || !normNid_(p.nationalId)));
      if (sameName.length === 1) {
        target = sameName[0];
      } else if (old && countApptsWithPtn_(old.ptn, opts.apptId) === 0) {
        target = old;
        mirror = true;
      }
    }

    const now = new Date().toISOString();
    if (!target) {
      const yy = ptnYear_(opts.date); // ปีของนัดแรก = ปีที่มาครั้งแรก
      const rec = {
        ptn: formatPtn_(yy, nextPtnNumber_(yy, patients, sheetData_(SHEET_APPTS))),
        firstName: first, lastName: last, nationalId: nid, phone: phone, moo: moo,
        createdAt: now, updatedAt: now
      };
      writePatientRow_(sheet, sheet.getLastRow() + 1, rec);
      return { ok: true, ptn: rec.ptn, isNew: true, patient: publicPatient_(rec) };
    }

    const cur = publicPatient_(target);
    const rec = {
      ptn: cur.ptn,
      firstName: (rename || mirror) ? first : cur.firstName,
      lastName: (rename || mirror) ? last : cur.lastName,
      nationalId: mirror ? nid : (nid || cur.nationalId),
      phone: mirror ? phone : (phone || cur.phone),
      moo: mirror ? moo : (moo || cur.moo),
      createdAt: normText_(target.createdAt) || now,
      updatedAt: now
    };
    const changed = ['firstName', 'lastName', 'nationalId', 'phone', 'moo'].some(k => rec[k] !== normText_(target[k]));
    if (changed) writePatientRow_(sheet, target._row, rec);
    return { ok: true, ptn: rec.ptn, isNew: false, patient: publicPatient_(rec) };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/**
 * รัน "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก setupPatients จาก dropdown ข้างปุ่ม "เรียกใช้" แล้วกด Run)
 * สิ่งที่ทำ: สร้างชีต Patients, ไล่ออก PTN ให้คนไข้จากนัดที่มีอยู่แล้ว (เรียงตามวันที่มาครั้งแรก), แล้วเติม PTN ลงคอลัมน์ ptn ของทุกนัด
 * PTN รูปแบบเก่า (PT00001 หรือ PTN69-00001) จะถูกแปลงเป็นรูปแบบปัจจุบัน (PTN69-0001) ทั้งในชีต Patients และในทุกนัด
 * รันซ้ำได้ปลอดภัย: คนที่มี PTN รูปแบบปัจจุบันแล้วจะไม่ถูกออกเลขใหม่ และนัดที่มี PTN ถูกต้องแล้วจะไม่ถูกแก้
 * (ชื่อฟังก์ชันไม่ลงท้ายด้วย _ เพื่อให้ขึ้นในรายการ Run)
 */
function setupPatients() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pSheet = ensurePatientInfra_();
    const aSheet = ss.getSheetByName(SHEET_APPTS);
    _sheetCache_ = {};

    const appts = sheetData_(SHEET_APPTS).filter(a => a.id);
    const dateOf = a => { try { return fmtDate_(a.date); } catch (e) { return ''; } };
    const stampOf = a => dateOf(a) + ' ' + (a.createdAt instanceof Date ? a.createdAt.toISOString() : normText_(a.createdAt));
    const ordered = appts.slice().sort((x, y) => stampOf(x) < stampOf(y) ? -1 : (stampOf(x) > stampOf(y) ? 1 : 0));

    // people = คนที่อยู่ในทะเบียนแล้ว + คนใหม่ที่พบจากนัด (ยังไม่มี ptn)
    const people = patientsData_().map(p => {
      const pub = publicPatient_(p);
      const created = p.createdAt instanceof Date ? p.createdAt.toISOString() : normText_(p.createdAt);
      return { ptn: pub.ptn, firstName: pub.firstName, lastName: pub.lastName, nid: normNid_(pub.nationalId), phone: pub.phone, moo: pub.moo, key: nameKey_(pub.firstName, pub.lastName), firstStamp: '', isNew: false, row: p._row, created: created };
    });
    const personOfAppt = {}; // id ของนัด -> คน
    const ambiguous = {};
    const newPerson = a => {
      const p = { ptn: '', firstName: normText_(a.firstName), lastName: normText_(a.lastName), nid: normNid_(a.nationalId), phone: '', moo: '', key: nameKey_(a.firstName, a.lastName), firstStamp: stampOf(a), isNew: true };
      people.push(p);
      return p;
    };
    const absorb = (p, a) => { // นัดถูกไล่จากเก่าไปใหม่ ค่าล่าสุดที่เป็นข้อมูลจริงจึงเป็นค่าที่เหลืออยู่
      personOfAppt[a.id] = p;
      if (!p.isNew) return;
      const ph = normPhone_(meaningful_(a.phone)), mo = meaningful_(a.moo);
      if (ph) p.phone = ph;
      if (mo) p.moo = mo;
      p.firstName = normText_(a.firstName);
      p.lastName = normText_(a.lastName);
      p.key = nameKey_(p.firstName, p.lastName);
    };

    const active = ordered.filter(a => a.status === 'active');
    // รอบ 0: นัดที่มี PTN อยู่แล้วและพบในทะเบียน
    active.forEach(a => {
      const p = normText_(a.ptn) ? people.find(x => x.ptn === normText_(a.ptn)) : null;
      if (p) personOfAppt[a.id] = p;
    });
    // รอบ 1: นัดที่มีเลขบัตร — เลขบัตรเดียวกัน = คนเดียวกัน
    active.forEach(a => {
      if (personOfAppt[a.id]) return;
      const nid = normNid_(a.nationalId);
      if (!nid) return;
      let p = people.find(x => x.nid === nid);
      if (!p) {
        const sameName = people.filter(x => x.key === nameKey_(a.firstName, a.lastName) && !x.nid);
        if (sameName.length === 1) { p = sameName[0]; p.nid = nid; }
      }
      absorb(p || newPerson(a), a);
    });
    // รอบ 2: นัดที่ไม่มีเลขบัตร — ชื่อ+นามสกุลตรงกับคนเดียวในทะเบียน = คนเดียวกัน
    active.forEach(a => {
      if (personOfAppt[a.id]) return;
      const key = nameKey_(a.firstName, a.lastName);
      const sameName = people.filter(x => x.key === key);
      let p = null;
      if (sameName.length === 1) p = sameName[0];
      else if (sameName.length > 1) {
        ambiguous[normText_(a.firstName) + ' ' + normText_(a.lastName)] = true;
        const noId = sameName.filter(x => !x.nid);
        if (noId.length === 1) p = noId[0];
      }
      absorb(p || newPerson(a), a);
    });

    // วันที่ของนัดแรกของแต่ละคน (นัดถูกเรียงจากเก่าไปใหม่แล้ว) ใช้ทั้งเรียงลำดับและกำหนดปีใน PTN
    people.forEach(p => { p.firstStamp = ''; });
    active.forEach(a => { const p = personOfAppt[a.id]; if (p && !p.firstStamp) p.firstStamp = stampOf(a); });
    const today = todayStr_();
    people.forEach(p => {
      if (!/^\d{4}-\d{2}-\d{2}/.test(p.firstStamp)) p.firstStamp = (/^\d{4}-\d{2}-\d{2}/.test(p.created) ? p.created.slice(0, 10) : today) + ' ~';
    });

    // ออก PTN ให้คนใหม่ และแปลง PTN รูปแบบเก่า (ของคนที่อยู่ในทะเบียนแล้ว) เป็นรูปแบบปัจจุบัน เรียงตามวันที่ของนัดแรก
    const needNumber = people.filter(p => !parsePtn_(p.ptn))
      .sort((x, y) => x.firstStamp < y.firstStamp ? -1 : (x.firstStamp > y.firstStamp ? 1 : 0));
    const nextOfYear = {};
    const remap = {}; // PTN รูปแบบเก่า -> PTN ใหม่
    needNumber.forEach(p => {
      const yy = ptnYear_(p.firstStamp.slice(0, 10));
      if (!nextOfYear[yy]) nextOfYear[yy] = nextPtnNumber_(yy, people, appts);
      const newPtn = formatPtn_(yy, nextOfYear[yy]++);
      if (p.ptn) remap[p.ptn] = newPtn;
      p.ptn = newPtn;
    });

    // PTN ที่มีปีแล้วแต่จำนวนหลักไม่ตรงมาตรฐาน: ปรับจำนวนหลักอย่างเดียว ปีและเลขลำดับคงเดิม
    const repadded = people.filter(p => needNumber.indexOf(p) === -1 && canonPtn_(p.ptn) !== p.ptn);
    repadded.forEach(p => { const c = canonPtn_(p.ptn); remap[p.ptn] = c; p.ptn = c; });

    const now = new Date().toISOString();
    const fresh = needNumber.filter(p => p.isNew);
    const converted = needNumber.filter(p => !p.isNew).concat(repadded);
    if (converted.length) { // แก้เฉพาะช่อง ptn ของแถวเดิมในชีต Patients
      const pCol = colIndex_(pSheet, 'ptn');
      const pRange = pSheet.getRange(2, pCol, pSheet.getLastRow() - 1, 1);
      const pValues = pRange.getValues();
      converted.forEach(p => { pValues[p.row - 2][0] = p.ptn; });
      pRange.setNumberFormat('@').setValues(pValues);
    }
    writePatientRows_(pSheet, pSheet.getLastRow() + 1, fresh.map(p => (
      { ptn: p.ptn, firstName: p.firstName, lastName: p.lastName, nationalId: p.nid, phone: p.phone, moo: p.moo, createdAt: now, updatedAt: now }
    )));

    // ใส่ PTN ลงคอลัมน์ ptn ของนัด: เติมช่องที่ยังว่าง และเปลี่ยน PTN รูปแบบเก่าเป็นรูปแบบปัจจุบัน
    // (นัดที่ยกเลิกแล้วและยังไม่มี PTN จะเติมให้เฉพาะเมื่อระบุคนได้ชัดเจน)
    const resolveCancelled = a => {
      const nid = normNid_(a.nationalId);
      if (nid) { const p = people.find(x => x.nid === nid); if (p) return p; }
      const sameName = people.filter(x => x.key === nameKey_(a.firstName, a.lastName) && (!nid || !x.nid));
      return sameName.length === 1 ? sameName[0] : null;
    };
    ensureApptTextColumns_();
    const lastRow = aSheet.getLastRow();
    let tagged = 0;
    if (lastRow > 1) {
      const col = colIndex_(aSheet, 'ptn');
      const range = aSheet.getRange(2, col, lastRow - 1, 1);
      const values = range.getValues();
      appts.forEach(a => {
        const i = a._row - 2;
        const cur = normText_(values[i][0]);
        let want = cur;
        if (personOfAppt[a.id]) want = personOfAppt[a.id].ptn;
        else if (cur && remap[cur]) want = remap[cur];
        else if (cur && canonPtn_(cur)) want = canonPtn_(cur);
        else if (!cur) { const p = resolveCancelled(a); want = p ? p.ptn : ''; }
        if (want && want !== cur) { values[i][0] = want; tagged++; }
      });
      range.setNumberFormat('@').setValues(values);
    }
    invalidateCache_(SHEET_APPTS);
    invalidateCache_(SHEET_PATIENTS);

    const total = people.length;
    const noId = people.filter(p => !p.nid).length;
    Logger.log('ออก PTN ใหม่ ' + fresh.length + ' คน · เปลี่ยนรูปแบบ PTN เดิม ' + converted.length + ' คน (รวมในทะเบียน ' + total + ' คน) · ใส่/แก้ PTN ในนัด ' + tagged + ' รายการ');
    Logger.log('คนไข้ที่ยังไม่มีเลขบัตรในทะเบียน ' + noId + ' คน (จับคู่ด้วยชื่อ+นามสกุลเท่านั้น)');
    const amb = Object.keys(ambiguous);
    if (amb.length) Logger.log('ชื่อซ้ำกันมากกว่า 1 คน ควรตรวจในชีต Patients: ' + amb.join(', '));
    Logger.log('เสร็จแล้ว! เปิดแท็บ Patients ในชีตเพื่อตรวจรายชื่อได้เลย');
  } finally {
    lock.releaseLock();
  }
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

  // ช่องแรกของ ICD-10/ICD-9 ล็อกเป็นรหัสอัตโนมัติเสมอ ไม่ว่าฝั่งหน้าเว็บจะส่งมาครบหรือไม่
  const icd10 = icdInput_(payload.icd10, ICD10_AUTO_CODE);
  if (icd10.length > 2) return { ok: false, error: 'ระบุรหัส ICD-10 ได้ไม่เกิน 2 รหัส' };

  const icd9 = icdInput_(payload.icd9, ICD9_AUTO_CODE);
  if (icd9.length > 6) return { ok: false, error: 'ระบุรหัส ICD-9 ได้ไม่เกิน 6 รหัส' };

  // หา/สร้างคนไข้ในทะเบียน แล้วผูก PTN เข้ากับนัดนี้ (payload.ptn = PTN ที่ผู้ใช้กดเลือกจากรายชื่อคนไข้เดิม ถ้ามี)
  const link = linkPatient_(payload, { pickedPtn: payload.ptn, date: payload.date });
  if (!link.ok) return link;
  ensureApptTextColumns_(); // รหัส ICD/เบอร์โทรต้องถูกเก็บเป็นข้อความ ไม่งั้นชีตจะแปลงเป็นตัวเลข

  appendRowByHeaders_(SHEET_APPTS, {
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
    status: 'active',
    icd10: icd10.join(','),
    icd9: icd9.join(','),
    ptn: link.ptn
  }, APPT_TEXT_HEADERS);

  bumpCalendarVersion_();
  return { ok: true, ptn: link.ptn, isNewPatient: link.isNew, patient: link.patient };
}

function cancelAppointment_(payload) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.attendedAt) {
    return { ok: false, error: 'นัดนี้บันทึกว่ามาทำกายภาพแล้ว ยกเลิกไม่ได้ (ต้องยกเลิกการบันทึก "มาแล้ว" ก่อน)' };
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  sheet.getRange(match._row, colIndex_(sheet, 'status')).setValue('cancelled');
  invalidateCache_(SHEET_APPTS);
  bumpCalendarVersion_();
  return { ok: true };
}

/**
 * บันทึกว่าคนไข้มาทำกายภาพแล้ว (หรือยกเลิกการบันทึก) — เก็บเวลาและผู้บันทึกไว้ในชีต Appointments
 * เพื่อใช้ทำ dashboard/สถิติภายหลัง (payload: {id, attended: true|false})
 * ไม่แตะคอลัมน์ status เพื่อให้ช่วงเวลานั้นยังถือว่า "มีนัดอยู่" ตามเดิม
 */
function markAttended_(payload, auth) {
  const rows = sheetData_(SHEET_APPTS);
  const match = rows.find(r => r.id === payload.id);
  if (!match) return { ok: false, error: 'ไม่พบนัดหมายนี้' };
  if (match.status !== 'active') return { ok: false, error: 'นัดนี้ถูกยกเลิกแล้ว' };

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_APPTS);
  ensureColumns_(sheet, ['attendedAt', 'attendedBy']); // เผื่อยังไม่ได้รัน setupSheets ใหม่
  const atCol = colIndex_(sheet, 'attendedAt');
  const byCol = colIndex_(sheet, 'attendedBy');

  if (payload.attended === false) {
    sheet.getRange(match._row, atCol).clearContent();
    sheet.getRange(match._row, byCol).clearContent();
  } else {
    sheet.getRange(match._row, atCol).setValue(new Date());
    sheet.getRange(match._row, byCol).setValue(auth.username);
  }
  invalidateCache_(SHEET_APPTS);
  return { ok: true };
}

function isSlotAvailable_(date, startTime, endTime, excludeApptId) {
  const resolved = resolveDayOpen_(date);
  if (!resolved.isOpen) {
    return { ok: false, error: resolved.reason ? 'วันนี้ปิดทำการ: ' + resolved.reason : 'วันนี้ไม่เปิดให้บริการ' };
  }
  const matchDef = resolved.slotDefs.find(d => d.start === startTime && d.end === endTime);
  if (!matchDef) {
    return { ok: false, error: 'ช่วงเวลานี้ไม่ได้อยู่ในตารางเวลาที่กำหนดไว้' };
  }

  const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

  const busyToday = sheetData_(SHEET_BUSY).filter(r => fmtDate_(r.date) === date);
  for (const b of busyToday) {
    if (overlaps(startTime, endTime, b.startTime, b.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้นักกายภาพไม่ว่าง (' + b.type + ')' };
    }
  }

  const apptsToday = sheetData_(SHEET_APPTS).filter(r => fmtDate_(r.date) === date && r.status === 'active' && r.id !== excludeApptId);
  for (const a of apptsToday) {
    if (overlaps(startTime, endTime, a.startTime, a.endTime)) {
      return { ok: false, error: 'ช่วงเวลานี้มีนัดอยู่แล้ว' };
    }
  }

  return { ok: true };
}

/* ---------------------------- Dashboard / สถิติ ---------------------------- */

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
function addDaysStr_(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween_(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
/** คีย์แทน "คนไข้คนเดียวกัน": ใช้เลขบัตรถ้ามีครบ 13 หลัก ไม่งั้นใช้ ชื่อ+นามสกุล+หมู่ (นับโดยประมาณ) */
function patientKey_(a) {
  const nid = String(a.nationalId || '').replace(/\D/g, '');
  if (nid.length === 13) return 'id:' + nid;
  return 'nm:' + [a.firstName, a.lastName, a.moo].map(x => String(x === undefined || x === null ? '' : x).trim().toLowerCase()).join('|');
}
function cmpMoo_(x, y) {
  const nx = Number(x), ny = Number(y);
  if (!isNaN(nx) && !isNaN(ny)) return nx - ny;
  return String(x) < String(y) ? -1 : (String(x) > String(y) ? 1 : 0);
}

/**
 * สรุปสถิติการให้บริการช่วง [from, to] (payload: {from:'yyyy-MM-dd', to:'yyyy-MM-dd'})
 * ไม่ส่งชื่อ/เบอร์/เลขบัตรของคนไข้กลับไป มีแต่ตัวเลขสรุป (ดูรายคนใช้หน้า "ค้นหาคนไข้" แทน)
 * เคส (ราย) = จำนวนคนไม่นับซ้ำที่มารับบริการในช่วง · visit (ครั้ง) = จำนวนครั้งที่มารับบริการในช่วง
 * รายใหม่ = คนที่ "ครั้งแรกที่มารับบริการ" (นับจากข้อมูลทั้งหมดในระบบ) อยู่ในช่วงนี้ · รายเก่า = เคยมาก่อนช่วงนี้แล้ว
 * "ไม่มาตามนัด" นับเฉพาะนัดที่วันผ่านไปแล้ว และอยู่หลังวันแรกที่เริ่มมีการกด "มาแล้ว"
 * (นัดก่อนหน้านั้นไม่มีข้อมูลการมา จะนับเป็นไม่มาทั้งหมดไม่ได้)
 */
function getDashboard_(payload) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(payload.from || ''), to = String(payload.to || '');
  if (!re.test(from) || !re.test(to)) return { ok: false, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (from > to) return { ok: false, error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' };
  const spanDays = daysBetween_(from, to) + 1;
  if (spanDays > 1830) return { ok: false, error: 'ช่วงเวลายาวเกินไป (ไม่เกิน 5 ปี)' };

  const tz = Session.getScriptTimeZone();
  const today = todayStr_();

  const rows = sheetData_(SHEET_APPTS)
    .filter(r => r.id && r.date)
    .map(r => ({
      date: fmtDate_(r.date),
      type: r.type,
      moo: String(r.moo === undefined || r.moo === null ? '' : r.moo).trim(),
      status: r.status,
      attendedDate: r.attendedAt ? Utilities.formatDate(new Date(r.attendedAt), tz, 'yyyy-MM-dd') : '',
      ptn: normText_(r.ptn),
      icd10: r.icd10,
      key: normText_(r.ptn) ? 'ptn:' + normText_(r.ptn) : patientKey_(r) // มี PTN ใช้ PTN นับคน (แม่นกว่าชื่อ)
    }));

  // วันแรกที่มีการกด "มาแล้ว" (ใช้ตัดสินว่านัดไหนมีข้อมูลการมาให้เทียบได้)
  let trackingStart = '';
  rows.forEach(a => { if (a.attendedDate && (!trackingStart || a.attendedDate < trackingStart)) trackingStart = a.attendedDate; });

  const inRange = rows.filter(a => a.date >= from && a.date <= to);
  const active = inRange.filter(a => a.status === 'active');
  const cancelled = inRange.filter(a => a.status === 'cancelled').length;
  const attended = active.filter(a => a.attendedDate);
  const upcoming = active.filter(a => a.date >= today && !a.attendedDate).length;

  const tracked = trackingStart ? active.filter(a => a.date < today && a.date >= trackingStart) : [];
  const trackedAttended = tracked.filter(a => a.attendedDate).length;
  const noShow = tracked.length - trackedAttended;
  const attendanceRate = tracked.length ? trackedAttended / tracked.length : null;

  const visitsByKey = {};
  attended.forEach(a => { visitsByKey[a.key] = (visitsByKey[a.key] || 0) + 1; });
  const keys = Object.keys(visitsByKey);

  // วันที่มารับบริการครั้งแรกของแต่ละคน (จากข้อมูลทั้งหมด ไม่ใช่เฉพาะช่วงที่กรอง) ใช้แยกรายใหม่/รายเก่า
  const firstVisitOf = {};
  rows.forEach(a => {
    if (a.status !== 'active' || !a.attendedDate) return;
    if (!firstVisitOf[a.key] || a.date < firstVisitOf[a.key]) firstVisitOf[a.key] = a.date;
  });
  const newCases = keys.filter(k => firstVisitOf[k] >= from && firstVisitOf[k] <= to).length;
  const countCases = list => { const seen = {}; list.forEach(a => { seen[a.key] = true; }); return Object.keys(seen).length; };

  const byType = APPT_TYPES.map(t => ({
    name: t,
    total: active.filter(a => a.type === t).length,
    attended: attended.filter(a => a.type === t).length,
    cases: countCases(attended.filter(a => a.type === t))
  }));

  const mooMap = {};
  active.forEach(a => {
    const m = a.moo || 'ไม่ระบุ';
    if (!mooMap[m]) mooMap[m] = { name: m, total: 0, attended: 0, cases: 0, _seen: {} };
    mooMap[m].total++;
    if (a.attendedDate) {
      mooMap[m].attended++;
      if (!mooMap[m]._seen[a.key]) { mooMap[m]._seen[a.key] = true; mooMap[m].cases++; } // เคส = คนไม่นับซ้ำที่มารับบริการจากหมู่นั้น
    }
  });
  Object.keys(mooMap).forEach(k => { delete mooMap[k]._seen; });
  const byMoo = Object.keys(mooMap).map(k => mooMap[k])
    .sort((x, y) => (y.attended - x.attended) || (y.total - x.total) || cmpMoo_(x.name, y.name));

  // แยกตามโรค (ICD-10) รายหมู่ — ใช้กรองแผนที่ตำบลตามโรคได้ทันทีโดยไม่ต้องโหลดใหม่
  // นับเฉพาะนัดที่มารับบริการแล้ว ไม่นับรหัสอัตโนมัติ (Z501) ที่ติดทุกนัด · นัดที่มี 2 โรคถูกนับในทั้งสองโรค · ส่งเฉพาะ 40 โรคที่มารับบริการมากสุด
  const dxLabel = {};
  icdCodeList_(SHEET_ICD10).forEach(c => { dxLabel[c.code] = normText_(c.label); });
  const dxMap = {};
  attended.forEach(a => {
    const m = a.moo || 'ไม่ระบุ';
    icdCodes_(a.icd10).forEach(code => {
      if (code === ICD10_AUTO_CODE) return;
      if (!dxMap[code]) dxMap[code] = { code: code, label: dxLabel[code] || '', visits: 0, cases: 0, moo: {}, _seen: {} };
      const dx = dxMap[code];
      if (!dx.moo[m]) dx.moo[m] = { name: m, attended: 0, cases: 0, _seen: {} };
      dx.visits++;
      dx.moo[m].attended++;
      if (!dx.moo[m]._seen[a.key]) { dx.moo[m]._seen[a.key] = true; dx.moo[m].cases++; }
      if (!dx._seen[a.key]) { dx._seen[a.key] = true; dx.cases++; }
    });
  });
  const byMooIcd = Object.keys(dxMap).map(k => dxMap[k])
    .sort((x, y) => (y.visits - x.visits) || (x.code < y.code ? -1 : 1)).slice(0, 40)
    .map(dx => ({ code: dx.code, label: dx.label, visits: dx.visits, cases: dx.cases,
      byMoo: Object.keys(dx.moo).map(k => ({ name: dx.moo[k].name, attended: dx.moo[k].attended, cases: dx.moo[k].cases })) }));

  // แยกตามคลินิก: ใช้การตั้งค่าคลินิก "ปัจจุบัน" ของแต่ละวันที่นัด
  const clinicCache = {};
  const clinicOf = date => {
    if (!(date in clinicCache)) {
      const c = resolveClinicForDate_(date);
      clinicCache[date] = c ? { name: c.name, color: c.color } : { name: 'ไม่ได้กำหนดคลินิก', color: '#9AA5A1' };
    }
    return clinicCache[date];
  };
  const clinicMap = {};
  active.forEach(a => {
    const c = clinicOf(a.date);
    if (!clinicMap[c.name]) clinicMap[c.name] = { name: c.name, color: c.color, total: 0, attended: 0 };
    clinicMap[c.name].total++;
    if (a.attendedDate) clinicMap[c.name].attended++;
  });
  const byClinic = Object.keys(clinicMap).map(k => clinicMap[k])
    .sort((x, y) => (y.attended - x.attended) || (y.total - x.total));

  // แยกตามวันในสัปดาห์ (จ-ศ, ส, อา)
  const wdNames = { 1: 'จันทร์', 2: 'อังคาร', 3: 'พุธ', 4: 'พฤหัสบดี', 5: 'ศุกร์', 6: 'เสาร์', 0: 'อาทิตย์' };
  const wdMap = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { wdMap[d] = { name: wdNames[d], total: 0, attended: 0 }; });
  active.forEach(a => {
    const d = new Date(a.date + 'T00:00:00Z').getUTCDay();
    wdMap[d].total++;
    if (a.attendedDate) wdMap[d].attended++;
  });
  const byWeekday = [1, 2, 3, 4, 5].map(d => wdMap[d]).concat([6, 0].map(d => wdMap[d]).filter(w => w.total > 0));

  // แนวโน้ม: รายวันถ้าช่วงไม่เกิน 45 วัน ไม่งั้นรายเดือน
  const granularity = spanDays <= 45 ? 'day' : 'month';
  const trend = [], idx = {};
  if (granularity === 'day') {
    for (let i = 0; i < spanDays; i++) {
      const k = addDaysStr_(from, i);
      idx[k] = trend.length;
      trend.push({ key: k, total: 0, attended: 0, cases: 0 });
    }
  } else {
    let cur = from.slice(0, 7);
    const endKey = to.slice(0, 7);
    while (cur <= endKey) {
      idx[cur] = trend.length;
      trend.push({ key: cur, total: 0, attended: 0, cases: 0 });
      let y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7)) + 1;
      if (m > 12) { m = 1; y++; }
      cur = y + '-' + String(m).padStart(2, '0');
    }
  }
  active.forEach(a => {
    const i = idx[granularity === 'day' ? a.date : a.date.slice(0, 7)];
    if (i !== undefined) {
      trend[i].total++;
      if (a.attendedDate) {
        trend[i].attended++;
        if (!trend[i]._seen) trend[i]._seen = {};
        if (!trend[i]._seen[a.key]) { trend[i]._seen[a.key] = true; trend[i].cases++; } // เคสไม่นับซ้ำภายในวัน/เดือนนั้น
      }
    }
  });
  trend.forEach(t => { delete t._seen; });

  return {
    ok: true,
    data: {
      from, to, today, trackingStart, granularity,
      totals: {
        appointments: active.length,
        attended: attended.length,
        upcoming,
        cancelled,
        noShow,
        trackedPast: tracked.length,
        attendanceRate,
        patientsSeen: keys.length,
        repeatPatients: keys.filter(k => visitsByKey[k] >= 2).length,
        cases: keys.length,
        visits: attended.length,
        newCases: newCases,
        returningCases: keys.length - newCases
      },
      byType, byMoo, byMooIcd, byClinic, byWeekday, trend,
      feedback: feedbackForDashboard_(from, to, attended.length)
    }
  };
}

/** วันที่เดียวกันของ k ปีก่อน ('yyyy-MM-dd') — 29 ก.พ. ของปีที่ไม่มี ใช้ 28 ก.พ. */
function shiftYears_(ymd, k) {
  const y = Number(ymd.slice(0, 4)) - k;
  const md = ymd.slice(4);
  const out = y + md;
  return recValidDate_(out) ? out : y + '-02-28';
}
/**
 * ตัวเลขหลักของช่วง [from, to] เทียบกับช่วงเดียวกันของ 1-3 ปีก่อน (payload: { from, to, years })
 * คืน periods เรียงจากปีเก่าสุดไปช่วงปัจจุบัน: { from, to, visits, cases, newCases, appointments, noShow, attendanceRate, satisfaction, respondents }
 * ใช้การคำนวณเดียวกับ getDashboard_ ทุกช่วง ตัวเลขจึงตรงกับหน้าสถิติของช่วงนั้นเสมอ
 */
function getDashboardCompare_(payload) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(payload.from || ''), to = String(payload.to || '');
  if (!re.test(from) || !re.test(to)) return { ok: false, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  const years = Math.max(1, Math.min(3, Math.floor(Number(payload.years) || 1)));
  const periods = [];
  for (let k = years; k >= 0; k--) {
    const f = shiftYears_(from, k), t = shiftYears_(to, k);
    const r = getDashboard_({ from: f, to: t });
    if (!r.ok) return r;
    const tt = r.data.totals, fb = r.data.feedback;
    periods.push({ from: f, to: t, visits: tt.visits, cases: tt.cases, newCases: tt.newCases, appointments: tt.appointments, noShow: tt.noShow,
      attendanceRate: tt.attendanceRate, satisfaction: fb && fb.overall ? fb.overall.percent : null, respondents: fb && fb.total ? fb.total : 0 });
  }
  return { ok: true, data: { periods: periods } };
}

/* ---------------------------- สถิติผลลัพธ์จากเวชระเบียน (หน้าสถิติ แท็บ "ผลลัพธ์การรักษา") ---------------------------- */

/**
 * ค่าที่วัดได้ต่ำกว่าเกณฑ์หรือไม่ — true / false / null (รายการนั้นยังไม่มีเกณฑ์)
 * ต้องตรงกับ recCriterion_ ใน record.js: อายุอยู่ในตารางค่าปกติและรู้เพศ ใช้ตารางตามอายุ/เพศ · นอกนั้นใช้เกณฑ์ค่าเดียว (riskBelow / riskAbove)
 */
function assessBelow_(test, value, age, sex, norms) {
  if (age !== null && sex) {
    const norm = norms.find(n => n.testKey === test.key && n.sex === sex && age >= n.ageFrom && age <= n.ageTo);
    if (norm) {
      const nums = [norm.normalLow, norm.normalHigh].filter(v => v !== null && v !== undefined);
      return test.better === 'lower' ? value > Math.max.apply(null, nums) : value < Math.min.apply(null, nums);
    }
  }
  if (test.riskBelow !== null && test.riskBelow !== undefined) return value < test.riskBelow;
  if (test.riskAbove !== null && test.riskAbove !== undefined) return value > test.riskAbove;
  return null;
}

/**
 * สรุปผลจากเวชระเบียน (แบบประเมินครั้งแรก) ที่ "บันทึกเวชระเบียน" แล้ว และวันที่ประเมินอยู่ในช่วง [from, to]
 * ส่งกลับเฉพาะตัวเลขสรุป ไม่มีชื่อ PTN หรือค่าของรายคน
 *   records (แบบประเมินครั้งแรก) / notes (Progress note) / patients / drafts (ฉบับร่างในช่วงนี้ ไม่ถูกนับ)
 *   ค่าแรกรับ (nrs, tests, barthel, eq5d) นับจากแบบประเมินครั้งแรกเท่านั้น · ปวดก่อน-หลังรักษานับทุกครั้งที่มารักษา (แรกรับและ Progress note)
 *   nrs: { rest: {n, avg, min, max}, func: {...} }     ระดับปวดแรกรับ
 *   pain: ปวดก่อนและหลังรักษา (เฉพาะฉบับที่กรอกครบทั้งสองค่า) — all และ groups (แยกตาม PT diagnosis ถ้าไม่มีใช้ Medical diagnosis) รูปเดียวกัน:
 *         { name, n, pre: {avg, min, max}, post: {avg, min, max}, drop (คะแนนเฉลี่ยที่ลดลง), pct (ร้อยละที่ลดลงจากค่าก่อนรักษา), improved, same, worse (จำนวนราย) }
 *   tests: [{ key, name, unit, tested, below, noCriterion }]  เฉพาะรายการที่มีคนถูกทดสอบในช่วงนี้
 *   barthel: { n, social, home, bed }                   12-20 / 5-11 / 0-4 คะแนน
 *   eq5d: { n, avg }
 */
// ช่องการรักษารุ่นก่อน 2026-10-15a (1 ช่องต่อเครื่องมือ) → ชื่อหัตถการ
const OUTCOME_OLD_TX = { us: 'US', usc: 'US Combine', es: 'ES', pms: 'PMS', ctx: 'C-Traction', ltx: 'L-Traction', hot: 'Hot/Cool', swr: 'Shock wave Radial', swf: 'Shock wave Focus',
  laser: 'LASER', swd: 'SWD', nerve: 'Nerve mobilization', mob: 'Mobilization', manual: 'Manual technique', ex_stretch: 'Stretching exs.', ex_strength: 'Strengthening exs.',
  ex_iso: 'Isometric exs.', ex_core: 'Core stabilization exs.', ex_cardio: 'Cardiovascular endurance' };
/** หัตถการในเวชระเบียน 1 ฉบับ (ไม่นับซ้ำในฉบับเดียวกัน) */
function outcomeProcedures_(r) {
  const out = [];
  const add = t => { t = normText_(t); if (t && out.indexOf(t) === -1) out.push(t); };
  Object.keys(r).forEach(k => { if (/^p5_[me]\d+_type$/.test(k)) add(recordCell_(r[k])); });
  Object.keys(OUTCOME_OLD_TX).forEach(k => { if (recordCell_(r['p5_' + k]) === 'Y') add(OUTCOME_OLD_TX[k]); });
  [['p5_amb', 'Ambulation training'], ['p5_tr', 'Transfer training'], ['p5_bal', 'Balance training']].forEach(x => { if (recordCell_(r[x[0]]) === 'Y') add(x[1]); });
  return out;
}

function getOutcomes_(payload, auth) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(payload.from || ''), to = String(payload.to || '');
  if (!re.test(from) || !re.test(to)) return { ok: false, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (from > to) return { ok: false, error: 'วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด' };
  const empty = { from: from, to: to, records: 0, notes: 0, patients: 0, drafts: 0, dx: { medical: [], pt: [] }, procedures: [], nrs: { rest: { n: 0, avg: null, min: null, max: null }, func: { n: 0, avg: null, min: null, max: null } }, pain: { all: null, groups: [] }, tests: [], barthel: { n: 0, social: 0, home: 0, bed: 0 }, eq5d: { n: 0, avg: null } };
  if (!recSheet_(SHEET_RECORDS)) return { ok: true, data: empty };

  const tests = assessTestsAll_().filter(t => t.active && t.key !== 'eq5d' && t.key !== 'barthel');
  const norms = assessNorms_();
  const extra = {};
  patientsData_().forEach(p => { extra[normText_(p.ptn)] = patientExtra_(p); });
  const num = (v, lo, hi) => { const n = recNum_(typeof v === 'string' ? v.trim() : v); return n !== null && n >= lo && n <= hi ? n : null; };
  const mean = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : null;

  const out = empty, seen = {}, rest = [], func = [], eq = [], pairs = [], procs = {}, mdx = {}, ptdx = {}, waits = [];
  const tally = {};
  tests.forEach(t => { tally[t.key] = { key: t.key, name: t.name, unit: t.unit, tested: 0, below: 0, noCriterion: 0 }; });
  const allRows = recRows_(SHEET_RECORDS);
  const dxOf = {}; // การวินิจฉัยของ session (Progress note ใช้ของแบบแรกรับ)
  allRows.forEach(r => {
    if ((normText_(r.kind) || 'initial') !== 'initial') return;
    dxOf[normText_(r.ptn) + '|' + (recNum_(r.session) || 0)] = normText_(r.p1_ptdx) || normText_(r.p1_mdx1);
  });
  allRows.forEach(r => {
    const m = recordMeta_(r);
    if (!m.id || !m.ptn || !re.test(m.date) || m.date < from || m.date > to) return;
    if (m.status !== 'final') { out.drafts++; return; }
    seen[m.ptn] = true;
    const pre = num(r.p5_nrs_pre, 0, 10), post = num(r.p5_nrs_post, 0, 10);
    if (pre !== null && post !== null) pairs.push({ group: dxOf[m.ptn + '|' + m.session] || 'ไม่ระบุการวินิจฉัย', pre: pre, post: post });
    outcomeProcedures_(r).forEach(t => { procs[t] = (procs[t] || 0) + 1; });
    if (m.kind === 'progress') { out.notes++; return; }
    out.records++;
    const cd = recDate_(r.p1_consult);
    if (recValidDate_(cd) && cd <= m.date) waits.push(Math.round((new Date(m.date + 'T00:00:00Z') - new Date(cd + 'T00:00:00Z')) / 86400000));
    const seenDx = {};
    [r.p1_mdx1, r.p1_mdx2, r.p1_mdx3, r.p1_mdx4].map(normText_).filter(Boolean).forEach(x => { if (!seenDx[x]) { seenDx[x] = true; mdx[x] = (mdx[x] || 0) + 1; } });
    const pt = normText_(r.p1_ptdx);
    if (pt) ptdx[pt] = (ptdx[pt] || 0) + 1;
    // อายุ ณ วันที่ประเมิน: จากวันเกิดในทะเบียน ถ้าไม่มีใช้อายุที่พิมพ์ไว้ในแบบฟอร์ม
    const ex = extra[m.ptn] || { sex: '', birthDate: '' };
    let age = null;
    if (ex.birthDate) {
      age = Number(m.date.slice(0, 4)) - Number(ex.birthDate.slice(0, 4));
      if (m.date.slice(5) < ex.birthDate.slice(5)) age--;
      if (!(age >= 0 && age < 130)) age = null;
    }
    if (age === null) { const typed = num(r.p1_age, 0, 129); age = typed === null ? null : Math.floor(typed); }

    const a = num(r.p2_nrs_rest, 0, 10), b = num(r.p2_nrs_func, 0, 10);
    if (a !== null) rest.push(a);
    if (b !== null) func.push(b);
    tests.forEach(t => {
      const v = num(r['pt_' + t.key], 0, 99999);
      if (v === null) return;
      const below = assessBelow_(t, v, age, ex.sex, norms);
      tally[t.key].tested++;
      if (below === null) tally[t.key].noCriterion++;
      else if (below) tally[t.key].below++;
    });
    const ba = num(r.pt_barthel, 0, 20);
    if (ba !== null) { out.barthel.n++; if (ba >= 12) out.barthel.social++; else if (ba >= 5) out.barthel.home++; else out.barthel.bed++; }
    const e = num(r.pt_eq5d, -1, 1);
    if (e !== null) eq.push(e);
  });
  out.patients = Object.keys(seen).length;
  const stat = a => ({ n: a.length, avg: mean(a), min: a.length ? Math.min.apply(null, a) : null, max: a.length ? Math.max.apply(null, a) : null });
  out.nrs = { rest: stat(rest), func: stat(func) };
  // ปวดก่อน-หลังรักษา: ทั้งหมด + แยกกลุ่มการวินิจฉัย (6 กลุ่มที่มีมากสุด)
  const painOf = (name, list) => {
    const pre = stat(list.map(x => x.pre)), post = stat(list.map(x => x.post));
    const drop = Math.round((pre.avg - post.avg) * 100) / 100;
    return { name: name, n: list.length, pre: { avg: pre.avg, min: pre.min, max: pre.max }, post: { avg: post.avg, min: post.min, max: post.max },
      drop: drop, pct: pre.avg > 0 ? Math.round(drop / pre.avg * 1000) / 10 : null,
      improved: list.filter(x => x.post < x.pre).length, same: list.filter(x => x.post === x.pre).length, worse: list.filter(x => x.post > x.pre).length };
  };
  if (pairs.length) {
    const byGroup = {};
    pairs.forEach(x => { (byGroup[x.group] = byGroup[x.group] || []).push(x); });
    out.pain = { all: painOf('ทั้งหมด', pairs), groups: Object.keys(byGroup).map(g => painOf(g.slice(0, 60), byGroup[g])).sort((x, y) => (y.n - x.n) || (x.name < y.name ? -1 : 1)).slice(0, 6) };
  }
  out.tests = tests.map(t => tally[t.key]).filter(t => t.tested > 0);
  // 5 อันดับการวินิจฉัย (จากแบบประเมินครั้งแรก) และหัตถการ (ทุกครั้งที่มารักษา) — n = จำนวนฉบับ, pct = ร้อยละของฉบับในกลุ่มนั้น
  const top = (map, total, limit) => Object.keys(map).map(k => ({ name: k.slice(0, 80), n: map[k], pct: total ? Math.round(map[k] / total * 1000) / 10 : null }))
    .sort((a, b) => (b.n - a.n) || (a.name < b.name ? -1 : 1)).slice(0, limit);
  out.dx = { medical: top(mdx, out.records, 5), pt: top(ptdx, out.records, 5) };
  out.procedures = top(procs, out.records + out.notes, 10);
  // ระยะรอคอย (วัน) จากวันที่ consult ถึงวันที่รับบริการครั้งแรกของ session
  out.wait = waits.length ? { n: waits.length, avg: Math.round(waits.reduce((a, b) => a + b, 0) / waits.length * 10) / 10, min: Math.min.apply(null, waits), max: Math.max.apply(null, waits),
    within7: waits.filter(x => x <= 7).length } : { n: 0, avg: null, min: null, max: null, within7: 0 };
  out.eq5d = { n: eq.length, avg: mean(eq) };
  if (out.records || out.notes) recordLog_(auth, 'outcomes', '', '');
  return { ok: true, data: out };
}

/* ---------------------------- เวชระเบียน: แบบประเมินครั้งแรกของแต่ละ session + Progress note ของครั้งถัดไป ---------------------------- */
// คนไข้ 1 คน (PTN เดิม) มีได้หลาย session — มาด้วยอาการใหม่ = เปิด session ใหม่ที่มีแบบประเมินครั้งแรกของตัวเอง
//   Records        : 1 แถวต่อเวชระเบียน 1 ฉบับ คอลัมน์แรกเป็นข้อมูลกำกับ ที่เหลือคือช่องในแบบฟอร์ม (p1_.. = ชุดที่ 1, pt_.. = ผลทดสอบสมรรถภาพ)
//                    kind = initial (ประเมินครั้งแรกของ session) หรือ progress (Progress note ของครั้งถัดไปใน session เดียวกัน)
//                    Progress note ใช้ช่องตรวจร่างกาย (p2_..) และการรักษา (p5_..) ชุดเดียวกับแบบแรกรับ + ช่องของตัวเอง (pn_..)
//                    ช่องในแบบฟอร์มกำหนดที่หน้าเว็บ (record.js) หลังบ้านเพิ่มคอลัมน์ให้เองเมื่อมีช่องใหม่ ทุกช่องเก็บเป็นข้อความ
//                    (ไม่งั้นชีตจะแปลง "8-10" หรือ "3-5" เป็นวันที่)
//   RecordOptions  : ตัวเลือกของดรอปดาวน์ 1 คอลัมน์ต่อ 1 รายการ — เพิ่ม/ลบ/แก้ในชีตได้ และค่าที่พิมพ์เองในเว็บถูกเติมต่อท้ายให้อัตโนมัติ
//   AssessTests    : รายการทดสอบสมรรถภาพ = โหมดใหญ่ (group) + ตัวประเมินย่อย (name) พร้อมเกณฑ์
//                    riskBelow: ค่าน้อยกว่านี้ = ต่ำกว่าเกณฑ์ · riskAbove: ค่ามากกว่านี้ = ต่ำกว่าเกณฑ์ (ใช้กับการจับเวลา) · interpret: การแปลผลเมื่อต่ำกว่าเกณฑ์
//                    รายการใหม่ต้องมี key เป็นตัวอักษรอังกฤษ/ตัวเลขไม่เว้นวรรค · active = FALSE คือซ่อนจากแบบฟอร์ม
//   AssessNorms    : ค่าปกติตามเพศและช่วงอายุ (ถ้าคนไข้อายุอยู่ในช่วงและรู้เพศ ใช้ตารางนี้ก่อน riskBelow/riskAbove)
// ชีตทั้งหมดถูกสร้างให้เองตอนบันทึกเวชระเบียนครั้งแรก ไม่ต้องรันคำสั่งใดเพิ่ม
const SHEET_RECORDS = 'Records';
const SHEET_RECORD_OPTIONS = 'RecordOptions';
const SHEET_ASSESS_TESTS = 'AssessTests';
const SHEET_ASSESS_NORMS = 'AssessNorms';
const RECORD_META_HEADERS = ['id', 'ptn', 'session', 'kind', 'date', 'status', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
const RECORD_KEY_RE = /^(p[1-5]|pt|pn)_[A-Za-z0-9_]{1,48}$/;
// ช่องที่หลังบ้านเป็นผู้เขียนเอง (หน้าเว็บส่งมาก็ไม่ใช้): ผู้ที่กดบันทึก Progress note เป็นฉบับจริง และเวลาที่กด
// pn_sat_at / pn_sat_by = ให้คนไข้ทำแบบประเมินความพึงพอใจแล้ว (1 ครั้งต่อ session เก็บที่แบบประเมินครั้งแรกของ session) — การบันทึกแบบฟอร์มไม่ลบค่านี้
const RECORD_SERVER_KEYS = ['pn_final_by', 'pn_final_at', 'pn_sat_at', 'pn_sat_by'];
const OPTION_MAX_ITEMS = 300;
const OPTION_MAX_TEXT = 80;
const RECORD_MAX_KEYS = 600;
const RECORD_MAX_TEXT = 1000;
const OPTION_LIST_RE = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const ASSESS_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,29}$/;
const ASSESS_TEST_HEADERS = ['key', 'group', 'name', 'unit', 'better', 'riskBelow', 'riskAbove', 'interpret', 'askName', 'active'];
const ASSESS_NORM_HEADERS = ['testKey', 'sex', 'ageFrom', 'ageTo', 'normalLow', 'normalHigh'];
// เกณฑ์และการแปลผลจาก: ศรีวรรณ ปัญติ. คู่มือปฏิบัติการ การตรวจสมรรถภาพทางกายในผู้สูงอายุ (Senior Fitness Test; Rikli & Jones, 1999b, 2001)
// รายการที่เอกสารนี้ไม่มีเกณฑ์ เว้น riskBelow/riskAbove ว่างไว้ให้เติมเองในชีต
const ASSESS_DEFAULT_TESTS = [
  { key: 'tug', group: 'Falling & Balance', name: 'Time up and go test', unit: 'วินาที', better: 'lower' },
  { key: 'tugDual', group: 'Falling & Balance', name: 'Time up and go + dual task', unit: 'วินาที', better: 'lower' },
  { key: 'gaitSpeed', group: 'Falling & Balance', name: 'Gait speed test', unit: 'วินาที', better: 'lower' },
  { key: 'chairStand5', group: 'Strengthening', name: '5 Time Chair stand test', unit: 'ครั้ง', better: 'higher' },
  { key: 'chairStand30', group: 'Strengthening', name: '30 second chair stand', unit: 'ครั้ง', better: 'higher', riskBelow: 8,
    interpret: 'กล้ามเนื้อขาไม่แข็งแรง เสี่ยงต่อการจำกัดความสามารถในการเดิน ขึ้นลงบันได ลุกนั่ง และเสี่ยงหกล้ม' },
  { key: 'handGrip', group: 'Strengthening', name: 'Hand Grip Strength', unit: 'กก.', better: 'higher' },
  { key: 'armCurl', group: 'Strengthening', name: 'Arm Curl test', unit: 'ครั้ง', better: 'higher', riskBelow: 11,
    interpret: 'กล้ามเนื้อแขนไม่แข็งแรง กระทบการทำงานบ้าน การยกและหิ้วของ' },
  { key: 'step2min', group: 'Endurance', name: '2 Minute Step test', unit: 'ครั้ง', better: 'higher', riskBelow: 65,
    interpret: 'ความทนทานของระบบหัวใจและหายใจต่ำ' },
  { key: 'walk6min', group: 'Endurance', name: '6 Minute walk test', unit: 'เมตร', better: 'higher', riskBelow: 320,
    interpret: 'ความทนทานของหัวใจและการหายใจต่ำ กระทบการเดินระยะไกลนอกบ้าน' },
  { key: 'mmse', group: 'Cognitive', name: 'MMSE', unit: 'คะแนน', better: 'higher' },
  { key: 'eq5d', group: 'QoL', name: 'EQ5D', unit: 'คะแนน', better: 'higher' },
  { key: 'fq', group: 'Functional Questionnaire test', name: 'Functional Questionnaire', unit: 'คะแนน', better: '', askName: true }
];
// ค่าปกติ (ช่วงเปอร์เซ็นไทล์ที่ 25-75) ผู้สูงอายุ 60-94 ปี ตามตารางที่ 2 (ชาย) และ 3 (หญิง) ของเอกสารเดียวกัน — 6 Minute walk แปลงจากหลาเป็นเมตร
const ASSESS_NORM_AGES = [[60, 64], [65, 69], [70, 74], [75, 79], [80, 84], [85, 89], [90, 94]];
const ASSESS_NORM_TABLE = {
  chairStand30: { M: [[14, 19], [12, 18], [12, 17], [11, 17], [10, 15], [8, 14], [7, 12]], F: [[12, 17], [11, 16], [10, 15], [10, 15], [9, 14], [8, 13], [4, 11]] },
  armCurl: { M: [[16, 22], [15, 21], [14, 21], [13, 19], [13, 19], [11, 17], [10, 14]], F: [[13, 19], [12, 18], [12, 17], [11, 17], [10, 16], [10, 15], [8, 13]] },
  step2min: { M: [[87, 115], [86, 116], [80, 110], [73, 109], [71, 103], [59, 91], [52, 86]], F: [[75, 107], [73, 107], [68, 101], [68, 100], [60, 90], [55, 85], [44, 72]] },
  walk6minYards: { M: [[610, 735], [560, 700], [545, 680], [470, 640], [445, 605], [380, 570], [305, 500]], F: [[545, 660], [500, 635], [480, 615], [435, 585], [385, 540], [340, 510], [275, 440]] }
};
function assessDefaultNorms_() {
  const out = [];
  Object.keys(ASSESS_NORM_TABLE).forEach(k => {
    const yards = k === 'walk6minYards';
    const conv = v => yards ? Math.round(v * 0.9144) : v;
    ['M', 'F'].forEach(sex => ASSESS_NORM_TABLE[k][sex].forEach((r, i) => {
      out.push({ testKey: yards ? 'walk6min' : k, sex: sex, ageFrom: ASSESS_NORM_AGES[i][0], ageTo: ASSESS_NORM_AGES[i][1], normalLow: conv(r[0]), normalHigh: conv(r[1]) });
    }));
  });
  return out;
}
// ตัวเลือกตั้งต้นของดรอปดาวน์ — รุ่น 2026-10-16a ใช้ตัวเลือกจากแบบฟอร์มเวชระเบียนเดิม (ชีต "ใบแรกรับ OPD") แก้คำสะกดผิดที่เห็นชัด
// ชีต RecordOptions ที่มีอยู่แล้วไม่ถูกแตะเอง: กดปุ่ม "เติมตัวเลือกจากแบบฟอร์มเดิม" ในหน้าตั้งค่า (seedRecordOptions_) เพื่อเติมตัวที่ยังไม่มี
// ลำดับมีความหมายกับ reps / setsPerDay / daysPerWeek: ตัวแรกคือค่าที่เติมให้เมื่อเพิ่มแถวการออกกำลังกาย
const RECORD_DEFAULT_OPTIONS = {
  side: ['Right', 'Left', 'Both'],
  bodyPart: ['neck', 'shoulder', 'back', 'Upper back', 'Lower back', 'hip', 'leg', 'knee', 'ankle', 'wrist', 'elbow', 'arm', 'heel'],
  muscle: ['Upper trapezius', 'Levator scapulae', 'Rhomboid', 'Rotator cuff', 'Pectoralis major', 'Pectoralis minor', 'Subscapularis', 'Paraspinal m.', 'QL m.',
    'Gluteus m.', 'Hamstring m.', 'Quadriceps', 'Calf m.', 'Lower extremity', 'neck', 'shoulder', 'elbow', 'Lower back', 'knee'],
  joint: ['neck', 'Shoulder', 'Knee', 'Hip', 'Lumbar', 'ankle', 'wrist', 'Cervical', 'Thoracic', 'AC joint', 'GH joint', 'Patellofemoral jt', 'SI jt'],
  direction: ['Flexion', 'Extension', 'Abduction', 'Adduction', 'Int. rotation', 'Ext. rotation'],
  ud: ['none', 'HT', 'DLP', 'gout'], yesNo: ['Yes', 'No'],
  contraindication: ['Tumor/CA', 'Fever', 'V/S instable'],
  redFlag: ['น้ำหนักลดผิดปกติ ไม่ทราบสาเหตุ', 'ปวดกลางคืนมากจนต้องตื่น', 'ชาและกลั้นปัสสาวะ อุจจาระไม่ได้', 'ไข้หนาวสั่น / ไข้เรื้อรัง', 'อ่อนแรงลงอย่างรวดเร็ว', 'Fracture', 'Infection', 'ยาละลายลิ่มเลือด / DVT'],
  orangeFlag: ['Depression', 'Severe Anxiety'],
  yellowFlag: ['ทัศนคติทางลบต่อสุขภาพ', 'กลัวการเคลื่อนไหว', 'ทัศนคติพึ่งพา passive', 'ภาวะเครียด วิตกกังวลระดับต่ำ'],
  medicalDx: ['Muscle strain', 'MPS', 'OA knee', 'Knee tendinitis', 'Post TKA', 'Lumbar degenerative', 'Back pain', 'Lumbar stenosis', 'Spondylosis', 'Piriformis syndrome',
    'Frozen shoulder', 'Shoulder tendinitis', 'Shoulder impingement', 'Shoulder post operative', 'Post operative'],
  ptDx: ['Upper cross syndrome', 'Weakness', 'Derangement', 'Geriatric syndrome', 'Poor ambulation', 'ADL dependent'],
  symptom: ['Pain', 'Numbness', 'Risk of fall'], frequency: ['Intermittent', 'Constant'], ease: ['นวด', 'นั่งพัก', 'นอน', 'กินยา'],
  specialTestUpper: ['Empty Can test (Supraspinatus tendon)', 'Hawkins-Kennedy Test (Supraspinatus tendinitis)', 'Neer Test (Supraspinatus tendon)', 'Drop Arm Test (Supraspinatus)',
    "Speed's Test (Long head Biceps tendon)", "Yergason's Test (Biceps tendon)", 'Apprehension test (Stability ant. shoulder)', 'Apley Scarf Test (AC joint)',
    "Phalen's Test (Carpal tunnel syndrome, Median n.)", "Mill's Test (Lateral epicondylitis)", 'Painful arc Test (30-120 Supraspinatus / 140-180 AC joint)'],
  specialTestLower: ['Faber Test (SI joint, Hip joint)', 'SLR test (Sciatic L4-S2)', "Bragard's Test (ต่อจาก SLR ลดมุม 5 องศา เพิ่ม Dorsiflexion)", 'Slump Test', 'Prone Instability Test'],
  testResult: ['Positive', 'Negative', 'NA', 'NT'],
  count: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], timeUnit: ['visit', 'weeks', 'months'],
  functionGoal: ['กลับไปทำอาชีพได้', 'ติดตะขอเสื้อในได้', 'ขับรถได้', 'ใส่เสื้อผ้า', 'เดินโดยไม่ปวด', 'เดินได้ไกลมากขึ้น', 'เดินได้โดยไม่ใช้อุปกรณ์พยุง'],
  modParam1: [], modParam2: [], modMode: ['Pulse', 'Continuous'],
  mobTechnique: [], mobGrade: ['I', 'II', 'III', 'IV'], exDetail: ['Flexor', 'Extensor', 'Int. rotation', 'Ext. rotation'],
  reps: ['8-10', '12-15', '3', '5'], setsPerDay: ['3', '1', '5'], daysPerWeek: ['3-5', '1', '3', '5', '7'],
  gaitPattern: [], gaitAid: ['No gait aid', 'Walker', 'Cane', 'Crutches'], paMinutes: ['20-30', '30-40', '40-60'], paDays: ['1-3', '3-5', '5-7'],
  // รุ่น 2026-10-15a: การรักษาเป็นแถวที่เลือกชนิดจากรายการ (เพิ่มชนิดเองได้) และรายการของ Progress note
  modality: ['US', 'US Combine', 'ES', 'PMS', 'C-Traction', 'L-Traction', 'Hot/Cool', 'Shock wave Radial', 'Shock wave Focus', 'LASER', 'SWD',
    'Nerve mobilization', 'Mobilization', 'Manual technique'],
  exercise: ['Stretching exs.', 'Strengthening exs.', 'Isometric exs.', 'Core stabilization exs.', 'Cardiovascular endurance'],
  modIntensity: [], assistLevel: ['Independent', 'Dependent'], transferType: [], posture: ['เข่าโก่ง'], romType: ['Active', 'Passive'],
  education: [], dischargeReason: [], signer: []
};

function recSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}
function recRows_(name) {
  return recSheet_(name) ? sheetData_(name) : [];
}
/** ขยายชีตให้มีจำนวนแถว/คอลัมน์พอก่อนเขียน (เขียนนอกขอบชีตจะผิดพลาด) */
function recEnsureGrid_(sheet, rows, cols) {
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (cols > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
}
function recHeaders_(sheet) {
  const row = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(h => normText_(h));
  let last = row.length;
  while (last > 0 && row[last - 1] === '') last--;
  return row.slice(0, last);
}
/** เพิ่มหัวคอลัมน์ที่ยังไม่มีต่อท้าย (ตั้งทั้งคอลัมน์เป็นข้อความ) คืนรายการหัวคอลัมน์ล่าสุด */
function recAddColumns_(sheet, names) {
  const headers = recHeaders_(sheet);
  const add = names.filter((n, i) => headers.indexOf(n) === -1 && names.indexOf(n) === i);
  if (!add.length) return headers;
  recEnsureGrid_(sheet, 1, headers.length + add.length);
  sheet.getRange(1, headers.length + 1, sheet.getMaxRows(), add.length).setNumberFormat('@');
  sheet.getRange(1, headers.length + 1, 1, add.length).setValues([add]);
  return headers.concat(add);
}
function recDate_(v) {
  if (v instanceof Date) { try { return fmtDate_(v); } catch (e) { return ''; } }
  return normText_(v).slice(0, 10);
}
function recValidDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function recNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function recFlag_(v, dflt) {
  if (v === true || v === false) return v;
  const s = normText_(v).toLowerCase();
  if (!s) return dflt;
  return !/^(false|no|n|0|ปิด|ไม่|ไม่ใช้)$/.test(s);
}
function recBetter_(v) {
  const s = normText_(v).toLowerCase();
  if (/^(lower|low|less|น้อย|ลด)/.test(s)) return 'lower';
  if (/^(higher|high|more|มาก|เพิ่ม)/.test(s)) return 'higher';
  return '';
}

/** สร้างชีตของเวชระเบียนถ้ายังไม่มี (เรียกซ้ำได้ ไม่แตะข้อมูลเดิม) */
function ensureRecordInfra_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const create = (name, headers, textCols) => {
    if (ss.getSheetByName(name)) return null;
    const sheet = ss.insertSheet(name);
    recEnsureGrid_(sheet, 1, headers.length);
    headers.forEach((h, i) => {
      if (textCols === true || textCols.indexOf(h) !== -1) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    invalidateCache_(name);
    return sheet;
  };
  create(SHEET_RECORDS, RECORD_META_HEADERS, true);
  const lists = Object.keys(RECORD_DEFAULT_OPTIONS);
  const opt = create(SHEET_RECORD_OPTIONS, lists, true);
  if (opt) {
    const depth = Math.max.apply(null, lists.map(l => RECORD_DEFAULT_OPTIONS[l].length));
    if (depth > 0) {
      const block = [];
      for (let r = 0; r < depth; r++) block.push(lists.map(l => RECORD_DEFAULT_OPTIONS[l][r] !== undefined ? RECORD_DEFAULT_OPTIONS[l][r] : ''));
      opt.getRange(2, 1, depth, lists.length).setValues(block);
    }
    invalidateCache_(SHEET_RECORD_OPTIONS);
  }
  const tests = create(SHEET_ASSESS_TESTS, ASSESS_TEST_HEADERS, ['key', 'group', 'name', 'unit', 'better', 'interpret']);
  if (tests) {
    const rows = ASSESS_DEFAULT_TESTS.map(t => [t.key, t.group, t.name, t.unit, t.better, t.riskBelow !== undefined ? t.riskBelow : '',
      t.riskAbove !== undefined ? t.riskAbove : '', t.interpret || '', t.askName ? 'TRUE' : '', 'TRUE']);
    tests.getRange(2, 1, rows.length, ASSESS_TEST_HEADERS.length).setValues(rows);
    invalidateCache_(SHEET_ASSESS_TESTS);
  }
  const norms = create(SHEET_ASSESS_NORMS, ASSESS_NORM_HEADERS, ['testKey', 'sex']);
  if (norms) {
    const rows = assessDefaultNorms_().map(n => ASSESS_NORM_HEADERS.map(h => n[h]));
    norms.getRange(2, 1, rows.length, ASSESS_NORM_HEADERS.length).setValues(rows);
    invalidateCache_(SHEET_ASSESS_NORMS);
  }
}

/** รายการทดสอบตามลำดับในชีต AssessTests (ยังไม่มีชีต = รายการตั้งต้น) — แถวที่ key ไม่ถูกรูปแบบหรือซ้ำถูกข้าม */
function assessTestsAll_() {
  const src = recSheet_(SHEET_ASSESS_TESTS)
    ? recRows_(SHEET_ASSESS_TESTS).map(r => ({ key: normText_(r.key), group: normText_(r.group) || 'อื่น ๆ', name: normText_(r.name), unit: normText_(r.unit),
      better: recBetter_(r.better), riskBelow: recNum_(r.riskBelow), riskAbove: recNum_(r.riskAbove), interpret: normText_(r.interpret),
      askName: recFlag_(r.askName, false), active: recFlag_(r.active, true) }))
    : ASSESS_DEFAULT_TESTS.map(t => ({ key: t.key, group: t.group, name: t.name, unit: t.unit, better: t.better,
      riskBelow: t.riskBelow !== undefined ? t.riskBelow : null, riskAbove: t.riskAbove !== undefined ? t.riskAbove : null, interpret: t.interpret || '',
      askName: !!t.askName, active: true }));
  const seen = {};
  return src.filter(t => { if (!t.name || !ASSESS_KEY_RE.test(t.key) || seen[t.key]) return false; seen[t.key] = true; return true; });
}
function assessNorms_() {
  const src = recSheet_(SHEET_ASSESS_NORMS) ? recRows_(SHEET_ASSESS_NORMS) : assessDefaultNorms_();
  const out = [];
  src.forEach(r => {
    const sexRaw = normText_(r.sex).toUpperCase();
    const sex = /^(M|ชาย|MALE)$/.test(sexRaw) ? 'M' : (/^(F|หญิง|FEMALE)$/.test(sexRaw) ? 'F' : '');
    const n = { testKey: normText_(r.testKey), sex: sex, ageFrom: recNum_(r.ageFrom), ageTo: recNum_(r.ageTo), normalLow: recNum_(r.normalLow), normalHigh: recNum_(r.normalHigh) };
    if (n.testKey && n.sex && n.ageFrom !== null && n.ageTo !== null && (n.normalLow !== null || n.normalHigh !== null)) out.push(n);
  });
  return out;
}
/** ตัวเลือกของดรอปดาวน์ทุกรายการ { ชื่อรายการ: [ตัวเลือก] } (ยังไม่มีชีต = ค่าตั้งต้น) */
function recordOptions_() {
  const sheet = recSheet_(SHEET_RECORD_OPTIONS);
  const out = {};
  if (!sheet) {
    Object.keys(RECORD_DEFAULT_OPTIONS).forEach(l => { out[l] = RECORD_DEFAULT_OPTIONS[l].slice(); });
    return out;
  }
  const values = sheet.getDataRange().getValues();
  const headers = (values[0] || []).map(h => normText_(h));
  headers.forEach((h, c) => {
    if (!OPTION_LIST_RE.test(h) || out[h]) return;
    const seen = {};
    out[h] = [];
    for (let r = 1; r < values.length; r++) {
      const v = normText_(values[r][c] instanceof Date ? fmtDate_(values[r][c]) : values[r][c]);
      if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; out[h].push(v); }
    }
  });
  // รายการที่ชีตยังไม่มีคอลัมน์ (เพิ่งเพิ่มในรุ่นใหม่) หรือคอลัมน์ว่างทั้งคอลัมน์: ใช้ค่าตั้งต้น
  Object.keys(RECORD_DEFAULT_OPTIONS).forEach(l => { if (!out[l] || !out[l].length) out[l] = RECORD_DEFAULT_OPTIONS[l].slice(); });
  return out;
}

/**
 * ตั้งค่าตัวเลือกของดรอปดาวน์ 1 รายการจากหน้าตั้งค่า — payload: { list, values: [ข้อความ] } (แทนที่ทั้งรายการตามลำดับที่ส่งมา)
 * ลบตัวเลือกออกไม่กระทบเวชระเบียนที่บันทึกไปแล้ว (เวชระเบียนเก็บเป็นข้อความ) · ส่งรายการว่าง = กลับไปใช้ค่าตั้งต้นของรายการนั้น
 */
function setRecordOptions_(payload, auth) {
  const list = normText_(payload.list);
  if (!OPTION_LIST_RE.test(list)) return { ok: false, error: 'ชื่อรายการไม่ถูกต้อง' };
  if (!Array.isArray(payload.values)) return { ok: false, error: 'ไม่ได้ส่งรายการตัวเลือก' };
  if (payload.values.length > OPTION_MAX_ITEMS) return { ok: false, error: 'ตัวเลือกมากเกินไป (สูงสุด ' + OPTION_MAX_ITEMS + ' รายการ)' };
  const values = [], seen = {};
  for (let i = 0; i < payload.values.length; i++) {
    if (typeof payload.values[i] !== 'string' && typeof payload.values[i] !== 'number') return { ok: false, error: 'ตัวเลือกต้องเป็นข้อความ' };
    const v = normText_(payload.values[i]).replace(/\s+/g, ' ');
    if (!v) continue;
    if (v.length > OPTION_MAX_TEXT) return { ok: false, error: 'ตัวเลือกยาวเกินไป (สูงสุด ' + OPTION_MAX_TEXT + ' ตัวอักษร): ' + v.slice(0, 20) + '...' };
    if (seen[v.toLowerCase()]) continue;
    seen[v.toLowerCase()] = true;
    values.push(v);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureRecordInfra_();
    const sheet = recSheet_(SHEET_RECORD_OPTIONS);
    const headers = recAddColumns_(sheet, [list]);
    const col = headers.indexOf(list) + 1;
    const depth = Math.max(sheet.getLastRow() - 1, values.length, 1);
    recEnsureGrid_(sheet, depth + 1, col);
    const block = [];
    for (let r = 0; r < depth; r++) block.push([r < values.length ? values[r] : '']);
    sheet.getRange(2, col, depth, 1).setNumberFormat('@').setValues(block);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    invalidateCache_(SHEET_RECORD_OPTIONS);
  }
  recordLog_(auth, 'options:' + list, '', '');
  return { ok: true, data: { list: list, values: recordOptions_()[list] || [] } };
}
/**
 * เติมตัวเลือกตั้งต้น (จากแบบฟอร์มเวชระเบียนเดิม) ที่ชีต RecordOptions ยังไม่มี ต่อท้ายแต่ละรายการ — กดจากหน้าตั้งค่า
 * ไม่ลบและไม่เรียงตัวเลือกที่มีอยู่ กดซ้ำได้ (ตัวที่มีแล้วไม่ถูกเพิ่มซ้ำ ไม่สนตัวพิมพ์เล็กใหญ่)
 */
function seedRecordOptions_(auth) {
  let added = 0, lists = 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureRecordInfra_();
    const sheet = recSheet_(SHEET_RECORD_OPTIONS);
    Object.keys(RECORD_DEFAULT_OPTIONS).forEach(list => {
      const defs = RECORD_DEFAULT_OPTIONS[list];
      if (!defs.length) return;
      const headers = recAddColumns_(sheet, [list]);
      const col = headers.indexOf(list) + 1;
      const colVals = sheet.getRange(1, col, Math.max(sheet.getLastRow(), 1), 1).getValues();
      let last = colVals.length;
      while (last > 1 && normText_(colVals[last - 1][0]) === '') last--;
      const have = colVals.slice(1, last).map(r => normText_(r[0] instanceof Date ? fmtDate_(r[0]) : r[0]).toLowerCase());
      const add = defs.filter(v => have.indexOf(v.toLowerCase()) === -1);
      if (!add.length) return;
      recEnsureGrid_(sheet, last + add.length, col);
      sheet.getRange(last + 1, col, add.length, 1).setNumberFormat('@').setValues(add.map(v => [v]));
      added += add.length; lists++;
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    invalidateCache_(SHEET_RECORD_OPTIONS);
  }
  recordLog_(auth, 'options:seed', '', '');
  return { ok: true, data: { added: added, lists: lists, options: recordOptions_() } };
}

/** เติมค่าที่ผู้ใช้พิมพ์เองต่อท้ายรายการตัวเลือก (ผู้เรียกถือตัวล็อกอยู่แล้ว) — learn: { ชื่อรายการ: [ค่า] } */
function recordLearnOptions_(learn) {
  if (!learn || typeof learn !== 'object') return;
  const sheet = recSheet_(SHEET_RECORD_OPTIONS);
  if (!sheet) return;
  const current = recordOptions_();
  let changed = false;
  Object.keys(learn).slice(0, 60).forEach(list => {
    if (!OPTION_LIST_RE.test(list) || !Array.isArray(learn[list])) return;
    const have = (current[list] || []).map(v => v.toLowerCase());
    const add = [];
    learn[list].slice(0, 10).forEach(v => {
      const s = normText_(v).slice(0, 60);
      if (s && have.indexOf(s.toLowerCase()) === -1) { have.push(s.toLowerCase()); add.push(s); }
    });
    if (!add.length) return;
    const headers = recAddColumns_(sheet, [list]);
    const col = headers.indexOf(list) + 1;
    const colVals = sheet.getRange(1, col, Math.max(sheet.getLastRow(), 1), 1).getValues();
    let last = colVals.length;
    while (last > 1 && normText_(colVals[last - 1][0]) === '') last--;
    // คอลัมน์ยังว่าง (รายการนี้ใช้ค่าตั้งต้นอยู่): เขียนค่าตั้งต้นลงไปก่อน ไม่งั้นค่าที่เพิ่งจำจะกลายเป็นตัวเลือกเดียวของรายการ
    const rows = (last === 1 ? (RECORD_DEFAULT_OPTIONS[list] || []) : []).concat(add);
    recEnsureGrid_(sheet, last + rows.length, col);
    sheet.getRange(last + 1, col, rows.length, 1).setNumberFormat('@').setValues(rows.map(v => [v]));
    changed = true;
  });
  if (changed) invalidateCache_(SHEET_RECORD_OPTIONS);
}

/** ข้อมูลตั้งต้นของแบบฟอร์ม: ตัวเลือกดรอปดาวน์ รายการทดสอบพร้อมเกณฑ์ และตารางค่าปกติ */
function getRecordSetup_() {
  return {
    ok: true,
    data: {
      options: recordOptions_(),
      tests: assessTestsAll_().filter(t => t.active).map(t => ({ key: t.key, group: t.group, name: t.name, unit: t.unit, better: t.better,
        riskBelow: t.riskBelow, riskAbove: t.riskAbove, interpret: t.interpret, askName: t.askName })),
      norms: assessNorms_()
    }
  };
}

/** เพศ ('M'/'F') และวันเกิด ('yyyy-MM-dd') ของคนไข้จากทะเบียน */
function patientExtra_(p) {
  const sexRaw = normText_(p.sex).toUpperCase();
  const bd = recDate_(p.birthDate);
  let sex = /^(M|ชาย)$/.test(sexRaw) ? 'M' : (/^(F|หญิง)$/.test(sexRaw) ? 'F' : '');
  // พระสงฆ์ / สามเณร เป็นผู้ชาย: ยังไม่ได้ระบุเพศ ใช้เกณฑ์ของผู้ชาย
  if (!sex && isMonk_(p.firstName)) sex = 'M';
  return { sex: sex, birthDate: recValidDate_(bd) ? bd : '' };
}
function isMonk_(firstName) {
  return /^(พระ|สามเณร|หลวงพ่อ|หลวงปู่|หลวงพี่|หลวงตา|ภิกษุ)/.test(normText_(firstName).replace(/\s+/g, ''));
}
function recordPatient_(reg) {
  return Object.assign(publicPatient_(reg), patientExtra_(reg));
}
/** บันทึกเพศ/วันเกิดลงทะเบียนคนไข้ (เฉพาะช่องที่ส่งมา) — คืนข้อความผิดพลาด หรือ '' เมื่อสำเร็จ */
function setPatientExtra_(ptn, extra) {
  if (!extra || typeof extra !== 'object') return '';
  const set = {};
  if (extra.sex !== undefined) {
    const s = normText_(extra.sex).toUpperCase();
    if (s !== '' && s !== 'M' && s !== 'F') return 'เพศไม่ถูกต้อง';
    set.sex = s;
  }
  if (extra.birthDate !== undefined) {
    const b = normText_(extra.birthDate);
    if (b !== '' && (!recValidDate_(b) || b > todayStr_() || b < '1900-01-01')) return 'วันเกิดไม่ถูกต้อง';
    set.birthDate = b;
  }
  if (!Object.keys(set).length) return '';
  const sheet = recSheet_(SHEET_PATIENTS);
  invalidateCache_(SHEET_PATIENTS);
  const row = patientsData_().find(p => normText_(p.ptn) === ptn);
  if (!sheet || !row) return 'ไม่พบคนไข้ ' + ptn + ' ในทะเบียน';
  const now = patientExtra_(row);
  const todo = Object.keys(set).filter(k => set[k] !== now[k]);
  if (!todo.length) return '';
  const headers = recAddColumns_(sheet, ['birthDate', 'sex']);
  todo.forEach(k => sheet.getRange(row._row, headers.indexOf(k) + 1).setNumberFormat('@').setValue(set[k]));
  invalidateCache_(SHEET_PATIENTS);
  return '';
}

/**
 * บันทึกการเข้าถึงเวชระเบียน (ชีต RecordLog): ใคร ทำอะไร กับเวชระเบียนของใคร เมื่อไร
 * action: list = เปิดรายการเวชระเบียนของคนไข้ · recent = เปิดเมนูเวชระเบียน · view = เปิดอ่าน · create / update / delete
 * เขียนไม่สำเร็จก็ไม่ขวางงานรักษา (ไม่โยนข้อผิดพลาดต่อ)
 */
const SHEET_RECORD_LOG = 'RecordLog';
function recordLog_(auth, action, recordId, ptn) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_RECORD_LOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_RECORD_LOG);
      sheet.getRange(1, 1, 1, 5).setValues([['time', 'user', 'action', 'recordId', 'ptn']]);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), String((auth && auth.username) || ''), action, String(recordId || ''), String(ptn || '')]);
  } catch (e) { /* บันทึกการเข้าถึงเป็นงานเสริม */ }
}

function recordMeta_(r) {
  return { id: normText_(r.id), ptn: normText_(r.ptn), session: recNum_(r.session) || 0, kind: normText_(r.kind) || 'initial', date: recDate_(r.date),
    status: normText_(r.status) === 'final' ? 'final' : 'draft', createdAt: normText_(r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt),
    createdBy: normText_(r.createdBy), updatedAt: normText_(r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt), updatedBy: normText_(r.updatedBy) };
}
function recordCell_(v) {
  if (v instanceof Date) { try { return fmtDate_(v); } catch (e) { return ''; } }
  return v === undefined || v === null ? '' : String(v);
}
/** ทุกช่องของแบบฟอร์มที่มีค่าในแถวนั้น { ช่อง: ข้อความ } */
function recordData_(row) {
  const data = {};
  Object.keys(row).forEach(k => {
    if (!RECORD_KEY_RE.test(k)) return;
    const v = recordCell_(row[k]);
    if (v !== '') data[k] = v;
  });
  return data;
}
/** ลำดับเวลาของเวชระเบียนใน session เดียวกัน: แรกรับมาก่อนเสมอ แล้วเรียงตามวันที่รับบริการ และเวลาที่สร้าง */
function recordOrder_(a, b) {
  if (a.kind !== b.kind) return a.kind === 'initial' ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : (a.createdAt > b.createdAt ? 1 : 0);
}
/**
 * ใส่ "ครั้งที่" (visit) ให้เวชระเบียนของคนไข้ 1 คน: แรกรับ = ครั้งที่ 1, Progress note นับต่อตามลำดับเวลาใน session นั้น
 * ถ้านักกายภาพแก้เลขครั้งที่เองในแบบฟอร์ม (pn_visit) ใช้เลขนั้น — list = [{ meta..., _row }] ของคนไข้คนเดียว
 */
function recordVisits_(list) {
  const bySession = {};
  list.forEach(m => { (bySession[m.session] = bySession[m.session] || []).push(m); });
  Object.keys(bySession).forEach(sn => {
    let n = 0, hasInitial = false;
    bySession[sn].sort(recordOrder_).forEach(m => {
      if (m.kind === 'initial') { if (!hasInitial) { hasInitial = true; n = 1; } m.visit = 1; return; }
      n = Math.max(n, 1) + 1;
      const typed = recNum_(m._row.pn_visit);
      m.visit = typed !== null && typed >= 1 && typed <= 999 ? Math.floor(typed) : n;
      n = m.visit;
    });
  });
  return list;
}
/** บรรทัดสรุปการรักษาของเวชระเบียน 1 ฉบับ (ใช้ในรายการ) เช่น "US, ES, Stretching exs." */
function recordTxSummary_(row) {
  const out = [];
  Object.keys(row).forEach(k => { if (/^p5_[me]\d+_type$/.test(k) && recordCell_(row[k])) out.push(recordCell_(row[k])); });
  [['p5_amb', 'Ambulation'], ['p5_tr', 'Transfer'], ['p5_bal', 'Balance']].forEach(x => { if (recordCell_(row[x[0]]) === 'Y') out.push(x[1]); });
  return out.filter((v, i) => out.indexOf(v) === i).slice(0, 8).join(', ');
}

/**
 * ข้อมูลประกอบของ Progress note 1 ฉบับ: แบบแรกรับของ session (การวินิจฉัย เป้าหมาย ข้อควรระวัง ค่าตั้งต้น)
 * เวชระเบียนครั้งก่อนหน้า (ใช้ดึงการรักษาเดิมมาใช้ และเทียบผล) เลขครั้งที่ และนัดครั้งต่อไปในระบบ
 * self = { id, date, createdAt } ของฉบับที่เปิดอยู่ หรือ null เมื่อกำลังจะเปิดฉบับใหม่
 */
function recordContext_(ptn, session, self) {
  const mine = recRows_(SHEET_RECORDS).filter(r => normText_(r.id) && normText_(r.ptn) === ptn).map(r => Object.assign(recordMeta_(r), { _row: r }));
  recordVisits_(mine);
  const inSession = mine.filter(m => m.session === session).sort(recordOrder_);
  const initial = inSession.find(m => m.kind === 'initial') || null;
  let before = inSession;
  if (self) {
    const at = inSession.findIndex(m => m.id === self.id);
    before = at === -1 ? inSession : inSession.slice(0, at);
  }
  const prev = before.length ? before[before.length - 1] : null;
  const me = self ? inSession.find(m => m.id === self.id) : null;
  const lastNote = before.filter(m => m.kind === 'progress').pop();
  const pack = m => m ? { id: m.id, kind: m.kind, date: m.date, status: m.status, visit: m.visit, data: recordData_(m._row) } : null;
  // นัดครั้งต่อไป: นัดที่ยังไม่ยกเลิกและยังไม่ได้มา ถัดจากวันที่รับบริการของฉบับนี้ (ฉบับใหม่ = ถัดจากวันนี้)
  const ref = self && self.date ? self.date : todayStr_();
  let next = null;
  sheetData_(SHEET_APPTS).forEach(a => {
    if (!a.id || !a.date || normText_(a.ptn) !== ptn || a.status !== 'active' || a.attendedAt) return;
    let date;
    try { date = fmtDate_(a.date); } catch (e) { return; }
    if (date <= ref) return;
    const start = normText_(a.startTime);
    if (!next || date + ' ' + start < next.date + ' ' + next.startTime) next = { date: date, startTime: start, endTime: normText_(a.endTime) };
  });
  return { session: session, initial: pack(initial), prev: pack(prev), visit: me ? me.visit : (lastNote ? lastNote.visit : 1) + 1, nextAppt: next };
}

/**
 * บันทึกว่าให้คนไข้ทำแบบประเมินความพึงพอใจแล้ว — 1 ครั้งต่อ session (payload: { ptn, session })
 * เก็บแค่วันที่และผู้กด คำตอบของแบบประเมินไม่ผูกกับคนไข้ (แบบประเมินยังไม่ระบุตัวตน)
 */
function markSatisfaction_(payload, auth) {
  const ptn = normText_(payload.ptn);
  const session = Math.floor(Number(payload.session));
  if (!ptn || !(session >= 1)) return { ok: false, error: 'ไม่ได้ระบุคนไข้หรือ session' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let at = '';
  try {
    invalidateCache_(SHEET_RECORDS);
    const sheet = recSheet_(SHEET_RECORDS);
    const row = sheet ? sheetData_(SHEET_RECORDS).find(r => normText_(r.id) && normText_(r.ptn) === ptn && (recNum_(r.session) || 0) === session && (normText_(r.kind) || 'initial') === 'initial') : null;
    if (!row) return { ok: false, error: 'ยังไม่มีแบบประเมินครั้งแรกของ session นี้' };
    at = recordCell_(row.pn_sat_at);
    if (at) return { ok: true, data: { already: true, at: at } };
    at = todayStr_();
    const headers = recAddColumns_(sheet, ['pn_sat_at', 'pn_sat_by']);
    sheet.getRange(row._row, headers.indexOf('pn_sat_at') + 1).setNumberFormat('@').setValue(at);
    sheet.getRange(row._row, headers.indexOf('pn_sat_by') + 1).setNumberFormat('@').setValue(String(auth.username || ''));
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    invalidateCache_(SHEET_RECORDS);
  }
  recordLog_(auth, 'satisfaction', '', ptn);
  return { ok: true, data: { already: false, at: at } };
}
/** จำนวน session ที่ให้ทำแบบประเมินแล้วในช่วงนี้ (ตามวันที่กด) */
function satisfactionGiven_(from, to) {
  return recRows_(SHEET_RECORDS).filter(r => { const d = recordCell_(r.pn_sat_at).slice(0, 10); return d && d >= from && d <= to; }).length;
}

/** ข้อมูลประกอบสำหรับเปิด Progress note ฉบับใหม่ — payload: { ptn, session } */
function getRecordContext_(payload, auth) {
  const ptn = normText_(payload.ptn);
  const session = Math.floor(Number(payload.session));
  if (!ptn) return { ok: false, error: 'ไม่ได้ระบุ PTN' };
  if (!(session >= 1)) return { ok: false, error: 'ไม่ได้ระบุ session' };
  const reg = patientsData_().find(p => normText_(p.ptn) === ptn);
  if (!reg) return { ok: false, error: 'ไม่พบคนไข้ ' + ptn + ' ในทะเบียน' };
  const context = recordContext_(ptn, session, null);
  if (!context.initial) return { ok: false, error: 'ยังไม่มีแบบประเมินครั้งแรกของ session นี้ เปิด session และบันทึกแบบประเมินครั้งแรกก่อน' };
  recordLog_(auth, 'view', context.initial.id, ptn);
  return { ok: true, data: { patient: recordPatient_(reg), today: todayStr_(), context: context, field: fieldAssessments_(ptn).list } };
}

/** รายการเวชระเบียนของคนไข้ 1 คน (ใหม่สุดก่อน) — payload: { ptn } */
function getPatientRecords_(payload, auth) {
  const ptn = normText_(payload.ptn);
  if (!ptn) return { ok: false, error: 'ไม่ได้ระบุ PTN' };
  const reg = patientsData_().find(p => normText_(p.ptn) === ptn);
  if (!reg) return { ok: false, error: 'ไม่พบคนไข้ ' + ptn + ' ในทะเบียน' };
  // session ใหม่สุดก่อน ใน session เดียวกัน: แบบแรกรับ แล้วตามด้วย Progress note ตามลำดับเวลา
  const records = recordVisits_(recRows_(SHEET_RECORDS).filter(r => normText_(r.id) && normText_(r.ptn) === ptn).map(r => Object.assign(recordMeta_(r), { _row: r }))).map(m => {
    const r = m._row;
    delete m._row;
    if (m.kind === 'progress') {
      m.nrsPre = recordCell_(r.p5_nrs_pre); m.nrsPost = recordCell_(r.p5_nrs_post);
      m.treatments = recordTxSummary_(r);
      m.signer = recordCell_(r.pn_sign);
      m.finalBy = recordCell_(r.pn_final_by);
    } else {
      m.chiefComplaint = recordCell_(r.p1_cc);
      m.medicalDx = [r.p1_mdx1, r.p1_mdx2, r.p1_mdx3, r.p1_mdx4].map(recordCell_).filter(Boolean).join(', ');
      m.ptDx = recordCell_(r.p1_ptdx);
      m.satAt = recordCell_(r.pn_sat_at);
    }
    return m;
  }).sort((a, b) => (b.session - a.session) || recordOrder_(a, b));
  if (records.length) recordLog_(auth, 'list', '', ptn);
  const fa = fieldAssessments_(ptn);
  if (!records.length && fa.list.length) recordLog_(auth, 'list', '', ptn);
  return { ok: true, data: { ptn: ptn, today: todayStr_(), patient: recordPatient_(reg), records: records, field: fa.list, fieldError: fa.error } };
}

/** เวชระเบียนที่บันทึก/แก้ไขล่าสุดของทุกคน (ใหม่สุดก่อน สูงสุด 40 ชุด) พร้อมชื่อคนไข้ — ใช้ในเมนูเวชระเบียน */
function getRecentRecords_(auth) {
  const names = {};
  patientsData_().forEach(p => { names[normText_(p.ptn)] = publicPatient_(p); });
  const all = recRows_(SHEET_RECORDS).filter(r => normText_(r.id) && normText_(r.ptn));
  const cc = {}; // Chief complaint ของ session (Progress note ไม่มีช่องนี้ ใช้ของแบบแรกรับ)
  all.forEach(r => { if ((normText_(r.kind) || 'initial') === 'initial') cc[normText_(r.ptn) + '|' + (recNum_(r.session) || 0)] = recordCell_(r.p1_cc); });
  const records = all.map(r => {
    const m = recordMeta_(r);
    const p = names[m.ptn];
    return { id: m.id, ptn: m.ptn, firstName: p ? p.firstName : '', lastName: p ? p.lastName : '', session: m.session, kind: m.kind, date: m.date, status: m.status,
      chiefComplaint: cc[m.ptn + '|' + m.session] || '', stamp: m.updatedAt || m.createdAt };
  }).sort((a, b) => a.stamp < b.stamp ? 1 : (a.stamp > b.stamp ? -1 : 0));
  if (records.length) recordLog_(auth, 'recent', '', '');
  return { ok: true, data: { total: records.length, drafts: records.filter(r => r.status !== 'final').length, records: records.slice(0, 40) } };
}

/** เวชระเบียน 1 ชุดพร้อมทุกช่องในแบบฟอร์ม — payload: { id } */
function getRecord_(payload, auth) {
  const id = normText_(payload.id);
  const row = id ? recRows_(SHEET_RECORDS).find(r => normText_(r.id) === id) : null;
  if (!row) return { ok: false, error: 'ไม่พบเวชระเบียนนี้' };
  const meta = recordMeta_(row);
  const data = recordData_(row);
  const reg = patientsData_().find(p => normText_(p.ptn) === meta.ptn);
  recordLog_(auth, 'view', meta.id, meta.ptn);
  const out = { record: Object.assign(meta, { data: data }), patient: reg ? recordPatient_(reg) : null, today: todayStr_(), field: fieldAssessments_(meta.ptn).list };
  if (meta.kind === 'progress') {
    out.context = recordContext_(meta.ptn, meta.session, { id: meta.id, date: meta.date, createdAt: meta.createdAt });
    // Progress note ที่บันทึกเป็นฉบับจริงแล้ว แก้ได้เฉพาะผู้ที่กดบันทึก
    out.record.locked = meta.status === 'final' && !!data.pn_final_by && data.pn_final_by !== auth.username;
  }
  return { ok: true, data: out };
}

/**
 * บันทึกเวชระเบียน — payload: { id?, ptn, date, status: 'draft'|'final', data: { ช่อง: ค่า }, patient?: { sex, birthDate }, learn?: { รายการ: [ค่า] },
 *                              kind?: 'progress', session? (ของ Progress note ฉบับใหม่) }
 * ไม่มี id = เปิด session ใหม่ของคนไข้คนนี้ (เลข session ถัดไป) หรือ Progress note ฉบับใหม่ของ session ที่ระบุ
 * มี id = แก้ไขชุดเดิม (ทุกช่องถูกแทนที่ด้วยค่าที่ส่งมา ชนิดของเวชระเบียนเปลี่ยนไม่ได้)
 * ชุดที่บันทึกเป็น final แล้วยังแก้ไขได้ (มีชื่อผู้แก้และเวลา) แต่ถอยกลับเป็นร่างไม่ได้
 * Progress note ที่เป็น final แล้ว แก้ได้เฉพาะผู้ที่กดบันทึกฉบับจริง (ตามเกณฑ์ตรวจเวชระเบียน: ต้องไม่ถูกแก้ไขโดยผู้อื่น)
 */
function saveRecord_(payload, auth) {
  const ptn = normText_(payload.ptn);
  const date = String(payload.date || '');
  if (!ptn) return { ok: false, error: 'ไม่ได้ระบุ PTN' };
  if (!recValidDate_(date)) return { ok: false, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (date > todayStr_()) return { ok: false, error: 'วันที่ประเมินต้องไม่เกินวันนี้' };
  if (!patientsData_().some(p => normText_(p.ptn) === ptn)) return { ok: false, error: 'ไม่พบคนไข้ ' + ptn + ' ในทะเบียน' };
  let status = payload.status === 'final' ? 'final' : 'draft';

  const input = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {};
  const keys = Object.keys(input);
  if (keys.length > RECORD_MAX_KEYS) return { ok: false, error: 'ข้อมูลในแบบฟอร์มมากเกินไป' };
  const data = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (!RECORD_KEY_RE.test(k)) return { ok: false, error: 'ช่องในแบบฟอร์มไม่ถูกต้อง: ' + k };
    if (RECORD_SERVER_KEYS.indexOf(k) !== -1) continue;
    let v = input[k];
    if (v === true) v = 'Y';
    else if (v === false || v === null || v === undefined) v = '';
    else if (typeof v === 'number') { if (!isFinite(v)) return { ok: false, error: 'ค่าตัวเลขไม่ถูกต้อง: ' + k }; v = String(v); }
    else if (typeof v === 'string') v = v.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, RECORD_MAX_TEXT);
    else return { ok: false, error: 'ค่าในช่องไม่ถูกต้อง: ' + k };
    if (v !== '') data[k] = v;
  }
  // ผลทดสอบสมรรถภาพต้องเป็นตัวเลข (ช่องชื่อแบบสอบถามลงท้าย _label เป็นข้อความได้)
  // (คะแนนอรรถประโยชน์ EQ-5D-5L ติดลบได้ ต่ำสุดประมาณ -0.283 = สภาวะที่แย่กว่าเสียชีวิต)
  const badNum = Object.keys(data).find(k => /^pt_/.test(k) && !/_label$/.test(k) &&
    (recNum_(data[k]) === null || recNum_(data[k]) < (k === 'pt_eq5d' ? -1 : 0) || recNum_(data[k]) > 99999));
  if (badNum) return { ok: false, error: 'ผลทดสอบต้องเป็นตัวเลข 0-99999: ' + badNum.slice(3) };
  const badNrs = ['p2_nrs_rest', 'p2_nrs_func', 'p5_nrs_pre', 'p5_nrs_post'].find(k => data[k] !== undefined && !/^(10|[0-9])$/.test(data[k]));
  if (badNrs) return { ok: false, error: 'NRS ต้องเป็นเลข 0-10' };
  if (data.p1_consent !== undefined && data.p1_consent !== 'signed' && data.p1_consent !== 'verbal') return { ok: false, error: 'ค่าการยินยอมไม่ถูกต้อง' };
  // ตัวเลขของ Progress note และการรักษา: องศา ROM, จำนวนจุด, นาทีต่อจุด, ร้อยละที่ดีขึ้น, ครั้งที่
  const numRule = k => /^p2_rom\d*_deg$/.test(k) ? [0, 360] : (/^p5_m\d+_(pts|min)$/.test(k) ? [0, 999] : (k === 'pn_s_pct' ? [0, 100] : (k === 'pn_visit' ? [1, 999] : null)));
  const badRange = Object.keys(data).find(k => { const r = numRule(k); return r && (recNum_(data[k]) === null || recNum_(data[k]) < r[0] || recNum_(data[k]) > r[1]); });
  if (badRange) return { ok: false, error: 'ค่าตัวเลขไม่ถูกต้อง: ' + badRange };
  // วันที่ consult (วันที่ส่งปรึกษา/ขอรับบริการ) ใช้คิดระยะรอคอยถึงวันที่รับบริการ — ต้องไม่หลังวันที่รับบริการ
  if (data.p1_consult !== undefined && (!recValidDate_(data.p1_consult) || data.p1_consult > date)) return { ok: false, error: 'วันที่ consult ต้องไม่หลังวันที่ประเมิน' };
  if (data.pn_p_next !== undefined && !recValidDate_(data.pn_p_next)) return { ok: false, error: 'วันนัดครั้งต่อไปไม่ถูกต้อง' };
  // ข้อกำหนดของฉบับจริง ขึ้นกับชนิดของเวชระเบียน (ตรวจหลังรู้ชนิดแน่นอนแล้ว)
  const finalError = kind => {
    if (kind === 'progress') {
      const treated = Object.keys(data).some(k => /^p5_[me]\d+_type$/.test(k)) || ['p5_amb', 'p5_tr', 'p5_bal', 'p5_other'].some(k => data[k] === 'Y');
      if (!treated) return 'เพิ่มการรักษาที่ให้ในครั้งนี้อย่างน้อย 1 รายการก่อนบันทึก (หรือกด บันทึกร่าง ไว้ก่อน)';
      if (!data.pn_sign) return 'เลือกผู้ลงชื่อ (นักกายภาพบำบัด) ก่อนบันทึก (หรือกด บันทึกร่าง ไว้ก่อน)';
      return '';
    }
    if (!data.p1_cc) return 'กรอก Chief complaint ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    if (!data.p1_consent) return 'บันทึกการยินยอมของคนไข้ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    return '';
  };
  const wantKind = payload.kind === 'progress' ? 'progress' : 'initial';
  // ฉบับใหม่รู้ชนิดจากคำขอ ตรวจได้เลยโดยไม่ต้องรอตัวล็อก (ฉบับเดิมตรวจอีกครั้งหลังอ่านชนิดจริงจากชีต)
  if (!normText_(payload.id) && status === 'final' && finalError(wantKind)) return { ok: false, error: finalError(wantKind) };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let id = normText_(payload.id), session = 0, updated = false, kind = wantKind;
  try {
    ensureRecordInfra_();
    // เพศ/วันเกิดตรวจและบันทึกก่อน ถ้าไม่ถูกต้องจะยังไม่เขียนเวชระเบียน
    const perr = setPatientExtra_(ptn, payload.patient);
    if (perr) return { ok: false, error: perr };
    invalidateCache_(SHEET_RECORDS);
    const sheet = recSheet_(SHEET_RECORDS);
    const rows = sheetData_(SHEET_RECORDS).filter(r => normText_(r.id));
    const nowIso = new Date().toISOString();
    let meta, rowIndex;
    if (id) {
      const existing = rows.find(r => normText_(r.id) === id);
      if (!existing) return { ok: false, error: 'ไม่พบเวชระเบียนนี้ (อาจถูกลบไปแล้ว)' };
      meta = recordMeta_(existing);
      if (meta.ptn !== ptn) return { ok: false, error: 'เวชระเบียนนี้เป็นของคนไข้คนอื่น' };
      kind = meta.kind;
      const finalBy = recordCell_(existing.pn_final_by);
      if (kind === 'progress' && meta.status === 'final' && finalBy && finalBy !== auth.username) {
        return { ok: false, error: 'Progress note ที่บันทึกแล้วแก้ไขได้เฉพาะผู้บันทึก (' + finalBy + ')' };
      }
      if (meta.status === 'final') status = 'final';
      ['pn_sat_at', 'pn_sat_by'].forEach(k => { const v = recordCell_(existing[k]); if (v) data[k] = v; });
      if (status === 'final' && finalError(kind)) return { ok: false, error: finalError(kind) };
      if (kind === 'progress') {
        const first = rows.find(r => normText_(r.ptn) === ptn && (recNum_(r.session) || 0) === meta.session && (normText_(r.kind) || 'initial') === 'initial');
        if (first && date < recDate_(first.date)) return { ok: false, error: 'วันที่ของ Progress note ต้องไม่ก่อนวันประเมินครั้งแรก (' + recDate_(first.date) + ')' };
      }
      if (kind === 'progress' && status === 'final') {
        data.pn_final_by = finalBy || auth.username;
        data.pn_final_at = recordCell_(existing.pn_final_at) || nowIso;
      }
      meta.date = date; meta.status = status; meta.updatedAt = nowIso; meta.updatedBy = auth.username;
      rowIndex = existing._row;
      updated = true;
    } else {
      id = Utilities.getUuid();
      const mine = rows.filter(r => normText_(r.ptn) === ptn);
      if (kind === 'progress') {
        // Progress note ต้องอยู่ใน session ที่มีแบบประเมินครั้งแรกแล้ว และวันที่ต้องไม่ก่อนวันประเมินครั้งแรก
        session = Math.floor(Number(payload.session));
        const first = mine.find(r => (recNum_(r.session) || 0) === session && (normText_(r.kind) || 'initial') === 'initial');
        if (!(session >= 1) || !first) return { ok: false, error: 'ยังไม่มีแบบประเมินครั้งแรกของ session นี้' };
        if (date < recDate_(first.date)) return { ok: false, error: 'วันที่ของ Progress note ต้องไม่ก่อนวันประเมินครั้งแรก (' + recDate_(first.date) + ')' };
        if (status === 'final') { data.pn_final_by = auth.username; data.pn_final_at = nowIso; }
      } else {
        session = mine.reduce((m, r) => Math.max(m, recNum_(r.session) || 0), 0) + 1;
      }
      meta = { id: id, ptn: ptn, session: session, kind: kind, date: date, status: status, createdAt: nowIso, createdBy: auth.username, updatedAt: '', updatedBy: '' };
      rowIndex = sheet.getLastRow() + 1;
    }
    session = meta.session;
    const headers = recAddColumns_(sheet, RECORD_META_HEADERS.concat(Object.keys(data)));
    recEnsureGrid_(sheet, rowIndex, headers.length);
    const values = headers.map(h => {
      if (RECORD_META_HEADERS.indexOf(h) !== -1) return String(meta[h] === undefined || meta[h] === null ? '' : meta[h]);
      return data[h] !== undefined ? data[h] : '';
    });
    sheet.getRange(rowIndex, 1, 1, headers.length).setNumberFormat('@').setValues([values]);
    recordLearnOptions_(payload.learn);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    invalidateCache_(SHEET_RECORDS);
  }
  recordLog_(auth, updated ? 'update' : 'create', id, ptn);
  return { ok: true, data: { id: id, session: session, status: status, updated: updated, kind: kind } };
}

/** ลบเวชระเบียน — ลบได้เฉพาะฉบับร่าง (ฉบับที่บันทึกแล้วแก้ไขได้แต่ลบจากหน้าเว็บไม่ได้) */
function deleteRecord_(payload, auth) {
  const id = normText_(payload.id);
  let ptn = '';
  const sheet = recSheet_(SHEET_RECORDS);
  if (!id || !sheet) return { ok: false, error: 'ไม่พบเวชระเบียนนี้' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    invalidateCache_(SHEET_RECORDS);
    const row = sheetData_(SHEET_RECORDS).find(r => normText_(r.id) === id);
    if (!row) return { ok: false, error: 'ไม่พบเวชระเบียนนี้ (อาจถูกลบไปแล้ว)' };
    if (normText_(row.status) === 'final') return { ok: false, error: 'ลบได้เฉพาะฉบับร่าง เวชระเบียนที่บันทึกแล้วลบจากหน้าเว็บไม่ได้' };
    ptn = normText_(row.ptn);
    // แบบแรกรับที่มี Progress note ตามหลังแล้วลบไม่ได้ (Progress note จะไม่มีการวินิจฉัยและเป้าหมายให้อ้างถึง)
    if ((normText_(row.kind) || 'initial') === 'initial' && sheetData_(SHEET_RECORDS).some(r => normText_(r.id) && normText_(r.ptn) === ptn &&
      (recNum_(r.session) || 0) === (recNum_(row.session) || 0) && normText_(r.kind) === 'progress')) {
      return { ok: false, error: 'session นี้มี Progress note แล้ว ลบแบบประเมินครั้งแรกไม่ได้' };
    }
    sheet.deleteRow(row._row);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
    invalidateCache_(SHEET_RECORDS);
  }
  recordLog_(auth, 'delete', id, ptn);
  return { ok: true };
}

/* ---------------------------- AppSheet: ให้ผู้ช่วยประเมินคนไข้นอกระบบนี้ แล้วผลโยงเข้าเวชระเบียน ---------------------------- */
// แอป AppSheet (สร้างในบัญชี Google ของเจ้าของชีต) อ่าน/เขียนแท็บ 2 แท็บในสเปรดชีตนี้:
//   AS_Patients     : รายชื่อคนไข้สำหรับให้เลือกในแอป มีแค่ PTN กับชื่อ (ไม่มีเลขบัตร เบอร์โทร ที่อยู่) — เป็นสูตรดึงจากแท็บ Patients อัปเดตเอง
//   AS_NewPatients  : คำขอเพิ่มคนไข้ใหม่จากแอป — syncAppSheet() ตรวจทุก 5 นาที: ถ้าเป็นคนไข้เดิมคืน PTN เดิม ถ้าไม่ใช่ออก PTN ใหม่ แล้วเขียน PTN กลับลงแถวนั้น
//   AS_Assessments  : ผลประเมิน 1 แถวต่อการประเมิน 1 ครั้ง หัวคอลัมน์เป็นชื่อที่คนอ่านเข้าใจ (แอปใช้เป็นชื่อช่อง)
//   AS_Columns      : บอกว่าหัวคอลัมน์ใดของ AS_Assessments คือช่องใดในเวชระเบียน (ระบบใช้ ไม่ต้องเพิ่มในแอป)
// หน้าเวชระเบียนอ่าน AS_Assessments ตาม PTN: แสดงในหน้าคนไข้ และดึงมาเติมแบบฟอร์มให้นักกายภาพตรวจก่อนบันทึก
// (ผลจากแอปไม่ถูกเขียนลงเวชระเบียนเองโดยไม่มีคนตรวจ) ความพึงพอใจยังใช้ Google Form แบบไม่ระบุตัวตนตามเดิม ไม่อยู่ในแอปนี้
const SHEET_AS_PATIENTS = 'AS_Patients';
const SHEET_AS_ASSESS = 'AS_Assessments';
const SHEET_AS_COLUMNS = 'AS_Columns';
const SHEET_AS_CONFIG = 'AS_Config';
const SHEET_AS_NEW = 'AS_NewPatients';
// หัวคอลัมน์ของแท็บ AS_NewPatients (AppSheet ใช้เป็นชื่อช่อง) — 2 คอลัมน์ท้ายระบบเป็นผู้เขียน ผู้ใช้แอปไม่ต้องกรอก
const AS_NEW = { id: 'ID', first: 'ชื่อ', last: 'นามสกุล', nid: 'เลขบัตรประชาชน', phone: 'เบอร์โทร', moo: 'หมู่', by: 'ผู้บันทึก', time: 'เวลาบันทึก', ptn: 'PTN', status: 'สถานะ' };
const AS_NEW_HEADERS = [AS_NEW.id, AS_NEW.first, AS_NEW.last, AS_NEW.nid, AS_NEW.phone, AS_NEW.moo, AS_NEW.by, AS_NEW.time, AS_NEW.ptn, AS_NEW.status];
const AS_NEW_MAX_PER_RUN = 10;
// แอปเยี่ยมบ้านเดิม (อีกสเปรดชีตหนึ่ง): ลิงก์ของชีตนั้นวางไว้ในแท็บ AS_Config ไม่เขียนไว้ในโค้ด (โค้ดนี้อยู่ใน GitHub ที่เปิดสาธารณะ)
// คอลัมน์ของชีตเยี่ยมบ้านที่โยงเข้าช่องของเวชระเบียน — ADL = คะแนนรวม Barthel 0-20, Chair stand test = 30 second chair stand
const HOME_VISIT_FIELDS = [
  { header: 'ผล MMSE', key: 'pt_mmse', label: 'MMSE', max: 30 },
  { header: 'TUG', key: 'pt_tug', label: 'TUG (วินาที)', max: 99999 },
  { header: 'TUG-DUal task', key: 'pt_tugDual', label: 'TUG + dual task (วินาที)', max: 99999 },
  { header: 'Chair stand test', key: 'pt_chairStand30', label: '30 second chair stand (ครั้ง)', max: 99999 },
  { header: '2MST', key: 'pt_step2min', label: '2 Minute Step test (ครั้ง)', max: 99999 },
  { header: 'ADL', key: 'pt_barthel', label: 'Barthel ADL', max: 20 }
];
// คอลัมน์ที่แสดงให้ดูเฉย ๆ (ไม่มีช่องรองรับในแบบฟอร์มเวชระเบียน)
const HOME_VISIT_SHOW = [{ header: 'Depression', label: 'Depression' }, { header: 'ครั้งที่', label: 'เยี่ยมครั้งที่' }];
const AS_SAMPLE_ID = 'ตัวอย่าง';
// ต้องตรงกับ REC_EQ5D / REC_BARTHEL ใน record.js
const AS_EQ5D = [
  ['mo', 'การเคลื่อนไหว', [0, 0.066127, 0.0865629, 0.2109943, 0.3712311]],
  ['sc', 'การดูแลตนเอง', [0, 0.0581293, 0.0706312, 0.1924905, 0.2498763]],
  ['ua', 'กิจกรรมที่ทำเป็นประจำ', [0, 0.0582544, 0.0711974, 0.1534855, 0.248331]],
  ['pd', 'อาการเจ็บปวด/ไม่สบายตัว', [0, 0.0563998, 0.0664922, 0.2068864, 0.2564331]],
  ['ad', 'ความวิตกกังวล/ซึมเศร้า', [0, 0.0580857, 0.0957539, 0.2327036, 0.2953493]]
];
const AS_EQ5D_LEVELS = ['ไม่มีปัญหา', 'เล็กน้อย', 'ปานกลาง', 'มาก', 'มากที่สุด'];
const AS_BARTHEL = [
  ['Feeding', ['ต้องมีคนป้อน', 'ตักเองได้ ต้องช่วยเตรียม', 'ช่วยตัวเองได้ปกติ']],
  ['Grooming', ['ต้องการความช่วยเหลือ', 'ทำเองได้']],
  ['Transfer', ['นั่งไม่ได้/ใช้ 2 คนยก', 'ต้องช่วยอย่างมาก', 'ต้องช่วยบ้าง', 'ทำได้เอง']],
  ['Toilet use', ['ช่วยตัวเองไม่ได้', 'ทำเองได้บ้าง', 'ช่วยตัวเองได้ดี']],
  ['Mobility', ['เคลื่อนที่ไม่ได้', 'ใช้รถเข็นเองได้', 'เดินโดยมีคนช่วย', 'เดินได้เอง']],
  ['Dressing', ['ต้องมีคนใส่ให้', 'ช่วยตัวเองได้ราวครึ่ง', 'ช่วยตัวเองได้ดี']],
  ['Stairs', ['ทำไม่ได้', 'ต้องการคนช่วย', 'ขึ้นลงได้เอง']],
  ['Bathing', ['ต้องมีคนช่วย', 'อาบเองได้']],
  ['Bowels', ['กลั้นไม่ได้', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']],
  ['Bladder', ['กลั้นไม่ได้', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']]
];

/**
 * คอลัมน์ของแท็บ AS_Assessments: { header, key, kind, list?, min?, max?, sample }
 * key = ช่องในเวชระเบียน (p2_.. / pt_..) หรือ id / date / time / ptn / assessor / note
 */
function appSheetColumns_() {
  const cols = [
    { header: 'ID', key: 'id', kind: 'id', sample: AS_SAMPLE_ID },
    { header: 'วันที่ประเมิน', key: 'date', kind: 'date' },
    { header: 'เวลาบันทึก', key: 'time', kind: 'datetime' },
    { header: 'คนไข้ (PTN)', key: 'ptn', kind: 'ptn', sample: '' },
    { header: 'ผู้ประเมิน', key: 'assessor', kind: 'text', sample: 'ตัวอย่าง@gmail.com' },
    { header: 'NRS ขณะพัก (0-10)', key: 'p2_nrs_rest', kind: 'int', min: 0, max: 10, sample: 2 },
    { header: 'NRS ขณะใช้งาน (0-10)', key: 'p2_nrs_func', kind: 'int', min: 0, max: 10, sample: 5 }
  ];
  assessTestsAll_().filter(t => t.active && t.key !== 'eq5d' && t.key !== 'barthel').forEach(t => {
    if (t.askName) cols.push({ header: t.name + ': ชื่อแบบสอบถาม', key: 'pt_' + t.key + '_label', kind: 'text', sample: '' });
    cols.push({ header: t.name + (t.unit ? ' (' + t.unit + ')' : ''), key: 'pt_' + t.key, kind: 'num', min: 0, max: 99999, sample: 12.5 });
  });
  AS_EQ5D.forEach(d => cols.push({ header: 'EQ-5D: ' + d[1], key: 'pt_eq5d_' + d[0], kind: 'enum',
    list: AS_EQ5D_LEVELS.map((t, i) => (i + 1) + ' = ' + t), sample: '1 = ' + AS_EQ5D_LEVELS[0] }));
  cols.push({ header: 'EQ-5D: สุขภาพวันนี้ VAS (0-100)', key: 'pt_eq5d_vas', kind: 'int', min: 0, max: 100, sample: 70 });
  AS_BARTHEL.forEach((b, i) => cols.push({ header: 'Barthel ' + (i + 1) + '. ' + b[0], key: 'pt_barthel_' + (i + 1), kind: 'enum',
    list: b[1].map((t, v) => v + ' = ' + t), sample: (b[1].length - 1) + ' = ' + b[1][b[1].length - 1] }));
  cols.push({ header: 'หมายเหตุ', key: 'note', kind: 'text', sample: 'แถวตัวอย่างสำหรับตั้งค่า AppSheet ลบได้หลังสร้างแอปเสร็จ' });
  // การรักษาที่ให้ในวันที่ประเมิน (ชุดที่ 5 ของเวชระเบียน) — kind 'choice' = ดรอปดาวน์จากตัวเลือกในหน้าตั้งค่าของเว็บ เก็บเป็นข้อความ
  let opts = {};
  try { opts = recordOptions_(); } catch (e) { opts = RECORD_DEFAULT_OPTIONS; }
  const list = name => (opts[name] || RECORD_DEFAULT_OPTIONS[name] || []).slice(0, 400);
  [1, 2].forEach(i => {
    cols.push({ header: 'การรักษา: Modality ' + i, key: 'p5_m' + i + '_type', kind: 'choice', list: list('modality'), sample: '' });
    cols.push({ header: 'การรักษา: Modality ' + i + ' ตำแหน่ง', key: 'p5_m' + i + '_at', kind: 'choice', list: list('muscle'), sample: '' });
  });
  [1, 2].forEach(i => {
    cols.push({ header: 'การรักษา: Exercise ' + i, key: 'p5_e' + i + '_type', kind: 'choice', list: list('exercise'), sample: '' });
    cols.push({ header: 'การรักษา: Exercise ' + i + ' ตำแหน่ง', key: 'p5_e' + i + '_at', kind: 'choice', list: list('muscle'), sample: '' });
  });
  cols.push({ header: 'การรักษา: Ambulation ระดับ', key: 'p5_amb_level', kind: 'choice', list: list('assistLevel'), sample: '' });
  cols.push({ header: 'การรักษา: Ambulation เครื่องช่วยเดิน', key: 'p5_amb_aid', kind: 'choice', list: list('gaitAid'), sample: '' });
  cols.push({ header: 'การรักษา: Home program', key: 'p5_hp_note', kind: 'text', sample: '' });
  // หัวคอลัมน์ต้องไม่ซ้ำกัน (ชื่อรายการทดสอบในชีตอาจซ้ำ)
  const seen = {};
  cols.forEach(c => { let h = c.header, n = 2; while (seen[h]) h = c.header + ' ' + (n++); seen[h] = true; c.header = h; });
  return cols;
}
function asColLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * รัน "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก setupAppSheet ข้างปุ่ม "เรียกใช้" แล้วกด Run) ก่อนสร้างแอปใน AppSheet
 * สิ่งที่ทำ: สร้างแท็บ AS_Patients, AS_NewPatients, AS_Assessments, AS_Columns พร้อมหัวคอลัมน์ ตัวเลือกดรอปดาวน์ และแถวตัวอย่าง 1 แถว
 * และตั้งให้ syncAppSheet ทำงานเองทุก 5 นาที (ออก PTN ให้คำขอคนไข้ใหม่จากแอป)
 * (AppSheet ดูชนิดของแต่ละช่องจากแถวตัวอย่างนี้ ระบบเวชระเบียนไม่นับแถวตัวอย่าง ลบได้หลังสร้างแอปเสร็จ)
 * รันซ้ำได้ปลอดภัย: ไม่แตะข้อมูลที่กรอกแล้ว — ถ้าเพิ่มรายการทดสอบใหม่ในแท็บ AssessTests ให้รันซ้ำ จะเพิ่มคอลัมน์ต่อท้ายให้
 * แล้วไปกด Regenerate schema ของตาราง AS_Assessments ใน AppSheet
 */
function setupAppSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // ---- AS_Patients: PTN + ชื่อ จากทะเบียน (สูตร อัปเดตเองเมื่อมีคนไข้ใหม่)
    const pSheet = ensurePatientInfra_();
    const pHeaders = recHeaders_(pSheet);
    const col = h => { const i = pHeaders.indexOf(h); if (i === -1) throw new Error('ไม่พบคอลัมน์ ' + h + ' ในแท็บ Patients'); return asColLetter_(i + 1); };
    const cPtn = col('ptn'), cFirst = col('firstName'), cLast = col('lastName');
    let asP = ss.getSheetByName(SHEET_AS_PATIENTS);
    if (!asP) { asP = ss.insertSheet(SHEET_AS_PATIENTS); asP.setFrozenRows(1); }
    asP.getRange(1, 1, 1, 5).setValues([['ptn', 'name', 'label', 'firstName', 'lastName']]);
    const src = "'" + SHEET_PATIENTS + "'!";
    asP.getRange(2, 1).setFormula('=ARRAYFORMULA(IF(' + src + cPtn + '2:' + cPtn + '="","",' + src + cPtn + '2:' + cPtn + '))');
    asP.getRange(2, 2).setFormula('=ARRAYFORMULA(IF(' + src + cPtn + '2:' + cPtn + '="","",TRIM(' + src + cFirst + '2:' + cFirst + '&" "&' + src + cLast + '2:' + cLast + ')))');
    asP.getRange(2, 3).setFormula('=ARRAYFORMULA(IF(' + src + cPtn + '2:' + cPtn + '="","",TRIM(' + src + cFirst + '2:' + cFirst + '&" "&' + src + cLast + '2:' + cLast + ')&" ("&' + src + cPtn + '2:' + cPtn + '&")"))');
    // ชื่อ / นามสกุลแยกช่อง: ให้แอปเยี่ยมบ้านเดิม (ที่เก็บชื่อกับสกุลคนละคอลัมน์) เติมให้เองเมื่อเลือกคนไข้
    asP.getRange(2, 4).setFormula('=ARRAYFORMULA(IF(' + src + cPtn + '2:' + cPtn + '="","",TRIM(' + src + cFirst + '2:' + cFirst + ')))');
    asP.getRange(2, 5).setFormula('=ARRAYFORMULA(IF(' + src + cPtn + '2:' + cPtn + '="","",TRIM(' + src + cLast + '2:' + cLast + ')))');

    // ---- AS_Assessments
    const cols = appSheetColumns_();
    let asA = ss.getSheetByName(SHEET_AS_ASSESS);
    const created = !asA;
    if (created) { asA = ss.insertSheet(SHEET_AS_ASSESS); }
    const existing = recHeaders_(asA);
    const add = cols.filter(c => existing.indexOf(c.header) === -1);
    if (add.length) {
      recEnsureGrid_(asA, 2, existing.length + add.length);
      asA.getRange(1, existing.length + 1, 1, add.length).setValues([add.map(c => c.header)]);
    }
    asA.setFrozenRows(1);
    const headers = recHeaders_(asA);
    const rows = Math.max(asA.getMaxRows() - 1, 1);
    cols.forEach(c => {
      const ci = headers.indexOf(c.header) + 1;
      const range = asA.getRange(2, ci, rows, 1);
      if (c.kind === 'id' || c.kind === 'ptn' || c.kind === 'text' || c.kind === 'enum' || c.kind === 'choice') range.setNumberFormat('@');
      if (c.kind === 'date') range.setNumberFormat('yyyy-mm-dd');
      if (c.kind === 'datetime') range.setNumberFormat('yyyy-mm-dd hh:mm:ss');
      let rule = null;
      if ((c.kind === 'enum' || c.kind === 'choice') && c.list && c.list.length) rule = SpreadsheetApp.newDataValidation().requireValueInList(c.list, true).setAllowInvalid(true).build();
      if (c.kind === 'ptn') rule = SpreadsheetApp.newDataValidation().requireValueInRange(asP.getRange('A2:A'), true).setAllowInvalid(true).build();
      if (c.kind === 'int' || c.kind === 'num') rule = SpreadsheetApp.newDataValidation().requireNumberBetween(c.min, c.max).setAllowInvalid(true).build();
      if (rule) range.setDataValidation(rule);
    });
    if (created) {
      const now = new Date();
      const sample = headers.map(h => {
        const c = cols.find(x => x.header === h);
        if (!c) return '';
        if (c.kind === 'date' || c.kind === 'datetime') return now;
        return c.sample !== undefined ? c.sample : '';
      });
      asA.getRange(2, 1, 1, headers.length).setValues([sample]);
    }
    invalidateCache_(SHEET_AS_ASSESS);

    // ---- AS_Columns: หัวคอลัมน์ -> ช่องในเวชระเบียน (เขียนใหม่ทั้งแท็บ)
    let asC = ss.getSheetByName(SHEET_AS_COLUMNS);
    if (!asC) asC = ss.insertSheet(SHEET_AS_COLUMNS);
    const last = Math.max(asC.getLastRow(), 1);
    asC.getRange(1, 1, last, 3).clearContent();
    recEnsureGrid_(asC, cols.length + 1, 3);
    asC.getRange(1, 1, cols.length + 1, 3).setNumberFormat('@')
      .setValues([['header', 'key', 'kind']].concat(cols.map(c => [c.header, c.key, c.kind])));
    asC.setFrozenRows(1);
    invalidateCache_(SHEET_AS_COLUMNS);

    // ---- AS_Config: ที่วางลิงก์ชีตของแอปเยี่ยมบ้านเดิม (ค่าที่กรอกไว้แล้วไม่ถูกแตะ)
    let asG = ss.getSheetByName(SHEET_AS_CONFIG);
    if (!asG) {
      asG = ss.insertSheet(SHEET_AS_CONFIG);
      asG.getRange(1, 1, 2, 3).setNumberFormat('@').setValues([['key', 'value', 'note'],
        ['homeVisitSheet', '', 'วางลิงก์ Google Sheet ของแอปเยี่ยมบ้านเดิมในช่อง value แล้วรัน setupAppSheet อีกครั้งเพื่อตรวจ (เว้นว่าง = ไม่โยงแอปเยี่ยมบ้าน)']]);
      asG.setFrozenRows(1);
    }
    // ---- AS_NewPatients: คำขอเพิ่มคนไข้ใหม่จากแอป (ข้อมูลที่กรอกแล้วไม่ถูกแตะ)
    let asN = ss.getSheetByName(SHEET_AS_NEW);
    const newCreated = !asN;
    if (newCreated) asN = ss.insertSheet(SHEET_AS_NEW);
    const nExisting = recHeaders_(asN);
    const nAdd = AS_NEW_HEADERS.filter(h => nExisting.indexOf(h) === -1);
    if (nAdd.length) {
      recEnsureGrid_(asN, 2, nExisting.length + nAdd.length);
      asN.getRange(1, nExisting.length + 1, 1, nAdd.length).setValues([nAdd]);
    }
    asN.setFrozenRows(1);
    const nHeaders = recHeaders_(asN);
    const nRows = Math.max(asN.getMaxRows() - 1, 1);
    nHeaders.forEach((h, i) => {
      if (AS_NEW_HEADERS.indexOf(h) === -1) return;
      // เก็บเป็นข้อความทุกช่อง (เลขบัตร/เบอร์โทรจะได้ไม่ถูกแปลงเป็นตัวเลขจนเลข 0 นำหน้าหาย) ยกเว้นเวลาบันทึก
      asN.getRange(2, i + 1, nRows, 1).setNumberFormat(h === AS_NEW.time ? 'yyyy-mm-dd hh:mm:ss' : '@');
    });
    if (newCreated) {
      const sampleN = {};
      sampleN[AS_NEW.id] = AS_SAMPLE_ID; sampleN[AS_NEW.first] = 'ตัวอย่าง'; sampleN[AS_NEW.last] = 'ทดสอบ'; sampleN[AS_NEW.by] = 'ตัวอย่าง@gmail.com';
      sampleN[AS_NEW.time] = new Date(); sampleN[AS_NEW.status] = 'แถวตัวอย่างสำหรับตั้งค่า AppSheet ลบได้หลังสร้างแอปเสร็จ';
      asN.getRange(2, 1, 1, nHeaders.length).setValues([nHeaders.map(h => sampleN[h] !== undefined ? sampleN[h] : '')]);
    }
    SpreadsheetApp.flush();

    // ---- ตัวตรวจคำขอคนไข้ใหม่: ทุก 5 นาที + ทันทีที่ชีตถูกแก้ (ถ้า Google แจ้งเหตุการณ์จาก AppSheet มาให้)
    let syncNote = '';
    try { installAppSheetSync_(ss); syncNote = 'ตั้งให้ระบบตรวจคำขอคนไข้ใหม่จากแอปทุก 5 นาทีแล้ว'; }
    catch (e) { syncNote = 'ตั้งตัวตรวจคำขอคนไข้ใหม่ไม่สำเร็จ (' + e.message + ') — รัน setupAppSheet อีกครั้งและกดอนุญาตสิทธิ์ที่ Google ถาม'; }

    Logger.log('เตรียมแท็บสำหรับ AppSheet เรียบร้อย: ' + SHEET_AS_PATIENTS + ', ' + SHEET_AS_NEW + ', ' + SHEET_AS_ASSESS + ' (' + headers.length + ' คอลัมน์' + (add.length && !created ? ' เพิ่มใหม่ ' + add.length : '') + '), ' + SHEET_AS_COLUMNS);
    Logger.log('ตารางสำหรับเพิ่มในแอป AppSheet: ' + SHEET_AS_ASSESS + ', ' + SHEET_AS_PATIENTS + ' และ ' + SHEET_AS_NEW + ' (ไม่ต้องเพิ่มแท็บอื่น)');
    Logger.log(syncNote);
    // ---- ตรวจการเชื่อมกับชีตของแอปเยี่ยมบ้านเดิม
    try { CacheService.getScriptCache().remove('hv_rows'); } catch (e) { /* ไม่เป็นไร */ }
    const hv = homeVisitRows_(true);
    if (hv.status === 'off') Logger.log('แอปเยี่ยมบ้านเดิม: ยังไม่ได้วางลิงก์ในแท็บ ' + SHEET_AS_CONFIG + ' (ช่อง B2) — วางแล้วรัน setupAppSheet อีกครั้ง');
    else if (hv.status !== 'ok') Logger.log('แอปเยี่ยมบ้านเดิม: เชื่อมไม่ได้ — ' + hv.error);
    else {
      const nids = {};
      patientsData_().forEach(p => { const n = normNid_(p.nationalId); if (n) nids[n] = true; });
      const ptns = {};
      patientsData_().forEach(p => { ptns[normText_(p.ptn)] = true; });
      const matched = hv.rows.filter(r => (r.ptn && ptns[r.ptn]) || (r.nid && nids[r.nid])).length;
      Logger.log('แอปเยี่ยมบ้านเดิม: เชื่อมได้ อ่านได้ ' + hv.rows.length + ' แถว · จับคู่กับคนไข้ในทะเบียนได้ ' + matched + ' แถว' +
        (hv.rows.length - matched ? ' · อีก ' + (hv.rows.length - matched) + ' แถวยังจับคู่ไม่ได้ (เลขบัตรไม่ตรงกับคนไข้ในทะเบียน หรือคนไข้ยังไม่เคยลงนัดในระบบนี้)' : ''));
      if (hv.missing.length) Logger.log('หมายเหตุ: ไม่พบคอลัมน์ ' + hv.missing.join(', ') + ' ในชีตเยี่ยมบ้าน (ข้ามไป)');
    }
  } finally {
    lock.releaseLock();
  }
}

/** ตั้ง trigger ให้ syncAppSheet ทำงานเอง (ลบของเดิมก่อน จึงรันซ้ำได้ไม่ซ้อนกัน) */
function installAppSheetSync_(ss) {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncAppSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAppSheet').timeBased().everyMinutes(5).create();
  // เสริม: ทำงานทันทีเมื่อสเปรดชีตถูกแก้ไข — ถ้าตั้งไม่ได้ก็ยังมีรอบ 5 นาทีทำงานแทน
  try { ScriptApp.newTrigger('syncAppSheet').forSpreadsheet(ss).onChange().create(); } catch (e) { /* ใช้รอบ 5 นาทีอย่างเดียว */ }
}

/** ข้อความจากแอป: ตัดช่องว่างเกิน จำกัดความยาว และไม่ให้ขึ้นต้นด้วยเครื่องหมายที่ชีตตีความเป็นสูตร */
function asNewText_(v, max) {
  return normText_(v).replace(/^[=+\-@\s]+/, '').slice(0, max);
}
/**
 * อ่านคำขอที่ยังไม่มี PTN ในแท็บ AS_NewPatients
 * คืน [{ row, id, first, last, nid, phone, moo, by, status, error }] — error = เหตุที่ยังออก PTN ไม่ได้ ('' = พร้อมออก)
 */
function asNewPending_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = recHeaders_(sheet);
  const at = {};
  Object.keys(AS_NEW).forEach(k => { at[k] = headers.indexOf(AS_NEW[k]); });
  if (at.id === -1 || at.first === -1 || at.last === -1 || at.ptn === -1 || at.status === -1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const out = [];
  values.forEach((v, i) => {
    const get = k => at[k] === -1 ? '' : v[at[k]];
    const id = normText_(get('id'));
    if (!id || id.indexOf(AS_SAMPLE_ID) === 0 || normText_(get('ptn'))) return;
    const first = asNewText_(meaningful_(get('first')), 60), last = asNewText_(meaningful_(get('last')), 60);
    const nidRaw = String(get('nid') === null || get('nid') === undefined ? '' : get('nid')).replace(/\D/g, '');
    let error = '';
    if (!first || !last) error = 'ยังไม่ได้ PTN: กรุณากรอกทั้งชื่อและนามสกุล';
    else if (nidRaw && nidRaw.length !== 13) error = 'ยังไม่ได้ PTN: เลขบัตรประชาชนต้องมี 13 หลัก (แก้ให้ครบ หรือลบออกถ้าไม่ทราบ)';
    out.push({ row: i + 2, id: id, first: first, last: last, nid: nidRaw.length === 13 ? nidRaw : '', phone: asNewText_(get('phone'), 20), moo: asNewText_(get('moo'), 10),
      by: normText_(get('by')).slice(0, 80), status: normText_(get('status')), error: error, at: at });
  });
  return out;
}
/**
 * ตรวจคำขอเพิ่มคนไข้ใหม่ที่ผู้ช่วยกรอกในแอป AppSheet (แท็บ AS_NewPatients) แล้วเขียน PTN กลับลงแถวนั้น
 * ใช้กติกาเดียวกับตอนลงนัดในเว็บ (linkPatient_): เลขบัตรตรงกับคนในทะเบียน = คนเดิม · ชื่อ+นามสกุลตรงกับคนเดียวในทะเบียน = คนเดิม · นอกนั้นออก PTN ใหม่
 * หลังได้ PTN แล้ว เลขบัตรและเบอร์โทรถูกย้ายไปเก็บในแท็บ Patients และลบออกจากแถวคำขอ (แท็บนี้ถูกส่งไปยังมือถือของผู้ใช้แอป)
 * ถูกเรียกเองทุก 5 นาที (setupAppSheet ตั้งให้) — จะกดรันเองจากตัวแก้ไขก็ได้ คืนจำนวนแถวที่ได้ PTN ในรอบนี้
 * (ชื่อฟังก์ชันไม่ลงท้ายด้วย _ เพื่อให้ตั้งเป็น trigger และเลือกรันได้)
 */
function syncAppSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_AS_NEW);
  if (!sheet) return 0;
  // ตรวจเร็ว ๆ ก่อนโดยไม่ล็อก: ส่วนใหญ่ไม่มีอะไรต้องทำ
  const actionable = t => !t.error || t.error !== t.status;
  if (!asNewPending_(sheet).some(actionable)) return 0;
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return 0; } // มีงานอื่นบันทึกอยู่: รอบถัดไปค่อยทำ
  let done = 0;
  try {
    const todo = asNewPending_(sheet).filter(actionable).slice(0, AS_NEW_MAX_PER_RUN); // อ่านใหม่หลังได้ล็อก
    todo.forEach(t => {
      const put = (k, val) => { if (t.at[k] !== -1) sheet.getRange(t.row, t.at[k] + 1).setNumberFormat('@').setValue(val); };
      // แถวอาจเลื่อนถ้ามีคนลบแถวอื่นระหว่างนี้: ตรวจว่า ID ยังตรงก่อนเขียน
      if (normText_(sheet.getRange(t.row, t.at.id + 1).getValue()) !== t.id) return;
      if (t.error) { put('status', t.error); return; }
      delete _sheetCache_[SHEET_PATIENTS];
      const byNid = t.nid ? patientsData_().some(p => normNid_(p.nationalId) === t.nid) : false;
      const link = linkPatient_({ firstName: t.first, lastName: t.last, nationalId: t.nid, phone: t.phone, moo: t.moo }, { date: todayStr_(), locked: true });
      if (!link.ok) { put('status', 'ยังไม่ได้ PTN: ' + link.error); return; }
      put('ptn', link.ptn);
      put('status', link.isNew ? 'ออก PTN ใหม่แล้ว' : ('เป็นคนไข้เดิมในทะเบียน (' + (byNid ? 'เลขบัตรตรงกัน' : 'ชื่อ-สกุลตรงกัน') + ')'));
      put('nid', '');
      put('phone', '');
      recordLog_({ username: 'appsheet:' + t.by }, link.isNew ? 'appsheetNewPatient' : 'appsheetMatchPatient', t.id, link.ptn);
      done++;
    });
    if (todo.length) SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return done;
}

/** วันที่จากช่องที่ AppSheet เขียน: เป็นค่าวันที่ของชีต หรือข้อความ yyyy-MM-dd / d/M/yyyy (ปี พ.ศ. ก็รับ) */
function asDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    try {
      if (isNaN(v)) return '';
      const iso0 = fmtDate_(v);
      // พิมพ์ปีเป็น พ.ศ. ในชีตที่นับปีแบบ ค.ศ. → ได้ค่าวันที่ปี 25xx: แปลงกลับเป็น ค.ศ.
      return Number(iso0.slice(0, 4)) > 2400 ? (Number(iso0.slice(0, 4)) - 543) + iso0.slice(4) : iso0;
    } catch (e) { return ''; }
  }
  const s = normText_(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y, mo, d;
  if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (!m) return '';
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]);
  }
  if (y > 2400) y -= 543;
  const iso = y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  return recValidDate_(iso) ? iso : '';
}

/** ลิงก์/รหัสของชีตแอปเยี่ยมบ้านจากแท็บ AS_Config ('' = ไม่ได้ตั้ง) */
function homeVisitSheetId_() {
  if (!recSheet_(SHEET_AS_CONFIG)) return '';
  const row = recRows_(SHEET_AS_CONFIG).find(r => normText_(r.key) === 'homeVisitSheet');
  const m = /[-\w]{25,}/.exec(row ? normText_(row.value) : '');
  return m ? m[0] : '';
}
/**
 * อ่านแถวจากชีตของแอปเยี่ยมบ้านเดิม (อีกสเปรดชีตหนึ่ง) เฉพาะคอลัมน์ที่ใช้ — ไม่อ่านเบอร์โทร พิกัด รูป ลายเซ็น
 * คืน { status: 'off' | 'ok' | 'error', rows: [{ id, ptn, nid, date, assessor, note, vals: {หัวคอลัมน์: ค่า} }], missing, error }
 * พักผลไว้ในแคช 3 นาที (เปิดอีกสเปรดชีตหนึ่งช้ากว่าอ่านชีตตัวเอง) — fresh = true อ่านใหม่เสมอ
 */
function homeVisitRows_(fresh) {
  const id = homeVisitSheetId_();
  if (!id) return { status: 'off', rows: [], missing: [] };
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    try { const hit = cache.get('hv_rows'); if (hit) return JSON.parse(hit); } catch (e) { /* อ่านจากชีตแทน */ }
  }
  let out;
  try {
    const book = SpreadsheetApp.openById(id);
    const need = ['วันที่ประเมิน', 'เลขบัตร ปชช'];
    let values = null;
    book.getSheets().some(sh => {
      if (sh.getLastRow() < 1) return false;
      const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(h => normText_(h));
      if (!need.every(h => head.indexOf(h) !== -1)) return false;
      values = sh.getDataRange().getValues();
      return true;
    });
    if (!values) out = { status: 'error', rows: [], missing: [], error: 'ไม่พบแท็บที่มีคอลัมน์ "วันที่ประเมิน" และ "เลขบัตร ปชช" ในชีตที่ลิงก์ไว้' };
    else {
      const head = values[0].map(h => normText_(h));
      const at = h => head.indexOf(h); // หัวคอลัมน์ซ้ำ (เช่น ICD10) ใช้คอลัมน์แรก
      const wanted = HOME_VISIT_FIELDS.map(f => f.header).concat(HOME_VISIT_SHOW.map(f => f.header));
      const rows = [];
      for (let r = 1; r < values.length; r++) {
        const row = values[r];
        const get = h => at(h) === -1 ? '' : row[at(h)];
        const rid = normText_(get('ID'));
        const date = asDate_(get('วันที่ประเมิน'));
        if (!rid || !date) continue;
        const vals = {};
        wanted.forEach(h => { const v = get(h); if (v !== '' && v !== null && v !== undefined) vals[h] = Object.prototype.toString.call(v) === '[object Date]' ? '' : String(v).slice(0, 60); });
        rows.push({ id: rid, ptn: normText_(get('PTN')), nid: normNid_(get('เลขบัตร ปชช')), date: date, assessor: normText_(get('ผู้ประเมิน')).slice(0, 80),
          note: normText_(get('คำแนะนำ/การรักษา')).slice(0, 300), vals: vals });
      }
      out = { status: 'ok', rows: rows, missing: wanted.filter(h => at(h) === -1) };
    }
  } catch (e) {
    out = { status: 'error', rows: [], missing: [], error: 'เปิดชีตของแอปเยี่ยมบ้านไม่ได้ (' + e.message + ') — ตรวจลิงก์ในแท็บ ' + SHEET_AS_CONFIG + ' และให้บัญชีเจ้าของสเปรดชีตนี้เปิดชีตนั้นได้' };
  }
  try { const json = JSON.stringify(out); if (json.length < 95000) cache.put('hv_rows', json, 180); } catch (e) { /* ไม่แคชก็ได้ */ }
  return out;
}
/** ผลจากแอปเยี่ยมบ้านของคนไข้ 1 คน: จับคู่ด้วย PTN (ถ้าชีตนั้นมีคอลัมน์ PTN) หรือเลขบัตรประชาชน 13 หลักที่ตรงกับทะเบียน */
function homeVisitAssessments_(ptn) {
  const hv = homeVisitRows_(false);
  if (hv.status !== 'ok') return { list: [], error: hv.status === 'error' ? hv.error : '' };
  const reg = patientsData_().find(p => normText_(p.ptn) === ptn);
  const nid = reg ? normNid_(reg.nationalId) : '';
  const today = todayStr_();
  const list = [];
  hv.rows.forEach(r => {
    const mine = r.ptn ? r.ptn === ptn : (nid && r.nid === nid);
    if (!mine || r.date > today) return;
    const data = {}, items = [];
    HOME_VISIT_FIELDS.forEach(f => {
      const raw = r.vals[f.header];
      if (raw === undefined) return;
      const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(String(raw));
      if (!m) { items.push({ label: f.label, value: String(raw).slice(0, 40) }); return; } // เช่น "ADL Dependent": แสดงให้ดู ไม่ดึงเข้าแบบฟอร์ม
      const v = Math.round(Number(m[1].replace(',', '.')) * 100) / 100;
      if (v < 0 || v > f.max) return;
      data[f.key] = String(v);
      items.push({ label: f.label, value: f.key === 'pt_barthel' ? v + '/20' : String(v) });
    });
    HOME_VISIT_SHOW.forEach(f => { if (r.vals[f.header] !== undefined) items.push({ label: f.label, value: String(r.vals[f.header]).slice(0, 40) }); });
    if (!items.length && !r.note) return;
    list.push({ id: 'hv:' + r.id, source: 'เยี่ยมบ้าน', date: r.date, time: '', assessor: r.assessor, note: r.note, data: data, items: items });
  });
  return { list: list, error: '' };
}

/**
 * ผลประเมินจาก AppSheet ของคนไข้ 1 คน (ใหม่สุดก่อน) ในรูปที่หน้าเวชระเบียนเติมลงแบบฟอร์มได้ทันที
 * { id, date, time, assessor, note, data: { ช่องในเวชระเบียน: ค่า }, items: [{ label, value }] (สำหรับแสดงผลย่อ) }
 * ค่าที่ไม่ถูกรูปแบบ/เกินช่วงถูกข้ามเป็นรายช่อง · แถวตัวอย่างและแถวที่ไม่มี PTN/วันที่ไม่ถูกนับ
 */
function clinicAssessments_(ptn) {
  if (!ptn || !recSheet_(SHEET_AS_ASSESS)) return [];
  let cols = [];
  if (recSheet_(SHEET_AS_COLUMNS)) {
    cols = recRows_(SHEET_AS_COLUMNS).map(r => ({ header: normText_(r.header), key: normText_(r.key), kind: normText_(r.kind) })).filter(c => c.header && c.key);
  }
  if (!cols.length) cols = appSheetColumns_();
  const byKey = {};
  cols.forEach(c => { byKey[c.key] = c; });
  if (!byKey.ptn || !byKey.id) return [];
  const cell = (row, key) => byKey[key] ? row[byKey[key].header] : '';
  const out = [];
  recRows_(SHEET_AS_ASSESS).forEach(row => {
    const id = normText_(cell(row, 'id'));
    if (!id || id.indexOf(AS_SAMPLE_ID) === 0) return;
    if (normText_(cell(row, 'ptn')) !== ptn) return;
    const tv = cell(row, 'time');
    const isDate = Object.prototype.toString.call(tv) === '[object Date]' && !isNaN(tv);
    const date = asDate_(cell(row, 'date')) || asDate_(tv);
    if (!date || date > todayStr_()) return;
    const data = {}, items = [];
    cols.forEach(c => {
      if (!RECORD_KEY_RE.test(c.key)) return;
      const raw = row[c.header];
      if (raw === '' || raw === null || raw === undefined) return;
      let v;
      if (c.kind === 'text' || c.kind === 'choice') { v = normText_(raw).slice(0, c.key === 'p5_hp_note' ? 300 : 80); if (!v) return; }
      else if (c.kind === 'enum' || c.kind === 'int') {
        const m = /^\s*(-?\d+)\b/.exec(String(raw));
        if (!m) return;
        v = Number(m[1]);
      } else { v = recNum_(typeof raw === 'string' ? raw.replace(',', '.') : raw); if (v === null) return; v = Math.round(v * 100) / 100; }
      // ช่วงค่าที่ยอมรับของแต่ละช่อง
      let lo = 0, hi = 99999;
      if (/^p2_nrs_/.test(c.key)) hi = 10;
      else if (c.key === 'pt_eq5d_vas') hi = 100;
      else if (/^pt_eq5d_/.test(c.key)) { lo = 1; hi = 5; }
      else { const b = /^pt_barthel_(\d+)$/.exec(c.key); if (b) hi = AS_BARTHEL[Number(b[1]) - 1] ? AS_BARTHEL[Number(b[1]) - 1][1].length - 1 : -1; }
      if (c.kind !== 'text' && c.kind !== 'choice' && (v < lo || v > hi)) return;
      data[c.key] = String(v);
      if (!/^pt_(eq5d_(mo|sc|ua|pd|ad)|barthel_\d+)$/.test(c.key) && !/_label$/.test(c.key)) items.push({ label: c.header, value: String(v) });
    });
    // คะแนนรวมของแบบประเมินที่ติ๊กครบทุกข้อ
    const eq = AS_EQ5D.map(d => data['pt_eq5d_' + d[0]]);
    if (eq.every(x => x !== undefined)) {
      const util = Math.round((1 - AS_EQ5D.reduce((s, d, i) => s + d[2][Number(eq[i]) - 1], 0)) * 10000) / 10000;
      data.pt_eq5d = String(util);
      items.push({ label: 'EQ-5D-5L ' + eq.join(''), value: util.toFixed(4) });
    } else if (eq.some(x => x !== undefined)) items.push({ label: 'EQ-5D-5L', value: 'ตอบ ' + eq.filter(x => x !== undefined).length + '/5 มิติ' });
    const ba = AS_BARTHEL.map((b, i) => data['pt_barthel_' + (i + 1)]);
    if (ba.every(x => x !== undefined)) {
      const total = ba.reduce((s, x) => s + Number(x), 0);
      data.pt_barthel = String(total);
      items.push({ label: 'Barthel ADL', value: total + '/20' });
    } else if (ba.some(x => x !== undefined)) items.push({ label: 'Barthel ADL', value: 'ตอบ ' + ba.filter(x => x !== undefined).length + '/10 ข้อ' });
    // การรักษา: ติ๊กหัวข้อให้ในเวชระเบียนเมื่อมีรายละเอียด (Ambulation / Home program)
    if (data.p5_amb_level || data.p5_amb_aid) data.p5_amb = 'Y';
    if (data.p5_hp_note) data.p5_hp = 'Y';
    if (!Object.keys(data).length) return;
    out.push({ id: id, source: 'ประเมิน', date: date, time: isDate ? tv.toISOString() : normText_(tv), assessor: normText_(cell(row, 'assessor')), note: normText_(cell(row, 'note')).slice(0, 300), data: data, items: items });
  });
  return out;
}
/** รวมผลจากทั้งสองแอป (ตารางประเมินใหม่ + แอปเยี่ยมบ้านเดิม) ใหม่สุดก่อน — { list, error } error = ข้อความเมื่อเชื่อมชีตเยี่ยมบ้านไม่ได้ */
function fieldAssessments_(ptn) {
  let list = [], error = '';
  try { list = clinicAssessments_(ptn); } catch (e) { error = 'อ่านแท็บ ' + SHEET_AS_ASSESS + ' ไม่สำเร็จ: ' + e.message; }
  try { const hv = homeVisitAssessments_(ptn); list = list.concat(hv.list); if (hv.error) error = hv.error; } catch (e) { error = 'อ่านผลจากแอปเยี่ยมบ้านไม่สำเร็จ: ' + e.message; }
  list.sort((a, b) => (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0)) || (a.time < b.time ? 1 : (a.time > b.time ? -1 : 0)));
  return { list: list.slice(0, 80), error: error };
}

/* ---------------------------- ความพึงพอใจ (แบบประเมิน Google Form ไม่ระบุตัวตน) ---------------------------- */
// คนไข้ตอบแบบประเมินผ่านลิงก์/QR ของ Google Form เมื่อไหร่ก็ได้ ไม่มีชื่อ ไม่ผูกกับนัดหรือ PTN
// ฟอร์มถูก "ลิงก์ไปยังชีต" มาที่สเปรดชีตนี้ (Google สร้างแท็บคำตอบให้เอง) ระบบแค่อ่านแท็บนั้นมาสรุปตามช่วงเวลาที่กรอง
// ตัวฟอร์มสร้างได้สองทาง: รัน setupSatisfactionForm() ให้สคริปต์สร้างและลิงก์ให้ หรือสร้างเองแล้วลิงก์เข้าสเปรดชีตนี้
// การสรุปผลอ่านจากแท็บคำตอบอย่างเดียว จึงจะตั้ง/แก้คำถามในฟอร์มอย่างไรก็ได้:
//   - ข้อที่ตอบเป็นคะแนน (สเกลเชิงเส้น 1-5 / 1-10 หรือตัวเลือก มากที่สุด..น้อยที่สุด) = ข้อคะแนน
//   - ข้อที่มีตัวเลือกไม่กี่แบบ = นับจำนวนแต่ละตัวเลือก · ข้อความอิสระ = ข้อเสนอแนะ

// คำถามตั้งต้นของแบบประเมินที่ setupSatisfactionForm() สร้างให้ (แก้/เพิ่ม/ลบในตัวฟอร์มภายหลังได้ ระบบสรุปผลตามคำถามที่มีจริง)
const FEEDBACK_FORM_TITLE = 'แบบประเมินความพึงพอใจ งานกายภาพบำบัด';
const FEEDBACK_FORM_DESCRIPTION = 'ไม่ต้องระบุชื่อ ใช้เวลาไม่เกิน 1 นาที คำตอบของท่านจะใช้เพื่อปรับปรุงบริการเท่านั้น\nให้คะแนน 1 = น้อยที่สุด ถึง 5 = มากที่สุด';
const FEEDBACK_SCALE_QUESTIONS = [
  'ความพึงพอใจต่อบริการโดยรวม',
  'การอธิบายและให้คำแนะนำของผู้ให้บริการ',
  'ความสุภาพและความเอาใจใส่ของผู้ให้บริการ',
  'ระยะเวลารอคอยก่อนได้รับบริการ',
  'ผลที่ได้รับหลังการรักษา'
];
const FEEDBACK_COMMENT_QUESTION = 'ข้อเสนอแนะเพิ่มเติม';

/**
 * รัน "ครั้งเดียว" จากตัวแก้ไข Apps Script (เลือก setupSatisfactionForm ข้างปุ่ม "เรียกใช้" แล้วกด Run)
 * สิ่งที่ทำ: สร้าง Google Form แบบประเมินความพึงพอใจ (ไม่เก็บอีเมล ไม่ต้องล็อกอิน ตอบซ้ำได้) แล้วลิงก์คำตอบเข้าสเปรดชีตนี้
 * จากนั้นดูลิงก์สำหรับส่งให้คนไข้ได้ใน "บันทึกการดำเนินการ" และในหน้าสถิติของเว็บ
 * รันซ้ำได้ปลอดภัย: ถ้ามีแบบประเมินอยู่แล้วจะไม่สร้างซ้ำ แค่แสดงลิงก์เดิม
 * ครั้งแรกที่รัน Google จะขอสิทธิ์ "ดูและจัดการฟอร์ม" เพิ่ม ต้องอนุมัติก่อน แล้วค่อยอัปเดตเว็บแอปเป็นเวอร์ชันใหม่
 */
function setupSatisfactionForm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  const existingId = props.getProperty('FEEDBACK_FORM_ID');
  if (existingId) {
    let existing = null;
    try { existing = FormApp.openById(existingId); } catch (e) { /* ฟอร์มถูกลบไปแล้ว สร้างใหม่ด้านล่าง */ }
    if (existing) {
      props.setProperty('FEEDBACK_FORM_URL', existing.getPublishedUrl());
      Logger.log('มีแบบประเมินอยู่แล้ว ไม่สร้างซ้ำ');
      Logger.log('ลิงก์สำหรับส่งให้คนไข้: ' + existing.getPublishedUrl());
      Logger.log('ลิงก์สำหรับแก้ไขคำถาม: ' + existing.getEditUrl());
      return;
    }
  }
  const linked = findFeedbackSheet_();
  if (linked) {
    Logger.log('สเปรดชีตนี้มีแท็บคำตอบของฟอร์มอยู่แล้ว ("' + linked.name + '") จึงไม่สร้างฟอร์มใหม่ซ้ำ');
    Logger.log('หน้าสถิติจะใช้แท็บนั้น ถ้าต้องการให้สคริปต์สร้างฟอร์มใหม่ ให้ยกเลิกการลิงก์ฟอร์มเดิมและลบแท็บนั้นก่อน แล้วรันอีกครั้ง');
    return;
  }

  const form = FormApp.create(FEEDBACK_FORM_TITLE);
  form.setDescription(FEEDBACK_FORM_DESCRIPTION);
  form.setCollectEmail(false);            // ไม่ระบุตัวตน
  form.setLimitOneResponsePerUser(false); // ไม่บังคับล็อกอิน ใครตอบเมื่อไหร่ก็ได้ ตอบซ้ำได้
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(true);
  form.setConfirmationMessage('ขอบคุณที่ร่วมประเมิน ความเห็นของท่านจะถูกนำไปปรับปรุงบริการ');
  // สองคำสั่งนี้มีผลเฉพาะบางประเภทบัญชี/ฟอร์ม ใช้ไม่ได้ก็ข้าม (ค่าเริ่มต้นของบัญชี Gmail ทั่วไปเปิดให้ทุกคนตอบได้อยู่แล้ว)
  try { form.setRequireLogin(false); } catch (e) { /* ใช้ได้เฉพาะบัญชีองค์กร */ }
  try { if (typeof form.setPublished === 'function') form.setPublished(true); } catch (e) { /* ฟอร์มรุ่นที่ไม่มีสถานะเผยแพร่ */ }

  FEEDBACK_SCALE_QUESTIONS.forEach(q => {
    form.addScaleItem().setTitle(q).setBounds(1, 5).setLabels('น้อยที่สุด', 'มากที่สุด').setRequired(true);
  });
  form.addParagraphTextItem().setTitle(FEEDBACK_COMMENT_QUESTION).setRequired(false);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId()); // Google สร้างแท็บคำตอบในสเปรดชีตนี้ให้เอง
  SpreadsheetApp.flush();

  props.setProperty('FEEDBACK_FORM_ID', form.getId());
  props.setProperty('FEEDBACK_FORM_URL', form.getPublishedUrl());
  Logger.log('สร้างแบบประเมินและลิงก์เข้าสเปรดชีตนี้เรียบร้อย');
  Logger.log('ลิงก์สำหรับส่งให้คนไข้: ' + form.getPublishedUrl());
  Logger.log('ลิงก์สำหรับแก้ไขคำถาม: ' + form.getEditUrl());
  Logger.log('ขั้นต่อไป: อัปเดตเว็บแอปเป็นเวอร์ชันใหม่ แล้วเปิดหน้าสถิติ');
}

const SYSTEM_SHEETS_ = [SHEET_USERS, SHEET_SCHEDULE, SHEET_SCHEDULE_SLOTS, SHEET_CLOSED, SHEET_BUSY, SHEET_APPTS, SHEET_CLINIC_TYPES,
  SHEET_CLINIC_DAYS, SHEET_CLINIC_RULES, SHEET_SPECIAL_OPEN, SHEET_SPECIAL_SLOTS, SHEET_ICD10, SHEET_ICD9, SHEET_EXTRA_SLOTS, SHEET_BUSY_RULES, SHEET_PATIENTS,
  'Records', 'RecordOptions', 'AssessTests', 'AssessNorms', 'RecordLog', 'AS_Patients', 'AS_Assessments', 'AS_Columns', 'AS_Config'];

/** หาแท็บคำตอบของแบบประเมิน: แท็บที่ลิงก์กับ Google Form (หรือแท็บที่หัวคอลัมน์แรกเป็น "ประทับเวลา"/"Timestamp") */
function findFeedbackSheet_() {
  const candidates = [];
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(sh => {
    const name = sh.getName();
    if (SYSTEM_SHEETS_.indexOf(name) !== -1) return;
    let formUrl = '';
    try { formUrl = sh.getFormUrl() || ''; } catch (e) { /* บางกรณีเรียกไม่ได้ ใช้การดูหัวคอลัมน์แทน */ }
    let byHeader = false;
    if (!formUrl && sh.getLastRow() >= 1) {
      byHeader = /^(timestamp|ประทับเวลา)$/i.test(normText_(sh.getRange(1, 1).getValue()));
    }
    if (formUrl || byHeader) candidates.push({ sheet: sh, name: name, formUrl: formUrl });
  });
  if (!candidates.length) return null;
  // มีหลายฟอร์มลิงก์อยู่: เลือกแท็บที่ชื่อบอกว่าเป็นแบบประเมิน ถ้าไม่มีใช้แท็บแรก
  return candidates.find(c => /พึงพอใจ|ประเมิน|satisf|feedback/i.test(c.name)) || candidates[0];
}

/**
 * แปลงคำตอบเป็นคะแนน — ไม่ใช่คำตอบแบบระดับคะแนนคืน null
 * รับ: ตัวเลข 0-10, "5", "5 = มากที่สุด", "4 - มาก", "5 คะแนน", และคำระดับ มากที่สุด/มาก/ปานกลาง/น้อย/น้อยที่สุด
 * (มีคำนำหน้า พึงพอใจ/พอใจ/เห็นด้วย ได้) — ตั้งใจเข้มงวด ตัวเลือกอย่าง "2-5 ครั้ง" หรือ "มากกว่า 5 ครั้ง" และคำชมอย่าง "ดีมาก" ต้องไม่ถูกนับเป็นคะแนน
 */
function likertValue_(v) {
  if (typeof v === 'number') return (v >= 0 && v <= 10 && Math.floor(v) === v) ? v : null;
  const s = normText_(v);
  if (!s) return null;
  let m = /^(\d{1,2})(?:\s*คะแนน|\s*[=:.)\-–]\s*\D.*)?$/.exec(s);
  if (m) { const n = Number(m[1]); return n <= 10 ? n : null; }
  m = /^(?:\d\s*)?(?:ระดับ)?(?:ความ)?(?:พึงพอใจ|พอใจ|เห็นด้วย)?\s*(มากที่สุด|น้อยที่สุด|ปานกลาง|มาก|น้อย)$/.exec(s);
  if (!m) return null;
  return { 'มากที่สุด': 5, 'มาก': 4, 'ปานกลาง': 3, 'น้อย': 2, 'น้อยที่สุด': 1 }[m[1]];
}

/** ไม่ให้ปัญหาของแท็บแบบประเมิน (เช่น มีคนแก้หัวตาราง) ทำให้หน้าสถิติทั้งหน้าเปิดไม่ได้ */
function feedbackForDashboard_(from, to, visits) {
  let shareUrl = '';
  try { shareUrl = PropertiesService.getScriptProperties().getProperty('FEEDBACK_FORM_URL') || ''; } catch (e) { /* ไม่มีก็ไม่เป็นไร */ }
  try {
    let given = 0;
    try { given = satisfactionGiven_(from, to); } catch (e) { /* ยังไม่มีเวชระเบียน */ }
    return Object.assign(getFeedbackStats_(from, to, visits, given), { shareUrl: shareUrl, given: given }); // shareUrl = ลิงก์ตอบแบบประเมิน (รู้เฉพาะเมื่อสคริปต์เป็นผู้สร้างฟอร์ม)
  } catch (e) {
    return { linked: true, error: e.message, shareUrl: shareUrl };
  }
}

/**
 * สรุปคำตอบแบบประเมินในช่วง [from, to] (ตามเวลาที่ตอบ) — ไม่มีข้อมูลระบุตัวตน
 * visits = จำนวน visit ในช่วงเดียวกัน ใช้คำนวณอัตราการตอบโดยประมาณ
 */
function getFeedbackStats_(from, to, visits, given) {
  const found = findFeedbackSheet_();
  if (!found) return { linked: false };
  const sh = found.sheet;
  const out = { linked: true, sheetName: found.name, formUrl: found.formUrl, total: 0, totalAll: 0, overall: null, questions: [], choices: [], comments: [], responseRate: null };
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return out;

  const tz = Session.getScriptTimeZone();
  const values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values.shift().map(normText_);
  const nonEmpty = v => !(v === '' || v === null || v === undefined);
  const rows = values.filter(r => r.some(nonEmpty)).map(r => {
    let date = '';
    const t = r[0] instanceof Date ? r[0] : (nonEmpty(r[0]) ? new Date(r[0]) : null);
    if (t && !isNaN(t)) date = Utilities.formatDate(t, tz, 'yyyy-MM-dd');
    return { date: date, cells: r };
  });
  const inRange = rows.filter(r => r.date && r.date >= from && r.date <= to);
  out.totalAll = rows.length;
  out.total = inRange.length;
  // อัตราการตอบ: เทียบกับ session ที่ให้ทำแบบประเมินแล้ว (ถ้ามีการกดในเวชระเบียน) ไม่งั้นเทียบกับจำนวน visit
  const base = given > 0 ? given : visits;
  out.responseRate = base > 0 ? Math.round(inRange.length / base * 1000) / 1000 : null;

  const round2 = n => Math.round(n * 100) / 100;
  const allFractions = []; // คะแนนทุกคำตอบของทุกข้อ ในรูปสัดส่วนของคะแนนเต็ม ใช้คิดร้อยละรวม
  const maxes = {};
  for (let c = 1; c < lastCol; c++) {
    const title = headers[c];
    if (!title) continue;
    if (/e-?mail|อีเมล|^คะแนน$|^score$/i.test(title)) continue; // ไม่แสดงอีเมล (ถ้าฟอร์มเผลอเปิดเก็บ) และคะแนนของโหมดแบบทดสอบ
    const allVals = rows.map(r => r.cells[c]).filter(nonEmpty);
    if (!allVals.length) continue;
    const allScores = allVals.map(likertValue_).filter(v => v !== null);
    // ช่องข้อเสนอแนะ/ความคิดเห็นเป็นข้อความเสมอ แม้ตอนคำตอบยังน้อยจะมีแต่คำสั้นๆ ที่หน้าตาคล้ายระดับคะแนน (เช่น "มาก")
    const isCommentTitle = /ข้อเสนอแนะ|ความคิดเห็น|ความเห็น|เพิ่มเติม|อื่น ?ๆ|comment|suggest|feedback/i.test(title);

    if (!isCommentTitle && allScores.length / allVals.length >= 0.8) {
      // ข้อคะแนน: คะแนนเต็ม 5 เว้นแต่พบคำตอบเกิน 5 ถือว่าเต็ม 10
      const max = Math.max.apply(null, allScores) > 5 ? 10 : 5;
      maxes[max] = true;
      const scores = inRange.map(r => likertValue_(r.cells[c])).filter(v => v !== null);
      const dist = [];
      for (let i = 1; i <= max; i++) dist.push(scores.filter(v => v === i).length);
      const sum = scores.reduce((a, b) => a + b, 0);
      scores.forEach(v => allFractions.push(v / max));
      out.questions.push({
        title: title,
        n: scores.length,
        max: max,
        avg: scores.length ? round2(sum / scores.length) : null,
        percent: scores.length ? round2(sum / scores.length / max * 100) : null,
        satisfied: scores.length ? round2(scores.filter(v => v / max >= 0.8).length / scores.length * 100) : null, // ระดับมากขึ้นไป (4-5 จาก 5)
        dist: dist
      });
      continue;
    }

    const texts = inRange.map(r => ({ date: r.date, text: normText_(r.cells[c]) })).filter(x => x.text);
    const distinctAll = {};
    allVals.forEach(v => { distinctAll[normText_(v)] = true; });
    const nDistinct = Object.keys(distinctAll).length;
    if (nDistinct <= 8 && allVals.length > nDistinct && Object.keys(distinctAll).every(k => k.length <= 40)) {
      // ข้อตัวเลือก (เช่น ประเภทผู้ตอบ ช่วงอายุ): นับจำนวนแต่ละตัวเลือก
      const counts = {};
      texts.forEach(x => { counts[x.text] = (counts[x.text] || 0) + 1; });
      out.choices.push({
        title: title,
        n: texts.length,
        counts: Object.keys(counts).map(k => ({ value: k, n: counts[k] })).sort((a, b) => b.n - a.n)
      });
    } else {
      // ข้อความอิสระ: ข้อเสนอแนะล่าสุด 30 รายการ
      texts.sort((a, b) => a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
      out.comments.push({
        title: title,
        n: texts.length,
        items: texts.slice(0, 30).map(x => ({ date: x.date, text: x.text.length > 500 ? x.text.slice(0, 500) + '...' : x.text }))
      });
    }
  }

  if (allFractions.length) {
    const mean = allFractions.reduce((a, b) => a + b, 0) / allFractions.length;
    const maxList = Object.keys(maxes);
    const max = maxList.length === 1 ? Number(maxList[0]) : null; // ทุกข้อคะแนนเต็มเท่ากันจึงบอกค่าเฉลี่ยรวมเป็นคะแนนได้
    out.overall = {
      percent: round2(mean * 100),
      avg: max ? round2(mean * max) : null,
      max: max,
      satisfied: round2(allFractions.filter(f => f >= 0.8).length / allFractions.length * 100),
      answers: allFractions.length
    };
  }
  return out;
}

/* ---------------------------- Calendar / detail views ---------------------------- */

/** ดึงข้อมูลสรุปทั้งเดือน เพื่อวาดปฏิทิน (payload: {year, month}) */
/** เลขเวอร์ชันของข้อมูลปฏิทิน — เพิ่มขึ้นทุกครั้งที่มีการแก้ไขอะไรก็ตามที่กระทบหน้าปฏิทิน เพื่อล้างแคชผลลัพธ์เดือนทั้งหมดทันที */
function bumpCalendarVersion_() {
  const props = PropertiesService.getScriptProperties();
  const v = Number(props.getProperty('CAL_VERSION') || '1') + 1;
  props.setProperty('CAL_VERSION', String(v));
}
function getCalendarVersion_() {
  return PropertiesService.getScriptProperties().getProperty('CAL_VERSION') || '1';
}

function getCalendar_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month); // 1-12

  // แคชผลลัพธ์ทั้งเดือนไว้ฝั่งเซิร์ฟเวอร์ — เดือนที่เคยเปิดดูแล้วจะโหลดเกือบทันทีในครั้งถัดไป
  const cacheKey = 'calendar2_v' + getCalendarVersion_() + '_' + year + '_' + month;
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return { ok: true, data: JSON.parse(cached) };
  } catch (e) { /* แคชใช้ไม่ได้ก็คำนวณสดตามปกติ */ }

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  const closedDates = sheetData_(SHEET_CLOSED);
  const specialOpen = sheetData_(SHEET_SPECIAL_OPEN);
  const appts = sheetData_(SHEET_APPTS).filter(r => r.status === 'active');

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = fmtDate_(d);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const resolved = resolveDayOpen_(dateStr);
    const isClosed = !resolved.isOpen;
    const isSpecialOpen = resolved.source === 'special';

    const dayBusy = getBusyForDate_(dateStr); // รวม Busy รายวัน + กฎปิดอัตโนมัติตามวันที่ในเดือน
    const dayAppts = appts.filter(a => fmtDate_(a.date) === dateStr);
    const opdCount = dayAppts.filter(a => a.type === 'OPD').length;
    const communityCount = dayAppts.filter(a => a.type === 'ลงชุมชน').length;

    // นับจำนวนช่องเวลาที่ยังว่างอยู่ (เอาไว้โชว์ "ว่างอีก N" บนปฏิทิน)
    let slotsAvailable = null;
    let slotsTotal = 0;
    if (resolved.isOpen) {
      const slots = buildSlotsFromDefs_(resolved.slotDefs, dayBusy, dayAppts);
      slotsAvailable = slots.filter(s => s.available).length;
      slotsTotal = slots.length;
    }

    // แสดงคลินิกเฉพาะวันที่เปิดให้บริการจริง (วันปิดไม่มีความหมายที่จะขึ้นป้ายคลินิก)
    const clinic = resolved.isOpen ? resolveClinicForDate_(dateStr) : null;

    days.push({
      date: dateStr,
      isWeekend,
      isClosed,
      isSpecialOpen,
      closedReason: isClosed ? (resolved.reason || '') : '',
      busyTypes: [...new Set(dayBusy.map(b => b.type))],
      opdCount,
      communityCount,
      slotsAvailable,
      slotsTotal,
      clinicName: clinic ? clinic.name : null,
      clinicColor: clinic ? clinic.color : null,
      clinicNote: clinic ? clinic.note : ''
    });
  }

  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(days), 3600); } catch (e) { /* ข้อมูลใหญ่เกินแคชได้ก็ข้ามไป */ }
  return { ok: true, data: days };
}

/** รายละเอียดของวันเดียว: ช่องเวลาว่าง + รายการนัด + busy + คลินิกวันนี้ (payload: {date}) */
function getDayDetail_(payload) {
  const date = payload.date;
  const resolved = resolveDayOpen_(date);

  const busy = getBusyForDate_(date); // รวม Busy รายวัน + กฎปิดอัตโนมัติตามวันที่ในเดือน
  const known9 = knownIcd9_();
  const appts = sheetData_(SHEET_APPTS)
    .filter(r => fmtDate_(r.date) === date && r.status === 'active')
    .sort((a, b) => a.startTime < b.startTime ? -1 : 1)
    .map(a => apptForClient_(a, known9));

  let slots = [];
  if (resolved.isOpen) {
    slots = buildSlotsFromDefs_(resolved.slotDefs, busy, appts);
  }

  const clinic = resolved.isOpen ? resolveClinicForDate_(date) : null;

  // รายการช่วงเวลาปกติของ "วันในสัปดาห์นี้" (ไม่ว่าวันนี้จะเปิดจริงหรือไม่) เอาไว้เป็นค่าตั้งต้นตอนกด "เปิดรับพิเศษ"
  const dow = new Date(date + 'T00:00:00').getDay();
  const weeklySlots = sheetData_(SHEET_SCHEDULE_SLOTS)
    .filter(r => Number(r.weekday) === dow)
    .map(r => ({ start: r.startTime, end: r.endTime }))
    .sort((a, b) => a.start < b.start ? -1 : 1);

  // ช่วงเวลาพิเศษเสริมที่เพิ่มไว้เฉพาะวันนี้ (แสดง+ลบทีละรายการได้ในแผงรายละเอียดวัน)
  const extraSlots = sheetData_(SHEET_EXTRA_SLOTS)
    .filter(r => fmtDate_(r.date) === date)
    .map(r => ({ id: r.id, start: r.startTime, end: r.endTime, note: r.note }))
    .sort((a, b) => a.start < b.start ? -1 : 1);

  return {
    ok: true,
    data: {
      date,
      isOpen: resolved.isOpen,
      isSpecialOpen: resolved.source === 'special',
      closedReason: resolved.reason || '',
      slotDefs: resolved.isOpen ? resolved.slotDefs : [],
      weeklySlots,
      extraSlots,
      busy,
      appointments: appts,
      slots,
      clinic: clinic
    }
  };
}

/** สร้างรายการช่วงเวลาจากที่กำหนดเองไว้ (ไม่ใช่การหารเท่าๆ กัน) พร้อมเช็คว่าช่วงไหนไม่ว่างแล้วบ้าง */
function buildSlotsFromDefs_(slotDefs, busy, appts) {
  return slotDefs.map(def => {
    const busyHit = busy.find(b => def.start < b.endTime && b.startTime < def.end);
    const apptHit = appts.find(a => def.start < a.endTime && a.startTime < def.end);
    return {
      start: def.start,
      end: def.end,
      available: !busyHit && !apptHit,
      busyType: busyHit ? busyHit.type : null,
      appointment: apptHit || null
    };
  });
}