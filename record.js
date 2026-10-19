/* ============================================================================
 * เวชระเบียน: แบบประเมินครั้งแรกของแต่ละ session (5 ชุด ตามแบบฟอร์มเดิมในชีต)
 * Progress note ของครั้งถัดไป (S O A P + เอกสารพร้อมพิมพ์) อยู่ใน progress.js — ใช้ตัวช่วยและช่องตรวจ/การรักษาจากไฟล์นี้
 * ใช้ของจาก app.js: api(), state, esc_(), toast(), showView_(), fmtThaiDate_(), todayYmd_(), logout()
 *
 * ช่องในแบบฟอร์มกำหนดที่ไฟล์นี้ (data-k = ชื่อคอลัมน์ในชีต Records) — เพิ่มช่องใหม่ที่นี่ได้เลย หลังบ้านเพิ่มคอลัมน์ให้เอง
 * ตัวเลือกดรอปดาวน์มาจากชีต RecordOptions (ชื่อรายการ = ชื่อคอลัมน์) รายการทดสอบ/เกณฑ์มาจากชีต AssessTests และ AssessNorms
 * ========================================================================== */

const REC = {
  setup: null,      // { options, tests, norms } จากหลังบ้าน
  patient: null,    // คนไข้ของแบบฟอร์มที่เปิดอยู่
  meta: null,       // { id, session, status, date, kind, ... } ของชุดที่เปิดอยู่ (id ว่าง = ยังไม่เคยบันทึก) kind = initial | progress
  ctx: null,        // Progress note: ข้อมูลประกอบจากหลังบ้าน { initial, prev, visit, nextAppt }
  layout: 'step',   // ใบแรกรับ: 'step' = กรอกทีละขั้น · 'all' = เห็นทั้ง 5 ชุดในหน้าเดียว (จำไว้ในเบราว์เซอร์)
  step: 1,          // ขั้นที่เปิดอยู่ (1-4) เมื่อกรอกทีละขั้น
  auto: null,       // ใบแรกรับฉบับใหม่: { touched: { ช่อง: true }, last: { ช่อง: ค่าที่ระบบเติม } } — ระบบเสนอ Problem list / Plan ให้จนกว่าผู้ใช้จะแก้เอง
  dirty: false,     // มีการแก้ไขที่ยังไม่ได้บันทึก
  autoDec: '',      // ข้อความ Decrease performance ที่ระบบเติมให้ล่าสุด (ใช้ดูว่าผู้ใช้แก้เองหรือยัง)
  saving: false
};
const REC_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const REC_OTHER = '__other__';

/* ---------------- ตัวช่วยสร้างช่องกรอก ---------------- */

const recAttr_ = s => esc_(String(s === undefined || s === null ? '' : s));
/** ดรอปดาวน์ที่เลือก "พิมพ์เอง…" ได้ — list = ชื่อรายการในชีต RecordOptions, ph = ข้อความบอกว่าช่องนี้คืออะไร */
function rDD(key, list, ph, cls) {
  const opts = ((REC.setup && REC.setup.options[list]) || []).map(o => `<option value="${recAttr_(o)}">${esc_(o)}</option>`).join('');
  return `<select data-k="${key}" data-list="${list}" class="rec-dd ${cls || 'm'}" aria-label="${recAttr_(ph)}"><option value="">${esc_(ph || 'เลือก')}</option>${opts}<option value="${REC_OTHER}">พิมพ์เอง…</option></select>`;
}
const rT = (key, ph, cls) => `<input type="text" data-k="${key}" class="${cls || 'm'}" placeholder="${recAttr_(ph)}" aria-label="${recAttr_(ph)}" maxlength="500">`;
const rTA = (key, ph) => `<textarea data-k="${key}" class="x" rows="2" placeholder="${recAttr_(ph)}" aria-label="${recAttr_(ph)}" maxlength="1000"></textarea>`;
const rNum = (key, label) => `<input type="number" data-k="${key}" class="s" inputmode="decimal" step="any" min="0" aria-label="${recAttr_(label)}">`;
const rTx = s => `<span class="tx">${s}</span>`;
const rCk = (key, label, cls) => `<label class="ck ${cls || ''}"><input type="checkbox" data-k="${key}">${label}</label>`;
/** ตัวเลือกแบบเลือกได้อย่างเดียว (เช่น None / Yes) — เก็บค่าเป็นคำเดียวในช่อง key กดซ้ำเพื่อยกเลิก */
const rPair = (key, items) => items.map(it => `<label class="ck ${it[2] || ''}"><input type="checkbox" data-pair="${key}" value="${it[0]}">${it[1]}</label>`).join('');
const rNY = key => rPair(key, [['none', 'None'], ['yes', 'Yes', 'warn']]);
const rNrs = (key, label) => `<span class="rec-nrs" data-nrs="${key}" role="group" aria-label="${recAttr_(label)}">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(i => `<button type="button" data-v="${i}">${i}</button>`).join('')}</span>`;
const rRow = (label, ...c) => `<div class="rec-row"><span class="lb">${label}</span>${c.join('')}</div>`;
/** แถวที่ต้องใช้เต็มความกว้าง (จอกว้างแบบฟอร์มจัด 2 คอลัมน์ แถวทั่วไปกินครึ่งเดียว) */
const rWide = html => html.replace('class="rec-row', 'class="rec-row wide');
/**
 * ส่วนที่ซ่อนไว้จนกว่าจะใช้ — cond: "ช่อง" (ติ๊กแล้ว/มีค่า) · "ช่อง=ค่า" · "ช่อง!=ค่า" (มีค่าและไม่ใช่ค่านั้น)
 * ช่องที่อยู่ในส่วนที่ซ่อนอยู่จะไม่ถูกบันทึก
 */
const rExtra = (cond, ...c) => c.length ? `<span class="rec-extra hidden" data-show="${cond}">${c.join('')}</span>` : '';
/** แถวที่ขึ้นต้นด้วยช่องติ๊ก — ช่องย่อยของแถวขึ้นมาเมื่อติ๊ก */
const rCRow = (key, label, ...c) => `<div class="rec-row" data-lead="${key}">${rCk(key, label, 'lead')}${rExtra(key, ...c)}</div>`;
/** แถว None / Yes — ช่องรายละเอียดขึ้นมาเมื่อเลือก Yes */
const rNYRow = (key, label, ...c) => `<div class="rec-row" data-ny="${key}"><span class="lb">${label}</span>${rNY(key)}${rExtra(key + '=yes', ...c)}</div>`;
/** กลุ่มช่องที่ต้องอยู่ด้วยกัน: จอแคบขึ้นบรรทัดใหม่พร้อมกันทั้งกลุ่ม */
const rGrp = inner => `<span class="rec-grp">${inner}</span>`;
/** กลุ่ม "ป้าย + ช่อง" ที่ไม่ให้ป้ายกับช่องแยกบรรทัดกัน */
const rGrpN = inner => `<span class="rec-grp nw">${inner}</span>`;
const rSub = s => `<div class="rec-sub">${s}</div>`;
const rCard = (n, title, body) => `<section class="rec-card" id="recPart${n}"><h3><span class="n">${n}</span>${title}</h3><div class="rec-grid">${body}</div></section>`;
/**
 * รายการแบบ "เลือกจากดรอปดาวน์ก่อน แล้วช่องกรอกของรายการนั้นจึงขึ้นมา" (ผลทดสอบ, Special test, Intervention)
 * items: [{ id, label, group, html, wide, lead, exs, block, slot, list, pre, rep, preset }] — lead = ช่องติ๊ก (ซ่อน) ที่ต้องเป็น Y เมื่อรายการถูกเลือก
 *   slot + list + pre : แถวว่างที่เลือก "ชนิด" จากรายการตัวเลือก (เช่น Modality) — ดรอปดาวน์เพิ่มรายการแสดงชนิดทั้งหมดของรายการนั้น
 *                       เลือกแล้วใช้แถวว่างถัดไป ชนิดเดียวกันเพิ่มได้หลายแถว · pre = คำนำหน้าชื่อช่องของแถว (ช่องชนิด = pre + _type)
 *   rep               : รายการที่เพิ่มซ้ำได้ (เช่น ROM 3 แถว) — ดรอปดาวน์แสดงชื่อเดียว เลือกแล้วใช้แถวว่างถัดไป
 *   preset            : "ช่อง=ค่า" ที่ติ๊กให้ทันทีเมื่อเพิ่มรายการ (เช่น เพิ่ม Tenderness = ตรวจพบ)
 */
function rPick(id, placeholder, items) {
  return `<div class="rec-pick" data-pick="${id}" data-ph="${recAttr_(placeholder)}">
    <div class="rec-pick-bar"><select class="rec-pick-add" aria-label="${recAttr_(placeholder)}"></select></div>
    <div class="rec-pick-items rec-grid">${items.map(it => `
      <div class="${it.block ? 'rec-pick-block' : 'rec-row'} rec-pick-item hidden${it.wide || it.block ? ' wide' : ''}" data-item="${recAttr_(it.id)}" data-label="${recAttr_(it.label)}" data-group="${recAttr_(it.group || '')}"${it.lead ? ` data-leadk="${it.lead}"` : ''}${it.exs ? ' data-exs="1"' : ''}${it.slot ? ` data-slot="${it.slot}" data-slot-list="${it.list}"` : ''}${it.pre ? ` data-pre="${it.pre}"` : ''}${it.rep ? ` data-rep="${it.rep}"` : ''}${it.preset ? ` data-preset="${it.preset}"` : ''}>
        ${it.lead ? `<input type="checkbox" data-k="${it.lead}" class="rec-lead-hidden" tabindex="-1" aria-hidden="true">` : ''}${it.html}
        <button type="button" class="rec-pick-x" title="เอารายการนี้ออก" aria-label="เอารายการนี้ออก: ${recAttr_(it.label)}">✕</button>
      </div>`).join('')}</div>
  </div>`;
}
const rName = s => `<span class="lb pick-name">${s}</span>`;

/* ---------------- แบบฟอร์ม 5 ชุด ---------------- */

function recPart1_() {
  return rCard(1, 'Personal Data', [
    rWide(`<div class="rec-row rec-consent" id="recConsentRow"><span class="lb">การยินยอม</span>${rPair('p1_consent', [['signed', 'ลงนามในใบยินยอมแล้ว'], ['verbal', 'ยินยอมด้วยวาจา']])}${rExtra('p1_consent', rT('p1_consent_by', 'ผู้ให้ความยินยอม (กรอกเมื่อไม่ใช่คนไข้เอง เช่น ญาติ)', 'x'))}<a class="secondary rec-mini" id="recConsentPrint" href="consent.html" target="_blank" rel="noopener">พิมพ์ใบยินยอม</a></div>`),
    rWide(rRow('Chief complaint', rT('p1_cc', 'อาการสำคัญ', 'x'))),
    rWide(rRow('Present history', rTA('p1_ph', 'ประวัติปัจจุบัน'))),
    rSub('Past history'),
    rWide(rRow('U/D', rDD('p1_ud1', 'ud', 'โรคประจำตัว 1'), rDD('p1_ud2', 'ud', 'โรคประจำตัว 2'), rDD('p1_ud3', 'ud', 'โรคประจำตัว 3'), rT('p1_ud_note', 'อื่น ๆ / รายละเอียด', 'x'))),
    rRow('Accident', rDD('p1_acc', 'yesNo', 'Yes / No'), rExtra('p1_acc!=No', rT('p1_acc_note', 'รายละเอียด', 'x'))),
    rNYRow('p1_fall', 'Falling history', rT('p1_fall_note', 'รายละเอียด', 'x')),
    rSub('Precaution / Contraindication / Flags'),
    rNYRow('p1_prec', 'Precaution', rT('p1_prec_note', 'รายละเอียด', 'x')),
    rNYRow('p1_contra', 'Contraindication', rDD('p1_contra1', 'contraindication', 'ข้อห้าม', 'l')),
    rNYRow('p1_red', 'Red flag', rDD('p1_red1', 'redFlag', 'Red flag 1'), rDD('p1_red2', 'redFlag', 'Red flag 2')),
    rNYRow('p1_orange', 'Orange flag', rDD('p1_orange1', 'orangeFlag', 'Orange flag', 'l')),
    rNYRow('p1_yellow', 'Yellow flag', rDD('p1_yellow1', 'yellowFlag', 'Yellow flag 1'), rDD('p1_yellow2', 'yellowFlag', 'Yellow flag 2')),
    rSub('Diagnosis'),
    rWide(rRow('Medical diagnosis', rDD('p1_mdx1', 'medicalDx', 'การวินิจฉัย 1'), rDD('p1_mdx2', 'medicalDx', 'การวินิจฉัย 2'), rDD('p1_mdx3', 'medicalDx', 'การวินิจฉัย 3'), rDD('p1_mdx4', 'medicalDx', 'การวินิจฉัย 4'))),
    rRow('PT diagnosis', rDD('p1_ptdx', 'ptDx', 'Physical therapy diagnosis', 'l'))
  ].join(''));
}

/* ---------------- แบบประเมินแบบติ๊กทีละข้อ: EQ-5D-5L และ Barthel ADL ---------------- */

