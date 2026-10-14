/* ============================================================================
 * เวชระเบียน: Progress note (ครั้งถัดจากแบบประเมินครั้งแรกใน session เดียวกัน)
 *   หน้ากรอก   : S O A P แบบสั้น — O เลือกรายการตรวจจากชุดเดียวกับ Physical Examination ของแบบแรกรับ
 *                P ใช้แถวการรักษาชุดเดียวกับ Intervention ของแบบแรกรับ (ดึงของครั้งก่อนมาใช้ได้)
 *   หน้าเอกสาร : เวชระเบียนฉบับพร้อมพิมพ์ ข้อความบรรยายตายตัวสร้างจากสิ่งที่กรอก (ส่วนที่ไม่ได้กรอกไม่ขึ้น) เลือกไทย/อังกฤษตอนพิมพ์
 * ใช้ของจาก record.js: REC, rDD/rT/rPair/rPick..., recTxBlock_(), recEx..._(), recCollect_(), recFill_() ฯลฯ และจาก app.js: api(), esc_(), toast()
 *
 * ช่องของ Progress note (คอลัมน์ในชีต Records): pn_s_.. = S · pn_o_.. = O · pn_a_.. = A · pn_p_.. = P · pn_sign = ผู้ลงชื่อ · pn_visit = ครั้งที่
 * ระดับปวดก่อน/หลังรักษาใช้ p5_nrs_pre / p5_nrs_post ช่องเดียวกับแบบแรกรับ (หน้าสถิตินับรวมกัน)
 * ========================================================================== */

// หัวเอกสาร (ชื่อหน่วยบริการ) — แก้ที่นี่ที่เดียว
const PN_ORG = ['โรงพยาบาลส่งเสริมสุขภาพตำบลบ้านแหลมโพธิ์', 'งานกายภาพบำบัด ตำบลบ้านกร่าง อำเภอเมืองพิษณุโลก จังหวัดพิษณุโลก'];
const PN = { lang: 'th', marks: true, respTouched: false, queued: false, ivMode: 'full' };
const PN_MONTHS = {
  th: ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};
// ข้อความบรรยายตายตัวของตัวเลือกแบบปุ่ม (ตัวเลือกจากดรอปดาวน์ที่ตั้งค่าเองได้ ใส่ลงเอกสารตามที่เลือก)
const PN_T = {
  th: {
    title: 'บันทึกความก้าวหน้าทางกายภาพบำบัด (Progress note)',
    heads: { s: 'Subjective (อาการที่ผู้ป่วยบอก)', o: 'Objective (ผลการตรวจ)', a: 'Assessment (การประเมินผล)', p: 'Plan (การรักษาและแผน)' },
    trend: { better: 'ดีขึ้นเมื่อเทียบกับครั้งก่อน', same: 'ไม่เปลี่ยนแปลงจากครั้งก่อน', worse: 'แย่ลงเมื่อเทียบกับครั้งก่อน' },
    hep: { regular: 'ปฏิบัติตามโปรแกรมการออกกำลังกายที่บ้านอย่างสม่ำเสมอ', some: 'ปฏิบัติตามโปรแกรมการออกกำลังกายที่บ้านได้บางครั้ง', none: 'ไม่ได้ปฏิบัติตามโปรแกรมการออกกำลังกายที่บ้าน' },
    resp: { better: 'ดี อาการมีแนวโน้มดีขึ้น', same: 'คงที่ อาการยังไม่เปลี่ยนแปลงชัดเจน', worse: 'ยังไม่เป็นไปตามเป้าหมาย อาการมีแนวโน้มแย่ลง' },
    goal: { met: 'บรรลุเป้าหมายแล้ว', going: 'อยู่ระหว่างดำเนินการ มีความก้าวหน้า', not: 'ยังไม่บรรลุเป้าหมาย' },
    plan: { cont: 'ให้การรักษาต่อตามแผนเดิม', adjust: 'ปรับแผนการรักษา', dc: 'จำหน่ายผู้ป่วยออกจากโปรแกรมกายภาพบำบัด', refer: 'ส่งต่อผู้ป่วย' },
    none: 'ไม่ได้บันทึก'
  },
  en: {
    title: 'Physical Therapy Progress Note',
    heads: { s: 'Subjective', o: 'Objective', a: 'Assessment', p: 'Plan' },
    trend: { better: 'have improved since the last visit', same: 'are unchanged since the last visit', worse: 'have worsened since the last visit' },
    hep: { regular: 'Good compliance with the home exercise program.', some: 'Partial compliance with the home exercise program.', none: 'The home exercise program was not performed.' },
    resp: { better: 'well to treatment and shows improvement', same: 'steadily to treatment with no clear change', worse: 'below expectation, with symptoms tending to worsen' },
    goal: { met: 'achieved', going: 'in progress, improving', not: 'not yet achieved' },
    plan: { cont: 'Continue physical therapy as planned', adjust: 'Modify the treatment plan', dc: 'Discharge from physical therapy', refer: 'Refer the patient' },
    none: 'Not recorded'
  }
};

/* ---------------- หน้ากรอก ---------------- */

const pnCard_ = (letter, title, hint, body) => `<section class="rec-card pn-card" id="recPart${letter}"><h3><span class="n">${letter}</span>${title}<small>${hint}</small></h3><div class="rec-grid">${body}</div></section>`;

/** รายการตรวจของ O: ชุดเดียวกับ Physical Examination ของแบบแรกรับ (ชื่อช่องเดียวกัน) เลือกทีละรายการจากดรอปดาวน์ */
function pnExamItems_() {
  const G1 = 'Behavior of symptoms', G2 = 'Posture / Tenderness / ROM';
  return [
    { id: 'sym', label: 'อาการ / บริเวณที่ปวด', group: G1, rep: 'sym', wide: true, html: rName('อาการ') + recExSym_(1) },
    { id: 'sym2', label: 'อาการ / บริเวณที่ปวด (2)', group: G1, rep: 'sym', wide: true, html: rName('อาการ (2)') + recExSym_(2) },
    { id: 'freq', label: 'Frequency (ความถี่ของอาการ)', group: G1, wide: true, html: rName('Frequency') + rDD('p2_freq', 'frequency', 'ความถี่') },
    { id: 'nrsRest', label: 'NRS ขณะพัก', group: G1, wide: true, html: rName('NRS · Rest') + rNrs('p2_nrs_rest', 'NRS ขณะพัก') },
    { id: 'nrsFunc', label: 'NRS ขณะใช้งาน', group: G1, wide: true, html: rName('NRS · Function') + rNrs('p2_nrs_func', 'NRS ขณะใช้งาน') },
    { id: 'agg', label: 'Aggravate (สิ่งที่ทำให้อาการมากขึ้น)', group: G1, wide: true, html: rName('Aggravate') + rT('p2_agg', 'สิ่งที่ทำให้อาการมากขึ้น', 'x') },
    { id: 'ease', label: 'Ease (สิ่งที่ทำให้อาการลดลง)', group: G1, wide: true, html: rName('Ease') + rDD('p2_ease', 'ease', 'สิ่งที่ทำให้อาการลดลง') },
    { id: 'post', label: 'Posture (ท่าทาง)', group: G2, wide: true, preset: 'p2_post=incorrect', html: rName('Posture') + recExPosture_() },
    { id: 'tender', label: 'Tenderness', group: G2, rep: 'tender', wide: true, preset: 'p2_tender=yes', html: rName('Tenderness') + rNY('p2_tender') + rExtra('p2_tender=yes', recExTender_(1)) },
    { id: 'tender2', label: 'Tenderness (2)', group: G2, rep: 'tender', wide: true, html: rName('Tenderness (2)') + recExTender_(2) },
    { id: 'rom', label: 'ROM (มุม องศา)', group: G2, rep: 'rom', wide: true, preset: 'p2_rom=limit',
      html: rName('ROM') + rPair('p2_rom', [['full', 'Full all direction'], ['limit', 'Limit at', 'warn']]) + rExtra('p2_rom=limit', recExRom_(1)) },
    { id: 'rom2', label: 'ROM (มุม องศา) (2)', group: G2, rep: 'rom', wide: true, html: rName('ROM (2)') + recExRom_(2) },
    { id: 'rom3', label: 'ROM (มุม องศา) (3)', group: G2, rep: 'rom', wide: true, html: rName('ROM (3)') + recExRom_(3) }
  ].concat(recStItems_()).concat(recTestItems_());
}

/** ข้อความเป้าหมายจากแบบแรกรับของ session (ชุดที่ 4) — { stg, ltg } */
function pnGoals_(ini) {
  const on = k => ini[k] === 'Y';
  const within = (n, unit) => n ? ` within ${n} ${unit || ''}`.trimEnd() : '';
  const stg = [
    on('p4_stg_pain') ? 'Relieve pain' + within(ini.p4_stg_pain_n, 'visit') : '',
    on('p4_stg_follow') ? 'ปฏิบัติตามที่นักกายภาพสอนได้อย่างถูกต้อง' + (ini.p4_stg_follow_n ? ` ภายใน ${ini.p4_stg_follow_n} visit` : '') : '',
    on('p4_stg_other') ? (ini.p4_stg_other_note || '') : ''
  ].filter(Boolean).join(' · ');
  const ltg = [
    on('p4_ltg_perf') ? 'Increase physical performance' : '',
    on('p4_ltg_qol') ? 'Increase QOL' : '',
    on('p4_ltg_rtf') ? ('Return to function ' + (ini.p4_ltg_rtf_what || '')).trim() + within(ini.p4_ltg_rtf_n, ini.p4_ltg_rtf_unit) : '',
    on('p4_ltg_hcm') ? 'Improve skills for healthcare management' + within(ini.p4_ltg_hcm_n, ini.p4_ltg_hcm_unit) : ''
  ].filter(Boolean).join(' · ');
  return { stg: stg, ltg: ltg };
}
/** ข้อควรระวัง / ข้อห้าม / flag จากแบบแรกรับ — '' = ไม่ได้บันทึก · 'none' = บันทึกว่าไม่มี */
function pnPrecautions_(ini) {
  const items = [];
  if (ini.p1_prec === 'yes') items.push('Precaution' + (ini.p1_prec_note ? ': ' + ini.p1_prec_note : ''));
  if (ini.p1_contra === 'yes') items.push('Contraindication' + (ini.p1_contra1 ? ': ' + ini.p1_contra1 : ''));
  [['red', 'Red flag'], ['orange', 'Orange flag'], ['yellow', 'Yellow flag']].forEach(f => {
    if (ini['p1_' + f[0]] !== 'yes') return;
    const v = [ini['p1_' + f[0] + '1'], ini['p1_' + f[0] + '2']].filter(Boolean).join(', ');
    items.push(f[1] + (v ? ': ' + v : ''));
  });
  if (items.length) return items.join(' · ');
  return ini.p1_prec === 'none' && ini.p1_contra === 'none' ? 'none' : '';
}
const pnDx_ = ini => ({ medical: [ini.p1_mdx1, ini.p1_mdx2, ini.p1_mdx3, ini.p1_mdx4].filter(Boolean).join(', '), pt: ini.p1_ptdx || '' });
/** สรุปการรักษาของเวชระเบียน 1 ฉบับเป็นข้อความสั้น (ใช้บอกว่าครั้งก่อนทำอะไร) */
function pnTxNames_(d) {
  const out = [];
  for (let i = 1; i <= REC_TX_SLOTS; i++) { if (d['p5_m' + i + '_type']) out.push(d['p5_m' + i + '_type']); }
  for (let i = 1; i <= REC_TX_SLOTS; i++) { if (d['p5_e' + i + '_type']) out.push(d['p5_e' + i + '_type']); }
  [['p5_amb', 'Ambulation'], ['p5_tr', 'Transfer'], ['p5_bal', 'Balance']].forEach(x => { if (d[x[0]] === 'Y') out.push(x[1]); });
  return out.filter((v, i) => out.indexOf(v) === i);
}

