/* =====================================================================
 * dashboard.js — หน้าสถิติ 4 มุมมอง (ภาพรวมบริการ / แผนที่ตำบล / ผลลัพธ์การรักษา / ความพึงพอใจ)
 * ต้องอัปโหลดคู่กับ index.html, app.js, record.js, style.css — โหลดหลัง app.js
 * ใช้ของจาก app.js: api(), state, esc_(), toast(), showView_(), fmtThaiDate_(), THAI_MONTH_SHORT, pct_(), renderFeedback_()
 * ข้อมูลทั้งหมดเป็นตัวเลขสรุปจากหลังบ้าน (getDashboard / getOutcomes) ไม่มีชื่อหรือ PTN ของคนไข้
 * ===================================================================== */

/* ---------------- ตั้งค่าที่แก้ได้ ---------------- */
// หมู่ในเขตรับผิดชอบของหน่วยบริการ (ขอบสีทองบนแผนที่) — หมู่อื่นใน 1-12 ยังนับและแสดงตามปกติ
const DASH_CATCHMENT = [7, 8, 9, 10];
// หมู่ที่ตั้งของ รพ.สต. (จุดกะพริบบนแผนที่) — 0 = ไม่แสดงจุด
const DASH_HOME_MOO = 9;
// ชื่อหมู่บ้านของตำบลบ้านกร่าง หมู่ 1-12 (แก้ตัวสะกดได้ที่นี่)
const DASH_MOO_NAMES = ['บ้านเด่นโบสถ์', 'บ้านกร่าง (เหนือ)', 'บ้านกร่าง', 'บ้านกร่าง (น้ำอับ)', 'บ้านกร่าง (วังป่าหญ้า)', 'บ้านกร่างนอก (บ้านกอก)',
  'บ้านกร่าง (มาบหมู)', 'บ้านหัวแท', 'บ้านแหลมโพธิ์', 'บ้านแม่ระหัน', 'บ้านกร่างท่าวัว', 'บ้านเหนือรุ่งอรุณ'];
/*
 * รูปร่างแผนที่: cells[i] = หมู่ที่ i+1 — d = เส้นรอบรูป (SVG path) · c = จุดวางเลขหมู่
 * ตอนนี้เป็น "แผนผังจำลอง": รูปร่างและตำแหน่งของแต่ละหมู่ยังไม่ตรงพื้นที่จริง (ยังไม่มีแผนที่แนวเขตหมู่)
 * เมื่อได้แผนที่จริง เปลี่ยนเฉพาะก้อนนี้ แล้วตั้ง schematic เป็น false — ส่วนอื่นของหน้าไม่ต้องแก้
 */
const DASH_MAP = {
  schematic: true,
  viewBox: "20 0 548 520",
  river: "M526.4 -10L535.3 10L537.6 30L534.3 50L530.0 70L529.2 90L532.9 110L538.2 130L539.9 150L534.7 170L523.6 190L511.7 210L504.7 230L505.3 250L511.6 270L518.3 290L521.2 310L519.3 330L516.2 350L516.5 370L523.0 390L533.7 410L543.4 430L546.8 450L542.3 470L532.8 490L523.9 510L520.0 530",
  riverLabel: [512, 40],
  cells: [
    { d: "M101.1 82.9L101.2 82.8L110.0 73.5L119.3 65.0L129.0 57.2L139.0 50.1L149.4 43.8L160.1 38.6L171.3 34.7L182.9 32.5L194.8 32.2L206.8 33.9L218.7 37.2L230.1 41.8L241.0 47.1L251.3 52.4L260.9 57.2L270.0 61.0L271.5 61.4L252.7 135.1L211.5 149.4Z", c: [196.2,85.8] },
    { d: "M252.7 135.1L271.5 61.4L278.8 63.5L287.6 65.0L296.4 65.7L305.4 66.2L314.4 67.0L323.4 68.6L332.1 71.3L340.6 75.3L348.5 80.3L356.1 86.1L363.3 92.3L368.8 97.0L341.2 154.2L296.3 169.7Z", c: [307.5,113.6] },
    { d: "M348.4 259.8L284.9 235.8L296.3 169.7L341.2 154.2L401.3 230.3Z", c: [336.5,210.4] },
    { d: "M199.1 234.9L211.5 149.4L252.7 135.1L296.3 169.7L284.9 235.8L253.1 252.6Z", c: [247,195.4] },
    { d: "M77.3 192.9L76.5 185.5L75.3 171.8L74.7 157.7L75.3 143.6L77.4 129.8L81.1 116.6L86.5 104.3L93.3 93.0L101.1 82.9L211.5 149.4L199.1 234.9L177.8 243.1Z", c: [140.9,166.2] },
    { d: "M107.4 361.6L103.6 355.8L97.5 346.6L91.6 337.0L86.1 326.9L81.5 316.2L78.1 305.0L76.1 293.4L75.4 281.6L75.7 269.7L76.7 258.0L78.0 246.4L78.9 234.8L79.3 223.2L78.9 211.2L77.9 198.6L77.3 192.9L177.8 243.1L149.2 339.0Z", c: [119.2,277.2] },
    { d: "M340.5 344.5L260.6 336.2L253.1 252.6L284.9 235.8L348.4 259.8Z", c: [300.3,291.8] },
    { d: "M149.2 339.0L177.8 243.1L199.1 234.9L253.1 252.6L260.6 336.2L235.2 359.3Z", c: [209.5,299.5] },
    { d: "M409.5 419.9L401.6 426.5L392.7 432.7L383.5 438.1L374.1 442.8L364.6 446.9L355.3 451.0L346.1 455.2L337.2 459.8L328.3 465.0L319.4 470.5L310.2 476.0L300.6 481.0L290.7 484.9L280.4 487.1L270.0 487.4L259.7 485.7L251.8 482.8L235.2 359.3L260.6 336.2L340.5 344.5Z", c: [307.4,408.5] },
    { d: "M251.8 482.8L249.6 482.0L239.9 476.8L230.8 470.7L222.1 464.2L213.6 458.0L205.3 452.3L196.9 447.3L188.3 442.8L179.6 438.5L170.8 434.1L162.2 429.1L153.9 423.4L146.1 416.6L139.0 409.0L132.6 400.7L126.6 391.9L121.0 382.9L115.3 373.8L109.5 364.8L107.4 361.6L149.2 339.0L235.2 359.3Z", c: [188.9,398.1] },
    { d: "M490.9 258.0L494.8 271.6L497.0 285.5L497.1 299.5L495.0 313.1L490.6 326.2L484.4 338.3L476.8 349.5L468.3 359.8L459.5 369.3L450.7 378.3L442.2 387.0L434.0 395.4L426.1 403.7L418.2 411.8L410.0 419.5L409.5 419.9L340.5 344.5L348.4 259.8L401.3 230.3L480.1 232.6L485.8 245.0Z", c: [418.3,311] },
    { d: "M401.3 230.3L341.2 154.2L368.8 97.0L370.5 98.5L377.8 104.6L385.4 110.3L393.4 115.8L401.7 121.3L410.3 127.0L418.7 133.4L426.8 140.6L434.3 148.6L441.1 157.5L447.2 167.0L452.7 177.1L457.9 187.6L463.1 198.4L468.5 209.4L474.2 220.7L480.0 232.5L480.1 232.6Z", c: [405.9,174.4] }
  ]
};

const DASH = { tab: 'over', data: null, metric: 'visits', dx: '', outKey: '', outReq: 0, cmpReq: 0, moo: null };
const DASH_RAMP = ['--d-s1', '--d-s2', '--d-s3', '--d-s4', '--d-s5', '--d-s6'];
const DASH_SVG = 'http://www.w3.org/2000/svg';
const dashReduce_ = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const dashCss_ = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const dashEl_ = (tag, attrs, text) => { const e = document.createElementNS(DASH_SVG, tag); Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); if (text !== undefined) e.textContent = text; return e; };
const dashH_ = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const dashNum_ = n => Number(n || 0).toLocaleString('en-US');
const dashPct_ = (n, d) => d ? Math.round(n / d * 100) + '%' : '-';

/* ---------------- กล่องข้อมูลตอนชี้ (ข้อความทุกตัวใส่ด้วย textContent) ---------------- */
function dashTipShow_(title, rows, x, y) {
  let tip = document.getElementById('dashTip');
  if (!tip) { tip = dashH_('div'); tip.id = 'dashTip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); }
  tip.textContent = '';
  tip.appendChild(dashH_('div', 't', title));
  rows.forEach(r => {
    const row = dashH_('div', 'r'), left = dashH_('span');
    if (r.color) { const k = dashH_('i', 'k'); k.style.background = r.color; left.appendChild(k); }
    left.appendChild(document.createTextNode(r.label));
    row.appendChild(left); row.appendChild(dashH_('b', '', r.value)); tip.appendChild(row);
  });
  tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let px = x + 14, py = y + 14;
  if (px + w > window.innerWidth - 8) px = x - w - 14;
  if (py + h > window.innerHeight - 8) py = y - h - 14;
  tip.style.left = Math.max(8, px) + 'px'; tip.style.top = Math.max(8, py) + 'px';
}
function dashTipHide_() { document.getElementById('dashTip')?.classList.remove('on'); }
/** ผูกการชี้/แตะ/โฟกัสของ node กับกล่องข้อมูล — make() คืน [หัวข้อ, แถว] */
function dashHover_(node, make, onIn, onOut) {
  const show = ev => {
    if (onIn) onIn();
    const b = node.getBoundingClientRect(), ptr = ev.type !== 'focus';
    const t = make();
    dashTipShow_(t[0], t[1], ptr ? ev.clientX : b.left + b.width / 2, ptr ? ev.clientY : b.top + b.height / 2);
  };
  const hide = () => { if (onOut) onOut(); dashTipHide_(); };
  node.addEventListener('pointermove', show); node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show); node.addEventListener('blur', hide);
}