// EQ-5D-5L: 5 มิติ มิติละ 5 ระดับ (1 = ไม่มีปัญหา ... 5 = มากที่สุด/ทำไม่ได้)
// คะแนนอรรถประโยชน์ = 1 - ผลรวมค่าสัมประสิทธิ์ของแต่ละมิติ (ค่าฉบับประชากรไทย Pattanaphesaj 2018 / HITAP ตรวจตรงกับตารางครบ 3,125 สถานะ)
// [เดิม:] (ค่าสัมประสิทธิ์ฉบับภาษาไทย: Pattanaphesaj J., Mahidol University; 2014)
// ที่นี่เป็นช่องบันทึก "ระดับ" ที่คนไข้ตอบ ไม่ใช่ตัวแบบสอบถาม — ถ้อยคำของแบบสอบถามเป็นลิขสิทธิ์ของ EuroQol Group
const REC_EQ5D = [
  ['mo', 'การเคลื่อนไหว', [0, 0.066127, 0.0865629, 0.2109943, 0.3712311]],
  ['sc', 'การดูแลตนเอง', [0, 0.0581293, 0.0706312, 0.1924905, 0.2498763]],
  ['ua', 'กิจกรรมที่ทำเป็นประจำ', [0, 0.0582544, 0.0711974, 0.1534855, 0.248331]],
  ['pd', 'อาการเจ็บปวด/ไม่สบายตัว', [0, 0.0563998, 0.0664922, 0.2068864, 0.2564331]],
  ['ad', 'ความวิตกกังวล/ซึมเศร้า', [0, 0.0580857, 0.0957539, 0.2327036, 0.2953493]]
];
const REC_EQ5D_LEVELS = ['ไม่มีปัญหา', 'เล็กน้อย', 'ปานกลาง', 'มาก', 'มากที่สุด'];
// Barthel ADL index (แบบประเมินคัดกรอง 10 ข้อ รวม 0-20 คะแนน): ลำดับตัวเลือก = คะแนน 0, 1, 2, ...
const REC_BARTHEL = [
  ['Feeding', 'รับประทานอาหาร', ['ตักเข้าปากเองไม่ได้ ต้องมีคนป้อน', 'ตักเองได้แต่ต้องมีคนช่วยเตรียม', 'ตักและช่วยตัวเองได้ปกติ']],
  ['Grooming', 'ล้างหน้า หวีผม แปรงฟัน โกนหนวด', ['ต้องการความช่วยเหลือ', 'ทำเองได้']],
  ['Transfer', 'ลุกนั่งจากที่นอน / เตียงไปเก้าอี้', ['นั่งไม่ได้ หรือต้องใช้ 2 คนยก', 'ต้องช่วยอย่างมากจึงนั่งได้', 'ต้องช่วยบ้าง หรือต้องมีคนดูแล', 'ทำได้เอง']],
  ['Toilet use', 'ใช้ห้องน้ำ', ['ช่วยตัวเองไม่ได้', 'ทำเองได้บ้าง ต้องช่วยบางอย่าง', 'ช่วยตัวเองได้ดี']],
  ['Mobility', 'เคลื่อนที่ภายในห้องหรือบ้าน', ['เคลื่อนที่ไปไหนไม่ได้', 'ใช้รถเข็นเองได้', 'เดินโดยมีคนช่วยหรือดูแล', 'เดินหรือเคลื่อนที่ได้เอง']],
  ['Dressing', 'สวมใส่เสื้อผ้า', ['ต้องมีคนสวมใส่ให้', 'ช่วยตัวเองได้ราวครึ่งหนึ่ง', 'ช่วยตัวเองได้ดี']],
  ['Stairs', 'ขึ้นลงบันได 1 ชั้น', ['ทำไม่ได้', 'ต้องการคนช่วย', 'ขึ้นลงได้เอง']],
  ['Bathing', 'อาบน้ำ', ['ต้องมีคนช่วยหรือทำให้', 'อาบน้ำเองได้']],
  ['Bowels', 'กลั้นอุจจาระ (1 สัปดาห์ที่ผ่านมา)', ['กลั้นไม่ได้ หรือต้องสวนเสมอ', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']],
  ['Bladder', 'กลั้นปัสสาวะ (1 สัปดาห์ที่ผ่านมา)', ['กลั้นไม่ได้ หรือใส่สายสวนที่ดูแลเองไม่ได้', 'กลั้นไม่ได้บางครั้ง', 'กลั้นได้ปกติ']]
];
function recBarthelGroup_(total) {
  return total >= 12 ? 'กลุ่มติดสังคม' : (total >= 5 ? 'กลุ่มติดบ้าน' : 'กลุ่มติดเตียง');
}
/** ตัวเลือกแบบปุ่ม เลือกได้ข้อเดียว กดซ้ำเพื่อยกเลิก — เก็บค่าเป็นตัวเลขในช่อง key (ใช้กลไกเดียวกับ NRS) */
const rOpts = (key, label, items) => `<span class="rec-opts" data-nrs="${key}" role="group" aria-label="${recAttr_(label)}">${items.map(it => `<button type="button" data-v="${it[0]}"><b>${it[0]}</b> ${esc_(it[1])}</button>`).join('')}</span>`;

/** บล็อกแบบประเมินติ๊กทีละข้อ ในรูปของรายการที่เลือกจากดรอปดาวน์ Performance test */
function recScoreItems_() {
  const tests = (REC.setup && REC.setup.tests) || [];
  const groupOf = (key, dflt) => { const t = tests.find(x => x.key === key); return t ? t.group : dflt; };
  return [
    { id: 'eq5d', label: 'EQ-5D-5L', group: groupOf('eq5d', 'QoL'), block: true, html: `
      <details class="rec-details" id="recEq5d" open>
        <summary><b>EQ-5D-5L</b><span class="rec-details-sum" id="recEq5dSum"></span></summary>
        <div class="rec-grid">
        ${REC_EQ5D.map(d => rWide(rRow(esc_(d[1]), rOpts('pt_eq5d_' + d[0], d[1], REC_EQ5D_LEVELS.map((t, i) => [i + 1, t]))))).join('')}
        ${rRow('ข้อ 6 สุขภาพวันนี้ (VAS)', `<input type="number" data-k="pt_eq5d_vas" class="s" min="0" max="100" step="1" inputmode="numeric" aria-label="สุขภาพวันนี้ VAS 0 ถึง 100">`, rTx('0 = แย่ที่สุด · 100 = ดีที่สุด'))}
        ${rRow('คะแนนอรรถประโยชน์', `<input type="number" data-k="pt_eq5d" class="s" min="-1" max="1" step="0.0001" inputmode="decimal" readonly tabindex="-1" aria-label="คะแนนอรรถประโยชน์ EQ-5D (คำนวณอัตโนมัติ)">`, rTx('คำนวณให้เองจากข้อ 1-5 (ฉบับประชากรไทย) · -0.4212 = แย่ที่สุด, 1 = สมบูรณ์ที่สุด · ไม่ต้องกรอก'))}
        </div>
      </details>` },
    { id: 'barthel', label: 'Barthel ADL', group: groupOf('barthel', 'Functional Questionnaire test'), block: true, html: `
      <details class="rec-details" id="recBarthel" open>
        <summary><b>Barthel ADL</b><span class="rec-details-sum" id="recBarthelSum"></span></summary>
        <div class="rec-grid">
        ${REC_BARTHEL.map((it, i) => `<div class="rec-row rec-barthel"><span class="lb">${i + 1}. ${esc_(it[0])}<small>${esc_(it[1])}</small></span>${rOpts('pt_barthel_' + (i + 1), it[0], it[2].map((t, v) => [v, t]))}</div>`).join('')}
        ${rWide(rRow('คะแนนรวม', `<input type="number" data-k="pt_barthel" class="s" min="0" max="20" step="1" inputmode="numeric" aria-label="คะแนนรวม Barthel ADL">`, rTx('/ 20 · รวมให้เองเมื่อติ๊กครบ 10 ข้อ ถ้ามีแต่คะแนนรวม (เช่น จากแอปเยี่ยมบ้าน) กรอกตรงนี้ได้')))}
        </div>
      </details>` }
  ];
}

function recPicked_(key) {
  const on = recBody_().querySelector(`[data-nrs="${key}"] button.on`);
  return on ? Number(on.dataset.v) : null;
}
/** เติมคะแนนรวมลงช่องของมัน — ตอบไม่ครบ: ล้างเฉพาะค่าที่ระบบเคยเติม (ค่าที่ผู้ใช้พิมพ์เองไม่แตะ) */
function recSetScore_(key, value) {
  const el = recBody_().querySelector(`[data-k="${key}"]`);
  if (!el) return;
  if (value !== null) { el.value = String(value); el.dataset.auto = '1'; }
  else if (el.dataset.auto === '1' || el.type === 'hidden') { el.value = ''; delete el.dataset.auto; }
}
/** คะแนนรวมจากข้อที่ติ๊ก (ต้องติ๊กครบ 10 ข้อ) */
function recBarthelItemsTotal_() {
  const picks = REC_BARTHEL.map((it, i) => recPicked_('pt_barthel_' + (i + 1)));
  return picks.every(v => v !== null) ? picks.reduce((s, v) => s + v, 0) : null;
}
/** คะแนนรวม Barthel ที่ใช้ตัดสิน: จากข้อที่ติ๊กครบ ถ้าไม่ครบใช้คะแนนรวมที่กรอกเอง (0-20) */
function recBarthelTotal_() {
  const items = recBarthelItemsTotal_();
  if (items !== null) return items;
  const el = recBody_().querySelector('[data-k="pt_barthel"]');
  if (!el || el.dataset.auto === '1' || recHiddenField_(el)) return null;
  const raw = (el.value || '').trim(), n = Number(raw);
  return raw !== '' && isFinite(n) && n >= 0 && n <= 20 ? n : null;
}
/** คะแนนอรรถประโยชน์ EQ-5D-5L (ไทย) = 1 - ผลรวมค่าสัมประสิทธิ์ของแต่ละมิติ ปัดเป็น 4 ตำแหน่ง ช่วง -0.4212 ถึง 1 (VAS ไม่นำมาคำนวณ) */
function recEq5dUtility_(lv) {
  const sum = REC_EQ5D.reduce((t, d, i) => t + Math.round(d[2][lv[i] - 1] * 1e7), 0); // คิดเป็นจำนวนเต็มกันเลขทศนิยมคลาดเคลื่อน
  return Math.round((1e7 - sum) / 1e3) / 1e4;
}
/** คำนวณคะแนนของ EQ-5D-5L และ Barthel ADL จากข้อที่ติ๊ก แล้วแสดงผลที่หัวบล็อก */
function recScores_() {
  const lv = REC_EQ5D.map(d => recPicked_('pt_eq5d_' + d[0]));
  const eqDone = lv.filter(v => v !== null).length;
  const eqSum = document.getElementById('recEq5dSum');
  if (!eqSum) return;
  let util = null;
  if (eqDone === REC_EQ5D.length) {
    util = recEq5dUtility_(lv);
    eqSum.textContent = `สถานะสุขภาพ ${lv.join('')} · อรรถประโยชน์ ${util.toFixed(4)}`;
  } else {
    eqSum.textContent = eqDone ? `ตอบแล้ว ${eqDone} / ${REC_EQ5D.length} มิติ` : 'ยังไม่ได้ประเมิน';
  }
  eqSum.classList.toggle('done', util !== null);
  recSetScore_('pt_eq5d', util);

  const bDone = REC_BARTHEL.filter((it, i) => recPicked_('pt_barthel_' + (i + 1)) !== null).length;
  recSetScore_('pt_barthel', recBarthelItemsTotal_());
  const total = recBarthelTotal_();
  const typed = total !== null && recBarthelItemsTotal_() === null;
  const bSum = document.getElementById('recBarthelSum');
  bSum.textContent = total !== null ? `${total} / 20 คะแนน · ${recBarthelGroup_(total)}${typed ? ' (กรอกคะแนนรวม)' : ''}` : (bDone ? `ตอบแล้ว ${bDone} / ${REC_BARTHEL.length} ข้อ` : 'ยังไม่ได้ประเมิน');
  bSum.classList.toggle('done', total !== null);
  bSum.classList.toggle('bad', total !== null && total < 12);
}

/** รายการทดสอบจากชีต AssessTests ในรูปของรายการให้เลือก (EQ5D และ Barthel ใช้บล็อกติ๊กทีละข้อแทนช่องคะแนนเดี่ยว) */
function recTestItems_() {
  const tests = (REC.setup && REC.setup.tests) || [];
  const blocks = recScoreItems_();
  const used = {};
  // ตามลำดับในชีต: EQ5D และ Barthel ใช้บล็อกติ๊กทีละข้อแทนช่องคะแนนเดี่ยว (อยู่ตำแหน่งเดิมของรายการนั้น)
  const items = tests.map(t => {
    const block = blocks.find(b => b.id === t.key);
    if (block) { used[t.key] = true; return block; }
    return { id: t.key, label: t.name, group: t.group, html: `
    <span class="lb">${esc_(t.name)}</span>
    ${t.askName ? `<input type="text" data-k="pt_${t.key}_label" class="m" placeholder="ชื่อแบบสอบถาม" aria-label="ชื่อแบบสอบถาม" maxlength="80">` : ''}
    ${rNum('pt_' + t.key, t.name)}${rTx(esc_(t.unit))}
    <span class="rec-crit" data-crit="${recAttr_(t.key)}"></span>` };
  });
  blocks.forEach(b => { if (!used[b.id]) items.push(b); }); // บล็อกที่ไม่มีในชีต (เช่น Barthel) ต่อท้ายโหมดของตัวเอง
  const groups = [];
  items.forEach(it => { if (groups.indexOf(it.group) === -1) groups.push(it.group); });
  return groups.reduce((out, g) => out.concat(items.filter(it => it.group === g)), []);
}

/* ---------------- ช่องตรวจร่างกายที่ใช้ร่วมกัน ----------------
 * แบบแรกรับวางเป็นแถวตายตัว ส่วน Progress note ให้เลือกจากดรอปดาวน์ทีละรายการ — ทั้งสองแบบใช้ชื่อช่องเดียวกัน
 * รายการที่มีได้หลายแถว: แถวที่ 2, 3 ใช้ชื่อช่องต่อท้ายเลข (p2_rom_.. / p2_rom2_.. / p2_rom3_..)
 */
const recKn_ = (base, n) => base + (n > 1 ? n : '');
const recExSym_ = n => { const k = recKn_('p2_sym', n); return rDD(k, 'symptom', 'อาการ') + rTx('at') + rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_at', 'bodyPart', 'ตำแหน่ง'); };
const recExPosture_ = () => rPair('p2_post', [['normal', 'Normal'], ['incorrect', 'Incorrect', 'warn']]) +
  rExtra('p2_post=incorrect', rCk('p2_post_fhp', 'Forward head'), rCk('p2_post_rs', 'Round shoulder'), rCk('p2_post_ws', 'Winged scapula'), rCk('p2_post_chin', 'Chin out'), rCk('p2_post_kyphosis', 'Thoracic kyphosis'), rDD('p2_post_other', 'posture', 'ท่าทางอื่น ๆ'));
const recExTender_ = n => { const k = recKn_('p2_tender', n); return rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_at', 'bodyPart', 'ตำแหน่ง') + rDD(k + '_muscle', 'muscle', 'กล้ามเนื้อ/โครงสร้าง'); };
const recExRom_ = n => {
  const k = recKn_('p2_rom', n);
  return rDD(k + '_type', 'romType', 'Active / Passive', 'm') + rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_joint', 'joint', 'ข้อ') + rDD(k + '_dir', 'direction', 'ทิศทาง') +
    rGrp(`<input type="number" data-k="${k}_deg" class="s n" min="0" max="360" step="1" inputmode="numeric" placeholder="องศา" aria-label="มุมที่วัดได้ (องศา)">` + rTx('°'));
};
/** แถวเพิ่มของรายการที่มีได้หลายแถว (แบบแรกรับ): ขึ้นมาเมื่อแถวก่อนหน้ามีข้อมูล */
const rMore = (cond, label, ...c) => `<div class="rec-row wide rec-more hidden" data-show="${cond}"><span class="lb">${label}</span>${c.join('')}</div>`;
const recStItems_ = () => {
  const st = (id, label, ...c) => ({ id: id, label: label, group: 'Special test', lead: 'p2_st_' + id, wide: true, html: rName(label) + c.join('') });
  return [
    st('upper', 'Shoulder / upper', rDD('p2_st_upper_test', 'specialTestUpper', 'ชื่อการทดสอบ', 'l'), rDD('p2_st_upper_res', 'testResult', 'ผล', 's')),
    st('lower', 'Lumbar / lower', rDD('p2_st_lower_test', 'specialTestLower', 'ชื่อการทดสอบ', 'l'), rDD('p2_st_lower_res', 'testResult', 'ผล', 's')),
    st('other', 'อื่น ๆ', rT('p2_st_other_note', 'ชื่อการทดสอบและผล', 'x'))
  ];
};
/** แถว "ผลจาก AppSheet" (ผู้ช่วยประเมินผ่านแอป) — ใช้ทั้งแบบแรกรับและ Progress note */
const recFieldRowHtml_ = () => rWide(`<div class="rec-row rec-field hidden" id="recFieldRow"><span class="lb">ผลจาก AppSheet</span>
      <select id="recFieldSel" class="l" aria-label="เลือกผลประเมินจาก AppSheet"></select>
      <button type="button" class="secondary rec-mini" id="recFieldApply">ดึงมาใส่แบบฟอร์ม</button>
      <span class="tx" id="recFieldNote"></span>
      <input type="hidden" data-k="p2_as_id"><input type="hidden" data-k="p2_as_by"><input type="hidden" data-k="p2_as_date"></div>
      <div class="rec-field-stamp hidden" id="recFieldStamp"></div>`);

function recPart2_() {
  return rCard(2, 'Physical Examination', [
    recFieldRowHtml_(),
    rRow('เวลาที่ตรวจ', `<input type="time" data-k="p2_time" class="s2" aria-label="เวลาที่ตรวจ">`),
    rSub('Behavior of symptoms'),
    rRow('อาการ', recExSym_(1)),
    rRow('Frequency', rDD('p2_freq', 'frequency', 'ความถี่')),
    rRow('NRS · Rest', rNrs('p2_nrs_rest', 'NRS ขณะพัก')),
    rRow('NRS · Function', rNrs('p2_nrs_func', 'NRS ขณะใช้งาน')),
    rRow('Aggravate', rT('p2_agg', 'สิ่งที่ทำให้อาการมากขึ้น', 'x')),
    rRow('Ease', rDD('p2_ease', 'ease', 'สิ่งที่ทำให้อาการลดลง')),
    rSub('Posture / Tenderness / ROM'),
    rWide(`<div class="rec-row"><span class="lb">Posture</span>${recExPosture_()}</div>`),
    rWide(rNYRow('p2_tender', 'Tenderness', recExTender_(1))),
    rMore('p2_tender_at|p2_tender_muscle', 'Tenderness (2)', recExTender_(2)),
    rWide(`<div class="rec-row"><span class="lb">ROM</span>${rPair('p2_rom', [['full', 'Full all direction'], ['limit', 'Limit at', 'warn']])}${rExtra('p2_rom=limit', recExRom_(1))}</div>`),
    rMore('p2_rom_joint|p2_rom_dir|p2_rom_deg', 'ROM (2)', recExRom_(2)),
    rMore('p2_rom2_joint|p2_rom2_dir|p2_rom2_deg', 'ROM (3)', recExRom_(3)),
    rSub('Special test'),
    rPick('st', 'เลือก Special test ที่ตรวจ', recStItems_().map(it => Object.assign(it, { group: '' }))),
    rSub('Performance test'),
    rPick('pt', 'เลือกรายการที่จะตรวจ', recTestItems_())
  ].join(''));
}

function recPart3_() {
  return rCard(3, 'Problem list (localize)', [
    rCRow('p3_pain', 'Pain at', rDD('p3_pain_side', 'side', 'ข้าง', 's'), rDD('p3_pain_at', 'bodyPart', 'ตำแหน่ง'), rDD('p3_pain_muscle', 'muscle', 'ส่วน/กล้ามเนื้อ')),
    rCRow('p3_rom', 'ROM limited', rDD('p3_rom_joint', 'joint', 'ข้อ'), rDD('p3_rom_dir', 'direction', 'ทิศทาง')),
    rCRow('p3_imb', 'Muscle imbalance', rTx('of'), rDD('p3_imb_muscle', 'muscle', 'กล้ามเนื้อ/ส่วน')),
    rCRow('p3_numb', 'Numbness', rDD('p3_numb_side', 'side', 'ข้าง', 's'), rDD('p3_numb_at', 'bodyPart', 'ตำแหน่ง')),
    rCRow('p3_amb', 'Poor ambulation'),
    rCRow('p3_hcm', 'Healthcare management'),
    rCRow('p3_other', 'Others', rT('p3_other_note', 'ระบุ', 'x')),
    rWide(`<div class="rec-row" data-lead="p3_decPerf">${rCk('p3_decPerf', 'Decrease performance', 'lead')}${rExtra('p3_decPerf',
      `<textarea data-k="p3_decPerf_detail" class="x" rows="2" placeholder="ระบบเติมรายการทดสอบที่ต่ำกว่าเกณฑ์ให้เอง แก้ไขได้" aria-label="รายละเอียด Decrease performance" maxlength="1000"></textarea>`,
      `<button type="button" class="secondary rec-mini" id="recDecRefill" title="เติมใหม่จากผลทดสอบในชุดที่ 2">↻ ดึงจากผลทดสอบ</button>`)}</div>`)
  ].join(''));
}

function recPart4_() {
  return rCard(4, 'Plan of treatment &amp; Goal', [
    rSub('Plan of treatment'),
    rWide(`<div class="rec-row">${[['ex', 'Exercise'], ['mod', 'Modality'], ['hp', 'Health promotion'], ['nerve', 'Nerve mobilization'], ['amb', 'Ambulation/transfer training'], ['bal', 'Balance training'], ['home', 'Home program']].map(x => rCk('p4_plan_' + x[0], x[1])).join('')}</div>`),
    rCRow('p4_plan_other', 'อื่น ๆ', rT('p4_plan_other_note', 'ระบุ', 'x')),
    rSub('Short term goal'),
    rCRow('p4_stg_pain', 'Relieve pain within', rDD('p4_stg_pain_n', 'count', 'จำนวน', 's'), rTx('visit')),
    rCRow('p4_stg_follow', 'ปฏิบัติตามที่นักกายภาพสอนได้อย่างถูกต้อง ภายใน', rDD('p4_stg_follow_n', 'count', 'จำนวน', 's'), rTx('visit')),
    rCRow('p4_stg_other', 'อื่น ๆ', rT('p4_stg_other_note', 'ระบุ', 'x')),
    rSub('Long term goal'),
    rCRow('p4_ltg_perf', 'Increase physical performance'),
    rCRow('p4_ltg_qol', 'Increase QOL'),
    rCRow('p4_ltg_rtf', 'Return to function', rDD('p4_ltg_rtf_what', 'functionGoal', 'กิจกรรม/หน้าที่'), rDD('p4_ltg_rtf_n', 'count', 'จำนวน', 's'), rDD('p4_ltg_rtf_unit', 'timeUnit', 'หน่วยเวลา', 's')),
    rCRow('p4_ltg_hcm', 'Improve skills for healthcare management', rDD('p4_ltg_hcm_n', 'count', 'จำนวน', 's'), rDD('p4_ltg_hcm_unit', 'timeUnit', 'หน่วยเวลา', 's'))
  ].join(''));
}

/* ---------------- การรักษา (Intervention) — ใช้ทั้งแบบแรกรับ (ชุดที่ 5) และ Progress note (P) ----------------
 * แถว Modality (เครื่องมือ) และ Exercise เป็นแถวว่าง REC_TX_SLOTS แถว: เลือกชนิดจากรายการตัวเลือก (เพิ่มชนิดเองได้ในหน้าตั้งค่า)
 *   Modality p5_m1.._m6 : _type ชนิด · _side ข้าง · _at ตำแหน่ง/กล้ามเนื้อ · _mode · _int (intensity) · _pts จำนวนจุด · _min นาทีต่อจุด · _note
 *   Exercise p5_e1.._e6 : _type ชนิด · _side ข้าง (ถ้ามี) · _at ตำแหน่ง/กล้ามเนื้อ · _detail · _reps ครั้ง/set · _sets set/วัน · _days วัน/สัปดาห์
 *   Ambulation (ฝึกเดิน) p5_amb + _level (Independent/Dependent) + _aid เครื่องช่วยเดิน + _pattern · Transfer (เคลื่อนย้าย) p5_tr + _type + _level
 */
const REC_TX_SLOTS = 6;
const recNumIn_ = (key, ph, max) => `<input type="number" data-k="${key}" class="s n" min="0" max="${max || 999}" step="any" inputmode="decimal" placeholder="${recAttr_(ph)}" aria-label="${recAttr_(ph)}">`;
function recTxItems_() {
  const mod = [], ex = [];
  for (let i = 1; i <= REC_TX_SLOTS; i++) {
    const k = 'p5_m' + i;
    mod.push({ id: 'm' + i, label: 'Modality', group: 'Modality (เครื่องมือ)', slot: 'm', list: 'modality', pre: k, wide: true,
      html: rDD(k + '_type', 'modality', 'เครื่องมือ', 'l rec-tx-type') + rTx('at') + rDD(k + '_side', 'side', 'ข้าง', 's') + rDD(k + '_at', 'muscle', 'ตำแหน่ง/กล้ามเนื้อ', 'l') +
        rGrpN(rTx('Mode') + rDD(k + '_mode', 'modMode', 'โหมด', 'm')) + rGrpN(rTx('Intensity') + rDD(k + '_int', 'modIntensity', 'ความเข้ม', 'm')) +
        rGrp(recNumIn_(k + '_pts', 'จำนวนจุด') + rTx('จุด ×') + recNumIn_(k + '_min', 'นาที/จุด') + rTx('นาที/จุด')) + rT(k + '_note', 'หมายเหตุ', 'm') });
    const e = 'p5_e' + i;
    ex.push({ id: 'e' + i, label: 'Exercise', group: 'Exercise (ออกกำลังกาย)', slot: 'e', list: 'exercise', pre: e, wide: true, exs: true,
      html: rDD(e + '_type', 'exercise', 'การออกกำลังกาย', 'l rec-tx-type') + rTx('of') + rDD(e + '_side', 'side', 'ข้าง', 's') + rDD(e + '_at', 'muscle', 'ตำแหน่ง/กล้ามเนื้อ', 'l') + rDD(e + '_detail', 'exDetail', 'รายละเอียด', 'm') +
        rGrp(rDD(e + '_reps', 'reps', 'ครั้ง', 's') + rTx('ครั้ง/set') + rDD(e + '_sets', 'setsPerDay', 'set', 's') + rTx('set/วัน') + rDD(e + '_days', 'daysPerWeek', 'วัน', 's') + rTx('วัน/สัปดาห์')) });
  }
  const level = k => rDD(k + '_level', 'assistLevel', 'ระดับการช่วยเหลือ', 'l');
  const training = [
    { id: 'amb', label: 'Ambulation training (ฝึกเดิน)', group: 'Training', lead: 'p5_amb', wide: true,
      html: rName('Ambulation training') + level('p5_amb') + rTx('with') + rDD('p5_amb_aid', 'gaitAid', 'เครื่องช่วยเดิน') + rDD('p5_amb_pattern', 'gaitPattern', 'รูปแบบการเดิน') + rT('p5_amb_note', 'หมายเหตุ', 'm') },
    { id: 'tr', label: 'Transfer training (เคลื่อนย้าย)', group: 'Training', lead: 'p5_tr', wide: true,
      html: rName('Transfer training') + rDD('p5_tr_type', 'transferType', 'รูปแบบการเคลื่อนย้าย', 'l') + level('p5_tr') + rT('p5_tr_note', 'หมายเหตุ', 'm') },
    { id: 'bal', label: 'Balance training', group: 'Training', lead: 'p5_bal', wide: true, html: rName('Balance training') + rT('p5_bal_note', 'รายละเอียด', 'x') },
    { id: 'other', label: 'อื่น ๆ', group: 'อื่น ๆ', lead: 'p5_other', wide: true, html: rName('อื่น ๆ') + rT('p5_other_note', 'ระบุ', 'x') }
  ];
  return { mod: mod, ex: ex.concat(training) };
}
/** บล็อกการรักษา: Modality · Exercise/Training · Behavior · คำแนะนำและ Home program */
function recTxBlock_() {
  const tx = recTxItems_();
  return [
    rSub('Modality (เครื่องมือ) / Manual'),
    rPick('mod', 'เพิ่ม Modality / Manual', tx.mod),
    rSub('Exercise / Training'),
    rPick('ex', 'เพิ่ม Exercise / Training', tx.ex),
    rSub('Behavior'),
    rCRow('p5_behav', 'ปรับพฤติกรรม', rTx('all times')),
    rCRow('p5_pa', 'Increase PA', rDD('p5_pa_min', 'paMinutes', 'นาที', 's'), rTx('นาที/วัน'), rDD('p5_pa_days', 'paDays', 'วัน', 's'), rTx('วัน/สัปดาห์')),
    rSub('คำแนะนำ / Home program'),
    rWide(rRow('คำแนะนำที่ให้', rDD('p5_edu1', 'education', 'คำแนะนำ 1', 'l'), rDD('p5_edu2', 'education', 'คำแนะนำ 2', 'l'), rT('p5_edu_note', 'รายละเอียดเพิ่มเติม', 'x'))),
    rWide(rCRow('p5_hp', 'ให้ Home program', rT('p5_hp_note', 'ท่า/โปรแกรมที่ให้กลับไปทำที่บ้าน', 'x')))
  ].join('');
}

function recPart5_() {
  return rCard(5, 'Intervention', [
    recTxBlock_(),
    // ระดับปวดก่อนและหลังรักษาครั้งนี้: ใช้ทำกราฟผลลัพธ์ในหน้าสถิติ (กรอกครบทั้งสองช่องจึงถูกนับ)
    rSub('Pain ก่อนและหลังรักษาครั้งนี้'),
    rRow('NRS · ก่อนรักษา', rNrs('p5_nrs_pre', 'NRS ก่อนรักษา'), rTx('เติมจาก NRS ขณะใช้งานด้านบนให้ กดเลือกเองได้')),
    rRow('NRS · หลังรักษา', rNrs('p5_nrs_post', 'NRS หลังรักษา')),
    rSub('ลงชื่อ'),
    rWide(rRow('ผู้ลงชื่อ', rDD('pn_sign', 'signer', 'เลือกผู้ลงชื่อ', 'pn-signer'), rTx('นักกายภาพบำบัดผู้ประเมิน · เพิ่มชื่อได้ที่ ตั้งค่า &gt; ตัวเลือกในแบบฟอร์มเวชระเบียน')))
  ].join(''));
}

/**
 * เวชระเบียนที่บันทึกก่อนรุ่น 2026-10-15a เก็บการรักษาเป็นช่องตายตัวต่อเครื่องมือ (p5_us_.., p5_ex_stretch_..)
 * แปลงเป็นแถวแบบใหม่ตอนเปิด (ข้อมูลในชีตไม่ถูกแตะจนกว่าจะกดบันทึก) — คืนข้อมูลชุดใหม่ ไม่แก้ของเดิม
 */
const REC_OLD_MODALITIES = [['us', 'US', 1], ['usc', 'US Combine', 1], ['es', 'ES', 1], ['pms', 'PMS', 1], ['ctx', 'C-Traction', 1], ['ltx', 'L-Traction', 1], ['hot', 'Hot/Cool', 1],
  ['swr', 'Shock wave Radial'], ['swf', 'Shock wave Focus'], ['laser', 'LASER'], ['swd', 'SWD'], ['nerve', 'Nerve mobilization'], ['mob', 'Mobilization', 2], ['manual', 'Manual technique']];
const REC_OLD_EXERCISES = [['stretch', 'Stretching exs.'], ['strength', 'Strengthening exs.'], ['iso', 'Isometric exs.'], ['core', 'Core stabilization exs.'], ['cardio', 'Cardiovascular endurance']];
function recLegacyTx_(src) {
  const d = Object.assign({}, src || {});
  const on = k => d[k] === 'Y' || d[k] === true || d[k] === 'true';
  const take = k => { const v = d[k] === undefined || d[k] === null ? '' : String(d[k]); delete d[k]; return v; };
  const put = (k, v) => { if (v) d[k] = v; };
  let m = 0, e = 0;
  while (d['p5_m' + (m + 1) + '_type']) m++;
  while (d['p5_e' + (e + 1) + '_type']) e++;
  REC_OLD_MODALITIES.forEach(x => {
    const k = 'p5_' + x[0];
    if (!on(k)) return;
    delete d[k];
    const side = take(k + '_side'), at = take(k + '_at'), of = take(k + '_of');
    const a = take(k + '_a'), b = take(k + '_b'), mode = take(k + '_mode'), tech = take(k + '_tech'), grade = take(k + '_grade'), dir = take(k + '_dir');
    if (m >= REC_TX_SLOTS) return;
    const n = 'p5_m' + (++m);
    d[n + '_type'] = x[1];
    put(n + '_side', side); put(n + '_at', of || at);
    put(n + '_mode', x[2] === 2 ? tech : mode);
    put(n + '_int', x[2] === 2 ? (grade ? 'Grade ' + grade : '') : [a, b].filter(Boolean).join(' '));
    put(n + '_note', [of && at ? at : '', x[2] === 2 ? dir : ''].filter(Boolean).join(' '));
  });
  REC_OLD_EXERCISES.forEach(x => {
    const k = 'p5_ex_' + x[0];
    if (!on(k)) return;
    delete d[k];
    const v = {};
    ['side', 'part', 'detail', 'reps', 'sets', 'days'].forEach(f => { v[f] = take(k + '_' + f); });
    if (e >= REC_TX_SLOTS) return;
    const n = 'p5_e' + (++e);
    d[n + '_type'] = x[1];
    put(n + '_side', v.side); put(n + '_at', v.part); put(n + '_detail', v.detail); put(n + '_reps', v.reps); put(n + '_sets', v.sets); put(n + '_days', v.days);
  });
  return d;
}

/* ---------------- อ่าน/เติมค่าในแบบฟอร์ม ---------------- */

function recBody_() { return document.getElementById('recordBody'); }

/** เพิ่มตัวเลือกให้ดรอปดาวน์ทุกช่องที่ใช้รายการเดียวกัน (ค่าที่พิมพ์เองใช้ต่อในแถวอื่นได้ทันที) */
function recAddOption_(list, value, isNew) {
  if (!value) return;
  const opts = REC.setup.options[list] || (REC.setup.options[list] = []);
  if (opts.indexOf(value) === -1) opts.push(value);
  recBody_().querySelectorAll(`select[data-list="${list}"]`).forEach(sel => {
    if (Array.from(sel.options).some(o => o.value === value)) return;
    const o = document.createElement('option');
    o.value = value; o.textContent = value;
    if (isNew) o.dataset.isNew = '1';
    sel.insertBefore(o, sel.querySelector(`option[value="${REC_OTHER}"]`));
  });
  // ชนิดการรักษาที่เพิ่งพิมพ์เอง: ให้ขึ้นในดรอปดาวน์ "เพิ่ม ..." ด้วย
  if (isNew) recBody_().querySelectorAll(`.rec-pick-item[data-slot-list="${list}"]`).forEach(it => recPickRefresh_(it.closest('.rec-pick')));
}

/** ขยายความสูงกล่องข้อความให้พอดีเนื้อหา (ไม่ต้องเลื่อนอ่านในกล่องเล็ก) */
function recGrow_(el) {
  if (!el || el.tagName !== 'TEXTAREA') return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, 320) + 'px';
}

function recSetField_(el, value) {
  const v = value === undefined || value === null ? '' : String(value);
  if (el.type === 'checkbox') { el.checked = v === 'Y' || v === 'true'; return; }
  if (el.tagName === 'SELECT') {
    if (v && !Array.from(el.options).some(o => o.value === v)) recAddOption_(el.dataset.list, v, false);
    el.value = v;
    el.dataset.prev = v;
    return;
  }
  el.value = v;
  recGrow_(el);
}

function recFill_(data) {
  const body = recBody_();
  body.querySelectorAll('[data-k]').forEach(el => recSetField_(el, data[el.dataset.k]));
  body.querySelectorAll('[data-pair]').forEach(el => { el.checked = String(data[el.dataset.pair] || '') === el.value; });
  body.querySelectorAll('[data-nrs]').forEach(g => {
    const v = data[g.dataset.nrs];
    g.querySelectorAll('button').forEach(b => b.classList.toggle('on', v !== undefined && v !== '' && String(v) === b.dataset.v));
  });
}

/** ช่องที่อยู่ในส่วนที่ซ่อนอยู่ (ยังไม่ได้เลือกใช้) ไม่ถูกบันทึก */
function recHiddenField_(el) {
  return !!el.closest('.rec-extra.hidden, .rec-more.hidden, .rec-pick-item.hidden, #recAgeTypedWrap.hidden');
}
function recCollect_() {
  const body = recBody_();
  const data = {};
  body.querySelectorAll('[data-k]').forEach(el => {
    if (recHiddenField_(el)) return;
    const k = el.dataset.k;
    if (el.type === 'checkbox') { if (el.checked) data[k] = true; return; }
    const v = (el.value || '').trim();
    if (v && v !== REC_OTHER) data[k] = v;
  });
  body.querySelectorAll('[data-pair]').forEach(el => { if (el.checked && !recHiddenField_(el)) data[el.dataset.pair] = el.value; });
  body.querySelectorAll('[data-nrs]').forEach(g => {
    const on = g.querySelector('button.on');
    if (on && !recHiddenField_(g)) data[g.dataset.nrs] = on.dataset.v;
  });
  return data;
}

/** ค่าที่ผู้ใช้พิมพ์เองในรอบนี้และยังถูกเลือกอยู่ — ส่งให้หลังบ้านจำเข้ารายการตัวเลือก */
function recLearn_() {
  const learn = {};
  recBody_().querySelectorAll('select[data-list]').forEach(sel => {
    const o = sel.selectedOptions[0];
    if (!o || !o.dataset.isNew || recHiddenField_(sel)) return;
    const list = sel.dataset.list;
    if (!learn[list]) learn[list] = [];
    if (learn[list].indexOf(o.value) === -1) learn[list].push(o.value);
  });
  return learn;
}

/* ---------------- อายุ เพศ และเกณฑ์ของผลทดสอบ ---------------- */

/** วันเกิดจากช่อง วัน/เดือน/ปี พ.ศ. → 'yyyy-MM-dd' · '' = ไม่ได้กรอก · null = กรอกไม่ครบหรือไม่ถูกต้อง */
function recBirthDate_() {
  // Progress note ไม่มีช่องวันเกิดในหัวแบบฟอร์ม: ใช้วันเกิดในทะเบียน
  if (!document.getElementById('recBirthDay')) return (REC.patient && /^\d{4}-\d{2}-\d{2}$/.test(REC.patient.birthDate || '')) ? REC.patient.birthDate : '';
  const d = document.getElementById('recBirthDay').value.trim();
  const m = document.getElementById('recBirthMonth').value;
  const y = document.getElementById('recBirthYear').value.trim();
  if (!d && !m && !y) return '';
  const dd = Number(d), mm = Number(m), be = Number(y);
  if (!dd || !mm || !be || be < 2400 || be > 2700) return null;
  const iso = `${be - 543}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z');
  if (isNaN(dt) || dt.toISOString().slice(0, 10) !== iso || iso > todayYmd_()) return null;
  return iso;
}
function recAgeAt_(birth, at) {
  if (!birth || !at) return null;
  let age = Number(at.slice(0, 4)) - Number(birth.slice(0, 4));
  if (at.slice(5) < birth.slice(5)) age--;
  return age >= 0 && age < 130 ? age : null;
}
/** อายุ ณ วันที่ประเมิน: จากวันเกิดถ้ากรอกครบ ไม่งั้นใช้อายุที่พิมพ์เอง */
function recAge_() {
  const birth = recBirthDate_();
  const date = document.getElementById('recDate').value;
  if (birth) return recAgeAt_(birth, date);
  const typedEl = document.getElementById('recAgeTyped');
  // Progress note: ไม่มีวันเกิด ใช้อายุที่พิมพ์ไว้ในแบบแรกรับของ session
  const typed = typedEl ? typedEl.value.trim() : String((REC.ctx && REC.ctx.initial && REC.ctx.initial.data.p1_age) || '');
  const n = Number(typed);
  return typed !== '' && isFinite(n) && n >= 0 && n < 130 ? Math.floor(n) : null;
}
const recSex_ = () => { const el = document.getElementById('recSex'); return el ? el.value : ((REC.patient && REC.patient.sex) || ''); };

/**
 * เกณฑ์ของรายการทดสอบสำหรับคนไข้คนนี้ — คืน null เมื่อรายการนั้นยังไม่มีเกณฑ์
 * อายุอยู่ในตารางค่าปกติและรู้เพศ: ใช้ตารางตามอายุ/เพศ · กรณีอื่น: ใช้เกณฑ์ค่าเดียวของรายการ (riskBelow / riskAbove)
 */
function recCriterion_(test, age, sex) {
  const fmt = n => String(Math.round(n * 100) / 100);
  if (age !== null && sex) {
    const norm = ((REC.setup && REC.setup.norms) || []).find(n => n.testKey === test.key && n.sex === sex && age >= n.ageFrom && age <= n.ageTo);
    if (norm) {
      const nums = [norm.normalLow, norm.normalHigh].filter(v => v !== null && v !== undefined);
      const basis = `${sex === 'M' ? 'ชาย' : 'หญิง'} ${norm.ageFrom}-${norm.ageTo} ปี`;
      if (test.better === 'lower') { const max = Math.max.apply(null, nums); return { text: 'ไม่เกิน ' + fmt(max), basis: basis, below: v => v > max }; }
      const min = Math.min.apply(null, nums);
      return { text: 'ตั้งแต่ ' + fmt(min), basis: basis, below: v => v < min };
    }
  }
  if (test.riskBelow !== null && test.riskBelow !== undefined) return { text: 'ตั้งแต่ ' + fmt(test.riskBelow), basis: '', below: v => v < test.riskBelow };
  if (test.riskAbove !== null && test.riskAbove !== undefined) return { text: 'ไม่เกิน ' + fmt(test.riskAbove), basis: '', below: v => v > test.riskAbove };
  return null;
}

/** อัปเดตป้ายเกณฑ์ข้างผลทดสอบแต่ละรายการ และคืนข้อความของรายการที่ต่ำกว่าเกณฑ์ (1 บรรทัดต่อรายการ) */
function recEvaluateTests_() {
  const body = recBody_();
  const age = recAge_(), sex = recSex_();
  const lines = [];
  ((REC.setup && REC.setup.tests) || []).forEach(t => {
    const input = body.querySelector(`[data-k="pt_${t.key}"]`);
    const tag = body.querySelector(`[data-crit="${t.key}"]`);
    if (!input || !tag) return;
    const crit = recCriterion_(t, age, sex);
    const raw = input.value.trim();
    const v = raw === '' ? null : Number(raw);
    const critText = crit ? `เกณฑ์ ${crit.text} ${t.unit}${crit.basis ? ' (' + crit.basis + ')' : ''}` : '';
    tag.className = 'rec-crit';
    if (!crit) { tag.textContent = v !== null ? 'ยังไม่มีเกณฑ์' : ''; return; }
    if (v === null || !isFinite(v)) { tag.textContent = critText; return; }
    if (crit.below(v)) {
      tag.classList.add('bad');
      tag.textContent = `ต่ำกว่าเกณฑ์ · ${critText}${t.interpret ? ' · ' + t.interpret : ''}`;
      lines.push(`${t.name} ${raw} ${t.unit} (${critText})${t.interpret ? ': ' + t.interpret : ''}`);
    } else {
      tag.classList.add('good');
      tag.textContent = `ผ่านเกณฑ์ · ${critText}`;
    }
  });
  // Barthel ADL ต่ำกว่า 12 คะแนน (กลุ่มติดบ้าน/ติดเตียง) นับเป็นสมรรถภาพลดลงด้วย
  const barthel = recBarthelTotal_();
  if (barthel !== null && barthel < 12) lines.push(`Barthel ADL ${barthel}/20 คะแนน: ${recBarthelGroup_(barthel)}`);
  return lines.join('\n');
}

/**
 * Decrease performance (ชุดที่ 3): เติมรายการที่ต่ำกว่าเกณฑ์ให้เอง
 * ถ้าผู้ใช้แก้ข้อความเองแล้วจะไม่เขียนทับ จนกว่าจะกด "ดึงจากผลทดสอบ" (force)
 */
function recSyncDecPerf_(force) {
  const body = recBody_();
  const text = recEvaluateTests_();
  const detail = body.querySelector('[data-k="p3_decPerf_detail"]');
  const box = body.querySelector('[data-k="p3_decPerf"]');
  if (!detail || !box) return;
  const untouched = detail.value.trim() === '' || detail.value.trim() === REC.autoDec.trim();
  if (force || untouched) {
    const hadAuto = REC.autoDec.trim() !== '' && detail.value.trim() === REC.autoDec.trim();
    detail.value = text;
    if (text) box.checked = true;
    else if (hadAuto || force) box.checked = false;
    recApplyShow_();
    recGrow_(detail);
  }
  REC.autoDec = text;
}

function recUpdateAge_() {
  const out = document.getElementById('recAgeAuto');
  if (!out) return;
  const birth = recBirthDate_();
  const typed = document.getElementById('recAgeTypedWrap');
  const err = document.getElementById('recBirthError');
  err.textContent = birth === null ? 'วันเกิดไม่ถูกต้องหรือกรอกไม่ครบ (วัน เดือน ปี พ.ศ.)' : '';
  if (birth) {
    const age = recAgeAt_(birth, document.getElementById('recDate').value);
    out.textContent = age !== null ? `${age} ปี` : '-';
    out.classList.remove('hidden'); typed.classList.add('hidden');
  } else {
    out.classList.add('hidden'); typed.classList.remove('hidden');
  }
}

/* ---------------- เปิดแบบฟอร์ม ---------------- */

function recStatusLabel_(status) {
  return status === 'final' ? '<span class="badge attended-tag">บันทึกแล้ว</span>' : '<span class="badge special-tag">ฉบับร่าง</span>';
}

const REC_NEW_DEFAULTS = { p1_fall: 'none', p1_prec: 'none', p1_contra: 'none', p1_red: 'none', p1_orange: 'none', p1_yellow: 'none', p2_post: 'normal', p2_tender: 'none', p2_rom: 'full' };
/** ผู้ลงชื่อของฉบับใหม่: คนที่เลือกครั้งล่าสุดในเครื่องนี้ (ถ้ายังอยู่ในรายการ) หรือคนเดียวที่มีในรายการ */
function recDefaultSigner_() {
  const list = (REC.setup && REC.setup.options.signer) || [];
  let last = '';
  try { last = localStorage.getItem('pnSigner') || ''; } catch (e) { /* ไม่มีที่เก็บในเบราว์เซอร์ก็ไม่เป็นไร */ }
  return list.indexOf(last) !== -1 ? last : (list.length === 1 ? list[0] : '');
}

/**
 * เปิดแบบฟอร์ม — opts: { ptn, id } แก้ไขชุดเดิม · { ptn, date } เปิด session ใหม่ · { ptn, kind: 'progress', session } Progress note ฉบับใหม่
 * (ยังไม่บันทึกจนกว่าจะกดปุ่ม) · view: 'doc' = เปิด Progress note ที่หน้าเอกสารพร้อมพิมพ์
 */
async function openRecordForm_(opts) {
  if (!recordLeaveGuard_('record')) return;
  REC.dirty = false;
  showView_('record');
  const body = recBody_();
  body.innerHTML = '<p class="panel-hint">กำลังเปิดเวชระเบียน...</p>';
  const calls = [api('getRecordSetup', {})];
  const newNote = !opts.id && opts.kind === 'progress';
  calls.push(opts.id ? api('getRecord', { id: opts.id }) : (newNote ? api('getRecordContext', { ptn: opts.ptn, session: opts.session }) : api('getPatientRecords', { ptn: opts.ptn })));
  const [su, rr] = await Promise.all(calls);
  const fail = !su.ok ? su.error : (!rr.ok ? rr.error : '');
  if (fail) {
    body.innerHTML = `<p class="error-text">เปิดเวชระเบียนไม่สำเร็จ: ${esc_(fail)}</p><button type="button" class="secondary" id="recBackBtn">กลับ</button>`;
    document.getElementById('recBackBtn').addEventListener('click', () => showView_('patients'));
    return;
  }
  REC.setup = su.data;
  REC.patient = rr.data.patient;
  REC.field = rr.data.field || [];
  const today = rr.data.today || todayYmd_();
  const nowHm = () => { const now = new Date(); return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`; };
  let data = {};
  REC.ctx = rr.data.context || null;
  if (REC.ctx) ['initial', 'prev'].forEach(k => { if (REC.ctx[k]) REC.ctx[k].data = recLegacyTx_(REC.ctx[k].data); });
  if (opts.id) {
    const r = rr.data.record;
    REC.meta = { id: r.id, session: r.session, status: r.status, date: r.date, kind: r.kind === 'progress' ? 'progress' : 'initial', locked: !!r.locked,
      createdAt: r.createdAt, createdBy: r.createdBy, updatedBy: r.updatedBy, updatedAt: r.updatedAt };
    data = recLegacyTx_(r.data || {});
  } else if (newNote) {
    REC.meta = { id: '', session: REC.ctx.session, status: 'new', date: today, kind: 'progress' };
    data = { p2_time: nowHm(), pn_visit: String(REC.ctx.visit) };
    if (REC.ctx.nextAppt) data.pn_p_next = REC.ctx.nextAppt.date;
  } else {
    const nextSession = (rr.data.records || []).reduce((m, r) => Math.max(m, r.session || 0), 0) + 1;
    const date = opts.date && opts.date <= today ? opts.date : today;
    REC.meta = { id: '', session: nextSession, status: 'new', date: date, kind: 'initial' };
    // ค่าเริ่มต้นของฉบับใหม่ (เห็นบนหน้ากรอกและแก้ได้ก่อนบันทึก): ไม่มีประวัติล้ม/ข้อควรระวัง/ข้อห้าม/Flag, Posture ปกติ, ไม่กดเจ็บ, ROM เต็ม
    data = Object.assign({ p2_time: nowHm() }, REC_NEW_DEFAULTS);
    data.pn_sign = recDefaultSigner_();
  }
  REC.auto = REC.meta.kind === 'initial' && !opts.id ? { touched: {}, last: {} } : null;
  if (!REC.patient) { body.innerHTML = '<p class="error-text">ไม่พบข้อมูลคนไข้ของเวชระเบียนนี้ในทะเบียน</p>'; return; }
  if (REC.meta.kind !== 'progress') { recRender_(data, today, opts); return; }
  if (typeof pnRender_ !== 'function') {
    body.innerHTML = '<p class="error-text">ยังไม่พบไฟล์ progress.js บนเว็บ — อัปโหลด progress.js ขึ้น GitHub คู่กับ index.html แล้วเปิดหน้านี้ใหม่</p><button type="button" class="secondary" id="recBackBtn">กลับ</button>';
    document.getElementById('recBackBtn').addEventListener('click', () => showView_('patients'));
    return;
  }
  pnRender_(data, today, opts);
}

// ใบแรกรับแบบกรอกทีละขั้น: 4 ขั้นสั้น ๆ จาก 5 ชุดของแบบฟอร์ม (ชุดที่ 3 และ 4 อยู่ขั้นเดียวกัน)
const REC_STEPS = [['ประวัติ', [1]], ['ตรวจร่างกาย', [2]], ['ปัญหา แผน เป้าหมาย', [3, 4]], ['การรักษา', [5]]];
const REC_PART_NAMES = ['Personal Data', 'Physical Examination', 'Problem list', 'Plan & Goal', 'Intervention'];
function recLayoutLoad_() {
  let v = '';
  try { v = localStorage.getItem('recLayout') || ''; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  REC.layout = v === 'all' ? 'all' : 'step';
}
/** แถบนำทางของใบแรกรับ: ทีละขั้น = 4 ขั้น (กดแล้วเปิดขั้นนั้น) · ทั้งหน้า = 5 ชุด (กดแล้วเลื่อนไปชุดนั้น) */
function recNavHtml_() {
  const btns = REC.layout === 'step'
    ? REC_STEPS.map((s, i) => `<button type="button" data-step="${i + 1}"><span class="n">${i + 1}</span>${s[0]}</button>`).join('')
    : REC_PART_NAMES.map((s, i) => `<button type="button" data-part="${i + 1}"><span class="n">${i + 1}</span>${s}</button>`).join('');
  return btns + `<button type="button" class="rec-layout" data-layout="${REC.layout === 'step' ? 'all' : 'step'}" title="สลับรูปแบบหน้ากรอก">${REC.layout === 'step' ? 'ดูทั้งหน้า' : 'กรอกทีละขั้น'}</button>`;
}
/** แสดงเฉพาะชุดของขั้นที่เปิดอยู่ (ชุดที่ไม่แสดงยังถูกบันทึกตามปกติ ต่างจากช่องที่ซ่อนเพราะยังไม่ได้เลือกใช้) */
function recApplyLayout_(scroll) {
  const body = recBody_();
  const nav = body.querySelector('.rec-steps');
  if (!nav || !REC.meta || REC.meta.kind === 'progress') return;
  nav.innerHTML = recNavHtml_();
  const stepMode = REC.layout === 'step';
  const parts = stepMode ? REC_STEPS[REC.step - 1][1] : [1, 2, 3, 4, 5];
  for (let i = 1; i <= 5; i++) document.getElementById('recPart' + i).classList.toggle('rec-off', parts.indexOf(i) === -1);
  nav.querySelectorAll('button[data-step]').forEach(b => b.classList.toggle('on', Number(b.dataset.step) === REC.step));
  const prev = document.getElementById('recPrevBtn'), next = document.getElementById('recNextBtn');
  if (prev) { prev.classList.toggle('hidden', !stepMode); prev.disabled = REC.step === 1; }
  if (next) next.classList.toggle('hidden', !stepMode || REC.step === REC_STEPS.length);
  if (!stepMode) recSpy_();
  if (scroll) { const head = body.querySelector('.pn-tabs') || nav; head.scrollIntoView({ block: 'start' }); }
}
/** เปิดขั้นที่มีช่องนี้อยู่ (ใช้ตอนบันทึกไม่ผ่าน เพื่อพาไปที่ช่องที่ต้องแก้) */
function recReveal_(el) {
  const card = el && el.closest('.rec-card.rec-off');
  if (!card) return;
  const n = Number(card.id.replace('recPart', ''));
  const at = REC_STEPS.findIndex(s => s[1].indexOf(n) !== -1);
  if (at !== -1) { REC.step = at + 1; recApplyLayout_(false); }
}

function recRender_(data, today, opts) {
  const p = REC.patient, m = REC.meta;
  recLayoutLoad_();
  REC.step = 1;
  const view = opts && opts.view === 'doc' ? 'doc' : 'form';
  const b = /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate || '') ? p.birthDate : '';
  const body = recBody_();
  body.innerHTML = `
   <div class="pn-wrap iv" id="pnWrap" data-view="${view}">
   <div class="pn-form" id="pnForm">
    <div class="rec-head">
      <div class="rec-head-top">
        <button type="button" class="secondary rec-mini" id="recBackBtn">‹ กลับหน้าคนไข้</button>
        <h2>เวชระเบียน · ประเมินครั้งแรก</h2>
        <span id="recStatus">${m.id ? recStatusLabel_(m.status) : '<span class="badge busy">ยังไม่ได้บันทึก</span>'}</span>
      </div>
      <div class="rec-head-info">
        <span class="kv">PTN <b>${esc_(p.ptn)}</b></span>
        <span class="kv">ชื่อ <b>${esc_(p.firstName)} ${esc_(p.lastName)}</b></span>
        <span class="kv">Session <b>ที่ ${esc_(m.session)}</b></span>
        ${m.updatedBy || m.createdBy ? `<span class="kv">บันทึกล่าสุดโดย <b>${esc_(m.updatedBy || m.createdBy)}</b></span>` : ''}
      </div>
      <div class="rec-head-form">
        <label>วันที่ consult<input type="date" data-k="p1_consult" id="recConsult" max="${recAttr_(today)}" aria-label="วันที่ consult (ส่งปรึกษา/ขอรับบริการ)"></label>
        <label>วันที่รับบริการ<input type="date" id="recDate" value="${recAttr_(m.date)}" max="${recAttr_(today)}"></label>
        <span class="rec-wait" id="recWait"></span>
        <label>เพศ<select id="recSex"><option value="">ไม่ระบุ</option><option value="M">ชาย</option><option value="F">หญิง</option></select></label>
        <label>วันเกิด (วัน / เดือน / ปี พ.ศ.)
          <span class="rec-birth">
            <input type="number" id="recBirthDay" min="1" max="31" placeholder="วัน" inputmode="numeric" aria-label="วันเกิด: วันที่" value="${b ? Number(b.slice(8, 10)) : ''}">
            <select id="recBirthMonth" aria-label="วันเกิด: เดือน"><option value="">เดือน</option>${REC_MONTHS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join('')}</select>
            <input type="number" id="recBirthYear" min="2400" max="2700" placeholder="ปี พ.ศ." inputmode="numeric" aria-label="วันเกิด: ปี พ.ศ." value="${b ? Number(b.slice(0, 4)) + 543 : ''}">
          </span>
        </label>
        <label>อายุ
          <span class="rec-age"><b id="recAgeAuto" class="hidden"></b>
            <span id="recAgeTypedWrap"><input type="number" id="recAgeTyped" data-k="p1_age" min="0" max="129" placeholder="ปี" inputmode="numeric" aria-label="อายุ (ปี)"></span></span>
        </label>
      </div>
      <p class="error-text" id="recBirthError"></p>
    </div>
    <div class="pn-tabs" role="tablist" aria-label="สลับหน้ากรอกกับใบแรกรับ">
      <button type="button" role="tab" data-pnview="form">กรอกข้อมูล</button>
      <button type="button" role="tab" data-pnview="doc">ใบแรกรับ (พร้อมพิมพ์)</button>
    </div>
    <div class="pn-entry">
    <nav class="rec-steps" aria-label="ไปยังขั้นของแบบฟอร์ม"></nav>
    ${recPart1_()}${recPart2_()}${recPart3_()}${recPart4_()}${recPart5_()}
    <div class="rec-foot">
      <span class="tx" id="recDirty"></span>
      <p class="error-text" id="recError"></p>
      <span class="rec-foot-btns">
        <button type="button" class="secondary" id="recPrevBtn">‹ ย้อน</button>
        <button type="button" class="secondary rec-next" id="recNextBtn">ถัดไป ›</button>
        ${m.status !== 'final' ? '<button type="button" class="secondary" id="recSaveDraftBtn">บันทึกร่าง</button>' : ''}
        <button type="button" class="primary" id="recSaveFinalBtn">${m.status === 'final' ? 'บันทึกการแก้ไข' : 'บันทึกเวชระเบียน'}</button>
      </span>
    </div>
    </div>
   </div>
   <aside class="pn-doc" id="pnDoc" aria-label="ใบแรกรับฉบับพร้อมพิมพ์">
     <div class="pn-bar">
       <span class="pn-seg" id="ivMode" role="group" aria-label="รูปแบบของใบแรกรับ"><button type="button" data-v="full">ฟอร์มเต็ม เห็นทุกช่อง</button><button type="button" data-v="short">เฉพาะที่บันทึก</button></span>
       <label class="pn-marks"><input type="checkbox" id="pnMarks"> เน้นสีส่วนที่กรอก</label>
       <button type="button" class="primary rec-mini" id="pnPrintBtn">พิมพ์ / บันทึกเป็น PDF</button>
     </div>
     <p class="pn-bar-note" id="pnPrintNote"></p>
     <div class="pn-paper" id="pnSheet"></div>
   </aside>
   </div>`;
  document.getElementById('recSex').value = p.sex === 'M' || p.sex === 'F' ? p.sex : '';
  if (b) document.getElementById('recBirthMonth').value = String(Number(b.slice(5, 7)));
  document.getElementById('recConsentPrint').href = 'consent.html#' + ['name=' + encodeURIComponent(`${p.firstName} ${p.lastName}`), 'ptn=' + encodeURIComponent(p.ptn), 'date=' + encodeURIComponent(m.date)].join('&');
  recFill_(data);
  recPickInit_();
  recFieldInit_(!m.id);
  recApplyShow_();
  recScores_();
  recUpdateAge_();
  // ข้อความ Decrease performance ที่บันทึกไว้: ถ้าตรงกับที่ระบบคำนวณได้ตอนนี้ ถือว่ายังเป็นของระบบ (อัปเดตตามผลทดสอบต่อได้)
  REC.autoDec = '';
  // อ่านจากช่องจริง (ไม่ใช่ข้อมูลที่โหลดมา) เพราะแบบฟอร์มใหม่อาจเพิ่งถูกเติมผลจาก AppSheet
  const saved = (recBody_().querySelector('[data-k="p3_decPerf_detail"]').value || '').trim();
  const nowText = recEvaluateTests_();
  REC.autoDec = saved === nowText.trim() ? nowText : (saved ? '\u0000' : '');
  recWire_();
  recApplyLayout_(false);
  REC.nrsTouched = data.p5_nrs_pre !== undefined && data.p5_nrs_pre !== '';
  recAuto_();
  recNrsAuto_();
  recWait_();
  REC.hpLast = recHpText_();
  recHpAuto_();
  if (typeof ivWire_ === 'function') ivWire_();
  recSetDirty_(false);
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  window.scrollTo(0, 0);
}

function recSetDirty_(dirty) {
  REC.dirty = dirty;
  const el = document.getElementById('recDirty');
  if (el) el.textContent = dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : (REC.meta && REC.meta.id ? 'บันทึกแล้ว' : 'ยังไม่ได้บันทึก');
}

let _recBodyWired_ = false;
/** ตัวฟังเหตุการณ์ของกล่องแบบฟอร์ม (#recordBody อยู่ตลอด เนื้อในถูกเขียนใหม่ทุกครั้งที่เปิดเวชระเบียน) — ผูกครั้งเดียว */
function recWireBody_() {
  if (_recBodyWired_) return;
  _recBodyWired_ = true;
  const body = recBody_();
  const err = () => { const el = document.getElementById('recError'); if (el) el.textContent = ''; };
  // ดรอปดาวน์: เลือก "พิมพ์เอง…" แล้วถามค่า เพิ่มเป็นตัวเลือกให้ทุกช่องที่ใช้รายการเดียวกัน
  body.addEventListener('change', e => {
    const el = e.target;
    if (!el.closest('.rec-card, .rec-head')) return;
    if (el.classList.contains('rec-pick-add')) { if (el.value) recPickAdd_(el.closest('.rec-pick'), el.value); return; }
    if (el.tagName === 'SELECT' && el.dataset.list) {
      if (el.value === REC_OTHER) {
        const typed = (window.prompt(`พิมพ์ค่าที่ต้องการ (${el.options[0].textContent})`) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (typed) { recAddOption_(el.dataset.list, typed, true); el.value = typed; }
        else el.value = el.dataset.prev || '';
      }
      el.dataset.prev = el.value;
    }
    // ตัวเลือกแบบเลือกได้อย่างเดียว: ติ๊กอันหนึ่ง อีกอันหลุด
    if (el.dataset && el.dataset.pair && el.checked) {
      body.querySelectorAll(`[data-pair="${el.dataset.pair}"]`).forEach(o => { if (o !== el) o.checked = false; });
    }
    recApplyShow_();
    recSetDirty_(true);
    err();
    if (el.id === 'recSex' || el.id === 'recBirthMonth' || el.id === 'recDate') { recUpdateAge_(); recSyncDecPerf_(false); }
  });
  body.addEventListener('input', e => {
    const el = e.target;
    if (!el.closest('.rec-card, .rec-head')) return;
    recSetDirty_(true);
    recGrow_(el);
    err();
    if (el.type === 'number') recApplyShow_(); // เช่น กรอกองศา ROM แล้วแถว ROM ถัดไปขึ้นมาทันที
    if (el.id === 'recBirthDay' || el.id === 'recBirthYear' || el.id === 'recAgeTyped') { recUpdateAge_(); recSyncDecPerf_(false); }
    else if (el.dataset && /^pt_/.test(el.dataset.k || '') && !/_label$/.test(el.dataset.k)) {
      delete el.dataset.auto; // พิมพ์เอง = ไม่ใช่ค่าที่ระบบคำนวณแล้ว
      if (el.dataset.k === 'pt_barthel') recScores_();
      recSyncDecPerf_(false);
    }
  });
  body.addEventListener('click', e => {
    const x = e.target.closest('.rec-pick-x');
    if (x) { recPickRemove_(x.closest('.rec-pick-item')); return; }
    // ปุ่มเลือกคะแนน/ตัวเลือก (NRS, EQ-5D, Barthel): กดซ้ำที่ปุ่มเดิม = ล้างค่า
    const btn = e.target.closest('[data-nrs] button[data-v]');
    if (!btn || btn.disabled) return;
    const g = btn.closest('[data-nrs]');
    const was = btn.classList.contains('on');
    g.querySelectorAll('button').forEach(b => b.classList.remove('on'));
    if (!was) btn.classList.add('on');
    recSetDirty_(true);
    err();
    if (g.classList.contains('rec-opts')) { recScores_(); recSyncDecPerf_(false); }
  });
  // Progress note: หลังการแก้ไขทุกครั้ง ปรับผลอัตโนมัติและเขียนเอกสารใหม่ (ผูกท้ายสุด จึงทำงานหลังตัวฟังด้านบน)
  ['change', 'input', 'click'].forEach(ev => body.addEventListener(ev, e => {
    if (!REC.meta) return;
    if (REC.meta.kind !== 'progress') { recAuto_(e); recNrsAuto_(e); recWait_(); }
    recHpAuto_(e);
    if (typeof pnChanged_ === 'function') pnChanged_(e);
  }));
}

function recWire_() {
  const body = recBody_();
  recWireBody_();
  document.getElementById('recBackBtn').addEventListener('click', () => recBackToPatient_());
  body.querySelector('.rec-steps').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.part) { document.getElementById('recPart' + btn.dataset.part).scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (btn.dataset.step) { REC.step = Number(btn.dataset.step); recApplyLayout_(true); return; }
    if (btn.dataset.layout) {
      REC.layout = btn.dataset.layout === 'all' ? 'all' : 'step';
      try { localStorage.setItem('recLayout', REC.layout); } catch (err) { /* จำไม่ได้ก็ไม่เป็นไร */ }
      recApplyLayout_(true);
    }
  });
  document.getElementById('recPrevBtn')?.addEventListener('click', () => { if (REC.step > 1) { REC.step--; recApplyLayout_(true); } });
  document.getElementById('recNextBtn')?.addEventListener('click', () => { if (REC.step < REC_STEPS.length) { REC.step++; recApplyLayout_(true); } });
  recSpy_();
  document.getElementById('recFieldApply')?.addEventListener('click', () => {
    const a = (REC.field || []).find(x => x.id === document.getElementById('recFieldSel').value);
    if (!a) return;
    recApplyField_(a);
    document.getElementById('recFieldNote').textContent = 'ดึงมาใส่แล้ว ตรวจค่าก่อนบันทึก';
    recSetDirty_(true);
  });
  document.getElementById('recDecRefill')?.addEventListener('click', () => { recSyncDecPerf_(true); recSetDirty_(true); });
  document.getElementById('recSaveDraftBtn')?.addEventListener('click', () => recSave_('draft'));
  document.getElementById('recSaveFinalBtn')?.addEventListener('click', () => recSave_('final'));
}

/** แถบชุด 1-5: เน้นสีชุดที่กำลังอยู่บนจอ */
function recSpy_() {
  const body = recBody_();
  const steps = body && body.querySelector('.rec-steps');
  if (!steps) return;
  const bar = steps.getBoundingClientRect().bottom + 12;
  const parts = Array.from(steps.querySelectorAll('button[data-part]')).map(b => b.dataset.part);
  if (!parts.length) return;
  let current = parts[0];
  parts.forEach(id => {
    const card = document.getElementById('recPart' + id);
    if (card && card.getBoundingClientRect().top <= bar) current = id;
  });
  // แบบฟอร์มสั้น ชุดท้าย ๆ เลื่อนขึ้นไม่ถึงขอบบน: เลื่อนสุดหน้าแล้วถือว่าอยู่ชุดสุดท้าย
  const el = document.scrollingElement || document.documentElement;
  const content = document.querySelector('.content');
  const atBottom = (el.scrollTop > 0 && el.scrollTop + window.innerHeight >= el.scrollHeight - 4) ||
    (content && content.scrollTop > 0 && content.scrollTop + content.clientHeight >= content.scrollHeight - 4);
  if (atBottom) current = parts[parts.length - 1];
  steps.querySelectorAll('button[data-part]').forEach(b => b.classList.toggle('on', b.dataset.part === String(current)));
}
let _recSpyQueued_ = false;
function recSpySoon_() {
  if (_recSpyQueued_) return;
  _recSpyQueued_ = true;
  requestAnimationFrame(() => { _recSpyQueued_ = false; if (!document.getElementById('recordView').classList.contains('hidden')) recSpy_(); });
}
window.addEventListener('scroll', recSpySoon_, { passive: true });
document.querySelector('.content')?.addEventListener('scroll', recSpySoon_, { passive: true });

/* ---------------- ผลประเมินจาก AppSheet (ผู้ช่วยประเมินนอกระบบนี้) ---------------- */

function recFieldLabel_(a) {
  return `${a.source ? a.source + ' · ' : ''}${fmtThaiDate_(a.date)}${a.assessor ? ' · ' + a.assessor : ''} · ${a.items.length} รายการ`;
}
/**
 * แถว "ผลจาก AppSheet" ในชุดที่ 2: โชว์เมื่อคนไข้มีผลประเมินจากแอป
 * แบบฟอร์มใหม่ (ยังไม่เคยบันทึก): ถ้ามีผลประเมินของวันเดียวกับวันที่ประเมิน เติมให้เลย — นักกายภาพตรวจแล้วกดบันทึกเอง
 * เวชระเบียนที่บันทึกแล้วไม่ถูกเติม/แก้เอง ต้องกด "ดึงมาใส่แบบฟอร์ม"
 */
function recFieldInit_(isNew) {
  const list = REC.field || [];
  const row = document.getElementById('recFieldRow');
  if (!row) return;
  recFieldStamp_();
  row.classList.toggle('hidden', !list.length);
  if (!list.length) return;
  const sel = document.getElementById('recFieldSel');
  sel.innerHTML = list.map(a => `<option value="${recAttr_(a.id)}">${esc_(recFieldLabel_(a))}</option>`).join('');
  const note = document.getElementById('recFieldNote');
  const usedId = recBody_().querySelector('[data-k="p2_as_id"]').value;
  const used = list.find(a => a.id === usedId);
  if (used) { sel.value = used.id; note.textContent = 'เวชระเบียนนี้ดึงผลชุดนี้มาแล้ว'; return; }
  if (!isNew) return;
  const same = list.find(a => a.date === REC.meta.date);
  if (!same) return;
  sel.value = same.id;
  recApplyField_(same);
  note.textContent = 'เติมผลประเมินของวันนี้ให้แล้ว ตรวจค่าก่อนบันทึก';
}
/**
 * บรรทัดบอกที่มาของผลที่ดึงมา: วันที่ประเมินจริง ผู้ประเมิน และแอปที่ใช้ (อ่านจากช่องที่บันทึกไปกับเวชระเบียน จึงยังโชว์เมื่อเปิดดูภายหลัง)
 * ถ้าวันที่ประเมินไม่ตรงกับวันที่ของเวชระเบียนนี้ จะบอกไว้ด้วย
 */
function recFieldStamp_() {
  const el = document.getElementById('recFieldStamp');
  if (!el) return;
  const get = k => { const f = recBody_().querySelector(`[data-k="${k}"]`); return f ? f.value : ''; };
  const id = get('p2_as_id'), date = get('p2_as_date'), by = get('p2_as_by');
  el.classList.toggle('hidden', !id || !date);
  if (!id || !date) { el.textContent = ''; return; }
  const other = REC.meta && REC.meta.date && REC.meta.date !== date;
  el.innerHTML = `ผลที่ดึงมา: ประเมินเมื่อวันที่ <b>${esc_(fmtThaiDate_(date))}</b>` + (by ? ` · ผู้ประเมิน ${esc_(by)}` : '') +
    ` · ${id.indexOf('hv:') === 0 ? 'แอปเยี่ยมบ้าน' : 'แอปประเมิน'}` + (other ? ` <span class="rec-field-other">คนละวันกับวันที่ของเวชระเบียนนี้ (${esc_(fmtThaiDate_(REC.meta.date))})</span>` : '');
}
/** เติมผลประเมินจากแอปลงแบบฟอร์ม (เฉพาะช่องที่ผลชุดนั้นมีค่า) และเปิดรายการที่มีค่าให้เห็น */
function recApplyField_(a) {
  const body = recBody_();
  Object.keys(a.data).forEach(k => {
    const v = String(a.data[k]);
    const group = body.querySelector(`[data-nrs="${k}"]`);
    if (group) { group.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); return; }
    const el = body.querySelector(`[data-k="${k}"]`);
    if (el && (el.type !== 'checkbox' || v === 'Y')) recSetField_(el, v); // ช่องติ๊ก: ติ๊กให้เมื่อผลจากแอปส่ง Y มา (เช่น Home program) ไม่เอาติ๊กออก
  });
  body.querySelector('[data-k="p2_as_id"]').value = a.id;
  body.querySelector('[data-k="p2_as_by"]').value = a.assessor || '';
  body.querySelector('[data-k="p2_as_date"]').value = a.date;
  recFieldStamp_();
  body.querySelectorAll('.rec-pick').forEach(pick => {
    pick.querySelectorAll('.rec-pick-item.hidden').forEach(item => {
      if (!recItemHasData_(item)) return;
      item.classList.remove('hidden');
      if (item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = true;
    });
    recPickRefresh_(pick);
  });
  recApplyShow_();
  recScores_();
  recSyncDecPerf_(false);
  recNrsAuto_();
}

/* ---------------- ใบแรกรับฉบับใหม่: ระบบเสนอ Problem list และ Plan of treatment ----------------
 * ติ๊กให้จากผลตรวจ (ชุดที่ 2) และการรักษา (ชุดที่ 5) เห็นบนหน้ากรอกพร้อมป้าย "ระบบเสนอ" และแก้ได้
 * ช่องไหนผู้ใช้กดเองแล้ว ระบบไม่แตะช่องนั้นอีก · เวชระเบียนที่เคยบันทึกแล้วเปิดกลับมาไม่ถูกเสนอ/แก้เอง
 */
const REC_AUTO_KEYS = ['p3_pain', 'p3_rom', 'p3_numb', 'p3_amb', 'p4_plan_ex', 'p4_plan_mod', 'p4_plan_hp', 'p4_plan_nerve', 'p4_plan_amb', 'p4_plan_bal', 'p4_plan_home'];
/**
 * ใบแรกรับ: NRS ก่อนรักษา (ชุดที่ 5) เติมจาก NRS ขณะใช้งาน (ชุดที่ 2) ถ้าไม่มีใช้ขณะพัก — จนกว่าผู้ใช้จะกดเลือกเอง
 * เวชระเบียนที่บันทึกค่าไว้แล้วถือว่าผู้ใช้เลือกเอง ไม่ถูกแก้
 */
/** ระยะรอคอย: วันที่ consult ถึงวันที่รับบริการ (แสดงข้างหัวแบบฟอร์ม) */
function recWait_() {
  const out = document.getElementById('recWait'), c = document.getElementById('recConsult'), d = document.getElementById('recDate');
  if (!out || !c || !d) return;
  const days = c.value && d.value ? Math.round((new Date(d.value + 'T00:00:00Z') - new Date(c.value + 'T00:00:00Z')) / 86400000) : null;
  out.textContent = days === null ? '' : (days < 0 ? 'วันที่ consult อยู่หลังวันที่รับบริการ' : `รอคอย ${days} วัน`);
  out.classList.toggle('bad', days !== null && days < 0);
}

/**
 * Home program: เมื่อติ๊ก "ให้ Home program" ระบบเติมรายการออกกำลังกายจากแถว Exercise ให้ในช่องรายละเอียด
 * (ถ้าผู้ใช้แก้ข้อความเองแล้วจะไม่เขียนทับ ยกเว้นข้อความยังเป็นของที่ระบบเติมไว้)
 */
function recHpText_() {
  const body = recBody_();
  return Array.from(body.querySelectorAll('.rec-pick-item[data-slot="e"]:not(.hidden)')).map(it => {
    const k = it.dataset.pre, g = s => recValueOf_(k + s);
    if (!g('_type')) return '';
    const where = [g('_side'), g('_at')].filter(Boolean).join(' ');
    const dose = [[g('_reps'), 'ครั้ง/set'], [g('_sets'), 'set/วัน'], [g('_days'), 'วัน/สัปดาห์']].filter(x => x[0]).map(x => x[0] + ' ' + x[1]).join(' ');
    return [g('_type'), g('_detail'), where, dose].filter(Boolean).join(' ');
  }).filter(Boolean).join(' · ');
}
function recHpAuto_() {
  const body = recBody_();
  const box = body.querySelector('[data-k="p5_hp"]'), note = body.querySelector('[data-k="p5_hp_note"]');
  if (!box || !note || !box.checked || note.disabled) return;
  const text = recHpText_();
  const cur = note.value.trim();
  if (cur === '' || cur === (REC.hpLast || '')) { if (note.value !== text) { note.value = text; recGrow_(note); } }
  REC.hpLast = text;
}

function recNrsAuto_(e) {
  if (!REC.meta || REC.meta.kind === 'progress') return;
  const g = recBody_().querySelector('[data-nrs="p5_nrs_pre"]');
  if (!g) return;
  if (e && e.type === 'click' && e.target.closest('[data-nrs="p5_nrs_pre"]')) { REC.nrsTouched = true; g.classList.remove('rec-autofill'); return; }
  if (REC.nrsTouched) return;
  const f = recPicked_('p2_nrs_func'), r = recPicked_('p2_nrs_rest');
  const want = f !== null ? f : r;
  g.querySelectorAll('button').forEach(b => b.classList.toggle('on', want !== null && b.dataset.v === String(want)));
  g.classList.toggle('rec-autofill', want !== null);
}

function recAuto_(e) {
  const A = REC.auto;
  if (!A || !REC.meta || REC.meta.kind === 'progress') return;
  const body = recBody_();
  const f = k => body.querySelector(`[data-k="${k}"]`);
  // ผู้ใช้แก้ช่องที่ระบบเสนอเอง: จำไว้ว่าช่องนี้เป็นของผู้ใช้แล้ว
  // (ช่องติ๊กได้เหตุการณ์ click ก่อน change: นับทั้งสองแบบ ไม่งั้นระบบจะติ๊กกลับทันที)
  const tk = e && (e.type === 'change' || e.type === 'click') && e.target && e.target.dataset ? e.target.dataset.k : '';
  if (tk && (REC_AUTO_KEYS.indexOf(tk) !== -1 || A.last[tk] !== undefined)) A.touched[tk] = true;
  const val = k => recShownValue_(k);
  const nrs = k => { const n = recPicked_(k); return n === null ? 0 : n; };
  const slotTypes = fam => Array.from(body.querySelectorAll(`.rec-pick-item[data-slot="${fam}"]:not(.hidden)`)).map(it => recValueOf_(it.dataset.pre + '_type')).filter(Boolean);
  const mods = slotTypes('m'), exs = slotTypes('e');
  const sym = val('p2_sym');
  const want = {
    p3_pain: /pain|ปวด/i.test(sym) && (nrs('p2_nrs_rest') > 0 || nrs('p2_nrs_func') > 0),
    p3_numb: /numb|ชา/i.test(sym),
    p3_rom: val('p2_rom') === 'limit',
    p3_amb: val('p5_amb') === 'Y',
    p4_plan_ex: exs.length > 0,
    p4_plan_mod: mods.some(t => !/nerve/i.test(t)),
    p4_plan_nerve: mods.some(t => /nerve/i.test(t)),
    p4_plan_amb: val('p5_amb') === 'Y' || val('p5_tr') === 'Y',
    p4_plan_bal: val('p5_bal') === 'Y',
    p4_plan_home: val('p5_hp') === 'Y',
    p4_plan_hp: val('p5_behav') === 'Y' || val('p5_pa') === 'Y'
  };
  let changed = false;
  REC_AUTO_KEYS.forEach(k => {
    const el = f(k);
    if (!el) return;
    if (!A.touched[k] && el.checked !== want[k]) { el.checked = want[k]; changed = true; }
    const lab = el.closest('label');
    if (lab) lab.classList.toggle('rec-auto', !A.touched[k] && el.checked && want[k]);
  });
  // ตำแหน่งของปัญหา: เติมจากผลตรวจ ตราบที่ผู้ใช้ยังไม่ได้เลือกเอง
  const copy = (lead, pairs) => {
    if (A.touched[lead] || !f(lead) || !f(lead).checked) return;
    pairs.forEach(x => {
      const el = f(x[0]), v = val(x[1]);
      if (!el || A.touched[x[0]] || !v) return;
      if (el.value === '' || el.value === A.last[x[0]]) { if (el.value !== v) { recSetField_(el, v); changed = true; } A.last[x[0]] = v; }
    });
  };
  copy('p3_pain', [['p3_pain_side', 'p2_sym_side'], ['p3_pain_at', 'p2_sym_at']]);
  copy('p3_numb', [['p3_numb_side', 'p2_sym_side'], ['p3_numb_at', 'p2_sym_at']]);
  copy('p3_rom', [['p3_rom_joint', 'p2_rom_joint'], ['p3_rom_dir', 'p2_rom_dir']]);
  if (changed) recApplyShow_();
}

/* ---------------- ซ่อนไว้จนกว่าจะใช้ ---------------- */

/** ค่าปัจจุบันของช่อง (ช่องติ๊ก = 'Y' หรือ '') */
function recValueOf_(key) {
  const body = recBody_();
  const pair = body.querySelector(`[data-pair="${key}"]:checked`);
  if (pair) return pair.value;
  const el = body.querySelector(`[data-k="${key}"]`);
  if (!el) return '';
  if (el.type === 'checkbox') return el.checked ? 'Y' : '';
  return el.value === REC_OTHER ? '' : (el.value || '').trim();
}
/** ค่าของช่องที่มองเห็นอยู่ (ช่องในส่วนที่ซ่อนอยู่ถือว่าว่าง เพราะไม่ถูกบันทึก) */
function recShownValue_(key) {
  const body = recBody_();
  const el = body.querySelector(`[data-pair="${key}"]:checked`) || body.querySelector(`[data-k="${key}"]`);
  return el && recHiddenField_(el) ? '' : recValueOf_(key);
}
/** แสดง/ซ่อนส่วนย่อยตามเงื่อนไขใน data-show — "ช่อง1|ช่อง2" = ช่องใดช่องหนึ่งมีค่า (ทำตามลำดับในหน้า ส่วนที่ซ่อนแล้วทำให้ส่วนที่พึ่งมันซ่อนตาม) */
function recApplyShow_() {
  recBody_().querySelectorAll('[data-show]').forEach(el => {
    const m = /^([A-Za-z0-9_|]+)(!=|=)?(.*)$/.exec(el.dataset.show);
    const v = m[1].split('|').map(recShownValue_).find(x => x !== '') || '';
    const show = !m[2] ? v !== '' : (m[2] === '=' ? v === m[3] : (v !== '' && v !== m[3]));
    el.classList.toggle('hidden', !show);
  });
}

function recItemHasData_(item) {
  return Array.from(item.querySelectorAll('[data-k]')).some(el => el.type === 'checkbox' ? el.checked : (el.value || '').trim() !== '') ||
    !!item.querySelector('[data-nrs] button.on') || !!item.querySelector('[data-pair]:checked');
}
/** ดรอปดาวน์ของรายการให้เลือก: เหลือเฉพาะรายการที่ยังไม่ได้เลือก (จัดกลุ่มตามโหมดใหญ่) */
function recPickRefresh_(pick) {
  const sel = pick.querySelector('.rec-pick-add');
  const hidden = Array.from(pick.querySelectorAll('.rec-pick-item.hidden'));
  const groups = [];
  hidden.forEach(it => { if (groups.indexOf(it.dataset.group) === -1) groups.push(it.dataset.group); });
  const opt = (v, t) => `<option value="${recAttr_(v)}">${esc_(t)}</option>`;
  const once = {};
  sel.innerHTML = `<option value="">＋ ${esc_(pick.dataset.ph)}</option>` + groups.map(g => {
    const inner = hidden.filter(it => it.dataset.group === g).map(it => {
      // แถวว่างที่เลือกชนิดได้: แสดงชนิดทั้งหมดของรายการนั้นครั้งเดียว · รายการที่เพิ่มซ้ำได้: แสดงชื่อเดียว
      const key = it.dataset.slot ? 'slot:' + it.dataset.slot : (it.dataset.rep ? 'rep:' + it.dataset.rep : '');
      if (key) { if (once[key]) return ''; once[key] = true; }
      if (!it.dataset.slot) return opt(it.dataset.item, it.dataset.rep ? it.dataset.label.replace(/ \(\d\)$/, '') : it.dataset.label);
      const types = (REC.setup && REC.setup.options[it.dataset.slotList]) || [];
      return types.map(t => opt(`slot:${it.dataset.slot}:${t}`, t)).join('') + opt(`slot:${it.dataset.slot}:`, 'อื่น ๆ (เลือกหรือพิมพ์เองในแถว)');
    }).join('');
    return g ? `<optgroup label="${recAttr_(g)}">${inner}</optgroup>` : inner;
  }).join('');
  sel.value = '';
  pick.querySelector('.rec-pick-bar').classList.toggle('hidden', hidden.length === 0);
}
/** ตอนเปิดแบบฟอร์ม: รายการที่มีข้อมูลบันทึกไว้แสดงเลย ที่เหลือซ่อนอยู่ในดรอปดาวน์ */
function recPickInit_() {
  recBody_().querySelectorAll('.rec-pick').forEach(pick => {
    pick.querySelectorAll('.rec-pick-item').forEach(item => {
      const has = recItemHasData_(item);
      item.classList.toggle('hidden', !has);
      if (has && item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = true;
    });
    recPickRefresh_(pick);
  });
}
function recPickAdd_(pick, id) {
  const slot = /^slot:([a-z]+):(.*)$/.exec(id);
  const item = slot ? pick.querySelector(`.rec-pick-item.hidden[data-slot="${slot[1]}"]`)
    : Array.from(pick.querySelectorAll('.rec-pick-item')).find(it => it.dataset.item === id && it.classList.contains('hidden')) ||
      Array.from(pick.querySelectorAll('.rec-pick-item')).find(it => it.dataset.item === id);
  if (!item) return;
  item.classList.remove('hidden');
  if (item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = true;
  if (slot && slot[2]) recSetField_(item.querySelector(`[data-k="${item.dataset.pre}_type"]`), slot[2]);
  if (item.dataset.preset) {
    const ps = item.dataset.preset.split('=');
    item.querySelectorAll(`[data-pair="${ps[0]}"]`).forEach(o => { o.checked = o.value === ps[1]; });
  }
  if (item.dataset.exs) {
    // เพิ่มแถวการออกกำลังกาย: เติมค่าตั้งต้น ครั้ง/set/วัน (ตัวเลือกแรกของแต่ละรายการ)
    [['_reps', 'reps'], ['_sets', 'setsPerDay'], ['_days', 'daysPerWeek']].forEach(x => {
      const sel = item.querySelector(`[data-k="${item.dataset.pre || item.dataset.leadk}${x[0]}"]`);
      const first = (REC.setup.options[x[1]] || [])[0];
      if (sel && !sel.value && first) { sel.value = first; sel.dataset.prev = first; }
    });
  }
  const details = item.querySelector('details');
  if (details) details.open = true;
  recPickRefresh_(pick);
  recApplyShow_();
  recScores_();
  recSetDirty_(true);
  const fields = Array.from(item.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), select, textarea, .rec-opts button'));
  // แถวที่เลือกชนิดมาแล้ว: ไปช่องถัดจากชนิดเลย
  const first = slot && slot[2] && fields.length > 1 ? fields[1] : fields[0];
  if (first) first.focus();
}
/** เอารายการออก: ล้างค่าที่กรอกในรายการนั้นทั้งหมดแล้วซ่อนกลับเข้าดรอปดาวน์ */
function recPickRemove_(item) {
  if (!item) return;
  item.querySelectorAll('[data-k]').forEach(el => {
    if (el.type === 'checkbox') el.checked = false; else { el.value = ''; delete el.dataset.auto; if (el.tagName === 'SELECT') el.dataset.prev = ''; }
  });
  item.querySelectorAll('[data-pair]').forEach(el => { el.checked = false; });
  item.querySelectorAll('[data-nrs] button.on').forEach(b => b.classList.remove('on'));
  item.classList.add('hidden');
  const pick = item.closest('.rec-pick');
  recPickRefresh_(pick);
  recScores_();
  recSyncDecPerf_(false);
  recSetDirty_(true);
  pick.querySelector('.rec-pick-add').focus();
}

/* ---------------- บันทึก ---------------- */

async function recSave_(status) {
  if (REC.saving) return;
  const errEl = document.getElementById('recError');
  errEl.textContent = '';
  const progress = REC.meta.kind === 'progress';
  const birth = progress ? '' : recBirthDate_();
  if (birth === null) { errEl.textContent = 'วันเกิดไม่ถูกต้องหรือกรอกไม่ครบ — แก้ไขหรือลบออกก่อนบันทึก'; document.getElementById('recBirthDay').focus(); return; }
  const date = document.getElementById('recDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errEl.textContent = progress ? 'เลือกวันที่รับบริการก่อนบันทึก' : 'เลือกวันที่ประเมินก่อนบันทึก'; return; }
  const consult = document.getElementById('recConsult');
  if (consult && consult.value && consult.value > date) { errEl.textContent = 'วันที่ consult ต้องไม่หลังวันที่รับบริการ'; consult.focus(); return; }
  const data = recCollect_();
  if (birth) delete data.p1_age; // มีวันเกิดแล้ว ไม่ต้องเก็บอายุที่พิมพ์เอง (คำนวณได้เสมอ)
  if (data.pt_eq5d_vas !== undefined && !(Number(data.pt_eq5d_vas) >= 0 && Number(data.pt_eq5d_vas) <= 100)) {
    errEl.textContent = 'EQ-5D-5L: สุขภาพวันนี้ (VAS) ต้องเป็นเลข 0-100';
    recReveal_(document.getElementById('recEq5d'));
    document.getElementById('recEq5d').open = true;
    recBody_().querySelector('[data-k="pt_eq5d_vas"]').focus();
    return;
  }
  // แถวการรักษาที่เพิ่มไว้ต้องมีชนิด (ไม่งั้นเอกสารจะไม่รู้ว่าเป็นการรักษาอะไร)
  const noType = Array.from(recBody_().querySelectorAll('.rec-pick-item[data-slot]:not(.hidden)')).find(it => !recValueOf_(it.dataset.pre + '_type'));
  if (noType) {
    errEl.textContent = 'เลือกชนิดของการรักษาให้ครบทุกแถว (แถวที่ไม่ใช้กด ✕ เอาออก)';
    recReveal_(noType);
    noType.scrollIntoView({ block: 'center' });
    noType.querySelector('select').focus();
    return;
  }
  if (progress) {
    const bad = pnValidate_(status, data);
    if (bad) { errEl.textContent = bad.text; if (bad.el) { bad.el.scrollIntoView({ block: 'center' }); bad.el.focus(); } return; }
  }
  if (!progress && status === 'final' && !data.p1_consent) {
    errEl.textContent = 'บันทึกการยินยอมของคนไข้ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    recReveal_(document.getElementById('recConsentRow'));
    document.getElementById('recConsentRow').scrollIntoView({ block: 'center' });
    recBody_().querySelector('[data-pair="p1_consent"]').focus();
    return;
  }
  if (!progress && status === 'final' && !data.p1_cc) {
    errEl.textContent = 'กรอก Chief complaint ก่อนบันทึกเวชระเบียน (หรือกด บันทึกร่าง ไว้ก่อน)';
    recReveal_(recBody_().querySelector('[data-k="p1_cc"]'));
    recBody_().querySelector('[data-k="p1_cc"]').focus();
    return;
  }
  REC.saving = true;
  const btns = recBody_().querySelectorAll('.rec-foot button');
  btns.forEach(b => { b.disabled = true; });
  const payload = { id: REC.meta.id || undefined, ptn: REC.patient.ptn, date: date, status: status, data: data, learn: recLearn_() };
  if (progress) {
    payload.kind = 'progress'; payload.session = REC.meta.session;
    // เลขครั้งที่ที่ตรงกับที่ระบบนับให้ ไม่ต้องเก็บ (ระบบนับใหม่เองเมื่อมีการบันทึกย้อนหลังหรือลบฉบับร่าง) เก็บเฉพาะเมื่อแก้เลขเอง
    if (REC.ctx && data.pn_visit === String(REC.ctx.visit)) delete data.pn_visit;
  }
  else payload.patient = { sex: recSex_(), birthDate: birth };
  const res = await api('saveRecord', payload);
  REC.saving = false;
  btns.forEach(b => { b.disabled = false; });
  if (!res.ok) { errEl.textContent = 'บันทึกไม่สำเร็จ: ' + res.error; return; }
  REC.meta.id = res.data.id;
  REC.meta.session = res.data.session;
  REC.meta.status = res.data.status;
  REC.meta.date = date;
  if (!progress) { REC.patient.sex = recSex_(); REC.patient.birthDate = birth; }
  recBody_().querySelectorAll('option[data-is-new]').forEach(o => { delete o.dataset.isNew; });
  recSetDirty_(false);
  if (progress) { pnSaved_(res.data); return; }
  if (data.pn_sign) { try { localStorage.setItem('pnSigner', data.pn_sign); } catch (e) { /* จำไม่ได้ก็ไม่เป็นไร */ } }
  if (typeof pnDoc_ === 'function') pnDoc_();
  if (res.data.status === 'final') {
    toast('บันทึกเวชระเบียนแล้ว');
    recBackToPatient_();
  } else {
    toast('บันทึกร่างแล้ว');
    document.getElementById('recStatus').innerHTML = recStatusLabel_('draft');
  }
}

/** กลับหน้าคนไข้ของเวชระเบียนที่เปิดอยู่ */
function recBackToPatient_() {
  if (!recordLeaveGuard_('patients')) return;
  REC.dirty = false;
  const p = REC.patient;
  showView_('patients');
  if (p) loadPatientProfile_(p);
}

/** ถามก่อนออกจากแบบฟอร์มเมื่อมีการแก้ไขที่ยังไม่ได้บันทึก — คืน false = ผู้ใช้ขออยู่ต่อ (app.js เรียกก่อนเปลี่ยนหน้า) */
function recordLeaveGuard_(nextView) {
  const open = !document.getElementById('recordView').classList.contains('hidden');
  if (!open || !REC.dirty) return true;
  if (window.confirm('มีการแก้ไขเวชระเบียนที่ยังไม่ได้บันทึก ออกจากหน้านี้โดยไม่บันทึกหรือไม่')) { REC.dirty = false; return true; }
  return false;
}
window.addEventListener('beforeunload', e => {
  if (REC.dirty && !document.getElementById('recordView').classList.contains('hidden')) { e.preventDefault(); e.returnValue = ''; }
});
/** ออกจากระบบ: ไม่ทิ้งข้อมูลเวชระเบียนค้างบนจอ */
function recordReset_() {
  REC.dirty = false; REC.patient = null; REC.meta = null; REC.setup = null; REC.autoDec = ''; REC.field = []; REC.ctx = null;
  document.getElementById('printRoot')?.remove();
  const opt = document.getElementById('recOptionsBox');
  if (opt) opt.innerHTML = '';
  const body = recBody_();
  if (body) body.innerHTML = '';
  _recRecentReq_++;
  const recent = document.getElementById('recordsRecent');
  if (recent) recent.innerHTML = '';
  const search = document.getElementById('recordSearchInput');
  if (search) search.value = '';
}

/* ---------------- รายการเวชระเบียนในหน้าคนไข้ ---------------- */

let _recListReq_ = 0;
async function loadPatientRecords_(ptn) {
  const box = document.getElementById('patientRecords');
  if (!box) return;
  const req = ++_recListReq_;
  box.innerHTML = '<h3>เวชระเบียน</h3><p class="dash-sub">กำลังโหลด...</p>';
  const res = await api('getPatientRecords', { ptn: ptn });
  if (req !== _recListReq_ || !document.body.contains(box)) return;
  if (!res.ok) { box.innerHTML = `<h3>เวชระเบียน</h3><p class="error-text">โหลดเวชระเบียนไม่สำเร็จ: ${esc_(res.error)}</p>`; return; }
  const recs = res.data.records || [];
  const field = res.data.field || [];
  // แถวของ session = แบบประเมินครั้งแรก ตามด้วย Progress note ของ session นั้นตามลำดับครั้งที่
  const del = r => r.status !== 'final' ? `<button type="button" class="secondary rec-mini rec-del" data-del="${recAttr_(r.id)}">ลบร่าง</button>` : '';
  const rows = recs.map(r => r.kind === 'progress' ? `
    <tr class="rec-note-row" data-id="${recAttr_(r.id)}">
      <td><span class="rec-note-tag">ครั้งที่ ${esc_(r.visit)}</span></td><td>${esc_(fmtThaiDate_(r.date))}</td><td>${recStatusLabel_(r.status)}</td>
      <td>Progress note${r.nrsPre !== '' && r.nrsPost !== '' ? ` · NRS ${esc_(r.nrsPre)} → ${esc_(r.nrsPost)}` : ''}</td><td>${esc_(r.treatments || '-')}</td>
      <td class="rec-actions"><button type="button" class="secondary rec-mini" data-open="${recAttr_(r.id)}">เปิด</button><button type="button" class="secondary rec-mini" data-print="${recAttr_(r.id)}">เอกสาร</button>${del(r)}</td>
    </tr>` : `
    <tr data-id="${recAttr_(r.id)}">
      <td>Session ${esc_(r.session)}</td><td>${esc_(fmtThaiDate_(r.date))}</td><td>${recStatusLabel_(r.status)}</td>
      <td>${esc_(r.chiefComplaint || '-')}</td><td>${esc_([r.medicalDx, r.ptDx].filter(Boolean).join(' · ') || '-')}</td>
      <td class="rec-actions">${r.satAt ? `<span class="rec-sat done" title="ให้ทำแบบประเมินความพึงพอใจแล้ว">✓ ประเมินความพึงพอใจ ${esc_(fmtThaiDate_(r.satAt))}</span>` : `<button type="button" class="secondary rec-mini rec-sat" data-sat="${recAttr_(r.session)}" title="กดหลังให้คนไข้ทำแบบประเมินความพึงพอใจ (1 ครั้งต่อ session)">ให้ทำแบบประเมินแล้ว</button>`}<button type="button" class="primary rec-mini" data-note="${recAttr_(r.session)}">+ Progress note</button><button type="button" class="secondary rec-mini" data-open="${recAttr_(r.id)}">เปิด</button><button type="button" class="secondary rec-mini" data-print="${recAttr_(r.id)}">เอกสาร</button>${del(r)}</td>
    </tr>`).join('');
  box.innerHTML = `
    <h3>เวชระเบียน <button type="button" class="secondary rec-mini" id="recNewBtn">+ เปิด session ใหม่ (ประเมินครั้งแรก)</button></h3>
    <p class="dash-sub">คนไข้ 1 คนใช้ PTN เดิม มาด้วยอาการใหม่ให้เปิด session ใหม่ · มารักษาต่อด้วยอาการเดิมให้กด + Progress note ที่ session นั้น</p>
    ${rows ? `<div class="table-scroll"><table class="mini-table rec-table">
      <thead><tr><th>Session / ครั้งที่</th><th>วันที่</th><th>สถานะ</th><th>Chief complaint</th><th>Diagnosis / การรักษา</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="dash-empty">ยังไม่มีเวชระเบียน</div>'}
    ${field.length ? `
      <h4 class="rec-field-title">ผลประเมินจาก AppSheet <span>${field.length} ครั้ง · เปิดเวชระเบียนแล้วกด "ดึงมาใส่แบบฟอร์ม" เพื่อใช้ผลชุดที่ต้องการ</span></h4>
      <div class="table-scroll"><table class="mini-table rec-table" id="recFieldTable">
        <thead><tr><th>วันที่ประเมิน</th><th>ที่มา</th><th>ผู้ประเมิน</th><th>ผล</th><th>หมายเหตุ / คำแนะนำ</th></tr></thead>
        <tbody>${field.map(a => `<tr><td>${esc_(fmtThaiDate_(a.date))}</td><td>${esc_(a.source || '-')}</td><td>${esc_(a.assessor || '-')}</td>
          <td>${a.items.map(i => `<span class="rec-chip">${esc_(i.label)} <b>${esc_(i.value)}</b></span>`).join('')}</td><td>${esc_(a.note || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${res.data.fieldError ? `<p class="error-text" id="recFieldError" style="margin-top:10px;">${esc_(res.data.fieldError)}</p>` : ''}`;
  document.getElementById('recNewBtn').addEventListener('click', () => {
    const drafts = recs.filter(r => r.status !== 'final' && r.kind !== 'progress').length;
    if (drafts && !window.confirm('คนไข้คนนี้มีฉบับร่างค้างอยู่ จะเปิด session ใหม่อีกชุดหรือไม่ (ถ้าจะกรอกต่อ ให้กด เปิด ที่ฉบับร่างเดิม)')) return;
    openRecordForm_({ ptn: ptn });
  });
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openRecordForm_({ ptn: ptn, id: b.dataset.open })));
  box.querySelectorAll('[data-sat]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('บันทึกว่าคนไข้ทำแบบประเมินความพึงพอใจของ session นี้แล้ว (1 ครั้งต่อ session) ใช่ไหม')) return;
    b.disabled = true;
    const res = await api('markSatisfaction', { ptn: ptn, session: Number(b.dataset.sat) });
    if (!res.ok) { toast('บันทึกไม่สำเร็จ: ' + res.error); b.disabled = false; return; }
    toast(res.data.already ? 'session นี้บันทึกไว้แล้ว' : 'บันทึกแล้ว');
    loadPatientRecords_(ptn);
  }));
  box.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => openRecordForm_({ ptn: ptn, id: b.dataset.print, view: 'doc' })));
  box.querySelectorAll('[data-note]').forEach(b => b.addEventListener('click', () => {
    const session = Number(b.dataset.note);
    const draft = recs.find(r => r.kind === 'progress' && r.session === session && r.status !== 'final');
    if (draft && !window.confirm('session นี้มี Progress note ฉบับร่างค้างอยู่ จะเปิดฉบับใหม่อีกฉบับหรือไม่ (ถ้าจะกรอกต่อ ให้กด เปิด ที่ฉบับร่างเดิม)')) return;
    openRecordForm_({ ptn: ptn, kind: 'progress', session: session });
  }));
  box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!window.confirm('ลบฉบับร่างนี้ใช่ไหม ลบแล้วกู้คืนไม่ได้')) return;
    b.disabled = true;
    const del = await api('deleteRecord', { id: b.dataset.del });
    if (!del.ok) { toast('ลบไม่สำเร็จ: ' + del.error); b.disabled = false; return; }
    toast('ลบฉบับร่างแล้ว');
    loadPatientRecords_(ptn);
  }));
}

/** ไปหน้าคนไข้ของคนที่เลือก แล้วเลื่อนมาที่กล่องเวชระเบียน */
async function recOpenPatient_(p) {
  const box = document.getElementById('recordSearchResults');
  if (box) { box.innerHTML = ''; box.classList.add('hidden'); }
  showView_('patients');
  await loadPatientProfile_(p);
  document.getElementById('patientRecords')?.scrollIntoView({ block: 'start' });
}

/* ---------------- เมนูเวชระเบียน: ค้นหาคนไข้ + รายการที่บันทึกล่าสุด ---------------- */

document.getElementById('recordSearchInput')?.addEventListener('input', e => {
  const matches = findPatientMatches_(e.target.value, '', 12);
  renderPatientSuggest_(matches, { boxId: 'recordSearchResults', head: 'กดเลือกเพื่อเปิดเวชระเบียน', onPick: recOpenPatient_ });
  const hint = document.getElementById('recordSearchHint');
  if (hint) {
    const q = e.target.value.trim();
    hint.textContent = !state.patientsLoaded ? 'กำลังโหลดทะเบียนคนไข้...' : (q.length >= 2 && !matches.length ? 'ไม่พบคนไข้ที่ตรงกับคำค้น (คนไข้ใหม่ให้ลงนัดก่อน ระบบจึงจะออก PTN)' : '');
  }
});

let _recRecentReq_ = 0;
async function loadRecentRecords_() {
  const box = document.getElementById('recordsRecent');
  if (!box) return;
  const req = ++_recRecentReq_;
  if (!box.innerHTML) box.innerHTML = '<p class="panel-hint" style="margin-top:16px;">กำลังโหลด...</p>';
  const res = await api('getRecentRecords', {});
  if (req !== _recRecentReq_) return;
  if (!res.ok) { box.innerHTML = `<p class="error-text" style="margin-top:16px;">โหลดรายการเวชระเบียนไม่สำเร็จ: ${esc_(res.error)}</p>`; return; }
  const recs = res.data.records || [];
  const rows = recs.map((r, i) => `
    <tr>
      <td>${esc_(fmtThaiDate_(r.date))}</td>
      <td><button type="button" class="rec-link" data-patient="${i}">${esc_((r.firstName + ' ' + r.lastName).trim() || r.ptn)}</button><small class="rec-ptn">${esc_(r.ptn)}</small></td>
      <td>Session ${esc_(r.session)}${r.kind === 'progress' ? ' <span class="rec-note-tag">Progress note</span>' : ''}</td><td>${recStatusLabel_(r.status)}</td><td>${esc_(r.chiefComplaint || '-')}</td>
      <td class="rec-actions"><button type="button" class="secondary rec-mini" data-open="${i}">เปิด</button></td>
    </tr>`).join('');
  box.innerHTML = `
    <div class="dash-panel" style="margin-top:16px;">
      <h3>บันทึกล่าสุด</h3>
      <p class="dash-sub">${res.data.total ? `ทั้งหมด ${res.data.total} ฉบับ${res.data.drafts ? ` · ฉบับร่างค้างอยู่ ${res.data.drafts} ชุด` : ''}${res.data.total > recs.length ? ` · แสดง ${recs.length} ชุดล่าสุด` : ''}` : 'เปิดเวชระเบียนใหม่ได้โดยค้นหาคนไข้ด้านบน หรือกดปุ่มเวชระเบียนในรายละเอียดนัด'}</p>
      ${rows ? `<div class="table-scroll"><table class="mini-table rec-table">
        <thead><tr><th>วันที่</th><th>คนไข้</th><th>Session</th><th>สถานะ</th><th>Chief complaint</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<div class="dash-empty">ยังไม่มีเวชระเบียน</div>'}
    </div>`;
  box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { const r = recs[Number(b.dataset.open)]; openRecordForm_({ ptn: r.ptn, id: r.id }); }));
  box.querySelectorAll('[data-patient]').forEach(b => b.addEventListener('click', () => { const r = recs[Number(b.dataset.patient)]; recOpenPatient_({ ptn: r.ptn, firstName: r.firstName, lastName: r.lastName }); }));
}

/**
 * ปุ่ม "เวชระเบียน" ในรายละเอียดนัด: คนไข้ที่ยังไม่มีเวชระเบียนเปิดแบบฟอร์มใหม่เลย (วันที่ = วันนัด)
 * ถ้ามีแล้วไปหน้าคนไข้ให้เลือกเปิดชุดเดิมหรือเปิด session ใหม่
 */
async function openRecordsFromAppt_(appt, date) {
  if (!appt || !appt.ptn) { toast('นัดนี้ยังไม่มี PTN'); return; }
  const res = await api('getPatientRecords', { ptn: appt.ptn });
  if (!res.ok) { toast('เปิดเวชระเบียนไม่สำเร็จ: ' + res.error); return; }
  if (!(res.data.records || []).length) { openRecordForm_({ ptn: appt.ptn, date: date }); return; }
  showView_('patients');
  await loadPatientProfile_(res.data.patient);
  document.getElementById('patientRecords')?.scrollIntoView({ block: 'start' });
}

/* ---------------- ตั้งค่า: ตัวเลือกของดรอปดาวน์ในแบบฟอร์ม (แบบแรกรับและ Progress note ใช้ชุดเดียวกัน) ---------------- */

// [หัวข้อ, [[ชื่อรายการในชีต RecordOptions, ชื่อที่แสดง, คำอธิบาย]]]
const REC_OPTION_GROUPS = [
  ['ผู้ลงชื่อ', [
    ['signer', 'ผู้ลงชื่อในเวชระเบียน', 'พิมพ์คำนำหน้า ชื่อ นามสกุล ตามด้วยเลขที่ใบอนุญาต เช่น นางสาวตัวอย่าง ใจดี ก.1234 — เอกสารจะแยกชื่อกับเลขที่ใบอนุญาตให้เอง']]],
  ['การรักษา (Intervention / P)', [
    ['modality', 'Modality: เครื่องมือ', 'ชนิดของเครื่องมือและหัตถการ เช่น US, ES, Hot pack'],
    ['modMode', 'Modality: Mode'], ['modIntensity', 'Modality: Intensity', 'เช่น 1.0 W/cm², ตามที่ผู้ป่วยทนได้'],
    ['exercise', 'Exercise: ชนิดการออกกำลังกาย'], ['exDetail', 'Exercise: รายละเอียด'],
    ['reps', 'Exercise: ครั้ง/set'], ['setsPerDay', 'Exercise: set/วัน'], ['daysPerWeek', 'Exercise: วัน/สัปดาห์'],
    ['assistLevel', 'Ambulation / Transfer: ระดับการช่วยเหลือ', 'Independent = ทำเองได้ · Dependent = ต้องมีผู้ช่วย'],
    ['gaitAid', 'Ambulation: เครื่องช่วยเดิน'], ['gaitPattern', 'Ambulation: รูปแบบการเดิน'], ['transferType', 'Transfer: รูปแบบการเคลื่อนย้าย'],
    ['education', 'คำแนะนำที่ให้ผู้ป่วย / ญาติ'], ['paMinutes', 'Increase PA: นาที/วัน'], ['paDays', 'Increase PA: วัน/สัปดาห์']]],
  ['ตำแหน่ง (ใช้ทั้งการตรวจและการรักษา)', [
    ['side', 'ข้าง', 'Right / Left / Both'], ['muscle', 'ตำแหน่ง / กล้ามเนื้อ', 'เช่น upper trapezius — ใช้กับการรักษา Tenderness และ Problem list'],
    ['bodyPart', 'ส่วนของร่างกาย', 'เช่น neck, low back'], ['joint', 'ข้อ (ROM)'], ['direction', 'ทิศทางการเคลื่อนไหว (ROM)']]],
  ['ตรวจร่างกาย (Physical examination / O)', [
    ['symptom', 'อาการ'], ['frequency', 'ความถี่ของอาการ'], ['ease', 'สิ่งที่ทำให้อาการลดลง'], ['posture', 'ท่าทาง (Posture) อื่น ๆ'], ['romType', 'ROM: Active / Passive'],
    ['specialTestUpper', 'Special test: Shoulder / upper'], ['specialTestLower', 'Special test: Lumbar / lower'], ['testResult', 'ผล Special test']]],
  ['ประวัติและการวินิจฉัย', [
    ['medicalDx', 'Medical diagnosis'], ['ptDx', 'PT diagnosis'], ['ud', 'โรคประจำตัว (U/D)'], ['contraindication', 'Contraindication'],
    ['redFlag', 'Red flag'], ['orangeFlag', 'Orange flag'], ['yellowFlag', 'Yellow flag']]],
  ['เป้าหมายและแผน', [
    ['count', 'จำนวน (ใช้กับเป้าหมาย)'], ['timeUnit', 'หน่วยเวลาของเป้าหมาย'], ['functionGoal', 'Return to function: กิจกรรม'], ['dischargeReason', 'เหตุผลที่จำหน่าย']]]
];
// รายการที่ไม่ต้องตั้งค่า: ของแบบฟอร์มรุ่นเก่าที่ไม่ได้ใช้แล้ว และ Yes/No
const REC_OPTION_HIDDEN = ['modParam1', 'modParam2', 'mobTechnique', 'mobGrade', 'yesNo'];
const REC_OPT = { options: null, list: '', items: [], dirty: false, loading: false };

function recOptMeta_(list) {
  for (const g of REC_OPTION_GROUPS) { const hit = g[1].find(x => x[0] === list); if (hit) return hit; }
  return [list, list, ''];
}
/** โหลดตัวเลือกทั้งหมดมาแสดงในหน้าตั้งค่า (app.js เรียกตอนเปิดหน้าตั้งค่า) */
async function recOptionsLoad_() {
  const box = document.getElementById('recOptionsBox');
  if (!box || REC_OPT.loading) return;
  REC_OPT.loading = true;
  if (!REC_OPT.options) box.innerHTML = '<p class="panel-hint">กำลังโหลด...</p>';
  const res = await api('getRecordSetup', {});
  REC_OPT.loading = false;
  if (!res.ok) { box.innerHTML = `<p class="error-text">โหลดตัวเลือกไม่สำเร็จ: ${esc_(res.error)}</p>`; return; }
  REC_OPT.options = res.data.options || {};
  if (REC_OPT.dirty && REC_OPT.list) { recOptionsRender_(); return; } // กำลังแก้ค้างอยู่ ไม่ทับ
  if (!REC_OPT.list || !REC_OPT.options[REC_OPT.list]) REC_OPT.list = 'signer';
  REC_OPT.items = (REC_OPT.options[REC_OPT.list] || []).slice();
  REC_OPT.dirty = false;
  recOptionsRender_();
}
function recOptionsRender_() {
  const box = document.getElementById('recOptionsBox');
  if (!box || !REC_OPT.options) return;
  const known = {};
  REC_OPTION_GROUPS.forEach(g => g[1].forEach(x => { known[x[0]] = true; }));
  const extra = Object.keys(REC_OPT.options).filter(l => !known[l] && REC_OPTION_HIDDEN.indexOf(l) === -1).sort();
  const groups = REC_OPTION_GROUPS.concat(extra.length ? [['อื่น ๆ (คอลัมน์ที่เพิ่มเองในชีต)', extra.map(l => [l, l])]] : []);
  const count = l => (l === REC_OPT.list ? REC_OPT.items : (REC_OPT.options[l] || [])).length;
  const meta = recOptMeta_(REC_OPT.list);
  box.innerHTML = `
    <div class="ropt-top">
      <label for="recOptList">รายการ</label>
      <select id="recOptList">${groups.map(g => `<optgroup label="${recAttr_(g[0])}">${g[1].map(x => `<option value="${recAttr_(x[0])}"${x[0] === REC_OPT.list ? ' selected' : ''}>${esc_(x[1])} (${count(x[0])})</option>`).join('')}</optgroup>`).join('')}</select>
    </div>
    ${meta[2] ? `<p class="panel-hint ropt-hint">${esc_(meta[2])}</p>` : ''}
    <ol class="ropt-items" id="recOptItems">${REC_OPT.items.map((v, i) => `
      <li><span class="ropt-text">${esc_(v)}</span>
        <button type="button" class="ropt-btn" data-up="${i}" title="เลื่อนขึ้น" aria-label="เลื่อนขึ้น: ${recAttr_(v)}"${i === 0 ? ' disabled' : ''}>↑</button>
        <button type="button" class="ropt-btn" data-down="${i}" title="เลื่อนลง" aria-label="เลื่อนลง: ${recAttr_(v)}"${i === REC_OPT.items.length - 1 ? ' disabled' : ''}>↓</button>
        <button type="button" class="ropt-btn ropt-x" data-rm="${i}" title="ลบตัวเลือกนี้" aria-label="ลบตัวเลือก: ${recAttr_(v)}">✕</button></li>`).join('') ||
      '<li class="ropt-empty">ยังไม่มีตัวเลือกในรายการนี้ (ในแบบฟอร์มยังเลือก "พิมพ์เอง…" ได้ และระบบจะจำค่าที่พิมพ์ไว้ให้)</li>'}</ol>
    <form class="inline-form ropt-add" id="recOptAddForm">
      <input type="text" id="recOptAddInput" maxlength="80" placeholder="พิมพ์ตัวเลือกใหม่ แล้วกด เพิ่ม" aria-label="ตัวเลือกใหม่ของรายการ ${recAttr_(meta[1])}">
      <button type="submit" class="secondary">เพิ่ม</button>
      <button type="button" class="primary" id="recOptSaveBtn"${REC_OPT.dirty ? '' : ' disabled'}>บันทึกรายการนี้</button>
      <span class="ropt-state" id="recOptState">${REC_OPT.dirty ? 'มีการแก้ไขที่ยังไม่ได้บันทึก' : ''}</span>
    </form>
    <div class="ropt-seed">
      <button type="button" class="secondary" id="recOptSeedBtn">เติมตัวเลือกจากแบบฟอร์มเดิม</button>
      <span class="panel-hint">เพิ่มตัวเลือกจากชีตเวชระเบียนเดิม (การวินิจฉัย, Special test, Flag, กล้ามเนื้อ ฯลฯ) ต่อท้ายทุกรายการ เฉพาะตัวที่ยังไม่มี ไม่ลบของที่ตั้งไว้ กดซ้ำได้</span>
    </div>`;
  document.getElementById('recOptSeedBtn').addEventListener('click', async e => {
    if (REC_OPT.dirty && !window.confirm('รายการที่เปิดอยู่มีการแก้ไขที่ยังไม่ได้บันทึก และจะถูกทิ้ง เติมตัวเลือกต่อหรือไม่')) return;
    e.target.disabled = true;
    const res = await api('seedRecordOptions', {});
    if (!res.ok) { toast('เติมตัวเลือกไม่สำเร็จ: ' + res.error); e.target.disabled = false; return; }
    REC_OPT.options = res.data.options;
    REC_OPT.items = (REC_OPT.options[REC_OPT.list] || []).slice();
    REC_OPT.dirty = false;
    toast(res.data.added ? `เพิ่ม ${res.data.added} ตัวเลือก ใน ${res.data.lists} รายการ` : 'ตัวเลือกจากแบบฟอร์มเดิมมีครบอยู่แล้ว');
    recOptionsRender_();
  });
  document.getElementById('recOptList').addEventListener('change', e => {
    if (REC_OPT.dirty && !window.confirm('รายการนี้มีการแก้ไขที่ยังไม่ได้บันทึก เปลี่ยนรายการโดยไม่บันทึกหรือไม่')) { e.target.value = REC_OPT.list; return; }
    REC_OPT.list = e.target.value;
    REC_OPT.items = (REC_OPT.options[REC_OPT.list] || []).slice();
    REC_OPT.dirty = false;
    recOptionsRender_();
  });
  document.getElementById('recOptItems').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const it = REC_OPT.items;
    if (b.dataset.rm !== undefined) it.splice(Number(b.dataset.rm), 1);
    else if (b.dataset.up !== undefined) { const i = Number(b.dataset.up); it.splice(i - 1, 0, it.splice(i, 1)[0]); }
    else if (b.dataset.down !== undefined) { const i = Number(b.dataset.down); it.splice(i + 1, 0, it.splice(i, 1)[0]); }
    else return;
    REC_OPT.dirty = true;
    recOptionsRender_();
  });
  document.getElementById('recOptAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = document.getElementById('recOptAddInput');
    const v = input.value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    if (REC_OPT.items.some(x => x.toLowerCase() === v.toLowerCase())) { toast('มีตัวเลือกนี้อยู่แล้ว'); return; }
    REC_OPT.items.push(v);
    REC_OPT.dirty = true;
    recOptionsRender_();
    document.getElementById('recOptAddInput').focus();
  });
  document.getElementById('recOptSaveBtn').addEventListener('click', async e => {
    e.target.disabled = true;
    const res = await api('setRecordOptions', { list: REC_OPT.list, values: REC_OPT.items });
    if (!res.ok) { toast('บันทึกไม่สำเร็จ: ' + res.error); e.target.disabled = false; return; }
    REC_OPT.options[REC_OPT.list] = res.data.values;
    REC_OPT.items = res.data.values.slice();
    REC_OPT.dirty = false;
    toast('บันทึกตัวเลือกแล้ว');
    recOptionsRender_();
  });
}