function pnRender_(data, today, opts) {
  const p = REC.patient, m = REC.meta, ctx = REC.ctx || {};
  const ini = (ctx.initial && ctx.initial.data) || {};
  const prev = ctx.prev || null;
  const goals = pnGoals_(ini), dx = pnDx_(ini), prec = pnPrecautions_(ini);
  m.finalBy = data.pn_final_by || ''; m.finalAt = data.pn_final_at || '';
  // ฉบับใหม่: ผู้ลงชื่อ = คนที่เลือกครั้งล่าสุดในเครื่องนี้ (ถ้ายังอยู่ในรายการ) หรือคนเดียวที่มีในรายการ
  if (!m.id && !data.pn_sign) {
    const list = (REC.setup.options.signer || []);
    let last = '';
    try { last = localStorage.getItem('pnSigner') || ''; } catch (e) { /* ไม่มีที่เก็บในเบราว์เซอร์ก็ไม่เป็นไร */ }
    data.pn_sign = list.indexOf(last) !== -1 ? last : (list.length === 1 ? list[0] : '');
  }
  PN.respTouched = !!data.pn_a_resp;
  const view = opts && opts.view === 'doc' ? 'doc' : 'form';
  const prevTx = prev ? pnTxNames_(prev.data) : [];
  const prevNrs = prev && prev.data.p5_nrs_pre !== undefined && prev.data.p5_nrs_post !== undefined ? `NRS ${prev.data.p5_nrs_pre} → ${prev.data.p5_nrs_post}` : '';
  const goalRow = (key, label, text) => rWide(`<div class="rec-row"><span class="lb">${label}</span>${rPair(key, [['met', 'บรรลุแล้ว'], ['going', 'กำลังก้าวหน้า'], ['not', 'ยังไม่บรรลุ', 'warn']])}<span class="tx pn-goal">${text ? esc_(text) : 'แบบแรกรับไม่ได้ตั้งเป้าหมายข้อนี้ไว้'}</span></div>`);
  const body = recBody_();
  body.innerHTML = `
  <div class="pn-wrap" id="pnWrap" data-view="${view}">
   <div class="pn-form" id="pnForm">
    <div class="rec-head">
      <div class="rec-head-top">
        <button type="button" class="secondary rec-mini" id="recBackBtn">‹ กลับหน้าคนไข้</button>
        <h2>เวชระเบียน · Progress note</h2>
        <span id="recStatus">${m.id ? recStatusLabel_(m.status) : '<span class="badge busy">ยังไม่ได้บันทึก</span>'}</span>
      </div>
      <div class="rec-head-info">
        <span class="kv">PTN <b>${esc_(p.ptn)}</b></span>
        <span class="kv">ชื่อ <b>${esc_(p.firstName)} ${esc_(p.lastName)}</b></span>
        <span class="kv">Session <b>ที่ ${esc_(m.session)}</b></span>
        ${m.updatedBy || m.createdBy ? `<span class="kv">บันทึกล่าสุดโดย <b>${esc_(m.updatedBy || m.createdBy)}</b></span>` : ''}
      </div>
      <div class="rec-head-form">
        <label>วันที่รับบริการ<input type="date" id="recDate" value="${recAttr_(m.date)}" min="${recAttr_((ctx.initial && ctx.initial.date) || '')}" max="${recAttr_(today)}"></label>
        <label>เวลา<input type="time" data-k="p2_time" aria-label="เวลาที่รับบริการ"></label>
        <label>ครั้งที่<input type="number" data-k="pn_visit" id="pnVisit" min="1" max="999" step="1" inputmode="numeric" aria-label="ครั้งที่ของ session นี้"></label>
      </div>
      <div class="pn-ctx" id="pnCtx">
        <div><b>แรกรับ ${esc_(fmtThaiDate_((ctx.initial && ctx.initial.date) || ''))}</b>${ctx.initial && ctx.initial.status !== 'final' ? ' <span class="pn-warn">(แบบแรกรับยังเป็นฉบับร่าง)</span>' : ''}
          ${ini.p1_cc ? ` · CC: ${esc_(ini.p1_cc)}` : ''}${dx.medical || dx.pt ? ` · Dx: ${esc_([dx.medical, dx.pt].filter(Boolean).join(' / '))}` : ''}</div>
        ${prec && prec !== 'none' ? `<div class="pn-warn"><b>ข้อควรระวัง</b> ${esc_(prec)}</div>` : ''}
        ${prev && prev.kind === 'progress' ? `<div><b>ครั้งก่อน (ครั้งที่ ${esc_(prev.visit)} · ${esc_(fmtThaiDate_(prev.date))})</b>${prevNrs ? ' · ' + esc_(prevNrs) : ''}${prevTx.length ? ' · ' + esc_(prevTx.join(', ')) : ''}</div>` : ''}
      </div>
      ${m.locked ? `<p class="pn-locked" id="pnLocked">Progress note ฉบับนี้บันทึกโดย <b>${esc_(m.finalBy)}</b> แล้ว ผู้อื่นแก้ไขไม่ได้ เปิดดูและพิมพ์ได้</p>` : ''}
    </div>
    <div class="pn-tabs" role="tablist" aria-label="สลับหน้ากรอกกับหน้าเอกสาร">
      <button type="button" role="tab" data-pnview="form">กรอกข้อมูล</button>
      <button type="button" role="tab" data-pnview="doc">เวชระเบียน (พร้อมพิมพ์)</button>
    </div>
    <div class="pn-entry">
    <nav class="rec-steps" aria-label="ไปยังส่วน">
      ${[['S', 'Subjective'], ['O', 'Objective'], ['A', 'Assessment'], ['P', 'Plan']].map(x => `<button type="button" data-part="${x[0]}"><span class="n">${x[0]}</span>${x[1]}</button>`).join('')}
    </nav>
    ${pnCard_('S', 'Subjective', 'อาการที่ผู้ป่วยบอก', [
      rWide(`<div class="rec-row"><span class="lb">อาการเทียบกับครั้งก่อน</span>${rPair('pn_s_trend', [['better', 'ดีขึ้น'], ['same', 'เท่าเดิม'], ['worse', 'แย่ลง', 'warn']])}${rExtra('pn_s_trend=better',
        rGrp(rTx('ดีขึ้นประมาณ') + `<input type="number" data-k="pn_s_pct" class="s n" min="0" max="100" step="1" inputmode="numeric" placeholder="%" aria-label="ดีขึ้นประมาณร้อยละ">` + rTx('%')))}</div>`),
      rWide(rRow('NRS · ก่อนรักษา', rNrs('p5_nrs_pre', 'NRS ก่อนรักษา'))),
      rWide(`<div class="rec-row"><span class="lb">Home program</span>${rPair('pn_s_hep', [['regular', 'ทำสม่ำเสมอ'], ['some', 'ทำบ้าง'], ['none', 'ไม่ได้ทำ', 'warn']])}</div>`),
      rWide(rRow('คำบอกเล่าเพิ่มเติม', rTA('pn_s_note', 'เช่น อาการที่เปลี่ยนไป สิ่งที่ยังทำไม่ได้ (ไม่กรอกก็ได้)')))
    ].join(''))}
    ${pnCard_('O', 'Objective', 'เลือกเฉพาะรายการที่ตรวจครั้งนี้ รายการที่ไม่ได้เลือกไม่ขึ้นในเอกสาร', [
      recFieldRowHtml_(),
      rPick('o', 'เพิ่มรายการที่ตรวจ', pnExamItems_()),
      rWide(rRow('ผลตรวจอื่น ๆ', rTA('pn_o_note', 'ผลตรวจที่ไม่มีในรายการ (ไม่กรอกก็ได้)')))
    ].join(''))}
    ${pnCard_('A', 'Assessment', 'ผลการรักษาและความก้าวหน้าตามเป้าหมาย', [
      rWide(rRow('NRS · หลังรักษา', rNrs('p5_nrs_post', 'NRS หลังรักษา'))),
      rWide(`<div class="rec-row"><span class="lb">ผลการรักษาครั้งนี้</span>${rPair('pn_a_resp', [['better', 'ดีขึ้น'], ['same', 'คงที่'], ['worse', 'แย่ลง', 'warn']])}<span class="tx" id="pnRespNote"></span></div>`),
      rWide(`<div class="rec-row"><span class="lb">อาการไม่พึงประสงค์</span>${rPair('pn_a_ae', [['none', 'ไม่พบ'], ['yes', 'พบ', 'warn']])}${rExtra('pn_a_ae=yes', rT('pn_a_ae_note', 'ระบุอาการและการดูแลที่ให้', 'x'))}</div>`),
      goalRow('pn_a_stg', 'Short term goal', goals.stg),
      goalRow('pn_a_ltg', 'Long term goal', goals.ltg),
      rWide(rRow('การประเมินเพิ่มเติม', rTA('pn_a_note', 'ไม่กรอกก็ได้')))
    ].join(''))}
    ${pnCard_('P', 'Plan', 'การรักษาที่ให้ครั้งนี้ และแผนครั้งต่อไป', [
      rWide(`<div class="rec-row pn-pull"><button type="button" class="secondary rec-mini" id="pnPullBtn"${prev ? '' : ' disabled'}>↺ ดึงการรักษาครั้งก่อนมาใช้</button>
        <span class="tx" id="pnPullNote">${prev ? `${prev.kind === 'progress' ? 'ครั้งที่ ' + esc_(prev.visit) : 'แรกรับ'} · ${esc_(fmtThaiDate_(prev.date))}${prevTx.length ? ': ' + esc_(prevTx.join(', ')) : ': ไม่ได้บันทึกการรักษา'}` : ''}</span></div>`),
      recTxBlock_(),
      rSub('แผนครั้งต่อไป'),
      rWide(`<div class="rec-row"><span class="lb">แผน</span>${rPair('pn_p_plan', [['cont', 'รักษาต่อตามแผนเดิม'], ['adjust', 'ปรับแผน'], ['dc', 'จำหน่าย'], ['refer', 'ส่งต่อ']])}
        ${rExtra('pn_p_plan=adjust', rT('pn_p_adjust', 'ปรับอย่างไร', 'x'))}
        ${rExtra('pn_p_plan=dc', rDD('pn_p_dc_reason', 'dischargeReason', 'เหตุผลที่จำหน่าย', 'l'), rT('pn_p_dc_note', 'สรุปผลการรักษาและคำแนะนำเมื่อจำหน่าย', 'x'))}
        ${rExtra('pn_p_plan=refer', rT('pn_p_refer', 'ส่งต่อที่ใด เพื่ออะไร', 'x'))}</div>`),
      rWide(`<div class="rec-row rec-more" id="pnNextRow"><span class="lb">นัดครั้งต่อไป</span><input type="date" data-k="pn_p_next" class="pn-date" aria-label="วันนัดครั้งต่อไป">${
        rTx(ctx.nextAppt ? `นัดในระบบ: ${esc_(fmtThaiDate_(ctx.nextAppt.date))}${ctx.nextAppt.startTime ? ' ' + esc_(ctx.nextAppt.startTime) + ' น.' : ''}` : 'ยังไม่มีนัดครั้งต่อไปในระบบ (ลงนัดได้ที่หน้าปฏิทิน)')}</div>`),
      rSub('ลงชื่อ'),
      rWide(rRow('ผู้ลงชื่อ', rDD('pn_sign', 'signer', 'เลือกผู้ลงชื่อ', 'pn-signer'), rTx('นักกายภาพบำบัดผู้ให้การรักษา · เพิ่มชื่อได้ที่ ตั้งค่า &gt; ตัวเลือกในแบบฟอร์มเวชระเบียน หรือเลือก "พิมพ์เอง…"')))
    ].join(''))}
    <div class="rec-foot">
      <span class="tx" id="recDirty"></span>
      <p class="error-text" id="recError"></p>
      <span class="rec-foot-btns">
        ${m.locked ? '' : (m.status !== 'final' ? '<button type="button" class="secondary" id="recSaveDraftBtn">บันทึกร่าง</button>' : '') +
          `<button type="button" class="primary" id="recSaveFinalBtn">${m.status === 'final' ? 'บันทึกการแก้ไข' : 'บันทึก Progress note'}</button>`}
      </span>
    </div>
    </div>
   </div>
   <aside class="pn-doc" id="pnDoc" aria-label="เวชระเบียนฉบับพร้อมพิมพ์">
     <div class="pn-bar">
       <span class="pn-seg" id="pnLang" role="group" aria-label="ภาษาของเอกสาร"><button type="button" data-v="th">ไทย</button><button type="button" data-v="en">English</button></span>
       <label class="pn-marks"><input type="checkbox" id="pnMarks"> เน้นสีส่วนที่กรอก</label>
       <button type="button" class="primary rec-mini" id="pnPrintBtn">พิมพ์ / บันทึกเป็น PDF</button>
     </div>
     <p class="pn-bar-note" id="pnPrintNote"></p>
     <div class="pn-paper" id="pnSheet"></div>
   </aside>
  </div>`;
  if (data.pn_visit === undefined && ctx.visit) data.pn_visit = String(ctx.visit);
  recFill_(data);
  recPickInit_();
  recFieldInit_(!m.id);
  recApplyShow_();
  recScores_();
  recEvaluateTests_();
  if (m.locked) body.querySelectorAll('.pn-entry input, .pn-entry select, .pn-entry textarea, .pn-entry button:not([data-part]), .rec-head-form input').forEach(el => { el.disabled = true; });
  pnWire_();
  recSetDirty_(false);
  pnAutoResp_(null);
  pnNextRow_();
  pnDoc_();
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  window.scrollTo(0, 0);
}