/* ---------------- ตัวเลขวิ่ง + แท่งโต (ครั้งเดียวตอนเปิดแท็บ) ---------------- */
function dashTween_(node, to, dec, from) {
  const fmt = v => dec ? v.toFixed(dec) : dashNum_(Math.round(v));
  cancelAnimationFrame(node._raf || 0);
  clearTimeout(node._done || 0);
  if (dashReduce_() || !isFinite(to)) { node.textContent = fmt(to); return; }
  const a = from || 0, dur = 750;
  // กันตัวเลขค้างกลางทาง (เช่น แท็บเบราว์เซอร์ถูกพักการวาดภาพ): ครบเวลาแล้วใส่ค่าจริงเสมอ
  node._done = setTimeout(() => { cancelAnimationFrame(node._raf || 0); node.textContent = fmt(to); }, dur + 200);
  let start = null;
  const step = ts => {
    if (start === null) start = ts;
    const p = Math.min(1, (ts - start) / dur), e = 1 - Math.pow(1 - p, 3);
    node.textContent = fmt(a + (to - a) * e);
    if (p < 1) node._raf = requestAnimationFrame(step);
  };
  node.textContent = fmt(a);
  node._raf = requestAnimationFrame(step);
}
function dashAnimate_(panel) {
  if (!panel) return;
  panel.classList.remove('live');
  panel.querySelectorAll('[data-w]').forEach(i => { i.style.width = '0'; });
  panel.querySelectorAll('[data-count]').forEach(n => dashTween_(n, Number(n.dataset.count), Number(n.dataset.dec || 0))); // เริ่มจาก 0 ในเฟรมเดียวกัน ตัวเลขไม่กะพริบ
  void panel.offsetWidth;
  requestAnimationFrame(() => {
    panel.classList.add('live');
    panel.querySelectorAll('[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; });
  });
}

/* ---------------- แท็บ ---------------- */
function dashSelectTab_(tab, focus) {
  DASH.tab = tab;
  document.querySelectorAll('#dashTabs .dtab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  document.querySelectorAll('#dashBody .dpanel').forEach(p => { p.hidden = p.dataset.tab !== tab; });
  dashTipHide_();
  if (tab === 'out') dashLoadOutcomes_();
  dashAnimate_(document.querySelector(`#dashBody .dpanel[data-tab="${tab}"]`));
}
(function () {
  const tabs = Array.from(document.querySelectorAll('#dashTabs .dtab'));
  tabs.forEach((b, i) => {
    b.addEventListener('click', () => dashSelectTab_(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') dashSelectTab_(tabs[(i + 1) % tabs.length].dataset.tab, true);
      if (e.key === 'ArrowLeft') dashSelectTab_(tabs[(i + tabs.length - 1) % tabs.length].dataset.tab, true);
    });
  });
})();

/* ---------------- ช่วงเวลา: กำหนดวันเอง / รายเดือน / รายไตรมาส / ปีงบประมาณ ---------------- */
// ปีงบประมาณ พ.ศ. N = 1 ต.ค. (N-1) ถึง 30 ก.ย. N · ไตรมาส 1 = ต.ค.-ธ.ค. ของปีก่อนหน้า
function dashFiscalOf_(date) { return date.getFullYear() + 543 + (date.getMonth() >= 9 ? 1 : 0); }
function dashPeriodShow_(kind) {
  const sel = document.getElementById('dashKind');
  if (!sel) return;
  sel.value = kind;
  document.querySelectorAll('.dash-kind').forEach(el => el.classList.toggle('hidden', el.dataset.kind.split(' ').indexOf(kind) === -1));
}
/** แปลงตัวเลือก เดือน / ไตรมาส / ปีงบประมาณ เป็นวันที่เริ่มและสิ้นสุดในช่อง dashFrom / dashTo */
function dashPeriodApply_() {
  const kind = document.getElementById('dashKind')?.value || 'custom';
  if (kind === 'custom') return;
  const ymd = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const last = (y, m) => new Date(y, m, 0).getDate();
  let from, to;
  if (kind === 'month') {
    const y = Number(document.getElementById('dashYear').value) - 543, m = Number(document.getElementById('dashMonth').value);
    from = ymd(y, m, 1); to = ymd(y, m, last(y, m));
  } else {
    const fy = Number(document.getElementById('dashFy').value) - 543; // ค.ศ. ของปีที่ปีงบประมาณสิ้นสุด
    if (kind === 'fiscal') { from = ymd(fy - 1, 10, 1); to = ymd(fy, 9, 30); }
    else {
      const q = Number(document.getElementById('dashQuarter').value);
      const y = q === 1 ? fy - 1 : fy, m0 = [10, 1, 4, 7][q - 1];
      from = ymd(y, m0, 1); to = ymd(y, m0 + 2, last(y, m0 + 2));
    }
  }
  document.getElementById('dashFrom').value = from;
  document.getElementById('dashTo').value = to;
}
(function () {
  const kind = document.getElementById('dashKind');
  if (!kind) return;
  const now = new Date(), fyNow = dashFiscalOf_(now), beNow = now.getFullYear() + 543;
  const fill = (id, items, value) => { const el = document.getElementById(id); el.textContent = ''; items.forEach(it => { const o = dashH_('option', '', it[1]); o.value = it[0]; el.appendChild(o); }); el.value = value; };
  fill('dashMonth', THAI_MONTH_SHORT.map((m, i) => [i + 1, m]), now.getMonth() + 1);
  const years = []; for (let y = beNow; y >= 2567; y--) years.push([y, 'พ.ศ. ' + y]);
  fill('dashYear', years, beNow);
  const fys = []; for (let y = fyNow; y >= 2567; y--) fys.push([y, 'ปีงบประมาณ ' + y]);
  fill('dashFy', fys, fyNow);
  document.getElementById('dashQuarter').value = String([2, 3, 4, 1][Math.floor(now.getMonth() / 3)]);
  kind.addEventListener('change', () => dashPeriodShow_(kind.value));
  document.getElementById('dashCompare')?.addEventListener('change', () => dashLoadCompare_());
})();

/** ชื่อเรียกช่วงเวลา: ปีงบประมาณ / ไตรมาส / เดือน / ปี ถ้าตรงพอดี ไม่งั้นเป็นวันที่เริ่ม-สิ้นสุด */
function dashPeriodLabel_(from, to) {
  const fy = Number(from.slice(0, 4)), fm = Number(from.slice(5, 7)), fd = from.slice(8), ty = Number(to.slice(0, 4)), tm = Number(to.slice(5, 7)), td = Number(to.slice(8));
  const lastDay = new Date(ty, tm, 0).getDate() === td;
  if (fd === '01' && lastDay) {
    if (fm === 10 && tm === 9 && ty === fy + 1) return 'ปีงบ ' + (ty + 543);
    if (fm === 1 && tm === 12 && ty === fy) return 'ปี ' + (fy + 543);
    if (ty === fy && fm === tm) return `${THAI_MONTH_SHORT[fm - 1]} ${fy + 543}`;
    if (ty === fy && tm === fm + 2 && [10, 1, 4, 7].indexOf(fm) !== -1) return `ไตรมาส ${[10, 1, 4, 7].indexOf(fm) + 1} ปีงบ ${fy + 543 + (fm === 10 ? 1 : 0)}`;
  }
  return `${fmtThaiDate_(from)} ถึง ${fmtThaiDate_(to)}`;
}
/** เทียบช่วงเดียวกันของ 1-3 ปีก่อน: โหลดแยก (ไม่ทำให้หน้าหลักช้า) แล้วแสดงใต้แถบสรุป */
async function dashLoadCompare_() {
  const box = document.getElementById('dashCompareBox'), d = DASH.data;
  if (!box || !d) return;
  const years = Number(document.getElementById('dashCompare')?.value || 0);
  const req = ++DASH.cmpReq;
  if (!years) { box.textContent = ''; return; }
  box.innerHTML = '<div class="dsheet"><div class="dpad dash-empty">กำลังโหลดข้อมูลเทียบย้อนหลัง...</div></div>';
  const res = await api('getDashboardCompare', { from: d.from, to: d.to, years: years });
  if (req !== DASH.cmpReq || !document.getElementById('dashCompareBox')) return;
  if (!res.ok) {
    box.innerHTML = `<div class="dsheet"><div class="dpad dash-empty">${/ไม่รู้จัก/.test(String(res.error)) ? 'หลังบ้าน (Apps Script) ยังเป็นรุ่นเก่า ยังเทียบย้อนหลังไม่ได้ — วาง Code.gs ชุดใหม่แล้วอัปเดตเว็บแอปเป็นเวอร์ชันใหม่' : 'โหลดข้อมูลเทียบไม่สำเร็จ: ' + esc_(res.error)}</div></div>`;
    return;
  }
  box.innerHTML = dashCompareHtml_(res.data.periods);
  if (DASH.tab === 'over') requestAnimationFrame(() => box.querySelectorAll('[data-w]').forEach(i => { i.style.width = i.dataset.w + '%'; }));
}
function dashCompareHtml_(periods) {
  const metrics = [
    { title: 'ให้บริการ (ครั้ง)', get: p => p.visits, fmt: v => dashNum_(v) },
    { title: 'จำนวนเคส (ราย)', get: p => p.cases, fmt: v => dashNum_(v) },
    { title: 'เคสรายใหม่ (ราย)', get: p => p.newCases, fmt: v => dashNum_(v) },
    { title: 'มาตามนัด', get: p => p.attendanceRate === null || p.attendanceRate === undefined ? null : Math.round(p.attendanceRate * 1000) / 10, fmt: v => v.toFixed(1) + '%', point: true },
    { title: 'ความพึงพอใจ', get: p => p.satisfaction === null || p.satisfaction === undefined ? null : Math.round(p.satisfaction * 10) / 10, fmt: v => v.toFixed(1) + '%', point: true }
  ];
  const shades = ['--d-s2', '--d-s3', '--d-s4', '--d-s5'].slice(4 - periods.length);
  const block = m => {
    const vals = periods.map(m.get), max = Math.max(1, ...vals.filter(v => v !== null));
    return `<div class="dcmp"><h4>${m.title}</h4><div class="dcmp-rows">${periods.map((p, i) => {
      const v = vals[i], prev = i ? vals[i - 1] : null;
      let delta = '';
      if (v !== null && prev !== null && i) {
        // จำนวน: % ที่เปลี่ยนจากปีก่อน · ค่าที่เป็นร้อยละอยู่แล้ว: ต่างกันกี่จุด
        const diff = m.point ? v - prev : (prev ? (v - prev) / prev * 100 : null);
        if (diff !== null) delta = `<span class="dl ${diff > 0 ? 'up' : (diff < 0 ? 'down' : '')}">${diff > 0 ? '▲' : (diff < 0 ? '▼' : '')} ${Math.abs(diff).toFixed(1)}${m.point ? ' จุด' : '%'}</span>`;
        else if (v > 0) delta = '<span class="dl up">▲ จากศูนย์</span>';
      }
      return `<span class="nm">${esc_(dashPeriodLabel_(p.from, p.to))}</span>
        <div class="tr">${v === null ? '' : `<i style="background:var(${shades[i]})" data-w="${(v / max * 100).toFixed(1)}"></i>`}</div>
        <span class="vl">${v === null ? '<small>ไม่มีข้อมูล</small>' : m.fmt(v)}</span>${delta || '<span class="dl"></span>'}`;
    }).join('')}</div></div>`;
  };
  return `<div class="dsheet"><header><h3>เทียบกับช่วงเดียวกันของปีก่อน</h3><p class="dsub">ตัวเลขท้ายแถวคือการเปลี่ยนแปลงจากปีก่อนหน้า ร้อยละเทียบกันเป็นจำนวนจุดที่ต่าง</p></header>
    <div class="dpad dcmp-grid">${metrics.map(block).join('')}</div></div>`;
}

/* ---------------- จุดเริ่ม: app.js เรียกเมื่อได้ข้อมูลจาก getDashboard ---------------- */
function dashRender_(d) {
  DASH.data = d;
  DASH.outKey = ''; // ช่วงเวลาอาจเปลี่ยน: ผลลัพธ์จากเวชระเบียนโหลดใหม่เมื่อเปิดแท็บนั้น
  const body = document.getElementById('dashBody');
  document.getElementById('dashTabs')?.classList.remove('hidden');
  body.innerHTML = `
    <section class="dpanel" data-tab="over" role="tabpanel" aria-labelledby="dtab-over">${dashOverviewHtml_(d)}</section>
    <section class="dpanel" data-tab="map" role="tabpanel" aria-labelledby="dtab-map" hidden>${dashMapHtml_()}</section>
    <section class="dpanel" data-tab="out" role="tabpanel" aria-labelledby="dtab-out" hidden><div id="dashOut" class="dash-empty">กำลังโหลด...</div></section>
    <section class="dpanel" data-tab="sat" role="tabpanel" aria-labelledby="dtab-sat" hidden>${renderFeedback_(d.feedback) || '<div class="dsheet"><div class="dpad dash-empty">หลังบ้านรุ่นนี้ยังไม่มีข้อมูลความพึงพอใจ</div></div>'}</section>`;
  dashTrendDraw_(d);
  dashMapDraw_(d);
  dashLoadCompare_();
  document.getElementById('dashToPatientsBtn')?.addEventListener('click', () => showView_('patients'));
  document.getElementById('fbCopyBtn')?.addEventListener('click', async () => {
    const input = document.getElementById('fbShareUrl');
    try { await navigator.clipboard.writeText(input.value); }
    catch (e) { input.select(); document.execCommand('copy'); } // เบราว์เซอร์ที่ไม่ให้ใช้คลิปบอร์ดแบบใหม่
    toast('คัดลอกลิงก์แบบประเมินแล้ว');
  });
  dashSelectTab_(DASH.tab);
}
/** ออกจากระบบ: ไม่ทิ้งตัวเลขค้างบนจอ และกลับไปแท็บแรก */
function dashReset_() {
  DASH.data = null; DASH.outKey = ''; DASH.tab = 'over'; DASH.metric = 'visits'; DASH.dx = ''; DASH.moo = null;
  dashTipHide_();
}

/* ---------------- มุมมอง 1: ภาพรวมบริการ ---------------- */
function dashOverviewHtml_(d) {
  const t = d.totals;
  const cases = t.cases !== undefined ? t.cases : t.patientsSeen;
  const visits = t.visits !== undefined ? t.visits : t.attended;
  const rate = t.attendanceRate === null || t.attendanceRate === undefined ? null : Math.round(t.attendanceRate * 100);
  const hasCases = (d.byType || []).some(r => r.cases !== undefined);
  const monthName = k => `${THAI_MONTH_SHORT[Number(k.slice(5, 7)) - 1]} ${Number(k.slice(0, 4)) + 543}`;
  const count = (n, dec) => `<span data-count="${Number(n) || 0}"${dec ? ` data-dec="${dec}"` : ''}>${dec ? (Number(n) || 0).toFixed(dec) : dashNum_(n)}</span>`;
  return `
    <div class="dsheet dsum">
      <div class="dsum-cell hero"><div class="lb">ให้บริการแล้ว</div><div class="num">${count(visits)}<small>ครั้ง (visit)</small></div>
        <div class="note">${cases ? `เฉลี่ย ${(visits / cases).toFixed(1)} ครั้งต่อราย` : 'นับจากนัดที่กด "มาแล้ว"'}</div></div>
      <div class="dsum-cell"><div class="lb">จำนวนเคส</div><div class="num">${count(cases)}<small>ราย</small></div>
        <div class="note">${t.newCases !== undefined ? `รายใหม่ ${t.newCases} (${dashPct_(t.newCases, cases)}) รายเก่า ${t.returningCases} (${dashPct_(t.returningCases, cases)})` : ''}</div></div>
      <div class="dsum-cell"><div class="lb">มาตามนัด</div><div class="num">${rate === null ? '<span>-</span>' : count(rate) + '<small>%</small>'}</div>
        ${rate === null ? '<div class="note">ยังไม่มีข้อมูลเทียบ</div>' : `<div class="dmeter" role="img" aria-label="มาตามนัด ${rate}%"><i data-w="${rate}"></i></div>`}</div>
      <div class="dsum-cell"><div class="lb">ไม่มาตามนัด</div><div class="num">${count(t.noShow)}<small>นัด</small></div>
        <div class="note">${t.trackedPast ? `${dashPct_(t.noShow, t.trackedPast)} ของ ${dashNum_(t.trackedPast)} นัดที่ผ่านไปแล้ว` : 'ยังไม่มีข้อมูลเทียบ'}</div></div>
      <div class="dsum-cell"><div class="lb">นัดทั้งหมด</div><div class="num">${count(t.appointments)}<small>นัด</small></div>
        <div class="note">มารับบริการแล้ว ${dashPct_(t.attended, t.appointments)} ยังไม่ถึงวันนัด ${dashNum_(t.upcoming)} ยกเลิก ${dashNum_(t.cancelled)}</div></div>
    </div>
    <p class="dash-sub dnote">เคสและ visit นับจากนัดที่กด "มาแล้ว" เท่านั้น รายใหม่คือผู้ที่มารับบริการครั้งแรกในช่วงนี้ หน้านี้ไม่แสดงชื่อคนไข้
      <button type="button" class="link-btn" id="dashToPatientsBtn">ดูข้อมูลรายคน</button></p>
    <div id="dashCompareBox"></div>
    <div class="dsheet">
      <header><h3>จำนวนนัดและการมารับบริการ${d.granularity === 'day' ? 'รายวัน' : 'รายเดือน'}</h3><p class="dsub">หน่วยเป็นจำนวนนัด ชี้ที่แท่งเพื่อดูตัวเลข</p></header>
      <div class="dpad">
        <div class="dlegend"><span><i style="background:var(--d-bar-light)"></i>นัดทั้งหมด</span><span><i style="background:var(--d-bar-dark)"></i>มารับบริการแล้ว</span></div>
        <div id="dashTrend"></div>
      </div>
    </div>
    <div class="dcols">
      ${hasCases ? `
      <div class="dsheet"><header><h3>เคส / visit แยกตามประเภทนัด</h3></header><div class="dpad">
        <table class="mini-table">
          <thead><tr><th>ประเภท</th><th>เคส (ราย)</th><th>visit (ครั้ง)</th></tr></thead>
          <tbody>
            ${d.byType.map(r => `<tr><td>${esc_(r.name)}</td><td>${r.cases}</td><td>${r.attended}</td></tr>`).join('')}
            <tr class="mini-total"><td>รวม (เคสไม่นับซ้ำ)</td><td>${cases}</td><td>${visits}</td></tr>
          </tbody>
        </table></div></div>` : ''}
      ${hasCases && d.granularity === 'month' ? `
      <div class="dsheet"><header><h3>เคส / visit รายเดือน</h3><p class="dsub">เคสของแต่ละเดือนนับไม่ซ้ำภายในเดือนนั้น</p></header><div class="dpad">
        <table class="mini-table">
          <thead><tr><th>เดือน</th><th>เคส (ราย)</th><th>visit (ครั้ง)</th></tr></thead>
          <tbody>${d.trend.map(r => `<tr><td>${monthName(r.key)}</td><td>${r.cases}</td><td>${r.attended}</td></tr>`).join('')}</tbody>
        </table></div></div>` : ''}
      <div class="dsheet"><header><h3>แยกตามประเภทนัด</h3><p class="dsub">มารับบริการ / นัดทั้งหมด และร้อยละที่มา</p></header><div class="dpad">${dashHBars_(d.byType)}</div></div>
      <div class="dsheet"><header><h3>แยกตามคลินิก</h3><p class="dsub">มารับบริการ / นัดทั้งหมด และร้อยละที่มา</p></header><div class="dpad">${dashHBars_(d.byClinic, true)}</div></div>
      <div class="dsheet"><header><h3>แยกตามวันในสัปดาห์</h3><p class="dsub">มารับบริการ / นัดทั้งหมด และร้อยละที่มา</p></header><div class="dpad">${dashHBars_(d.byWeekday)}</div></div>
    </div>`;
}
/** แท่งแนวนอน: แท่งอ่อน = นัดทั้งหมด · แท่งเข้ม = มารับบริการแล้ว */
function dashHBars_(rows, useColor) {
  if (!rows || !rows.length) return '<div class="dash-empty">ไม่มีข้อมูลในช่วงนี้</div>';
  const max = Math.max(1, ...rows.map(r => r.total));
  const colorOk = c => /^#[0-9A-Fa-f]{3,8}$/.test(String(c || ''));
  return `<div class="dhb">${rows.map(r => `
      <span class="nm" title="${esc_(r.name)}">${esc_(r.name)}</span>
      <div class="tr"><i class="tot" data-w="${(r.total / max * 100).toFixed(1)}"></i><i class="att" data-w="${(r.attended / max * 100).toFixed(1)}"${useColor && colorOk(r.color) ? ` style="background:${r.color}"` : ''}></i></div>
      <span class="vl">${r.attended}<small>/ ${r.total}</small><em>${dashPct_(r.attended, r.total)}</em></span>`).join('')}</div>`;
}

/** กราฟแท่งแนวโน้ม: 2 แท่งต่อช่วง (นัดทั้งหมด / มารับบริการ) ชี้แล้วขึ้นตัวเลข มีตารางให้เปิดดู */
function dashTrendDraw_(d) {
  const host = document.getElementById('dashTrend');
  const trend = d.trend || [];
  if (!host) return;
  if (!trend.length || !trend.some(t => t.total)) { host.innerHTML = '<div class="dash-empty">ไม่มีนัดในช่วงนี้</div>'; return; }
  const day = d.granularity === 'day', n = trend.length;
  const W = 760, H = 250, L = 36, R = 8, T = 18, B = 28, ph = H - T - B, band = (W - L - R) / n;
  const bw = Math.max(2.5, Math.min(16, band * 0.36)), gap = bw >= 6 ? 2 : 1;
  const rawMax = Math.max(1, ...trend.map(t => t.total));
  const stepY = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => s * 4 >= rawMax) || Math.ceil(rawMax / 4);
  const maxY = stepY * 4, y = v => T + ph - v / maxY * ph;
  const label = k => day ? String(Number(k.slice(8))) : THAI_MONTH_SHORT[Number(k.slice(5, 7)) - 1];
  const full = k => day ? fmtThaiDate_(k) : `${THAI_MONTH_SHORT[Number(k.slice(5, 7)) - 1]} ${Number(k.slice(0, 4)) + 543}`;
  const every = Math.ceil(n / 16);
  const svg = dashEl_('svg', { class: 'dtrend', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'กราฟแท่งจำนวนนัดทั้งหมดและที่มารับบริการ' + (day ? 'รายวัน' : 'รายเดือน') });
  for (let i = 0; i <= 4; i++) {
    svg.appendChild(dashEl_('line', { class: 'grid', x1: L, x2: W - R, y1: y(stepY * i), y2: y(stepY * i) }));
    svg.appendChild(dashEl_('text', { class: 'ax', x: L - 8, y: y(stepY * i) + 4, 'text-anchor': 'end' }, String(stepY * i)));
  }
  const peak = trend.reduce((best, t, i) => t.attended > trend[best].attended ? i : best, 0);
  const bar = (x, v, cls, delay) => {
    const top = y(v), r = Math.min(4, bw / 2, (y(0) - top));
    const p = dashEl_('path', { class: 'bar ' + cls, d: v > 0 ? `M${x} ${y(0)}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${y(0)}Z` : '' });
    p.style.transitionDelay = delay + 'ms';
    return p;
  };
  const stagger = Math.min(35, 420 / n);
  const bands = [];
  trend.forEach((t, i) => {
    const x0 = L + band * i, cx = x0 + band / 2;
    const rect = dashEl_('rect', { class: 'band', x: x0 + 0.5, y: T - 8, width: Math.max(1, band - 1), height: ph + 8, rx: 5, role: 'img', 'aria-label': `${full(t.key)} นัดทั้งหมด ${t.total} มารับบริการ ${t.attended}` });
    if (n <= 16) rect.setAttribute('tabindex', '0');
    bands.push(rect);
    svg.appendChild(bar(cx - bw - gap / 2, t.total, 'tot', i * stagger));
    svg.appendChild(bar(cx + gap / 2, t.attended, 'att', i * stagger + 60));
    if (i % every === 0) svg.appendChild(dashEl_('text', { class: 'ax', x: cx, y: H - 8, 'text-anchor': 'middle' }, label(t.key)));
    if (i === peak && t.attended > 0) svg.appendChild(dashEl_('text', { class: 'peak', x: cx + gap / 2 + bw / 2, y: y(t.attended) - 6, 'text-anchor': 'middle' }, String(t.attended)));
    dashHover_(rect, () => [full(t.key), [
      { label: 'นัดทั้งหมด', value: t.total + ' นัด', color: dashCss_('--d-bar-light') },
      { label: 'มารับบริการ', value: t.attended + ' ครั้ง', color: dashCss_('--d-s3') },
      { label: 'มาตามนัด', value: t.total ? Math.round(t.attended / t.total * 100) + '%' : '-' }]],
    () => rect.classList.add('on'), () => rect.classList.remove('on'));
  });
  bands.forEach(b => svg.insertBefore(b, svg.firstChild));
  host.textContent = '';
  host.appendChild(svg);
  const det = dashH_('details', 'dtbl'), tbl = dashH_('table', 'dtbl-table'), wrap = dashH_('div', 'table-scroll');
  det.appendChild(dashH_('summary', '', 'ดูเป็นตาราง'));
  const head = dashH_('tr');
  [day ? 'วันที่' : 'เดือน', 'นัดทั้งหมด', 'มารับบริการ', 'มาตามนัด'].forEach(x => head.appendChild(dashH_('th', '', x)));
  const thead = dashH_('thead'); thead.appendChild(head); tbl.appendChild(thead);
  const tb = dashH_('tbody');
  trend.forEach(t => { const r = dashH_('tr'); [full(t.key), t.total, t.attended, t.total ? Math.round(t.attended / t.total * 100) + '%' : '-'].forEach(x => r.appendChild(dashH_('td', '', String(x)))); tb.appendChild(r); });
  tbl.appendChild(tb); wrap.appendChild(tbl); det.appendChild(wrap); host.appendChild(det);
}

/* ---------------- มุมมอง 2: แผนที่ตำบล ---------------- */
/** ช่อง "หมู่" เป็นข้อความที่พิมพ์เอง: เลข 1-12 = หมู่ในตำบลบ้านกร่าง · ว่าง = ไม่ระบุ · นอกนั้น = นอกตำบล/อื่น ๆ */
function dashMooIndex_(name) {
  const s = String(name === undefined || name === null ? '' : name).trim();
  if (!s || s === 'ไม่ระบุ') return 'none';
  const m = /^(?:หมู่ที่|หมู่|ม\.)?\s*0*(\d{1,2})$/.exec(s);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= DASH_MAP.cells.length ? n - 1 : 'out';
}
function dashMooData_(d, list) {
  const n = DASH_MAP.cells.length, zero = () => Array.from({ length: n }, () => 0);
  const out = { hasCases: (d.byMoo || []).some(m => m.cases !== undefined), visits: zero(), cases: zero(), outside: { visits: 0, cases: 0 }, none: { visits: 0, cases: 0 }, others: [] };
  (list || d.byMoo || []).forEach(m => {
    const i = dashMooIndex_(m.name), v = Number(m.attended) || 0, c = Number(m.cases) || 0;
    if (i === 'none') { out.none.visits += v; out.none.cases += c; }
    else if (i === 'out') { out.outside.visits += v; out.outside.cases += c; if (v) out.others.push({ name: String(m.name), visits: v }); }
    else { out.visits[i] += v; out.cases[i] += c; }
  });
  return out;
}
function dashMapHtml_() {
  return `
    <div class="dsheet"><div class="dmapgrid">
      <div class="dmapbox">
        ${DASH_MAP.schematic ? '<div class="dribbon">แผนผังจำลอง รูปร่างและตำแหน่งหมู่ยังไม่ตรงพื้นที่จริง</div>' : ''}
        <svg class="dmap" id="dashMap" viewBox="${DASH_MAP.viewBox}" role="group" aria-label="แผนที่ตำบลบ้านกร่าง ระบายสีตามจำนวนผู้มารับบริการ ขอบสีทองคือเขตรับผิดชอบ"></svg>
        <div class="dramp"><span>น้อย</span><span class="steps">${DASH_RAMP.map(r => `<i style="background:var(${r})"></i>`).join('')}</span><span>มาก</span><span id="dashRampNote"></span>
          <span class="dcatchkey"><i></i>ขอบสีทอง คือเขตรับผิดชอบ หมู่ ${DASH_CATCHMENT.join(', ')}</span></div>
      </div>
      <div class="dmapside">
        <div class="dmaphead"><h3>ความถี่การมารับบริการ</h3>
          <span class="dseg" id="dashMetric"><button type="button" data-m="visits" aria-pressed="true">ครั้ง (visit)</button><button type="button" data-m="cases" aria-pressed="false">เคส (ราย)</button></span></div>
        <label class="ddx hidden" id="dashDxWrap">กรองตามโรค (ICD-10)
          <select id="dashDx"><option value="">ทุกโรค</option></select></label>
        <div class="dreadout" id="dashReadout" aria-live="polite"></div>
        <div class="dshare" id="dashShare"></div>
        <div class="drank" id="dashRank"></div>
        <p class="dsub" id="dashMooNote"></p>
      </div>
    </div></div>`;
}
function dashMapDraw_(d) {
  const svg = document.getElementById('dashMap');
  if (!svg) return;
  // ตัวกรองโรค: ข้อมูลรายโรคมากับคำตอบเดียวกันแล้ว เลือกปุ๊บแผนที่เปลี่ยนทันที ไม่ต้องโหลดใหม่
  const dxList = d.byMooIcd || [], dxSel = document.getElementById('dashDx');
  if (!dxList.some(x => x.code === DASH.dx)) DASH.dx = '';
  dxList.forEach(x => { const o = dashH_('option', '', `${x.code}${x.label ? ' ' + x.label : ''} (${x.visits} ครั้ง)`); o.value = x.code; dxSel.appendChild(o); });
  dxSel.value = DASH.dx;
  document.getElementById('dashDxWrap').classList.toggle('hidden', !dxList.length);
  const pick = () => { const dx = dxList.find(x => x.code === DASH.dx); return dashMooData_(d, dx ? dx.byMoo : null); };
  let moo = DASH.moo = pick();
  if (!moo.hasCases) DASH.metric = 'visits';
  const seg = document.getElementById('dashMetric');
  seg.classList.toggle('hidden', !moo.hasCases);
  const inCatch = i => DASH_CATCHMENT.indexOf(i + 1) !== -1;
  const unit = () => DASH.metric === 'visits' ? 'ครั้ง' : 'ราย';
  const reduce = dashReduce_();
  let active = -1, lastShown = 0, rows = [];

  if (DASH_MAP.river) {
    svg.appendChild(dashEl_('path', { class: 'river', d: DASH_MAP.river }));
    if (DASH_MAP.riverLabel) svg.appendChild(dashEl_('text', { class: 'rv', x: DASH_MAP.riverLabel[0], y: DASH_MAP.riverLabel[1], transform: `rotate(80 ${DASH_MAP.riverLabel[0]} ${DASH_MAP.riverLabel[1]})` }, 'แม่น้ำน่าน'));
  }
  DASH_MAP.cells.forEach(c => svg.appendChild(dashEl_('path', { class: 'edge', d: c.d })));
  const cells = DASH_MAP.cells.map((c, i) => {
    const p = dashEl_('path', { class: 'cell', d: c.d, tabindex: 0, role: 'img' });
    p.style.transitionDelay = (reduce ? 0 : i * 45) + 'ms';
    svg.appendChild(p);
    return p;
  });
  // ขอบเขตรับผิดชอบ = วงแหวนรอบพื้นที่รวมของหมู่ในเขต (ขยายพื้นที่รวมออก แล้วเจาะตัวพื้นที่ทิ้ง เหลือแต่ขอบนอก)
  const catchCells = DASH_CATCHMENT.map(k => DASH_MAP.cells[k - 1]).filter(Boolean);
  if (catchCells.length) {
    const defs = dashEl_('defs', {}), mask = dashEl_('mask', { id: 'dashCatchMask', maskUnits: 'userSpaceOnUse', x: -20, y: -20, width: 640, height: 600 });
    catchCells.forEach(c => mask.appendChild(dashEl_('path', { d: c.d, fill: '#fff', stroke: '#fff', 'stroke-width': 10, 'stroke-linejoin': 'round' })));
    catchCells.forEach(c => mask.appendChild(dashEl_('path', { d: c.d, fill: '#000', stroke: '#000', 'stroke-width': 1.5, 'stroke-linejoin': 'round' })));
    defs.appendChild(mask); svg.appendChild(defs);
    svg.appendChild(dashEl_('rect', { class: 'catch', x: -20, y: -20, width: 640, height: 600, mask: 'url(#dashCatchMask)' }));
  }
  const hi = dashEl_('path', { class: 'hi', d: '' });
  svg.appendChild(hi);
  // ป้ายบนแผนที่: วงกลม = เลขหมู่ · ตัวเลขใต้วงกลม = จำนวนผู้มารับบริการของหมู่นั้น (เห็นได้โดยไม่ต้องชี้)
  const values = [];
  const badges = DASH_MAP.cells.map((c, i) => {
    const g = dashEl_('g', { class: 'badge' + (inCatch(i) ? ' in' : ''), transform: `translate(${c.c[0]} ${c.c[1] - 7})` }), inner = dashEl_('g', {});
    inner.appendChild(dashEl_('circle', { r: 11 })); inner.appendChild(dashEl_('text', {}, String(i + 1)));
    const val = dashEl_('text', { class: 'val', y: 25 }, '0');
    values.push(val);
    g.appendChild(inner); g.appendChild(val); svg.appendChild(g);
    return inner;
  });
  const home = DASH_MAP.cells[DASH_HOME_MOO - 1];
  if (home) {
    const px = home.c[0] + 34, py = home.c[1] - 26;
    svg.appendChild(dashEl_('circle', { class: 'pulse', cx: px, cy: py, r: 7 }));
    svg.appendChild(dashEl_('circle', { class: 'pin', cx: px, cy: py, r: 6 }));
    svg.appendChild(dashEl_('text', { class: 'pinlb', x: px + 11, y: py + 4 }, 'รพ.สต.'));
  }

  const sumAll = m => moo[m].reduce((a, b) => a + b, 0) + moo.outside[m] + moo.none[m];
  const readout = document.getElementById('dashReadout'), rank = document.getElementById('dashRank');
  function focusMoo(i, force) {
    if (i === active && !force) return;
    active = i;
    cells.forEach((p, k) => { p.style.opacity = i === -1 || k === i ? '' : '.55'; });
    badges.forEach((b, k) => b.classList.toggle('on', k === i));
    rows.forEach((r, k) => { if (r) r.classList.toggle('on', k === i); });
    hi.classList.toggle('on', i !== -1);
    if (i !== -1) hi.setAttribute('d', DASH_MAP.cells[i].d);
    const total = sumAll(DASH.metric), v = i === -1 ? total : moo[DASH.metric][i];
    readout.textContent = '';
    const dxNow = dxList.find(x => x.code === DASH.dx);
    const where = dashH_('div', 'where', i === -1 ? (dxNow ? `${dxNow.code}${dxNow.label ? ' ' + dxNow.label : ''}` : 'ทั้งตำบลและนอกเขต') : `หมู่ ${i + 1} ${DASH_MOO_NAMES[i] || ''}`);
    where.appendChild(dashH_('small', '', i === -1 ? 'เลื่อนเมาส์หรือแตะที่หมู่เพื่อดูรายละเอียด' : (inCatch(i) ? 'อยู่ในเขตรับผิดชอบ' : 'นอกเขตรับผิดชอบ มารับบริการเป็นครั้งคราว')));
    const big = dashH_('div', 'big'), num = dashH_('span', '', dashNum_(v));
    big.appendChild(num); big.appendChild(dashH_('small', '', unit()));
    readout.appendChild(where); readout.appendChild(big);
    readout.appendChild(dashH_('div', 'more', i === -1 ? `${fmtThaiDate_(d.from)} ถึง ${fmtThaiDate_(d.to)}`
      : (total ? `คิดเป็น ${(v / total * 100).toFixed(1)}% ของทั้งหมด` : '') + (moo.hasCases ? ` (${moo.cases[i]} ราย ${moo.visits[i]} ครั้ง)` : '')));
    dashTween_(num, v, 0, lastShown); lastShown = v;
  }
  function paint() {
    const data = moo[DASH.metric], max = Math.max(0, ...data), all = sumAll(DASH.metric);
    const stepOf = v => v <= 0 ? -1 : Math.min(DASH_RAMP.length - 1, Math.floor(v / (max + 0.0001) * DASH_RAMP.length));
    const colorOf = v => stepOf(v) < 0 ? dashCss_('--d-s0') : dashCss_(DASH_RAMP[stepOf(v)]);
    values.forEach((t, i) => t.classList.toggle('dark', stepOf(data[i]) >= 3));
    cells.forEach((p, i) => { p.setAttribute('fill', colorOf(data[i])); p.setAttribute('aria-label', `หมู่ ${i + 1} ${DASH_MOO_NAMES[i] || ''} ${data[i]} ${unit()}`); });
    values.forEach((t, i) => { const prev = Number(t.dataset.v || 0); t.dataset.v = data[i]; dashTween_(t, data[i], 0, prev); });
    document.getElementById('dashRampNote').textContent = (max ? `สูงสุด ${dashNum_(max)} ${unit()}` : 'ช่วงนี้ยังไม่มีผู้มารับบริการ') + ' ตัวเลขบนแผนที่คือจำนวน' + (DASH.metric === 'visits' ? 'ครั้งที่มารับบริการ' : 'ราย');
    // ผู้มารับบริการมาจากไหน
    const share = document.getElementById('dashShare');
    share.textContent = '';
    if (all) {
      const inC = DASH_CATCHMENT.reduce((t, k) => t + (data[k - 1] || 0), 0), outT = moo.outside[DASH.metric] + moo.none[DASH.metric], other = all - inC - outT;
      share.appendChild(dashH_('div', 'ttl', 'ผู้มารับบริการมาจากไหน'));
      const st = dashH_('div', 'dstack'), kv = dashH_('div', 'dkv');
      [[`ในเขตรับผิดชอบ หมู่ ${DASH_CATCHMENT.join(', ')}`, inC, '--d-s5'], ['หมู่อื่นในตำบลบ้านกร่าง', other, '--d-s3'], ['นอกตำบลและไม่ระบุหมู่', outT, '--d-s1']].forEach(p => {
        const sg = dashH_('i'); sg.style.background = `var(${p[2]})`; sg.dataset.w = (p[1] / all * 100).toFixed(2); st.appendChild(sg);
        const k = dashH_('i'); k.style.background = `var(${p[2]})`; kv.appendChild(k); kv.appendChild(dashH_('span', '', p[0]));
        const val = dashH_('b', '', `${dashNum_(p[1])} ${unit()}`); val.appendChild(dashH_('em', '', Math.round(p[1] / all * 100) + '%')); kv.appendChild(val);
      });
      st.setAttribute('role', 'img'); st.setAttribute('aria-label', `ในเขตรับผิดชอบ ${inC} หมู่อื่นในตำบล ${other} นอกตำบลและไม่ระบุ ${outT}`);
      share.appendChild(st); share.appendChild(kv);
    }
    // อันดับรายหมู่ (ใช้เป็นตารางข้อมูลของแผนที่ด้วย)
    rank.textContent = ''; rows = [];
    data.map((v, i) => ({ i: i, v: v })).sort((a, b) => (b.v - a.v) || (a.i - b.i)).forEach(r => {
      const rw = dashH_('div', 'rw'); rw.tabIndex = 0;
      const nm = dashH_('span', inCatch(r.i) ? '' : 'out'); if (inCatch(r.i)) nm.appendChild(dashH_('i')); nm.appendChild(document.createTextNode('หมู่ ' + (r.i + 1))); rw.appendChild(nm);
      const tr = dashH_('div', 'tr'), bar = dashH_('i'); bar.dataset.w = max ? (r.v / max * 100).toFixed(1) : '0'; tr.appendChild(bar); rw.appendChild(tr);
      const val = dashH_('b', '', dashNum_(r.v)); val.appendChild(dashH_('em', '', all ? Math.round(r.v / all * 100) + '%' : '')); rw.appendChild(val);
      rw.addEventListener('pointerenter', () => focusMoo(r.i)); rw.addEventListener('pointerleave', () => focusMoo(-1));
      rw.addEventListener('focus', () => focusMoo(r.i)); rw.addEventListener('blur', () => focusMoo(-1));
      rank.appendChild(rw); rows[r.i] = rw;
    });
    const note = document.getElementById('dashMooNote');
    note.textContent = moo.others.length ? 'นับเป็นนอกตำบลเพราะช่องหมู่ไม่ใช่เลข 1 ถึง 12: ' + moo.others.slice(0, 8).map(o => `"${o.name}" ${o.visits} ครั้ง`).join(', ') + (moo.others.length > 8 ? ' และอื่น ๆ' : '')
      : 'ช่องหมู่ที่เป็นเลข 1 ถึง 12 นับเป็นหมู่ในตำบลบ้านกร่าง ถ้าคนไข้อยู่นอกตำบล ให้พิมพ์ชื่อตำบลในช่องหมู่ตอนลงนัด';
    if (!document.querySelector('#dashBody .dpanel[data-tab="map"]').hidden) {
      requestAnimationFrame(() => document.querySelectorAll('#dashRank [data-w], #dashShare [data-w]').forEach(b => { b.style.width = b.dataset.w + '%'; }));
    }
    focusMoo(active, true);
  }
  cells.forEach((p, i) => dashHover_(p, () => [`หมู่ ${i + 1} ${DASH_MOO_NAMES[i] || ''}`, [{ label: 'มารับบริการ', value: moo.visits[i] + ' ครั้ง' }]
    .concat(moo.hasCases ? [{ label: 'จำนวนเคส', value: moo.cases[i] + ' ราย' }] : []).concat([{ label: 'สัดส่วนของทั้งหมด', value: dashPct_(moo[DASH.metric][i], sumAll(DASH.metric)) }]).concat([{ label: 'เขตรับผิดชอบ', value: inCatch(i) ? 'ใช่' : 'ไม่ใช่' }])],
  () => focusMoo(i), () => focusMoo(-1)));
  dxSel.addEventListener('change', () => { DASH.dx = dxSel.value; moo = DASH.moo = pick(); paint(); });
  seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === DASH.metric)));
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    DASH.metric = b.dataset.m;
    seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  });
  paint();
}

/* ---------------- ปวดก่อน-หลังรักษา: เทา = ก่อน · เขียว = หลัง · จุด = ค่าเฉลี่ย · เส้น = ต่ำสุดถึงสูงสุด ---------------- */
function dashPainHtml_(pain) {
  const head = '<header><h3>ระดับความปวด ก่อนและหลังรักษา</h3><p class="dsub">NRS 0 ถึง 10 ยิ่งน้อยยิ่งดี จุดคือค่าเฉลี่ย เส้นคือช่วงต่ำสุดถึงสูงสุด แยกตามการวินิจฉัย</p></header>';
  if (pain === undefined) return ''; // หลังบ้านรุ่นก่อน: ยังไม่มีข้อมูลส่วนนี้
  if (!pain || !pain.all) {
    return `<div class="dsheet">${head}<div class="dpad dash-empty">ช่วงนี้ยังไม่มีเวชระเบียนที่กรอก NRS ทั้งก่อนและหลังรักษา (แบบแรกรับ: ท้ายส่วน Intervention · Progress note: ส่วน S และ A)</div></div>`;
  }
  const a = pain.all;
  const fmt = v => Number(v).toFixed(1);
  const change = g => g.drop > 0 ? `ลดลง ${fmt(g.drop)} คะแนน${g.pct !== null ? ` (${g.pct.toFixed(0)}%)` : ''}` : (g.drop < 0 ? `เพิ่มขึ้น ${fmt(-g.drop)} คะแนน` : 'ไม่เปลี่ยน');
  const rows = [a].concat(pain.groups.length > 1 || (pain.groups[0] && pain.groups[0].name !== 'ไม่ระบุการวินิจฉัย') ? pain.groups : []);
  const W = 760, L = 200, R = 178, T = 12, rowH = 54, H = T + rowH * rows.length + 30, x = v => L + (W - L - R) * v / 10;
  let svg = '';
  for (let v = 0; v <= 10; v += 2) {
    svg += `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + rowH * rows.length}"/><text class="ax" x="${x(v)}" y="${T + rowH * rows.length + 18}" text-anchor="middle">${v}</text>`;
  }
  rows.forEach((g, i) => {
    const cy = T + rowH * i + rowH / 2, y1 = cy - 9, y2 = cy + 9;
    const lane = (s, y, cls, label) => `<line class="rng ${cls}" x1="${x(s.min)}" x2="${x(s.max)}" y1="${y}" y2="${y}"/><circle class="avg ${cls}" cx="${x(s.avg)}" cy="${y}" r="6.5"/>
      <text class="lv" x="${W - R + 14}" y="${y + 4}"><tspan class="b">${label} ${fmt(s.avg)}</tspan> (${s.min} ถึง ${s.max})</text>`;
    svg += `${i ? `<line class="sep" x1="0" x2="${W}" y1="${T + rowH * i}" y2="${T + rowH * i}"/>` : ''}
      <text class="nm${i ? '' : ' all'}" x="0" y="${cy - 4}">${esc_(g.name.length > 24 ? g.name.slice(0, 23) + '…' : g.name)}</text>
      <text class="n" x="0" y="${cy + 14}">${g.n} ราย ${change(g)}</text>
      ${lane(g.pre, y1, 'pre', 'ก่อน')}${lane(g.post, y2, 'post', 'หลัง')}
      <rect class="hit" x="0" y="${T + rowH * i}" width="${W}" height="${rowH}" data-i="${i}"><title>${esc_(g.name)}: ${g.n} ราย ปวดลดลง ${g.improved} เท่าเดิม ${g.same} เพิ่มขึ้น ${g.worse}</title></rect>`;
  });
  return `<div class="dsheet">${head}
    <div class="dsum dsum-4 dsum-in">
      <div class="dsum-cell"><div class="lb"><i class="dot pre"></i>ก่อนรักษา เฉลี่ย</div><div class="num"><span data-count="${a.pre.avg}" data-dec="1">${fmt(a.pre.avg)}</span><small>จาก 10</small></div><div class="note">ต่ำสุด ${a.pre.min} สูงสุด ${a.pre.max}</div></div>
      <div class="dsum-cell"><div class="lb"><i class="dot post"></i>หลังรักษา เฉลี่ย</div><div class="num"><span data-count="${a.post.avg}" data-dec="1">${fmt(a.post.avg)}</span><small>จาก 10</small></div><div class="note">ต่ำสุด ${a.post.min} สูงสุด ${a.post.max}</div></div>
      <div class="dsum-cell"><div class="lb">ความปวด${a.drop < 0 ? 'เพิ่มขึ้น' : 'ลดลง'}เฉลี่ย</div><div class="num">${a.pct === null ? '<span>-</span>' : `<span data-count="${Math.abs(a.pct)}" data-dec="1">${Math.abs(a.pct).toFixed(1)}</span><small>%</small>`}</div><div class="note">${fmt(Math.abs(a.drop))} คะแนน จาก ${a.n} ราย</div></div>
      <div class="dsum-cell"><div class="lb">ผู้ที่ปวดลดลงหลังรักษา</div><div class="num"><span data-count="${Math.round(a.improved / a.n * 100)}">${Math.round(a.improved / a.n * 100)}</span><small>%</small></div><div class="note">${a.improved} จาก ${a.n} ราย เท่าเดิม ${a.same} เพิ่มขึ้น ${a.worse}</div></div>
    </div>
    <div class="dpad">
      <div class="dlegend"><span><i class="dot" style="background:var(--d-pre)"></i>ก่อนรักษา</span><span><i class="dot" style="background:var(--d-bar-dark)"></i>หลังรักษา</span></div>
      <div class="dpain-scroll"><svg class="dpain" viewBox="0 0 ${W} ${H}" role="img" aria-label="ระดับความปวดเฉลี่ยก่อนรักษา ${fmt(a.pre.avg)} หลังรักษา ${fmt(a.post.avg)} จาก ${a.n} ราย">${svg}</svg></div>
    </div></div>`;
}