function pnSetView_(view) {
  const wrap = document.getElementById('pnWrap');
  if (!wrap) return;
  wrap.dataset.view = view;
  wrap.querySelectorAll('[data-pnview]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pnview === view)));
  if (view === 'doc') pnDoc_();
}

function pnWire_() {
  recWire_();
  const wrap = document.getElementById('pnWrap');
  wrap.querySelectorAll('[data-pnview]').forEach(b => b.addEventListener('click', () => { pnSetView_(b.dataset.pnview); window.scrollTo(0, 0); }));
  pnSetView_(wrap.dataset.view);
  document.getElementById('pnLang').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    PN.lang = b.dataset.v === 'en' ? 'en' : 'th';
    pnDoc_();
  });
  const marks = document.getElementById('pnMarks');
  marks.checked = PN.marks;
  marks.addEventListener('change', () => { PN.marks = marks.checked; pnDoc_(); });
  document.getElementById('pnPrintBtn').addEventListener('click', pnPrint_);
  document.getElementById('pnPullBtn').addEventListener('click', pnPull_);
}

/** เรียกหลังการแก้ไขทุกครั้งในหน้า Progress note (record.js ผูกไว้ท้ายสุดของตัวฟังเหตุการณ์) */
function pnChanged_(e) {
  if (!document.getElementById('pnWrap')) return;
  if (e && e.type === 'click' && !e.target.closest('.rec-card button, .rec-card label')) return;
  pnAutoResp_(e);
  pnNextRow_();
  if (PN.queued) return;
  PN.queued = true;
  requestAnimationFrame(() => { PN.queued = false; if (document.getElementById('pnSheet')) pnDoc_(); });
}

/** จำหน่ายแล้วไม่มีนัดครั้งต่อไป: ซ่อนช่องวันนัด (ช่องที่ซ่อนไม่ถูกบันทึก) */
function pnNextRow_() {
  const row = document.getElementById('pnNextRow');
  if (row) row.classList.toggle('hidden', recValueOf_('pn_p_plan') === 'dc');
}

/**
 * ผลการรักษาครั้งนี้: เลือกให้เองจาก NRS ก่อนและหลังรักษา (ลดลง = ดีขึ้น) จนกว่านักกายภาพจะเลือกเอง
 */
function pnAutoResp_(e) {
  const body = recBody_();
  const boxes = Array.from(body.querySelectorAll('[data-pair="pn_a_resp"]'));
  if (!boxes.length) return;
  if (e && e.target && e.target.dataset && e.target.dataset.pair === 'pn_a_resp') PN.respTouched = boxes.some(b => b.checked);
  const pre = recPicked_('p5_nrs_pre'), post = recPicked_('p5_nrs_post');
  const note = document.getElementById('pnRespNote');
  const auto = pre === null || post === null ? '' : (post < pre ? 'better' : (post > pre ? 'worse' : 'same'));
  if (!PN.respTouched && auto && !(REC.meta && REC.meta.locked)) boxes.forEach(b => { b.checked = b.value === auto; });
  if (note) note.textContent = auto ? `NRS ${pre} → ${post}${PN.respTouched ? '' : ' (เลือกให้ตาม NRS แก้ได้)'}` : 'กรอก NRS ก่อนและหลังรักษา ระบบจะเลือกให้';
}

/** ดึงการรักษา (แถว Modality / Exercise / Training / คำแนะนำ) ของครั้งก่อนมาใส่ แล้วแก้เฉพาะที่ต่างจากเดิม */
function pnPull_() {
  const prev = REC.ctx && REC.ctx.prev;
  const card = document.getElementById('recPartP');
  if (!prev || !card) return;
  const keys = Object.keys(prev.data).filter(k => /^p5_/.test(k) && !/^p5_nrs_/.test(k));
  if (!keys.length) { toast('ครั้งก่อนไม่ได้บันทึกการรักษาไว้'); return; }
  const fields = Array.from(card.querySelectorAll('[data-k^="p5_"]'));
  const used = fields.some(el => el.type === 'checkbox' ? el.checked : (el.value || '').trim() !== '');
  if (used && !window.confirm('แทนที่การรักษาที่กรอกไว้ด้วยการรักษาของครั้งก่อนหรือไม่')) return;
  fields.forEach(el => recSetField_(el, prev.data[el.dataset.k]));
  card.querySelectorAll('.rec-pick').forEach(pick => {
    pick.querySelectorAll('.rec-pick-item').forEach(item => {
      const has = recItemHasData_(item);
      item.classList.toggle('hidden', !has);
      if (item.dataset.leadk) item.querySelector(`[data-k="${item.dataset.leadk}"]`).checked = has;
    });
    recPickRefresh_(pick);
  });
  recApplyShow_();
  recSetDirty_(true);
  document.getElementById('pnPullNote').textContent = 'ดึงมาแล้ว แก้เฉพาะส่วนที่ต่างจากครั้งก่อน';
  pnDoc_();
}

/** ตรวจก่อนบันทึก — คืน { text, el } เมื่อไม่ผ่าน */
function pnValidate_(status, data) {
  const body = recBody_();
  const f = k => body.querySelector(`[data-k="${k}"]`);
  if (data.pn_visit !== undefined && !(Number(data.pn_visit) >= 1 && Number(data.pn_visit) <= 999 && Number.isInteger(Number(data.pn_visit)))) return { text: 'ครั้งที่ ต้องเป็นเลขจำนวนเต็มตั้งแต่ 1', el: f('pn_visit') };
  if (data.pn_s_pct !== undefined && !(Number(data.pn_s_pct) >= 0 && Number(data.pn_s_pct) <= 100)) return { text: 'ร้อยละที่ดีขึ้นต้องเป็นเลข 0-100', el: f('pn_s_pct') };
  const badDeg = Object.keys(data).find(k => /^p2_rom\d*_deg$/.test(k) && !(Number(data[k]) >= 0 && Number(data[k]) <= 360));
  if (badDeg) return { text: 'มุม ROM ต้องเป็นเลข 0-360 องศา', el: f(badDeg) };
  if (status !== 'final') return null;
  const treated = Object.keys(data).some(k => /^p5_[me]\d+_type$/.test(k)) || ['p5_amb', 'p5_tr', 'p5_bal', 'p5_other'].some(k => data[k]);
  if (!treated) return { text: 'เพิ่มการรักษาที่ให้ในครั้งนี้อย่างน้อย 1 รายการก่อนบันทึก (หรือกด บันทึกร่าง ไว้ก่อน)', el: body.querySelector('#recPartP .rec-pick-add') };
  if (!data.pn_sign) return { text: 'เลือกผู้ลงชื่อก่อนบันทึก (หรือกด บันทึกร่าง ไว้ก่อน)', el: f('pn_sign') };
  return null;
}