/* ---------------- มุมมอง 3: ผลลัพธ์การรักษา (จากเวชระเบียน โหลดเมื่อเปิดแท็บ) ---------------- */
async function dashLoadOutcomes_() {
  const d = DASH.data, host = document.getElementById('dashOut');
  if (!d || !host) return;
  const key = d.from + '|' + d.to;
  if (DASH.outKey === key) return;
  DASH.outKey = key;
  const req = ++DASH.outReq;
  host.className = 'dash-empty'; host.textContent = 'กำลังโหลด...';
  const res = await api('getOutcomes', { from: d.from, to: d.to });
  if (req !== DASH.outReq || !document.getElementById('dashOut')) return; // เปลี่ยนช่วงเวลาหรือออกจากหน้าไปแล้ว
  if (!res.ok) {
    DASH.outKey = '';
    host.textContent = /Unknown action|ไม่รู้จัก/i.test(String(res.error)) ? 'หลังบ้าน (Apps Script) ยังเป็นรุ่นเก่า ยังไม่มีสถิติผลลัพธ์จากเวชระเบียน — วาง Code.gs ชุดใหม่แล้วอัปเดตเว็บแอปเป็นเวอร์ชันใหม่' : 'โหลดไม่สำเร็จ: ' + res.error;
    return;
  }
  host.className = '';
  host.innerHTML = dashOutcomesHtml_(res.data);
  if (DASH.tab === 'out') dashAnimate_(host.closest('.dpanel'));
  dashLoadFinance_(d, host, req);
}
/** รายรับแยกสิทธิ์การรักษา (นับจากนัดที่กด "มาแล้ว" ในช่วงที่เลือก) — หลังบ้านรุ่นเก่าไม่มี = ไม่แสดง */
async function dashLoadFinance_(d, host, req) {
  const res = await api('getFinance', { from: d.from, to: d.to });
  if (req !== DASH.outReq || !res.ok || !document.body.contains(host)) return;
  const f = res.data, baht = v => Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const rows = f.rights.filter(g => g.visits || g.rate).map(g => `<tr><td>${esc_(g.name)}</td><td>${g.patients}</td><td>${g.visits}</td><td>${g.rate ? baht(g.rate) : '-'}</td><td>${g.rate ? baht(g.revenue) : '-'}</td></tr>`).join('');
  const html = `<div class="dsheet"><header><h3>รายรับแยกสิทธิ์การรักษา</h3><p class="dsub">นับจากนัดที่กด "มาแล้ว" ในช่วงนี้ รายรับ = จำนวนครั้ง × รายรับต่อครั้งที่ตั้งไว้ในหน้าตั้งค่า</p></header>
    <div class="dpad">${f.visits ? `<div class="table-scroll"><table class="mini-table"><thead><tr><th>สิทธิ์</th><th>ผู้ป่วย (ราย)</th><th>ครั้งที่มา</th><th>บาท/ครั้ง</th><th>รายรับ (บาท)</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr class="fin-total"><td>รวม</td><td></td><td>${f.visits}</td><td></td><td>${baht(f.revenue)}</td></tr></tfoot></table></div>${f.unset ? '<div class="note">มีสิทธิ์ที่ยังไม่ได้ตั้งรายรับต่อครั้ง หรือคนไข้ที่ยังไม่ระบุสิทธิ์ — ไม่ถูกนับเป็นรายรับ</div>' : ''}` : '<div class="dash-empty">ช่วงนี้ยังไม่มีนัดที่กด "มาแล้ว"</div>'}</div></div>`;
  host.insertAdjacentHTML('beforeend', html);
}
/** 5 อันดับการวินิจฉัย และหัตถการที่ให้บ่อย (หลังบ้านรุ่นก่อน 2026-10-16a ไม่ส่งมา = ไม่แสดง) */
function dashDxProcHtml_(o) {
  if (!o.dx && !o.procedures) return '';
  const w = o.wait;
  const wait = w && w.n ? `<div class="dsheet dsum dsum-3">
      <div class="dsum-cell"><div class="lb">ระยะรอคอยเฉลี่ย (consult ถึงรับบริการ)</div><div class="num"><span data-count="${w.avg}" data-dec="1">${w.avg.toFixed(1)}</span><small>วัน</small></div><div class="note">จาก ${w.n} ราย ที่กรอกวันที่ consult</div></div>
      <div class="dsum-cell"><div class="lb">ได้รับบริการภายใน 7 วัน</div><div class="num"><span data-count="${w.within7}">${w.within7}</span><small>ราย</small></div><div class="note">${dashPct_(w.within7, w.n)} ของ ${w.n} ราย</div></div>
      <div class="dsum-cell"><div class="lb">รอสั้นสุด / นานสุด</div><div class="num">${w.min}<small>ถึง</small>${w.max}<small>วัน</small></div></div>
    </div>` : '';
  const bars = (rows, of) => rows && rows.length ? `<div class="dhb dhb-wide">${rows.map((r, i) => `
      <span class="nm" title="${esc_(r.name)}">${i + 1}. ${esc_(r.name)}</span>
      <div class="tr"><i class="att" data-w="${(r.n / Math.max(1, rows[0].n) * 100).toFixed(1)}"></i></div>
      <span class="vl">${r.n}<small>${of}</small><em>${r.pct === null ? '' : r.pct.toFixed(r.pct % 1 ? 1 : 0) + '%'}</em></span>`).join('')}</div>` : '<div class="dash-empty">ช่วงนี้ยังไม่มีข้อมูล</div>';
  const dx = o.dx || { medical: [], pt: [] };
  return `${wait}<div class="dcols">
      <div class="dsheet"><header><h3>5 อันดับโรค</h3><p class="dsub">Medical diagnosis จากแบบประเมินครั้งแรก ${o.records} ฉบับ (1 ฉบับมีได้หลายโรค)</p></header>
        <div class="dpad">${bars(dx.medical, 'ราย')}${dx.pt && dx.pt.length ? `<p class="dsub" style="margin:14px 0 6px">PT diagnosis</p>${bars(dx.pt, 'ราย')}` : ''}</div></div>
      <div class="dsheet"><header><h3>หัตถการที่ให้</h3><p class="dsub">จำนวนครั้งที่มารักษาที่ได้รับหัตถการนั้น จาก ${o.records + (o.notes || 0)} ครั้ง (แรกรับ + Progress note)</p></header>
        <div class="dpad">${bars(o.procedures, 'ครั้ง')}</div></div>
    </div>`;
}
function dashOutcomesHtml_(o) {
  const note = '<div class="dinfo">ตัวเลขในแท็บนี้มาจากเวชระเบียนที่กดบันทึกแล้ว ค่าแรกรับ (ระดับปวด ผลทดสอบสมรรถภาพ Barthel EQ-5D) นับจากแบบประเมินครั้งแรก ส่วนปวดก่อนและหลังรักษานับทุกครั้งที่มารักษา รวม Progress note</div>';
  if (!o.records && !o.notes) {
    return `${note}<div class="dsheet"><div class="dpad dash-empty">ช่วงนี้ยังไม่มีเวชระเบียนที่บันทึกแล้ว${o.drafts ? ` (มีฉบับร่าง ${o.drafts} ฉบับ ยังไม่ถูกนับ)` : ''}</div></div>`;
  }
  const fig = (v, n, unitText, dec) => v === null || v === undefined ? '<div class="dfig"><span>-</span></div><div class="note">ยังไม่มีข้อมูล</div>'
    : `<div class="dfig"><span data-count="${v}" data-dec="${dec}">${Number(v).toFixed(dec)}</span><small>${unitText}</small></div><div class="note">จาก ${n} ราย</div>`;
  const nrsCell = (title, x) => `<div class="dsum-cell"><div class="lb">${title}</div>${fig(x.avg, x.n, 'จาก 10', 1)}${x.avg === null ? '' : `<div class="dmeter" role="img" aria-label="${x.avg} จาก 10"><i data-w="${(x.avg * 10).toFixed(1)}"></i></div>${x.min !== null && x.min !== undefined ? `<div class="note">ต่ำสุด ${x.min} สูงสุด ${x.max}</div>` : ''}`}</div>`;
  const tests = o.tests.slice().sort((a, b) => (b.tested - b.noCriterion ? b.below / (b.tested - b.noCriterion) : -1) - (a.tested - a.noCriterion ? a.below / (a.tested - a.noCriterion) : -1));
  const testRows = tests.map(t => {
    const judged = t.tested - t.noCriterion;
    return `<span class="nm" title="${esc_(t.name)}">${esc_(t.name)}</span>
      <div class="tr">${judged ? `<i class="att" data-w="${(t.below / judged * 100).toFixed(1)}"></i>` : ''}</div>
      <span class="vl">${judged ? `${t.below}<small>จาก ${judged} ราย</small><em>${dashPct_(t.below, judged)}</em>` : `<small>ทดสอบ ${t.tested} ราย ยังไม่มีเกณฑ์</small>`}</span>`;
  }).join('');
  const statRows = o.tests.slice().sort((x, y) => (x.name < y.name ? -1 : 1)).map(t => `<tr><td>${esc_(t.name)}</td><td>${esc_(t.unit || '')}</td><td class="num">${t.tested}</td><td class="num"><b>${Number(t.avg).toFixed(Number(t.avg) % 1 ? 1 : 0)}</b></td><td class="num">${t.max}</td><td class="num">${t.min}</td></tr>`).join('');
  const statPanel = statRows ? `<div class="dsheet"><header><h3>ค่าเฉลี่ย สูงสุด ต่ำสุด ของแต่ละแบบทดสอบ</h3><p class="dsub">คิดจากทุกค่าที่ทดสอบในช่วงนี้ แยกจากตารางจำนวนรายที่ต่ำกว่าเกณฑ์ด้านบน (ค่าสูงหรือต่ำไม่ได้แปลว่าดีหรือแย่เสมอไป ขึ้นกับแบบทดสอบ เช่น เวลายิ่งน้อยยิ่งดี)</p></header>
        <div class="dpad"><div class="table-scroll"><table class="mini-table"><thead><tr><th>แบบทดสอบ</th><th>หน่วย</th><th>ทดสอบ (ราย)</th><th>ค่าเฉลี่ย</th><th>สูงสุด</th><th>ต่ำสุด</th></tr></thead><tbody>${statRows}</tbody></table></div></div></div>` : '';
  const b = o.barthel, parts = [['ติดสังคม (12 ถึง 20 คะแนน)', b.social, '--d-s5'], ['ติดบ้าน (5 ถึง 11 คะแนน)', b.home, '--d-s3'], ['ติดเตียง (0 ถึง 4 คะแนน)', b.bed, '--d-s1']];
  return `${note}
    <div class="dsheet dsum dsum-3">
      <div class="dsum-cell hero"><div class="lb">แบบประเมินครั้งแรกที่บันทึกแล้ว</div><div class="num"><span data-count="${o.records}">${o.records}</span><small>ฉบับ</small></div>
        <div class="note">${o.notes ? `Progress note อีก ${o.notes} ฉบับ · ` : ''}จาก ${o.patients} ราย${o.drafts ? ` มีฉบับร่างอีก ${o.drafts} ฉบับที่ยังไม่ถูกนับ` : ''}</div></div>
      ${nrsCell('ระดับปวดแรกรับ ขณะพัก (NRS เฉลี่ย)', o.nrs.rest)}
      ${nrsCell('ระดับปวดแรกรับ ขณะใช้งาน (NRS เฉลี่ย)', o.nrs.func)}
    </div>
    ${dashPainHtml_(o.pain)}
    ${dashDxProcHtml_(o)}
    <div class="dcols">
      <div class="dsheet"><header><h3>ผลทดสอบสมรรถภาพที่ต่ำกว่าเกณฑ์</h3><p class="dsub">จำนวนรายที่ต่ำกว่าเกณฑ์ จากผู้ที่ได้ทดสอบและมีเกณฑ์เทียบ</p></header>
        <div class="dpad">${testRows ? `<div class="dhb dhb-wide">${testRows}</div>` : '<div class="dash-empty">ช่วงนี้ยังไม่มีผลทดสอบสมรรถภาพ</div>'}</div></div>
      <div class="dsheet"><header><h3>ระดับการพึ่งพิง (Barthel ADL)</h3><p class="dsub">${b.n ? `ผู้ที่ได้ประเมิน ${b.n} ราย` : 'ช่วงนี้ยังไม่มีผู้ที่ได้ประเมิน'}</p></header><div class="dpad">
        ${b.n ? `<div class="dstack" role="img" aria-label="ติดสังคม ${b.social} ราย ติดบ้าน ${b.home} ราย ติดเตียง ${b.bed} ราย">${parts.map(p => `<i style="background:var(${p[2]})" data-w="${(p[1] / b.n * 100).toFixed(2)}"></i>`).join('')}</div>
        <div class="dkv">${parts.map(p => `<i style="background:var(${p[2]})"></i><span>${p[0]}</span><b>${p[1]} ราย<em>${dashPct_(p[1], b.n)}</em></b>`).join('')}</div>` : ''}
        <div class="dsplit"><div class="lb">คุณภาพชีวิตเฉลี่ย EQ-5D-5L</div>${fig(o.eq5d.avg, o.eq5d.n, 'จากเต็ม 1.00', 2)}</div>
      </div></div>
    </div>
    ${statPanel}`;
}