/** หลังบันทึกสำเร็จ: ฉบับจริงเปิดใหม่ที่หน้าเอกสาร (ได้ชื่อผู้บันทึกและเวลาจากหลังบ้าน) พร้อมพิมพ์ */
function pnSaved_(saved) {
  const sign = recValueOf_('pn_sign');
  if (sign) { try { localStorage.setItem('pnSigner', sign); } catch (e) { /* จำไม่ได้ก็ไม่เป็นไร */ } }
  if (saved.status === 'final') {
    toast('บันทึก Progress note แล้ว');
    openRecordForm_({ ptn: REC.patient.ptn, id: saved.id, view: 'doc' });
    return;
  }
  toast('บันทึกร่างแล้ว');
  document.getElementById('recStatus').innerHTML = recStatusLabel_('draft');
  pnDoc_();
}

/* ---------------- เอกสารพร้อมพิมพ์ ---------------- */

function pnDate_(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return lang === 'th' ? `${Number(m[3])} ${PN_MONTHS.th[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : `${Number(m[3])} ${PN_MONTHS.en[Number(m[2]) - 1]} ${m[1]}`;
}
function pnStamp_(iso, lang) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return lang === 'th' ? `${pnDate_(ymd, 'th')} เวลา ${hm} น.` : `${pnDate_(ymd, 'en')} ${hm}`;
}
/** แยกชื่อกับเลขที่ใบอนุญาตจากข้อความผู้ลงชื่อ เช่น "นางสาวตัวอย่าง ใจดี ก.1234" */
function pnSigner_(text) {
  const t = String(text || '').trim();
  const m = /^(.+?)[\s,]+((?:กภ|ก)\s*\.?\s*\d[\d\s]*)$/.exec(t);
  return m ? { name: m[1].trim(), license: m[2].replace(/\s+/g, '') } : { name: t, license: '' };
}

/** สร้างเอกสารจากข้อมูลที่กรอกอยู่ตอนนี้ แล้วแสดงในหน้าเอกสาร */
function pnDoc_() {
  const sheet = document.getElementById('pnSheet');
  if (!sheet || !REC.meta || !REC.patient) return;
  const data = recCollect_();
  sheet.className = 'pn-paper' + (PN.marks ? '' : ' plain') + (REC.meta.status === 'final' && !REC.dirty ? '' : ' draft');
  const initial = REC.meta.kind !== 'progress';
  sheet.lang = initial ? 'th' : PN.lang;
  sheet.classList.toggle('iv', initial);
  sheet.innerHTML = initial ? ivDocHtml_(data, PN.ivMode === 'full') : pnDocHtml_(data, PN.lang);
  document.querySelectorAll('#ivMode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === PN.ivMode)));
  document.querySelectorAll('#pnLang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === PN.lang)));
  const note = document.getElementById('pnPrintNote');
  if (note) note.textContent = !REC.meta.id || REC.dirty ? 'ยังมีการแก้ไขที่ไม่ได้บันทึก — บันทึกก่อนจึงพิมพ์ได้' : (REC.meta.status !== 'final' ? 'ฉบับร่าง: พิมพ์ได้ แต่จะมีคำว่า ฉบับร่าง กำกับ' : '');
}

function pnDocHtml_(d, lang) {
  const th = lang === 'th', T = PN_T[lang];
  const p = REC.patient, meta = REC.meta, ctx = REC.ctx || {};
  const ini = (ctx.initial && ctx.initial.data) || {};
  const mk = s => `<mark>${esc_(s)}</mark>`;
  const has = k => d[k] !== undefined && d[k] !== '';
  const join = a => a.filter(Boolean).join(' ');
  const date = document.getElementById('recDate') ? document.getElementById('recDate').value : meta.date;
  const nrs = v => `${v}/10`;
  const lines = { s: [], o: [], a: [], p: [] };

  /* ----- S ----- */
  const s = [];
  if (has('pn_s_trend') && T.trend[d.pn_s_trend]) {
    const pct = d.pn_s_trend === 'better' && has('pn_s_pct') ? Number(d.pn_s_pct) : null;
    if (th) s.push('ผู้ป่วยให้ประวัติว่าอาการ' + mk(T.trend[d.pn_s_trend]) + (pct === null ? '' : (pct >= 100 ? ' ' + mk('อาการหายเป็นปกติ') : ' ประมาณร้อยละ ' + mk(pct))));
    else s.push('The patient reports that symptoms ' + mk(T.trend[d.pn_s_trend]) + (pct === null ? '' : (pct >= 100 ? ', ' + mk('fully resolved') : ', approximately ' + mk(pct + '%') + ' better')) + '.');
  }
  if (has('p5_nrs_pre')) s.push(th ? 'ระดับความปวดก่อนการรักษา ' + mk(nrs(d.p5_nrs_pre)) + ' (Numeric Rating Scale)' : 'Pain before treatment ' + mk(nrs(d.p5_nrs_pre)) + ' (Numeric Rating Scale).');
  if (has('pn_s_hep') && T.hep[d.pn_s_hep]) s.push(mk(T.hep[d.pn_s_hep]));
  if (has('pn_s_note')) s.push(mk(d.pn_s_note));
  if (s.length) lines.s.push(`<p>${s.join(' ')}</p>`);

  /* ----- O ----- */
  const o = [];
  const base = (v, unit) => v === undefined || v === '' ? '' : (th ? ` (แรกรับ ${esc_(v)}${unit ? ' ' + esc_(unit) : ''})` : ` (initial ${esc_(v)}${unit ? ' ' + esc_(unit) : ''})`);
  [1, 2].forEach(n => {
    const k = recKn_('p2_sym', n);
    if (!has(k) && !has(k + '_at')) return;
    const where = join([d[k + '_side'], d[k + '_at']]);
    o.push((th ? 'อาการ: ' : 'Symptom: ') + mk(d[k] || (th ? 'มีอาการ' : 'symptom')) + (where ? (th ? ' บริเวณ ' : ' at ') + mk(where) : ''));
  });
  if (has('p2_freq')) o.push((th ? 'ความถี่ของอาการ: ' : 'Frequency: ') + mk(d.p2_freq));
  if (has('p2_nrs_rest')) o.push((th ? 'ระดับความปวด (NRS) ขณะพัก ' : 'Pain (NRS) at rest ') + mk(nrs(d.p2_nrs_rest)) + base(ini.p2_nrs_rest !== undefined ? nrs(ini.p2_nrs_rest) : ''));
  if (has('p2_nrs_func')) o.push((th ? 'ระดับความปวด (NRS) ขณะใช้งาน ' : 'Pain (NRS) on activity ') + mk(nrs(d.p2_nrs_func)) + base(ini.p2_nrs_func !== undefined ? nrs(ini.p2_nrs_func) : ''));
  if (has('p2_agg')) o.push((th ? 'สิ่งที่ทำให้อาการมากขึ้น: ' : 'Aggravating factors: ') + mk(d.p2_agg));
  if (has('p2_ease')) o.push((th ? 'สิ่งที่ทำให้อาการลดลง: ' : 'Easing factors: ') + mk(d.p2_ease));
  if (d.p2_post === 'normal') o.push((th ? 'ท่าทาง (Posture): ' : 'Posture: ') + mk(th ? 'ปกติ' : 'normal'));
  if (d.p2_post === 'incorrect') {
    const found = [['p2_post_fhp', 'Forward head'], ['p2_post_rs', 'Round shoulder'], ['p2_post_ws', 'Winged scapula'], ['p2_post_chin', 'Chin out'], ['p2_post_kyphosis', 'Thoracic kyphosis']]
      .filter(x => d[x[0]]).map(x => x[1]).concat(has('p2_post_other') ? [d.p2_post_other] : []);
    o.push((th ? 'ท่าทาง (Posture): ' : 'Posture: ') + mk(th ? 'ผิดปกติ' : 'incorrect') + (found.length ? (th ? ' ได้แก่ ' : ': ') + mk(found.join(', ')) : ''));
  }
  const tenderAt = k => { const part = d[k + '_muscle'] ? d[k + '_muscle'] + (d[k + '_at'] ? ' (' + d[k + '_at'] + ')' : '') : (d[k + '_at'] || ''); return join([d[k + '_side'], part]); };
  if (d.p2_tender === 'none') o.push((th ? 'อาการกดเจ็บ (Tenderness): ' : 'Tenderness: ') + mk(th ? 'ไม่พบ' : 'none'));
  if (d.p2_tender === 'yes') o.push((th ? 'อาการกดเจ็บ (Tenderness): ' : 'Tenderness: ') + (tenderAt('p2_tender') ? (th ? 'พบที่ ' : 'at ') + mk(tenderAt('p2_tender')) : mk(th ? 'พบ' : 'present')));
  if (tenderAt('p2_tender2')) o.push((th ? 'อาการกดเจ็บ (Tenderness): พบที่ ' : 'Tenderness: at ') + mk(tenderAt('p2_tender2')));
  // ROM: ค่าตั้งต้น = แถวในแบบแรกรับที่ข้อ ทิศทาง และข้างตรงกัน
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const romBase = k => {
    if (!d[k + '_joint'] || !d[k + '_dir']) return '';
    const hit = [1, 2, 3].map(n => recKn_('p2_rom', n)).find(b => ini[b + '_deg'] !== undefined && same(ini[b + '_joint'], d[k + '_joint']) && same(ini[b + '_dir'], d[k + '_dir']) &&
      same(ini[b + '_side'], d[k + '_side']) && (!ini[b + '_type'] || !d[k + '_type'] || same(ini[b + '_type'], d[k + '_type'])));
    return hit ? base(ini[hit + '_deg'], th ? 'องศา' : 'degrees') : '';
  };
  const romText = k => {
    const what = join([d[k + '_type'], d[k + '_side'], d[k + '_joint'], d[k + '_dir']]);
    const deg = has(k + '_deg') ? mk(d[k + '_deg'] + (th ? ' องศา' : '°')) : '';
    return what || deg ? join([what ? mk(what) : '', deg]) + romBase(k) : '';
  };
  const romHead = th ? 'ช่วงการเคลื่อนไหวของข้อ (ROM): ' : 'Range of motion: ';
  if (d.p2_rom === 'full') o.push(romHead + mk(th ? 'เต็มช่วงการเคลื่อนไหวทุกทิศทาง' : 'full in all directions'));
  if (d.p2_rom === 'limit') o.push(romHead + (th ? 'จำกัด ' : 'limited ') + romText('p2_rom'));
  ['p2_rom2', 'p2_rom3'].forEach(k => { if (romText(k)) o.push(romHead + romText(k)); });
  if (d.p2_st_upper && (has('p2_st_upper_test') || has('p2_st_upper_res'))) o.push('Special test: ' + mk(d.p2_st_upper_test || '-') + (has('p2_st_upper_res') ? (th ? ' ผล ' : ': ') + mk(d.p2_st_upper_res) : ''));
  if (d.p2_st_lower && (has('p2_st_lower_test') || has('p2_st_lower_res'))) o.push('Special test: ' + mk(d.p2_st_lower_test || '-') + (has('p2_st_lower_res') ? (th ? ' ผล ' : ': ') + mk(d.p2_st_lower_res) : ''));
  if (d.p2_st_other && has('p2_st_other_note')) o.push('Special test: ' + mk(d.p2_st_other_note));
  // ผลทดสอบสมรรถภาพ: ค่าที่วัดได้ + ผลเทียบเกณฑ์ (ถ้ารายการนั้นมีเกณฑ์) + ค่าแรกรับ
  const age = recAge_(), sex = recSex_();
  ((REC.setup && REC.setup.tests) || []).forEach(t => {
    if (t.key === 'eq5d' || t.key === 'barthel' || !has('pt_' + t.key)) return;
    const v = Number(d['pt_' + t.key]);
    const crit = recCriterion_(t, age, sex);
    const verdict = crit && isFinite(v) ? (crit.below(v) ? (th ? 'ต่ำกว่าเกณฑ์' : 'below the criterion') : (th ? 'ผ่านเกณฑ์' : 'meets the criterion')) : '';
    const name = t.askName && d['pt_' + t.key + '_label'] ? d['pt_' + t.key + '_label'] : t.name;
    o.push(esc_(name) + ' ' + mk(d['pt_' + t.key] + ' ' + t.unit) + (verdict ? ' ' + mk(verdict) + ` (${th ? 'เกณฑ์' : 'criterion'} ${esc_(crit.text)}${crit.basis ? ' ' + esc_(crit.basis) : ''})` : '') + base(ini['pt_' + t.key], t.unit));
  });
  if (has('pt_eq5d') || has('pt_eq5d_vas')) o.push('EQ-5D-5L' + (has('pt_eq5d') ? (th ? ' คะแนนอรรถประโยชน์ ' : ' utility ') + mk(d.pt_eq5d) + base(ini.pt_eq5d) : '') + (has('pt_eq5d_vas') ? ' VAS ' + mk(d.pt_eq5d_vas) : ''));
  if (has('pt_barthel')) o.push('Barthel ADL ' + mk(d.pt_barthel + '/20') + ' ' + mk(recBarthelGroup_(Number(d.pt_barthel))) + base(ini.pt_barthel !== undefined ? ini.pt_barthel + '/20' : ''));
  if (o.length) lines.o.push(`<p>${th ? 'ตรวจร่างกายทางกายภาพบำบัดพบดังนี้' : 'Physical examination findings:'}</p><ul>${o.map(x => `<li>${x}</li>`).join('')}</ul>`);
  if (has('pn_o_note')) lines.o.push(`<p>${mk(d.pn_o_note)}</p>`);

  /* ----- A ----- */
  const a = [];
  const pre = has('p5_nrs_pre') ? Number(d.p5_nrs_pre) : null, post = has('p5_nrs_post') ? Number(d.p5_nrs_post) : null;
  if (pre !== null && post !== null) {
    const drop = pre - post, pct = pre > 0 ? Math.round(Math.abs(drop) / pre * 100) : null;
    if (th) a.push('ระดับความปวด' + (drop > 0 ? 'ลดลง' : (drop < 0 ? 'เพิ่มขึ้น' : 'คงเดิม')) + 'จาก ' + mk(nrs(pre)) + ' เป็น ' + mk(nrs(post)) + ' หลังการรักษา' + (drop !== 0 && pct !== null ? ` (${drop > 0 ? 'ลดลง' : 'เพิ่มขึ้น'}ร้อยละ ${mk(pct)})` : ''));
    else a.push('Pain ' + (drop > 0 ? 'decreased' : (drop < 0 ? 'increased' : 'remained')) + ' from ' + mk(nrs(pre)) + ' to ' + mk(nrs(post)) + ' after treatment' + (drop !== 0 && pct !== null ? ` (${mk(pct + '%')} ${drop > 0 ? 'reduction' : 'increase'})` : '') + '.');
  } else if (post !== null) a.push(th ? 'ระดับความปวดหลังการรักษา ' + mk(nrs(post)) + ' (Numeric Rating Scale)' : 'Pain after treatment ' + mk(nrs(post)) + ' (Numeric Rating Scale).');
  if (has('pn_a_resp') && T.resp[d.pn_a_resp]) a.push(th ? 'ผู้ป่วยตอบสนองต่อการรักษา' + mk(T.resp[d.pn_a_resp]) : 'The patient responds ' + mk(T.resp[d.pn_a_resp]) + '.');
  if (d.pn_a_ae === 'none') a.push(mk(th ? 'ไม่พบอาการไม่พึงประสงค์ระหว่างและหลังการรักษา' : 'No adverse reaction during or after treatment.'));
  if (d.pn_a_ae === 'yes') a.push((th ? 'พบอาการไม่พึงประสงค์' : 'Adverse reaction noted') + (has('pn_a_ae_note') ? ': ' + mk(d.pn_a_ae_note) : '') + (th ? '' : '.'));
  if (a.length) lines.a.push(`<p>${a.join(' ')}</p>`);
  const goals = pnGoals_(ini), g = [];
  [['pn_a_stg', th ? 'เป้าหมายระยะสั้น' : 'Short-term goal', goals.stg], ['pn_a_ltg', th ? 'เป้าหมายระยะยาว' : 'Long-term goal', goals.ltg]].forEach(x => {
    if (has(x[0]) && T.goal[d[x[0]]]) g.push(`${x[1]}${x[2] ? ' (' + esc_(x[2]) + ')' : ''}: ${mk(T.goal[d[x[0]]])}`);
  });
  if (g.length) lines.a.push(`<ul>${g.map(x => `<li>${x}</li>`).join('')}</ul>`);
  if (has('pn_a_note')) lines.a.push(`<p>${mk(d.pn_a_note)}</p>`);

  /* ----- P ----- */
  const tx = [];
  const level = v => /^independent$/i.test(v) ? (th ? 'ทำได้เอง (Independent)' : 'independent') : (/^dependent$/i.test(v) ? (th ? 'ต้องมีผู้ช่วย (Dependent)' : 'dependent, assistance required') : v);
  for (let i = 1; i <= REC_TX_SLOTS; i++) {
    const k = 'p5_m' + i;
    if (!has(k + '_type') && !has(k + '_at')) continue;
    const where = join([d[k + '_side'], d[k + '_at']]);
    const pts = has(k + '_pts') ? Number(d[k + '_pts']) : null, min = has(k + '_min') ? Number(d[k + '_min']) : null;
    const total = pts !== null && min !== null && isFinite(pts * min) && pts > 1 ? Math.round(pts * min * 100) / 100 : null;
    let t = mk(d[k + '_type'] || (th ? '(ไม่ระบุเครื่องมือ)' : '(unspecified modality)')) + (where ? (th ? ' บริเวณ ' : ' at ') + mk(where) : '');
    if (th) t += (has(k + '_mode') ? ' Mode ' + mk(d[k + '_mode']) : '') + (has(k + '_int') ? ' Intensity ' + mk(d[k + '_int']) : '') + (pts !== null ? ' จำนวน ' + mk(pts + ' จุด') : '') +
      (min !== null ? (pts !== null ? ' จุดละ ' : ' ใช้เวลา ') + mk(min + ' นาที') : '') + (total !== null ? ` (รวม ${mk(total + ' นาที')})` : '');
    else t += (has(k + '_mode') ? ', mode ' + mk(d[k + '_mode']) : '') + (has(k + '_int') ? ', intensity ' + mk(d[k + '_int']) : '') + (pts !== null ? ', ' + mk(pts + (pts === 1 ? ' point' : ' points')) : '') +
      (min !== null ? ', ' + mk(min + ' min') + (pts !== null ? ' per point' : '') : '') + (total !== null ? ` (total ${mk(total + ' min')})` : '');
    tx.push(t + (has(k + '_note') ? ' ' + mk(d[k + '_note']) : ''));
  }
  for (let i = 1; i <= REC_TX_SLOTS; i++) {
    const k = 'p5_e' + i;
    if (!has(k + '_type') && !has(k + '_at')) continue;
    const where = join([d[k + '_side'], d[k + '_at']]);
    const dose = [[k + '_reps', th ? 'ครั้ง/set' : 'reps/set'], [k + '_sets', th ? 'set/วัน' : 'sets/day'], [k + '_days', th ? 'วัน/สัปดาห์' : 'days/week']].filter(x => has(x[0])).map(x => mk(d[x[0]] + ' ' + x[1]));
    tx.push(mk(d[k + '_type'] || (th ? '(ไม่ระบุชนิดการออกกำลังกาย)' : '(unspecified exercise)')) + (has(k + '_detail') ? ' (' + mk(d[k + '_detail']) + ')' : '') +
      (where ? (th ? ' บริเวณ ' : ' for ') + mk(where) : '') + (dose.length ? ' ' + dose.join(th ? ' ' : ', ') : ''));
  }
  if (d.p5_amb) {
    const aid = d.p5_amb_aid || '', noAid = /^(no\b|none|without|ไม่ใช้|ไม่มี)/i.test(aid);
    tx.push((th ? 'ฝึกเดิน (Ambulation training)' : 'Ambulation training') + (has('p5_amb_pattern') ? ' ' + mk(d.p5_amb_pattern) : '') +
      (has('p5_amb_level') ? (th ? ' ระดับการช่วยเหลือ: ' : ', level of assistance: ') + mk(level(d.p5_amb_level)) : '') +
      (aid ? ' ' + mk(noAid ? (th ? 'ไม่ใช้เครื่องช่วยเดิน' : 'without gait aid') : (th ? 'ใช้ ' : 'with ') + aid) : '') + (has('p5_amb_note') ? ' ' + mk(d.p5_amb_note) : ''));
  }
  if (d.p5_tr) tx.push((th ? 'ฝึกเคลื่อนย้ายตัว (Transfer training)' : 'Transfer training') + (has('p5_tr_type') ? ' ' + mk(d.p5_tr_type) : '') +
    (has('p5_tr_level') ? (th ? ' ระดับการช่วยเหลือ: ' : ', level of assistance: ') + mk(level(d.p5_tr_level)) : '') + (has('p5_tr_note') ? ' ' + mk(d.p5_tr_note) : ''));
  if (d.p5_bal) tx.push((th ? 'ฝึกการทรงตัว (Balance training)' : 'Balance training') + (has('p5_bal_note') ? ' ' + mk(d.p5_bal_note) : ''));
  if (d.p5_other && has('p5_other_note')) tx.push(mk(d.p5_other_note));
  if (d.p5_behav) tx.push(mk(th ? 'แนะนำการปรับพฤติกรรมในชีวิตประจำวัน' : 'Advice on behaviour modification in daily activities'));
  if (d.p5_pa) tx.push((th ? 'เพิ่มกิจกรรมทางกาย (Increase PA)' : 'Increase physical activity') + (has('p5_pa_min') ? ' ' + mk(d.p5_pa_min + (th ? ' นาที/วัน' : ' min/day')) : '') + (has('p5_pa_days') ? ' ' + mk(d.p5_pa_days + (th ? ' วัน/สัปดาห์' : ' days/week')) : ''));
  if (tx.length) lines.p.push(`<p>${th ? 'ให้การรักษาทางกายภาพบำบัดดังนี้' : 'Treatment given:'}</p><ol>${tx.map(x => `<li>${x}</li>`).join('')}</ol>`);
  const edu = [d.p5_edu1, d.p5_edu2, d.p5_edu_note].filter(Boolean);
  if (edu.length) lines.p.push(`<p>${th ? 'ให้คำแนะนำแก่ผู้ป่วย/ญาติ: ' : 'Patient and family education: '}${edu.map(mk).join(th ? ' · ' : '; ')}</p>`);
  if (d.p5_hp) lines.p.push(`<p>${th ? 'ให้โปรแกรมการออกกำลังกายที่บ้าน (Home program)' : 'Home exercise program given'}${has('p5_hp_note') ? ': ' + mk(d.p5_hp_note) : ''}</p>`);
  const plan = [];
  if (has('pn_p_plan') && T.plan[d.pn_p_plan]) {
    let t = mk(T.plan[d.pn_p_plan]);
    if (d.pn_p_plan === 'adjust' && has('pn_p_adjust')) t += ': ' + mk(d.pn_p_adjust);
    if (d.pn_p_plan === 'refer' && has('pn_p_refer')) t += ': ' + mk(d.pn_p_refer);
    if (d.pn_p_plan === 'dc') t += (has('pn_p_dc_reason') ? (th ? ' เนื่องจาก ' : ' because: ') + mk(d.pn_p_dc_reason) : '') + (has('pn_p_dc_note') ? (th ? ' สรุปผลและคำแนะนำ: ' : '. Summary and advice: ') + mk(d.pn_p_dc_note) : '');
    plan.push((th ? 'แผนการรักษา: ' : 'Plan: ') + t + (th ? '' : '.'));
  }
  if (has('pn_p_next') && d.pn_p_plan !== 'dc') plan.push((th ? 'นัดครั้งต่อไปวันที่ ' : 'Next appointment: ') + mk(pnDate_(d.pn_p_next, lang)) + (th ? '' : '.'));
  // บรรทัดแผน/นัด อยู่ท้ายสุดของ P และพิมพ์ติดกับช่องลงชื่อเสมอ (ลายมือชื่อไม่ไปอยู่หน้าใหม่ลำพัง)
  const planHtml = plan.length ? `<p>${plan.join(' ')}</p>` : '';

  /* ----- หัวเอกสาร ลายมือชื่อ ท้ายเอกสาร ----- */
  const dx = pnDx_(ini), prec = pnPrecautions_(ini);
  const ageNow = recAge_();
  const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  const sexText = p.sex === 'M' ? (th ? 'ชาย' : 'Male') : (p.sex === 'F' ? (th ? 'หญิง' : 'Female') : '-');
  const cell = (label, value, span) => `<div class="c${span}"><b>${label}</b> ${value || '-'}</div>`; // span = จำนวนช่องจาก 12
  const signer = pnSigner_(d.pn_sign);
  const visit = has('pn_visit') ? d.pn_visit : (ctx.visit || '');
  const recorded = meta.finalAt ? (th ? `บันทึกเป็นเวชระเบียนโดย ${esc_(meta.finalBy)} เมื่อ ${pnStamp_(meta.finalAt, lang)}` : `Recorded by ${esc_(meta.finalBy)} on ${pnStamp_(meta.finalAt, lang)}`)
    : (th ? 'ฉบับร่าง ยังไม่ได้บันทึกเป็นเวชระเบียน' : 'Draft — not yet finalised');
  const amended = meta.finalAt && meta.updatedAt && new Date(meta.updatedAt) - new Date(meta.finalAt) > 60000
    ? (th ? ` · แก้ไขล่าสุด ${pnStamp_(meta.updatedAt, lang)} โดย ${esc_(meta.updatedBy)}` : ` · last amended ${pnStamp_(meta.updatedAt, lang)} by ${esc_(meta.updatedBy)}`) : '';
  const section = k => `<div class="pn-soap"><div class="pn-l">${k.toUpperCase()}</div><div class="pn-c"><h4>${T.heads[k]}</h4>${lines[k].join('') || (k === 'p' && planHtml ? '' : `<p class="pn-none">${T.none}</p>`)}</div></div>`;
  const ccCell = ini.p1_cc ? cell(th ? 'อาการสำคัญแรกรับ' : 'Chief complaint', esc_(ini.p1_cc), prec ? 6 : 12) : '';
  const precCell = prec ? cell(th ? 'ข้อควรระวัง / ข้อห้าม' : 'Precautions / contraindications', prec === 'none' ? (th ? 'ไม่มี' : 'None') : esc_(prec), ini.p1_cc ? 6 : 12) : '';
  return `
    <table class="pn-tbl"><thead><tr><td><div class="pn-run">${esc_(name)} · PTN ${esc_(p.ptn)} · Progress note ${esc_(pnDate_(date, lang))}</div></td></tr></thead><tbody><tr><td>
    <div class="pn-org">${esc_(PN_ORG[0])}<small>${esc_(PN_ORG[1])}</small></div>
    <div class="pn-ttl">${T.title}</div>
    <div class="pn-id">
      ${cell(th ? 'ชื่อ-สกุล' : 'Name', esc_(name), 5)}${cell('PTN', esc_(p.ptn), 3)}${cell(th ? 'เพศ' : 'Sex', sexText, 2)}${cell(th ? 'อายุ' : 'Age', ageNow !== null ? ageNow + (th ? ' ปี' : ' years') : '-', 2)}
      ${cell(th ? 'วันที่รับบริการ' : 'Date of service', esc_(pnDate_(date, lang)) + (has('p2_time') ? (th ? ` เวลา ${esc_(d.p2_time)} น.` : ` ${esc_(d.p2_time)}`) : ''), 5)}${cell(th ? 'ครั้งที่' : 'Visit', esc_(visit) + ` (Session ${esc_(meta.session)})`, 3)}${cell(th ? 'ประเมินแรกรับ' : 'Initial evaluation', esc_(pnDate_((ctx.initial && ctx.initial.date) || '', lang)), 4)}
      ${cell(th ? 'การวินิจฉัยทางการแพทย์' : 'Medical diagnosis', esc_(dx.medical), 6)}${cell(th ? 'การวินิจฉัยทางกายภาพบำบัด' : 'PT diagnosis', esc_(dx.pt), 6)}
      ${ccCell}${precCell}
    </div>
    ${['s', 'o', 'a', 'p'].map(section).join('')}
    <div class="pn-keep">${planHtml ? `<div class="pn-soap pn-cont"><div></div><div class="pn-c">${planHtml}</div></div>` : ''}
    <div class="pn-sign">
      <div class="pn-sign-box">
        <div class="pn-sign-line">${th ? 'ลงชื่อ' : 'Signature'} ......................................................</div>
        <div>( ${signer.name ? mk(signer.name) : '......................................................'} )</div>
        <div>${th ? 'นักกายภาพบำบัด' : 'Physical therapist'}${signer.license ? (th ? ' เลขที่ใบอนุญาต ' : ', licence no. ') + mk(signer.license) : (th ? ' เลขที่ใบอนุญาต ..................' : ', licence no. ..................')}</div>
        <div>${th ? 'วันที่' : 'Date'} ${esc_(pnDate_(date, lang))}</div>
      </div>
    </div>
    <div class="pn-foot">${recorded}${amended}</div>
    </div>
    </td></tr></tbody></table>`;
}

function pnPrintDone_() {
  window.removeEventListener('afterprint', pnPrintDone_);
  document.body.classList.remove('pn-printing');
  if (PN.title) document.title = PN.title;
  const root = document.getElementById('printRoot');
  if (root) root.innerHTML = '';
}
/** พิมพ์เอกสาร: คัดลอกแผ่นเอกสารไปไว้นอกหน้าเว็บ (ซ่อนส่วนอื่นทั้งหมดตอนพิมพ์) — ต้องบันทึกก่อน เอกสารจึงตรงกับข้อมูลในระบบ */
function pnPrint_() {
  if (!REC.meta.id || REC.dirty) { toast('บันทึกก่อนพิมพ์ เพื่อให้เอกสารตรงกับข้อมูลในระบบ'); return; }
  pnPrintPrep_();
  window.print();
}
/** เตรียมหน้าพิมพ์: คัดลอกแผ่นเอกสารไปไว้นอกหน้าเว็บ แล้วซ่อนส่วนอื่นทั้งหมด */
function pnPrintPrep_() {
  pnDoc_();
  let root = document.getElementById('printRoot');
  if (!root) { root = document.createElement('div'); root.id = 'printRoot'; document.body.appendChild(root); }
  const sheet = document.getElementById('pnSheet');
  root.innerHTML = `<div class="${sheet.className.replace('pn-paper', 'pn-paper plain')}" lang="${sheet.lang}">${sheet.innerHTML}</div>`;
  // ชื่อเอกสาร = ชื่อไฟล์ที่เบราว์เซอร์เสนอเมื่อเลือก "บันทึกเป็น PDF"
  if (!document.body.classList.contains('pn-printing')) {
    PN.title = document.title;
    document.body.classList.add('pn-printing');
    window.addEventListener('afterprint', pnPrintDone_);
  }
  document.title = `${REC.meta.kind === 'progress' ? 'Progress note' : 'เวชระเบียน'} ${REC.patient.ptn} ${REC.meta.date}`;
}
// กด Ctrl+P เองขณะเปิดเวชระเบียน: พิมพ์เฉพาะแผ่นเอกสาร ไม่ใช่ทั้งหน้าเว็บ
window.addEventListener('beforeprint', () => {
  const view = document.getElementById('recordView');
  if (document.body.classList.contains('pn-printing') || !view || view.classList.contains('hidden') || !document.getElementById('pnSheet')) return;
  pnPrintPrep_();
});


/* ---------------- ใบแรกรับ (แบบประเมินครั้งแรก) ฉบับพร้อมพิมพ์ ----------------
 * จัดตามแบบฟอร์มเวชระเบียนเดิม 5 ส่วน · full = เห็นทุกช่องของฟอร์ม (ช่องที่ไม่ได้ติ๊กเป็นกล่องว่าง) · ไม่ full = เฉพาะที่บันทึก
 */
function ivWire_() {
  const wrap = document.getElementById('pnWrap');
  if (!wrap) return;
  wrap.querySelectorAll('[data-pnview]').forEach(b => b.addEventListener('click', () => { pnSetView_(b.dataset.pnview); window.scrollTo(0, 0); }));
  pnSetView_(wrap.dataset.view);
  try { const v = localStorage.getItem('ivMode'); if (v === 'full' || v === 'short') PN.ivMode = v; } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  document.getElementById('ivMode').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    PN.ivMode = b.dataset.v === 'short' ? 'short' : 'full';
    try { localStorage.setItem('ivMode', PN.ivMode); } catch (err) { /* จำไม่ได้ก็ไม่เป็นไร */ }
    pnDoc_();
  });
  const marks = document.getElementById('pnMarks');
  marks.checked = PN.marks;
  marks.addEventListener('change', () => { PN.marks = marks.checked; pnDoc_(); });
  document.getElementById('pnPrintBtn').addEventListener('click', pnPrint_);
  pnDoc_();
}

function ivDocHtml_(d, full) {
  const p = REC.patient, meta = REC.meta;
  const mk = s => `<mark>${esc_(s)}</mark>`;
  const has = k => d[k] !== undefined && d[k] !== '' && d[k] !== false;
  const v = k => has(k) ? mk(d[k]) : '';
  const join = a => a.filter(Boolean).join(' ');
  const cb = (on, label, detail) => !on && !full ? '' : `<span class="cb${on ? ' on' : ''}">${on ? mk(label) : esc_(label)}${on && detail ? ' ' + detail : ''}</span>`;
  const row = (label, value) => value ? `<div class="r"><b>${label}</b><span class="v">${value}</span></div>` : (full ? `<div class="r"><b>${label}</b><span class="v none">-</span></div>` : '');
  const ny = (key, label, detail) => {
    const yes = d[key] === 'yes';
    if (!has(key)) return full ? row(label, '') : '';
    return !yes && !full ? row(label, mk('None')) : `<div class="r"><b>${label}</b><span class="v">${cb(!yes, 'None')}${cb(yes, 'Yes', detail)}</span></div>`;
  };
  const line = html => html ? `<div class="ln">${html}</div>` : '';
  const col = (title, inner) => inner ? `<div class="col"><h5>${title}</h5>${inner}</div>` : '';
  const date = document.getElementById('recDate') ? document.getElementById('recDate').value : meta.date;
  const age = recAge_();
  const name = `${p.firstName || ''} ${p.lastName || ''}`.trim();
  const sexText = recSex_() === 'M' ? 'ชาย' : (recSex_() === 'F' ? 'หญิง' : '-');
  const wait = has('p1_consult') && date && d.p1_consult <= date ? Math.round((new Date(date + 'T00:00:00Z') - new Date(d.p1_consult + 'T00:00:00Z')) / 86400000) : null;

  /* (1) Personal data */
  const ud = [d.p1_ud1, d.p1_ud2, d.p1_ud3].filter(Boolean);
  const consent = d.p1_consent === 'signed' ? 'ลงนามในใบยินยอมแล้ว' : (d.p1_consent === 'verbal' ? 'ยินยอมด้วยวาจา' : '');
  const p1 = row('Chief complaint', v('p1_cc')) + row('Present history', has('p1_ph') ? mk(d.p1_ph).replace(/\n/g, '<br>') : '') +
    row('Past history U/D', join([ud.length ? mk(ud.join(', ')) : '', v('p1_ud_note')])) +
    (has('p1_acc') || full ? row('Accident', join([v('p1_acc'), /^no/i.test(d.p1_acc || '') ? '' : v('p1_acc_note')])) : '') +
    ny('p1_fall', 'Falling history', v('p1_fall_note')) + ny('p1_prec', 'Precaution', v('p1_prec_note')) + ny('p1_contra', 'Contraindication', v('p1_contra1')) +
    ny('p1_red', 'Red flag', [v('p1_red1'), v('p1_red2')].filter(Boolean).join(', ')) + ny('p1_orange', 'Orange flag', v('p1_orange1')) +
    ny('p1_yellow', 'Yellow flag', [v('p1_yellow1'), v('p1_yellow2')].filter(Boolean).join(', ')) +
    row('Medical diagnosis', [d.p1_mdx1, d.p1_mdx2, d.p1_mdx3, d.p1_mdx4].filter(Boolean).map(mk).join(', ')) + row('PT diagnosis', v('p1_ptdx')) +
    row('การยินยอม', consent ? mk(consent) + (has('p1_consent_by') ? ' โดย ' + v('p1_consent_by') : '') : '');

  /* (2) Physical examination */
  const sym = n => { const k = recKn_('p2_sym', n); return has(k) || has(k + '_at') ? join([v(k), has(k + '_side') || has(k + '_at') ? 'of ' + mk(join([d[k + '_side'], d[k + '_at']])) : '']) : ''; };
  const nrs = join([has('p2_nrs_rest') ? 'Rest ' + mk(d.p2_nrs_rest + '/10') : '', has('p2_nrs_func') ? 'Function ' + mk(d.p2_nrs_func + '/10') : '']);
  const tenderAt = k => join([d[k + '_side'], d[k + '_at'], d[k + '_muscle']]);
  const romAt = k => join([d[k + '_type'], d[k + '_side'], d[k + '_joint'], d[k + '_dir'], has(k + '_deg') ? d[k + '_deg'] + '°' : '']);
  const tender = [d.p2_tender === 'yes' ? tenderAt('p2_tender') : '', tenderAt('p2_tender2')].filter(Boolean).map(mk).join(', ');
  const roms = [d.p2_rom === 'limit' ? romAt('p2_rom') : '', romAt('p2_rom2'), romAt('p2_rom3')].filter(Boolean).map(mk).join(', ');
  const left = row('Behavior of symptoms', [sym(1), sym(2)].filter(Boolean).join(' · ')) + row('NRS', nrs) + row('Frequency', v('p2_freq')) +
    row('Aggravate', v('p2_agg')) + row('Ease', v('p2_ease')) +
    (has('p2_tender') || full ? `<div class="r"><b>Tenderness</b><span class="v">${cb(d.p2_tender !== 'yes', 'None')}${cb(d.p2_tender === 'yes', 'Yes', tender)}</span></div>` : '') +
    (has('p2_rom') || roms || full ? `<div class="r"><b>ROM</b><span class="v">${cb(d.p2_rom === 'full', 'Full all direction')}${cb(d.p2_rom === 'limit' || !!roms, 'Limit at', roms)}</span></div>` : '');
  const POSTS = [['p2_post_fhp', 'Forward head'], ['p2_post_rs', 'Round shoulder'], ['p2_post_ws', 'Winged scapula'], ['p2_post_chin', 'Chin out'], ['p2_post_kyphosis', 'Thoracic kyphosis']];
  const incorrect = d.p2_post === 'incorrect';
  const post = has('p2_post') || full ? col('Posture', line(cb(d.p2_post === 'normal', 'Normal') + cb(incorrect, 'Incorrect')) +
    (incorrect || full ? POSTS.map(x => line(cb(incorrect && !!d[x[0]], x[1]))).join('') + (incorrect && has('p2_post_other') ? line(cb(true, d.p2_post_other)) : '') : '')) : '';
  // Special test และ Performance test: แสดงเฉพาะรายการที่ตรวจ (ไม่แสดงช่องว่างแม้ในฟอร์มเต็ม)
  const st = [['p2_st_upper', 'Shoulder / upper'], ['p2_st_lower', 'Lumbar / lower']].filter(x => d[x[0]] && (has(x[0] + '_test') || has(x[0] + '_res'))).map(x =>
    line(`<span class="cb on">${mk(x[1])} ${join([v(x[0] + '_test'), has(x[0] + '_res') ? ': ' + v(x[0] + '_res') : ''])}</span>`)).join('') +
    (d.p2_st_other && has('p2_st_other_note') ? line(`<span class="cb on">${mk('อื่น ๆ')} ${v('p2_st_other_note')}</span>`) : '');
  const age2 = recAge_(), sex2 = recSex_();
  const tests = ((REC.setup && REC.setup.tests) || []).filter(t => t.key !== 'eq5d' && t.key !== 'barthel');
  const testLine = t => {
    const k = 'pt_' + t.key, on = has(k);
    let detail = '';
    if (on) {
      const crit = recCriterion_(t, age2, sex2), n = Number(d[k]);
      detail = mk(d[k] + ' ' + t.unit) + (crit && isFinite(n) ? ` (${crit.below(n) ? 'ต่ำกว่าเกณฑ์' : 'ผ่านเกณฑ์'} ${esc_(crit.text)})` : '');
    }
    return on ? line(cb(true, t.askName && has(k + '_label') ? d[k + '_label'] : t.name, detail)) : '';
  };
  const perf = tests.map(testLine).join('') +
    (!(has('pt_eq5d') || has('pt_eq5d_vas')) ? '' : line(cb(true, 'EQ-5D-5L', join([has('pt_eq5d') ? 'utility ' + mk(d.pt_eq5d) : '', has('pt_eq5d_vas') ? 'VAS ' + mk(d.pt_eq5d_vas) : ''])))) +
    (has('pt_barthel') ? line(cb(true, 'Barthel ADL', mk(d.pt_barthel + '/20') + ' ' + mk(recBarthelGroup_(Number(d.pt_barthel))))) : '');
  const p2 = `<div class="two"><div>${left}</div>${post}</div>` + (st ? `<div class="grp">Special test</div><div class="lst">${st}</div>` : '') +
    `<div class="grp">Performance test</div>` + (perf ? `<div class="three">${perf}</div>` : '<div class="ln none">NA</div>');

  /* (3) Problem list · (4) Plan & goal */
  const prob = [
    ['p3_pain', 'Pain at', join([d.p3_pain_side, d.p3_pain_at, d.p3_pain_muscle])], ['p3_rom', 'ROM limited', join([d.p3_rom_joint, d.p3_rom_dir])],
    ['p3_imb', 'Muscle imbalance', d.p3_imb_muscle ? 'of ' + d.p3_imb_muscle : ''], ['p3_numb', 'Numbness', join([d.p3_numb_side, d.p3_numb_at])],
    ['p3_amb', 'Poor ambulation', ''], ['p3_decPerf', 'Decrease performance', ''], ['p3_hcm', 'Healthcare management', ''], ['p3_other', 'Others', d.p3_other_note || '']
  ].map(x => line(cb(!!d[x[0]], x[1], x[2] ? mk(x[2]) : ''))).join('') +
    (d.p3_decPerf && has('p3_decPerf_detail') ? `<div class="ln sm">${mk(d.p3_decPerf_detail).replace(/\n/g, '<br>')}</div>` : '');
  const plan = [['ex', 'Exercise'], ['mod', 'Modality'], ['hp', 'Health promotion'], ['nerve', 'Nerve mobilization'], ['amb', 'Ambulation/transfer training'], ['bal', 'Balance training'], ['home', 'Home program']]
    .map(x => line(cb(!!d['p4_plan_' + x[0]], x[1]))).join('') + line(cb(!!d.p4_plan_other, 'อื่น ๆ', v('p4_plan_other_note')));
  const within = (n, unit) => n ? ` ภายใน ${mk(n)} ${esc_(unit || '')}` : '';
  const stg = line(cb(!!d.p4_stg_pain, 'Relieve pain', within(d.p4_stg_pain_n, 'visit'))) + line(cb(!!d.p4_stg_follow, 'ปฏิบัติตามที่นักกายภาพสอนได้อย่างถูกต้อง', within(d.p4_stg_follow_n, 'visit'))) +
    line(cb(!!d.p4_stg_other, 'อื่น ๆ', v('p4_stg_other_note')));
  const ltg = line(cb(!!d.p4_ltg_perf, 'Increase physical performance')) + line(cb(!!d.p4_ltg_qol, 'Increase QOL')) +
    line(cb(!!d.p4_ltg_rtf, 'Return to function', join([v('p4_ltg_rtf_what'), within(d.p4_ltg_rtf_n, d.p4_ltg_rtf_unit)]))) +
    line(cb(!!d.p4_ltg_hcm, 'Improve skills for healthcare management', within(d.p4_ltg_hcm_n, d.p4_ltg_hcm_unit)));
  const goal = (stg ? '<div class="ln"><b>Short term</b></div>' + stg : '') + (ltg ? '<div class="ln"><b>Long term</b></div>' + ltg : '');
  const p34 = `<div class="three">${col('(3) Problem list', prob)}${col('(4) Plan of treatment', plan)}${col('(4) Goal', goal)}</div>`;

  /* (5) Intervention */
  const types = fam => { const out = []; for (let i = 1; i <= REC_TX_SLOTS; i++) { const k = 'p5_' + fam + i; if (has(k + '_type')) out.push(k); } return out; };
  const modRows = types('m'), exRows = types('e');
  const modText = k => join([has(k + '_side') || has(k + '_at') ? 'AT ' + mk(join([d[k + '_side'], d[k + '_at']])) : '', has(k + '_mode') ? 'Mode ' + v(k + '_mode') : '',
    has(k + '_int') ? 'Intensity ' + v(k + '_int') : '', has(k + '_pts') ? mk(d[k + '_pts'] + ' จุด') : '', has(k + '_min') ? mk(d[k + '_min'] + ' นาที/จุด') : '', v(k + '_note')]);
  const exText = k => join([has(k + '_side') || has(k + '_at') ? 'OF ' + mk(join([d[k + '_side'], d[k + '_at']])) : '', v(k + '_detail'),
    has(k + '_reps') ? mk(d[k + '_reps'] + ' ครั้ง/set') : '', has(k + '_sets') ? mk(d[k + '_sets'] + ' set/วัน') : '', has(k + '_days') ? mk(d[k + '_days'] + ' วัน/สัปดาห์') : '']);
  // ฟอร์มเต็ม: ชนิดทั้งหมดในรายการตัวเลือกเป็นกล่องให้ติ๊ก (ชนิดที่ทำแล้วขึ้นพร้อมรายละเอียด)
  const famLines = (rows, list, text) => {
    const used = rows.map(k => d[k + '_type']);
    const all = full ? ((REC.setup && REC.setup.options[list]) || []).filter(t => used.indexOf(t) === -1) : [];
    return rows.map(k => line(cb(true, d[k + '_type'], text(k)))).join('') + all.map(t => line(cb(false, t))).join('');
  };
  const aid = d.p5_amb_aid ? (/^(no\b|none|ไม่ใช้|ไม่มี)/i.test(d.p5_amb_aid) ? 'ไม่ใช้เครื่องช่วยเดิน' : 'with ' + d.p5_amb_aid) : '';
  const train = line(cb(!!d.p5_amb, 'Ambulation training', join([v('p5_amb_level'), v('p5_amb_pattern'), aid ? mk(aid) : '', v('p5_amb_note')]))) +
    line(cb(!!d.p5_tr, 'Transfer training', join([v('p5_tr_type'), v('p5_tr_level'), v('p5_tr_note')]))) +
    line(cb(!!d.p5_bal, 'Balance training', v('p5_bal_note'))) + line(cb(!!d.p5_other && has('p5_other_note'), 'อื่น ๆ', v('p5_other_note'))) +
    line(cb(!!d.p5_behav, 'ปรับพฤติกรรม', 'all times')) +
    line(cb(!!d.p5_pa, 'Increase PA', join([has('p5_pa_min') ? mk(d.p5_pa_min + ' นาที/วัน') : '', has('p5_pa_days') ? mk(d.p5_pa_days + ' วัน/สัปดาห์') : ''])));
  const edu = [d.p5_edu1, d.p5_edu2, d.p5_edu_note].filter(Boolean);
  const after = row('คำแนะนำ', edu.map(mk).join(' · ')) + (d.p5_hp || full ? `<div class="r"><b>Home program</b><span class="v">${cb(!!d.p5_hp, 'ให้ Home program', v('p5_hp_note'))}</span></div>` : '') +
    row('NRS ก่อน / หลังรักษา', has('p5_nrs_pre') || has('p5_nrs_post') ? join([has('p5_nrs_pre') ? 'ก่อน ' + mk(d.p5_nrs_pre + '/10') : '', has('p5_nrs_post') ? 'หลัง ' + mk(d.p5_nrs_post + '/10') : '']) : '');
  const p5 = `<div class="two">${col('Modality / Manual', famLines(modRows, 'modality', modText))}${col('Exercise / Training', famLines(exRows, 'exercise', exText) + train)}</div>${after}`;

  const part = (label, body) => `<div class="part"><div class="side"><span>${label}</span></div><div class="body">${body || '<span class="none">ไม่ได้บันทึก</span>'}</div></div>`;
  const signer = pnSigner_(d.pn_sign);
  const by = meta.updatedBy || meta.createdBy;
  const stamp = meta.updatedAt || meta.createdAt;
  return `
    <table class="pn-tbl"><thead><tr><td><div class="pn-run">${esc_(name)} · PTN ${esc_(p.ptn)} · ${esc_(pnDate_(date, 'th'))}</div></td></tr></thead><tbody><tr><td>
    <div class="pn-org">${esc_(PN_ORG[0])}<small>${esc_(PN_ORG[1])}</small></div>
    <div class="pn-ttl">แบบบันทึกทางกายภาพบำบัด</div>
    <div class="idrow"><div><b>PTN</b> ${esc_(p.ptn)}</div><div><b>ชื่อ-สกุล</b> ${esc_(name)}</div><div><b>เพศ</b> ${sexText}</div><div><b>อายุ</b> ${age !== null ? age + ' ปี' : '-'}</div>
      <div><b>Session</b> ${esc_(meta.session)}</div><div><b>Consult date</b> ${has('p1_consult') ? esc_(pnDate_(d.p1_consult, 'th')) : '-'}</div>
      <div><b>วันที่รับบริการ</b> ${esc_(pnDate_(date, 'th'))}${has('p2_time') ? ' เวลา ' + esc_(d.p2_time) + ' น.' : ''}</div><div><b>รอคอย</b> ${wait === null ? '-' : wait + ' วัน'}</div></div>
    ${part('(1) Personal Data', p1)}${part('(2) Physical Examination', p2)}${part('(3) Problem · (4) Plan &amp; Goal', p34)}${part('(5) Intervention', p5)}
    <div class="pn-keep"><div class="pn-sign"><div class="pn-sign-box">
      <div class="pn-sign-line">ลงชื่อ ......................................................</div>
      <div>( ${signer.name ? mk(signer.name) : '......................................................'} )</div>
      <div>นักกายภาพบำบัด เลขที่ใบอนุญาต ${signer.license ? mk(signer.license) : '..................'}</div>
      <div>วันที่ ${esc_(pnDate_(date, 'th'))}</div></div></div>
    <div class="pn-foot">${meta.id && meta.status === 'final' ? `บันทึกในระบบโดย ${esc_(by)}${stamp ? ' เมื่อ ' + pnStamp_(stamp, 'th') : ''}` : 'ฉบับร่าง ยังไม่ได้บันทึกเป็นเวชระเบียน'}</div></div>
    </td></tr></tbody></table>`;
}
