// =========================================================================
// ตั้งค่ารหัสไฟล์ Google Sheets (นำรหัสระหว่าง /d/ กับ /edit มาวางแทนที่ด้านล่าง)
// =========================================================================
const SPREADSHEET_ID = '1_IeTWmD1E6URJpAJo_xUE41ohTWBEucqk-oKRmbUs8s';

const STORAGE_KEY = 'indchem2569_planner_v1';
const SHEETS = [
  'Courses',
  'Course_Conditions',
  'Elective_Tracks',
  'Study_Plans',
  'Curriculum_Rules',
  'PLOs',
  'PLO_CLO_Mapping'
];

// Global Database
const DB = {
  courses: [],
  courseMap: {},
  conditions: [],
  condByCourse: {},
  unlocksByCourse: {},
  tracks: [],
  trackNames: {},
  tracksByCourse: {}, // course_id -> [{ trackId, trackName, isCommon }]
  studyPlans: [],
  rules: [],
  plos: {},
  cloByCourse: {}
};

// User App State
let STATE = {
  planType: 'Regular',       // 'Regular' | 'Coop'
  selectedTrack: '',
  flexibleMode: false,
  maxYear: 4,
  extraSummers: [],          // e.g. [1, 2]
  items: []                  // { uid, slotGroupId, isSplitChild, isTrackOverflow, year, sem, courseId, originalCourseId, title, originalTitle, credits, originalCredits, category, isPlaceholder, isExtra, placeholderRule, trackNote, status }
};

let SELECTED_COURSE_ID = null;
let PICKER_CTX = null;       // { mode: 'replace' | 'add', uid, year, sem, category }
let MOVE_UID = null;
let RECENTLY_UPDATED_UIDS = new Set();
let FLASH_TIMER = null;

function isCommonOptionRow(trackRow) {
  return String(trackRow && trackRow.is_common_option).trim().toUpperCase() === 'TRUE';
}

// =========================================================================
// 0. UI Effects (Toast Notification, Flash Highlight, Active Track Banner)
// =========================================================================
function injectEffectStyles() {
  if (document.getElementById('trackEffectStyles')) return;
  const style = document.createElement('style');
  style.id = 'trackEffectStyles';
  style.textContent = `
    .toast-container {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 400px;
      width: calc(100% - 40px);
      pointer-events: none;
    }
    .toast-msg {
      pointer-events: auto;
      background: #0f172a;
      color: #f8fafc;
      border-left: 5px solid #10b981;
      border-radius: 10px;
      padding: 12px 14px;
      box-shadow: 0 10px 25px rgba(15, 23, 42, 0.25);
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      animation: toastSlideIn 0.28s ease-out;
      transition: opacity 0.3s ease, transform 0.3s ease;
    }
    .toast-msg.hiding {
      opacity: 0;
      transform: translateY(10px);
    }
    .toast-title {
      font-weight: 700;
      font-size: 0.92rem;
      margin-bottom: 3px;
      color: #6ee7b7;
    }
    .toast-desc {
      font-size: 0.84rem;
      line-height: 1.45;
      color: #e2e8f0;
    }
    .toast-close {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 1.15rem;
      line-height: 1;
      cursor: pointer;
      padding: 2px 4px;
    }
    .toast-close:hover {
      color: #ffffff;
    }
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes cardFlashGlow {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.65); background-color: #d1fae5; border-color: #10b981; }
      35% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0.25); background-color: #ecfdf5; border-color: #10b981; }
      70% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15); background-color: #ecfdf5; border-color: #34d399; }
      100% { box-shadow: none; }
    }
    .course-card.just-updated {
      animation: cardFlashGlow 2.8s ease-out;
    }
    .active-track-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-left: 4px solid #059669;
      color: #065f46;
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.88rem;
    }
    .active-track-banner strong {
      color: #064e3b;
    }
    .tag-overflow {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fcd34d;
    }
    @media print {
      .toast-container, .active-track-banner .btn { display: none !important; }
    }
  `;
  document.head.appendChild(style);
}

function hideLegacyLegendBar() {
  const stopTags = new Set(['BODY', 'HTML', 'MAIN', 'HEADER', 'FOOTER']);
  const stopIds = new Set(['appRoot', 'roadmapContainer', 'summaryGrid']);

  const selBar = document.getElementById('selectionStatus');
  if (selBar) {
    let target = selBar;
    let cur = selBar.parentElement;
    while (cur && !stopTags.has(cur.tagName) && !stopIds.has(cur.id)) {
      if (cur.querySelector('#roadmapContainer') || cur.querySelector('#summaryGrid')) break;
      target = cur;
      if (cur.textContent && cur.textContent.includes('สัญลักษณ์สายโซ่วิชา')) break;
      cur = cur.parentElement;
    }
    target.style.display = 'none';
  }

  const root = document.getElementById('appRoot') || document.body;
  root.querySelectorAll('div, section').forEach(el => {
    if (stopIds.has(el.id)) return;
    if (el.querySelector('#roadmapContainer') || el.querySelector('#summaryGrid')) return;
    if (el.textContent && el.textContent.includes('สัญลักษณ์สายโซ่วิชา')) {
      el.style.display = 'none';
    }
  });
}

function showToast(title, description, duration = 4800) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast-msg';
  toast.innerHTML = `
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-desc">${description}</div>
    </div>
    <button class="toast-close" aria-label="ปิด">&times;</button>
  `;

  const dismiss = () => {
    if (toast.classList.contains('hiding')) return;
    toast.classList.add('hiding');
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  container.appendChild(toast);
  setTimeout(dismiss, duration);
}

function scrollToYear(year) {
  const el = document.getElementById(`year-section-${year}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// =========================================================================
// 1. Data Loading & RFC 4180 CSV Parser
// =========================================================================
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field.trim());
        field = '';
      } else if (c === '\r' && next === '\n') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (c === '\n') {
        row.push(field.trim());
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, '').trim());
  return rows.slice(1)
    .filter(r => r.some(cell => cell !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ไม่สามารถอ่านชีต ${sheetName} ได้ (HTTP ${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

async function initApp() {
  injectEffectStyles();
  hideLegacyLegendBar();
  const loadingBox = document.getElementById('loadingBox');
  if (!SPREADSHEET_ID || SPREADSHEET_ID === 'PUT_YOUR_GOOGLE_SHEET_ID_HERE') {
    loadingBox.classList.add('error');
    loadingBox.innerHTML = '<strong>ยังไม่ได้ใส่รหัส Google Sheets</strong><br>กรุณาแก้ไขบรรทัด SPREADSHEET_ID ในไฟล์ app.js แล้วบันทึกลง GitHub อีกครั้งครับ';
    return;
  }

  try {
    const results = await Promise.all(SHEETS.map(s => fetchSheet(s)));
    const [courses, conditions, tracks, studyPlans, rules, plos, cloMapping] = results;

    // Process Courses
    DB.courses = courses.map(c => ({
      ...c,
      credits: Number(c.credits) || 0
    }));
    DB.courses.forEach(c => { if (c.course_id) DB.courseMap[c.course_id] = c; });

    // Process Conditions
    DB.conditions = conditions;
    conditions.forEach(cond => {
      if (!DB.condByCourse[cond.course_id]) DB.condByCourse[cond.course_id] = [];
      DB.condByCourse[cond.course_id].push(cond);

      if (cond.condition_type === 'PREREQUISITE' || cond.condition_type === 'COREQUISITE') {
        if (!DB.unlocksByCourse[cond.condition_course_id]) DB.unlocksByCourse[cond.condition_course_id] = [];
        if (!DB.unlocksByCourse[cond.condition_course_id].includes(cond.course_id)) {
          DB.unlocksByCourse[cond.condition_course_id].push(cond.course_id);
        }
      }
    });

    // Process Tracks
    DB.tracks = tracks;
    tracks.forEach(t => {
      const tName = t.track_name_th || t.track_id;
      const isCommon = isCommonOptionRow(t);
      if (t.track_id && !DB.trackNames[t.track_id]) {
        DB.trackNames[t.track_id] = tName;
      }
      if (t.course_id && t.track_id) {
        if (!DB.tracksByCourse[t.course_id]) DB.tracksByCourse[t.course_id] = [];
        const existing = DB.tracksByCourse[t.course_id].find(x => x.trackId === t.track_id);
        if (!existing) {
          DB.tracksByCourse[t.course_id].push({
            trackId: t.track_id,
            trackName: tName,
            isCommon
          });
        } else if (!isCommon) {
          existing.isCommon = false;
        }
      }
    });

    // Process Study Plans, Rules, PLOs, CLOs
    DB.studyPlans = studyPlans;
    DB.rules = rules;
    plos.forEach(p => { DB.plos[p.outcome_id] = p; });
    cloMapping.forEach(m => {
      if (!DB.cloByCourse[m.course_id]) DB.cloByCourse[m.course_id] = [];
      DB.cloByCourse[m.course_id].push(m);
    });

    populateTrackDropdown();
    loadOrBuildState();

    loadingBox.style.display = 'none';
    document.getElementById('appRoot').style.display = 'block';
    hideLegacyLegendBar();
    renderAll();
  } catch (err) {
    loadingBox.classList.add('error');
    loadingBox.innerHTML = `<strong>เกิดข้อผิดพลาดในการโหลดข้อมูลจาก Google Sheets</strong><br>${err.message}<br><small>กรุณาตรวจสอบว่าเปิดสิทธิ์แชร์ไฟล์เป็น Anyone with the link (Viewer) แล้ว</small>`;
  }
}

function populateTrackDropdown() {
  const sel = document.getElementById('trackSelect');
  sel.innerHTML = '<option value="">-- เลือกสายความเชี่ยวชาญ --</option>';
  Object.entries(DB.trackNames).forEach(([id, name]) => {
    sel.innerHTML += `<option value="${id}">${name}</option>`;
  });
}

// =========================================================================
// 2. State Management & Credit-Aware Slot Splitting / Overflow
// =========================================================================
function buildDefaultItems(planType) {
  const allowedTypes = planType === 'Coop'
    ? ['Regular_and_Coop', 'Coop_Only']
    : ['Regular_and_Coop', 'Regular_Only'];

  return DB.studyPlans
    .filter(p => allowedTypes.includes(p.plan_type))
    .map((p, idx) => {
      const isPh = String(p.is_placeholder).toUpperCase() === 'TRUE';
      const cInfo = DB.courseMap[p.course_id];
      const baseCredits = cInfo ? cInfo.credits : (Number(p.credits) || 0);
      const uid = `slot_${idx}_${p.course_id}`;
      return {
        uid,
        slotGroupId: uid,
        isSplitChild: false,
        isTrackOverflow: false,
        year: Number(p.year_level) || 1,
        sem: Number(p.semester) || 1,
        courseId: p.course_id,
        originalCourseId: p.course_id,
        title: cInfo ? cInfo.title_th : p.course_title_th,
        originalTitle: p.course_title_th,
        credits: baseCredits,
        originalCredits: baseCredits,
        category: p.course_type || (cInfo ? cInfo.course_category : 'Major_Required'),
        isPlaceholder: isPh,
        isExtra: false,
        placeholderRule: p.placeholder_rule || '',
        trackNote: '',
        status: 'planned'
      };
    });
}

function createRemainderSlot(parentSlot, remCredits) {
  if (remCredits <= 0) return null;
  const groupId = parentSlot.slotGroupId || parentSlot.uid;
  parentSlot.slotGroupId = groupId;
  const childUid = `${groupId}_sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const childSlot = {
    uid: childUid,
    slotGroupId: groupId,
    isSplitChild: true,
    isTrackOverflow: false,
    year: parentSlot.year,
    sem: parentSlot.sem,
    courseId: parentSlot.originalCourseId,
    originalCourseId: parentSlot.originalCourseId,
    title: `${parentSlot.originalTitle} (คงเหลือ ${remCredits} หน่วยกิต)`,
    originalTitle: parentSlot.originalTitle,
    credits: remCredits,
    originalCredits: remCredits,
    category: parentSlot.category,
    isPlaceholder: true,
    isExtra: false,
    placeholderRule: parentSlot.placeholderRule || '',
    trackNote: '',
    status: 'planned'
  };
  const idx = STATE.items.findIndex(i => i.uid === parentSlot.uid);
  if (idx !== -1) {
    STATE.items.splice(idx + 1, 0, childSlot);
  } else {
    STATE.items.push(childSlot);
  }
  return childSlot;
}

function createTrackOverflowItem(year, sem, candidate, credits) {
  const cInfo = DB.courseMap[candidate.course_id];
  const uid = `trk_overflow_${Date.now()}_${Math.random().toString(36).slice(2, 6)}_${candidate.course_id}`;
  const item = {
    uid,
    slotGroupId: uid,
    isSplitChild: false,
    isTrackOverflow: true,
    year,
    sem,
    courseId: candidate.course_id,
    originalCourseId: candidate.course_id,
    title: cInfo ? cInfo.title_th : candidate.course_title_th,
    originalTitle: cInfo ? cInfo.title_th : candidate.course_title_th,
    credits,
    originalCredits: credits,
    category: 'Major_Elective',
    isPlaceholder: false,
    isExtra: true,
    placeholderRule: '',
    trackNote: '',
    status: 'planned'
  };

  // แทรกต่อท้ายวิชาสุดท้ายในชั้นปีและเทอมเดียวกัน
  let insertIdx = -1;
  for (let i = STATE.items.length - 1; i >= 0; i--) {
    if (STATE.items[i].year === year && STATE.items[i].sem === sem) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx !== -1) {
    STATE.items.splice(insertIdx, 0, item);
  } else {
    STATE.items.push(item);
  }
  return item;
}

function loadOrBuildState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
        STATE = parsed;
        STATE.items.forEach(it => {
          if (!it.slotGroupId) it.slotGroupId = it.uid;
          if (it.isSplitChild === undefined) it.isSplitChild = false;
          if (it.isTrackOverflow === undefined) it.isTrackOverflow = false;
        });
        syncControlsFromState();
        return;
      }
    }
  } catch (e) {}
  STATE.items = buildDefaultItems(STATE.planType);
  saveState();
  syncControlsFromState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE));
}

function syncControlsFromState() {
  document.getElementById('btnPlanRegular').classList.toggle('active', STATE.planType === 'Regular');
  document.getElementById('btnPlanCoop').classList.toggle('active', STATE.planType === 'Coop');
  document.getElementById('trackSelect').value = STATE.selectedTrack || '';
  document.getElementById('flexModeToggle').checked = !!STATE.flexibleMode;
  document.getElementById('flexSwitchLabel').classList.toggle('active', !!STATE.flexibleMode);
  document.getElementById('flexExtraBar').style.display = STATE.flexibleMode ? 'flex' : 'none';
}

function switchPlanType(newType) {
  if (STATE.planType === newType) return;
  if (!confirm('การเปลี่ยนแผนการศึกษาจะรีเซ็ตตารางให้ตรงตามแผนที่เลือก (สถานะวิชาที่ติ๊กผ่านไว้จะถูกเก็บไว้ให้) ต้องการดำเนินการต่อหรือไม่?')) return;
  const passedMap = {};
  STATE.items.forEach(it => {
    if (it.status === 'passed') passedMap[it.courseId] = true;
  });
  STATE.planType = newType;
  STATE.maxYear = 4;
  STATE.extraSummers = [];
  STATE.items = buildDefaultItems(newType).map(it => ({
    ...it,
    status: passedMap[it.courseId] ? 'passed' : 'planned'
  }));
  RECENTLY_UPDATED_UIDS.clear();
  saveState();
  syncControlsFromState();
  renderAll();
}

function toggleFlexibleMode(enabled) {
  STATE.flexibleMode = enabled;
  saveState();
  syncControlsFromState();
  renderAll();
}

function resetToDefault() {
  if (!confirm('ต้องการล้างการปรับแต่งทั้งหมดและคืนค่ากลับสู่แผนมาตรฐานหรือไม่?')) return;
  STATE.selectedTrack = '';
  STATE.maxYear = 4;
  STATE.extraSummers = [];
  STATE.items = buildDefaultItems(STATE.planType);
  SELECTED_COURSE_ID = null;
  RECENTLY_UPDATED_UIDS.clear();
  saveState();
  syncControlsFromState();
  renderAll();
  showToast('คืนค่าแผนมาตรฐานเรียบร้อย', 'ล้างการปรับแต่งและวิชาที่เลือกไว้ทั้งหมดแล้วครับ');
}

function applySelectedTrack() {
  const trackId = document.getElementById('trackSelect').value;
  if (!trackId) {
    showToast('กรุณาเลือกสายความเชี่ยวชาญ', 'เลือกกลุ่มความเชี่ยวชาญจากรายการด้านซ้ายก่อนกดปุ่มนี้ครับ', 3200);
    return;
  }
  STATE.selectedTrack = trackId;
  const trackName = DB.trackNames[trackId] || trackId;

  // ล้างช่องย่อยที่เคยแตกและช่องที่เคยงอกเกินของสายเก่าออกก่อน
  STATE.items = STATE.items.filter(i =>
    !(i.isSplitChild && i.category === 'Major_Elective') &&
    !i.isTrackOverflow
  );

  const requiredIds = new Set(STATE.items.filter(i => !i.isPlaceholder).map(i => i.courseId));
  const allTrackRows = DB.tracks.filter(t => t.track_id === trackId);
  const trackCourses = allTrackRows
    .filter(t => t.course_id && !requiredIds.has(t.course_id))
    .sort((a, b) => (a.priority_level || '').localeCompare(b.priority_level || ''));

  const coreTrackCourses = trackCourses.filter(t => !isCommonOptionRow(t));
  const commonTrackCourses = trackCourses.filter(t => isCommonOptionRow(t));

  const fallbackNoteObj = allTrackRows.find(t => t.fallback_note_th && t.fallback_note_th.trim());
  const fallbackNote = fallbackNoteObj ? fallbackNoteObj.fallback_note_th.trim() : '';

  const majorElecSlots = STATE.items.filter(i => i.isPlaceholder && i.category === 'Major_Elective');
  const baseMajorElecCredits = majorElecSlots.reduce((sum, s) => sum + (s.originalCredits || 3), 0);

  // รีเซ็ตช่องวิชาเอกเลือกมาตรฐานทั้งหมดกลับสู่ค่าตั้งต้น
  majorElecSlots.forEach(slot => {
    const origInfo = DB.courseMap[slot.originalCourseId];
    slot.slotGroupId = slot.slotGroupId || slot.uid;
    slot.courseId = slot.originalCourseId;
    slot.title = origInfo ? origInfo.title_th : slot.originalTitle;
    slot.credits = slot.originalCredits || (origInfo ? origInfo.credits : 3);
    slot.trackNote = '';
  });

  const usedIds = new Set();
  const filledSlotUids = new Set();
  const overflowItems = [];

  const getCourseCredits = (tc) => {
    const cInfo = DB.courseMap[tc.course_id];
    const cr = cInfo ? cInfo.credits : Number(tc.credits);
    return cr > 0 ? cr : 3;
  };

  const findBestSlot = (filterFn, cr) => {
    const eligible = majorElecSlots.filter(slot =>
      !filledSlotUids.has(slot.uid) &&
      cr <= slot.credits &&
      filterFn(slot)
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.credits - b.credits);
    return eligible[0];
  };

  const assignToSlot = (slot, candidate) => {
    usedIds.add(candidate.course_id);
    filledSlotUids.add(slot.uid);
    const cInfo = DB.courseMap[candidate.course_id];
    const cr = getCourseCredits(candidate);
    const rem = slot.credits - cr;

    slot.courseId = candidate.course_id;
    slot.title = cInfo ? cInfo.title_th : candidate.course_title_th;
    slot.credits = cr;
    slot.trackNote = '';

    if (rem > 0) {
      const child = createRemainderSlot(slot, rem);
      if (child) majorElecSlots.push(child);
    }
  };

  const fillSlotsWithPool = (pool, allowOverflow) => {
    // รอบที่ 1: จับคู่ตรงทั้งชั้นปี (recommended_year) และภาคเรียน (recommended_sem)
    pool.forEach(tc => {
      if (usedIds.has(tc.course_id)) return;
      const recY = Number(tc.recommended_year);
      const recS = Number(tc.recommended_sem);
      if (!recY || !recS) return;
      const cr = getCourseCredits(tc);
      const slot = findBestSlot(s => s.year === recY && s.sem === recS, cr);
      if (slot) {
        assignToSlot(slot, tc);
      } else if (allowOverflow) {
        // ในแผนสหกิจศึกษา ไม่สร้างช่องงอกเพิ่มลงปี 4 เทอม 2 (ช่วงออกสหกิจศึกษา)
        const isCoopBlockedTerm = STATE.planType === 'Coop' && recY === 4 && recS === 2;
        if (!isCoopBlockedTerm) {
          usedIds.add(tc.course_id);
          const ovItem = createTrackOverflowItem(recY, recS, tc, cr);
          overflowItems.push(ovItem);
        }
      }
    });

    // รอบที่ 2: จับคู่ตรงภาคเรียนที่แนะนำ (recommended_sem) หรือเทอมที่เปิดสอน (open_term_suggested)
    pool.forEach(tc => {
      if (usedIds.has(tc.course_id)) return;
      const recS = Number(tc.recommended_sem);
      const cInfo = DB.courseMap[tc.course_id];
      const cr = getCourseCredits(tc);
      const slot = findBestSlot(s =>
        recS === s.sem ||
        (cInfo && cInfo.open_term_suggested && cInfo.open_term_suggested.includes(`T${s.sem}`)),
        cr
      );
      if (slot) assignToSlot(slot, tc);
    });

    // รอบที่ 3: เติมรายวิชาที่เหลือลงในช่องว่างที่ยังเหลือ
    pool.forEach(tc => {
      if (usedIds.has(tc.course_id)) return;
      const cr = getCourseCredits(tc);
      const slot = findBestSlot(() => true, cr);
      if (slot) assignToSlot(slot, tc);
    });
  };

  // ขั้นที่ 1: ลงวิชาเฉพาะกลุ่มหลัก (is_common_option = FALSE) โดยอนุญาตให้งอกช่องเพิ่มตามเทอมแนะนำได้
  fillSlotsWithPool(coreTrackCourses, true);

  // ขั้นที่ 2: เติมวิชาตัวเลือกร่วมของกลุ่มนั้น (is_common_option = TRUE) เฉพาะในช่องว่างที่เหลือ
  fillSlotsWithPool(commonTrackCourses, false);

  // ขั้นที่ 3: ช่องที่ยังว่างอยู่หลังเติมครบทั้ง 2 ขั้น ให้แสดงคำแนะนำ fallback_note_th
  majorElecSlots.forEach(slot => {
    if (!filledSlotUids.has(slot.uid) && fallbackNote) {
      slot.trackNote = fallbackNote;
    }
  });

  // เก็บรายการช่องที่อัปเดตและช่องที่งอกเพิ่มเพื่อให้เกิดเอฟเฟกต์กระพริบเน้นสี
  RECENTLY_UPDATED_UIDS = new Set([
    ...majorElecSlots.map(s => s.uid),
    ...overflowItems.map(o => o.uid)
  ]);
  if (FLASH_TIMER) clearTimeout(FLASH_TIMER);

  saveState();
  renderAll();

  const targetYear = majorElecSlots.length > 0
    ? Math.min(...majorElecSlots.map(s => s.year))
    : 3;
  scrollToYear(targetYear);

  // สรุปผลและแจ้งเตือนกรณีลงเกินเกณฑ์ขั้นต่ำ
  const totalPlacedCount = filledSlotUids.size + overflowItems.length;
  const remainingSlots = majorElecSlots.filter(s => !filledSlotUids.has(s.uid));
  const remainingCredits = remainingSlots.reduce((sum, s) => sum + s.credits, 0);
  const overflowCredits = overflowItems.reduce((sum, o) => sum + o.credits, 0);

  const plannedMajorElecCredits = STATE.items
    .filter(i => i.status !== 'failed' && i.category === 'Major_Elective')
    .reduce((sum, i) => sum + i.credits, 0);
  const overMinCredits = Math.max(0, plannedMajorElecCredits - baseMajorElecCredits);

  let desc = `จัดวางวิชาสาย ${trackName} ลงตารางปี 3–4 จำนวน ${totalPlacedCount} วิชาเรียบร้อยแล้ว`;
  if (overflowItems.length > 0) {
    desc += ` (งอกเพิ่มตามเทอมแนะนำ ${overflowItems.length} วิชา / +${overflowCredits} นก.)`;
  }
  if (remainingSlots.length > 0) {
    desc += ` เหลือช่องว่าง ${remainingSlots.length} ช่อง (${remainingCredits} นก.)`;
  }
  if (overMinCredits > 0) {
    desc += `<br><span style="color:#fde68a;font-weight:600;">หมายเหตุ: วางแผนวิชาเอกเลือกเกินเกณฑ์ขั้นต่ำ +${overMinCredits} หน่วยกิต (กดปุ่มลบบนการ์ดที่งอกเพิ่มได้หากไม่ต้องการเรียนเกิน)</span>`;
  }
  showToast('จัดวิชาตามแพ็กเกจเรียบร้อย', desc, overMinCredits > 0 ? 6000 : 4500);

  FLASH_TIMER = setTimeout(() => {
    RECENTLY_UPDATED_UIDS.clear();
    document.querySelectorAll('.course-card.just-updated').forEach(el => {
      el.classList.remove('just-updated');
    });
  }, 3000);
}

// =========================================================================
// 3. Validation Engine
// =========================================================================
function termOrder(year, sem) {
  return year * 10 + sem;
}

function validateItem(item) {
  const warnings = [];
  if (item.status === 'failed') return warnings;
  const cInfo = DB.courseMap[item.courseId];
  const myOrder = termOrder(item.year, item.sem);

  // 1) ตรวจสอบเทอมที่เปิดสอนจริง
  if (cInfo && cInfo.offered_terms && cInfo.offered_terms !== 'VERIFY') {
    const offered = cInfo.offered_terms.split(',').map(s => s.trim().toUpperCase());
    const curTermTag = item.sem === 3 ? 'SUMMER' : `T${item.sem}`;
    if (offered.length > 0 && !offered.includes(curTermTag) && !offered.includes('ALL')) {
      warnings.push(`ปกติวิชานี้เปิดสอนเฉพาะ ${cInfo.offered_terms}`);
    }
  }

  // 2) ตรวจสอบ Prerequisite / Corequisite / Year Status
  const conds = DB.condByCourse[item.courseId] || [];
  if (conds.length > 0) {
    const groups = {};
    conds.forEach(c => {
      const g = c.condition_group || 'GRP_1';
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });

    const isAnyGroupOR = conds.some(c => String(c.logic_operator).toUpperCase() === 'OR');
    const groupResults = Object.values(groups).map(gConds => {
      const gMissing = [];
      gConds.forEach(c => {
        if (c.condition_type === 'YEAR_STATUS') {
          const reqYear = Number(String(c.condition_course_id).replace(/\D/g, '')) || 1;
          if (item.year < reqYear) gMissing.push(c.condition_note_th || `ต้องอยู่ชั้นปีที่ ${reqYear} ขึ้นไป`);
        } else if (c.condition_type === 'PREREQUISITE') {
          const ok = STATE.items.some(other =>
            other.courseId === c.condition_course_id &&
            other.status !== 'failed' &&
            (termOrder(other.year, other.sem) < myOrder)
          );
          if (!ok) gMissing.push(`ต้องลงผ่าน ${c.condition_course_id} ในเทอมก่อนหน้า`);
        } else if (c.condition_type === 'COREQUISITE') {
          const ok = STATE.items.some(other =>
            other.courseId === c.condition_course_id &&
            other.status !== 'failed' &&
            (termOrder(other.year, other.sem) <= myOrder)
          );
          if (!ok) gMissing.push(`ต้องลงควบหรือผ่าน ${c.condition_course_id}`);
        }
      });
      return { passed: gMissing.length === 0, missing: gMissing };
    });

    if (isAnyGroupOR) {
      if (!groupResults.some(r => r.passed)) {
        warnings.push(conds[0].condition_note_th || 'ไม่ผ่านเงื่อนไขวิชาบังคับก่อน/วิชาควบ');
      }
    } else {
      groupResults.forEach(r => {
        if (!r.passed) warnings.push(...r.missing);
      });
    }
  }

  return [...new Set(warnings)];
}

// =========================================================================
// 4. Credit Calculation & Summary Rendering
// =========================================================================
function getCategoryGroup(cat) {
  if (!cat) return 'MajorReq';
  if (cat === 'Minor_Extra') return 'Minor';
  if (cat.startsWith('GE')) return 'GE';
  if (cat.startsWith('Core')) return 'Core';
  if (cat === 'Major_Elective') return 'MajorElec';
  if (cat === 'Free_Elective') return 'Free';
  return 'MajorReq';
}

function getRuleMin(ruleId, fallback) {
  const r = DB.rules.find(x => x.rule_id === ruleId);
  return r ? (Number(r.min_credits) || fallback) : fallback;
}

function renderSummary() {
  const activeItems = STATE.items.filter(i => i.status !== 'failed');
  const calc = (fn) => ({
    passed: activeItems.filter(i => i.status === 'passed' && fn(i)).reduce((s, i) => s + i.credits, 0),
    planned: activeItems.filter(fn).reduce((s, i) => s + i.credits, 0)
  });

  const total = calc(() => true);
  const ge = calc(i => getCategoryGroup(i.category) === 'GE');
  const core = calc(i => getCategoryGroup(i.category) === 'Core');
  const majorAll = calc(i => ['MajorReq', 'MajorElec'].includes(getCategoryGroup(i.category)));
  const major300 = calc(i => {
    if (!['MajorReq', 'MajorElec'].includes(getCategoryGroup(i.category))) return false;
    const m = String(i.courseId).match(/^\d{3}(\d)/);
    return m && Number(m[1]) >= 3;
  });
  const free = calc(i => getCategoryGroup(i.category) === 'Free');
  const minor = calc(i => getCategoryGroup(i.category) === 'Minor');

  const cards = [
    { title: 'หน่วยกิตรวมตลอดหลักสูตร', data: total, target: getRuleMin('TOTAL_CREDITS', 135) },
    { title: 'หมวดวิชาศึกษาทั่วไป (GE)', data: ge, target: getRuleMin('GE_TOTAL', 24) },
    { title: 'วิชาแกนวิทยาศาสตร์', data: core, target: getRuleMin('CORE_TOTAL', 29) },
    { title: 'วิชาเอก (บังคับ + เลือก)', data: majorAll, target: getRuleMin('MAJOR_TOTAL', 76) },
    { title: 'วิชาเอกระดับ 300 ขึ้นไป', data: major300, target: getRuleMin('MAJOR_LVL300_PLUS', 36) },
    { title: 'วิชาเลือกเสรี', data: free, target: getRuleMin('FREE_ELEC', 6) }
  ];

  const grid = document.getElementById('summaryGrid');
  let html = cards.map(c => {
    const pct = Math.min(100, Math.round((c.data.passed / c.target) * 100));
    const isDone = c.data.passed >= c.target;
    const extraPassed = c.data.passed - c.target;
    const extraPlanned = c.data.planned - c.target;

    let statusText = `ในแผน ${c.data.planned}`;
    if (isDone) {
      statusText = extraPassed > 0
        ? `<span style="color:var(--success);font-weight:600;">ผ่านเกิน +${extraPassed} นก.</span>`
        : `<span style="color:var(--success);font-weight:600;">ครบเกณฑ์</span>`;
    } else if (extraPlanned > 0) {
      statusText = `<span style="color:#b45309;font-weight:600;">ในแผน ${c.data.planned} (เกินขั้นต่ำ +${extraPlanned})</span>`;
    }

    return `
      <div class="stat-card">
        <div class="stat-title">${c.title}</div>
        <div class="stat-value">
          <span>${c.data.passed} / ${c.target} <span style="font-size:0.78rem;font-weight:500;">นก.</span></span>
          <span class="stat-sub">${statusText}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${isDone ? 'done' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');

  if (minor.planned > 0) {
    html += `
      <div class="stat-card" style="border-color:#d8b4fe;background:#faf5ff;">
        <div class="stat-title" style="color:#7e22ce;">วิชาโท / เรียนเพิ่มนอกแผน</div>
        <div class="stat-value" style="color:#7e22ce;">
          <span>${minor.passed} <span style="font-size:0.78rem;font-weight:500;">นก.</span></span>
          <span class="stat-sub">ลงไว้ ${minor.planned} นก.</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${minor.planned ? Math.round((minor.passed / minor.planned) * 100) : 0}%;background:#9333ea;"></div>
        </div>
      </div>
    `;
  }

  grid.innerHTML = html;
}

// =========================================================================
// 5. Roadmap Rendering
// =========================================================================
function getHighlightRole(courseId) {
  if (!SELECTED_COURSE_ID) return null;
  if (courseId === SELECTED_COURSE_ID) return 'selected';

  const selConds = DB.condByCourse[SELECTED_COURSE_ID] || [];
  if (selConds.some(c => c.condition_type === 'PREREQUISITE' && c.condition_course_id === courseId)) return 'prereq';
  if (selConds.some(c => c.condition_type === 'COREQUISITE' && c.condition_course_id === courseId)) return 'coreq';

  const unlocks = DB.unlocksByCourse[SELECTED_COURSE_ID] || [];
  if (unlocks.includes(courseId)) return 'unlock';

  return 'dim';
}

function renderRoadmap() {
  const container = document.getElementById('roadmapContainer');
  const maxYear = Math.max(STATE.maxYear, ...STATE.items.map(i => i.year), 4);
  let html = '';

  if (STATE.selectedTrack && DB.trackNames[STATE.selectedTrack]) {
    html += `
      <div class="active-track-banner">
        <div>กำลังแสดงแผนตามสายความเชี่ยวชาญ: <strong>${DB.trackNames[STATE.selectedTrack]}</strong></div>
        <button class="btn btn-sm" onclick="scrollToYear(3)">ไปที่วิชาเอกเลือก (ปี 3–4)</button>
      </div>
    `;
  }

  for (let y = 1; y <= maxYear; y++) {
    const hasSummer = STATE.items.some(i => i.year === y && i.sem === 3) || STATE.extraSummers.includes(y);
    const sems = hasSummer ? [1, 2, 3] : [1, 2];

    html += `<section class="year-section" id="year-section-${y}">`;
    html += `
      <div class="year-header">
        <div class="year-title">
          ชั้นปีที่ ${y}
          ${y === 1 ? '<span style="font-size:0.82rem;font-weight:400;color:var(--muted);margin-left:8px;">(คลิกที่การ์ดรายวิชาเพื่อดูรายละเอียดและสายโซ่วิชา)</span>' : ''}
        </div>
        ${STATE.flexibleMode && !hasSummer ? `<button class="btn btn-sm" onclick="addSummerTerm(${y})">+ เพิ่มภาคฤดูร้อน ปี ${y}</button>` : ''}
      </div>
    `;
    html += `<div class="semesters-grid">`;

    sems.forEach(s => {
      const termItems = STATE.items.filter(i => i.year === y && i.sem === s);
      const termCredits = termItems.filter(i => i.status !== 'failed').reduce((sum, i) => sum + i.credits, 0);
      const creditLimit = s === 3 ? 9 : 22;
      const isOver = termCredits > creditLimit;
      const semLabel = s === 3 ? 'ภาคฤดูร้อน' : `ภาคการศึกษาที่ ${s}`;

      html += `
        <div class="semester-box">
          <div class="semester-head">
            <span class="semester-name">${semLabel}</span>
            <span class="credit-badge ${isOver ? 'over' : ''}">${termCredits} หน่วยกิต ${isOver ? '(เกินเกณฑ์)' : ''}</span>
          </div>
      `;

      if (termItems.length === 0) {
        html += `<div style="font-size:0.82rem;color:var(--muted);padding:12px;text-align:center;">ไม่มีรายวิชาในภาคเรียนนี้</div>`;
      } else {
        termItems.forEach(item => {
          const catGroup = getCategoryGroup(item.category);
          const hlRole = getHighlightRole(item.courseId);
          const warnings = validateItem(item);
          const hlClass = hlRole ? `hl-${hlRole}` : '';
          const flashClass = RECENTLY_UPDATED_UIDS.has(item.uid) ? 'just-updated' : '';

          let hlBadge = '';
          if (hlRole === 'prereq') hlBadge = '<span class="tag tag-hl-prereq">ตัวลงก่อน</span>';
          if (hlRole === 'coreq') hlBadge = '<span class="tag tag-hl-coreq">วิชาควบ</span>';
          if (hlRole === 'unlock') hlBadge = '<span class="tag tag-hl-unlock">ตัวต่อ</span>';

          const phClass = item.isPlaceholder ? 'is-placeholder' : '';
          let elecBadge = '';
          if (item.isTrackOverflow) {
            elecBadge = '<span class="tag tag-overflow">วิชาเอกเลือก (เพิ่มตามสาย)</span>';
          } else if (item.isPlaceholder) {
            if (catGroup === 'GE') elecBadge = '<span class="tag tag-elec-ge">เลือกศึกษาทั่วไป (GE)</span>';
            else if (catGroup === 'MajorElec') elecBadge = '<span class="tag tag-elec-major">วิชาเอกเลือก</span>';
            else if (catGroup === 'Free') elecBadge = '<span class="tag tag-elec-free">วิชาเลือกเสรี</span>';
            else elecBadge = '<span class="tag tag-elec">ช่องวิชาเลือก</span>';
          } else if (catGroup === 'Minor') {
            elecBadge = '<span class="tag tag-minor">วิชาโท / เรียนเพิ่ม</span>';
          } else if (item.isExtra) {
            elecBadge = '<span class="tag tag-elec-free">ลงเพิ่มเติม</span>';
          }

          html += `
            <div class="course-card cat-${catGroup} status-${item.status} ${phClass} ${hlClass} ${flashClass}" onclick="selectCourse('${item.courseId}', '${item.uid}')">
              <div class="card-top">
                <div>
                  <div class="card-id">
                    <span>${item.courseId}</span>
                    ${hlBadge}
                    ${elecBadge}
                  </div>
                  <div class="card-title">${item.title}</div>
                  ${DB.courseMap[item.courseId]?.title_en ? `<div class="card-title-en">(${DB.courseMap[item.courseId].title_en})</div>` : ''}
                  ${item.trackNote ? `<div style="font-size:0.78rem;color:#0f766e;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:6px 8px;margin-top:6px;line-height:1.4;"><strong>คำแนะนำกลุ่ม:</strong> ${item.trackNote}</div>` : ''}
                </div>
                <div onclick="event.stopPropagation()">
                  ${!STATE.flexibleMode ? `
                    <label class="pass-checkbox" title="ติ๊กเมื่อสอบผ่านวิชานี้แล้ว">
                      <input type="checkbox" ${item.status === 'passed' ? 'checked' : ''} onchange="togglePass('${item.uid}', this.checked)" />
                      <span>ผ่าน</span>
                    </label>
                  ` : `
                    <select class="btn btn-sm" onchange="changeStatus('${item.uid}', this.value)">
                      <option value="planned" ${item.status === 'planned' ? 'selected' : ''}>วางแผนไว้</option>
                      <option value="enrolled" ${item.status === 'enrolled' ? 'selected' : ''}>กำลังเรียน</option>
                      <option value="passed" ${item.status === 'passed' ? 'selected' : ''}>ผ่านแล้ว</option>
                      <option value="failed" ${item.status === 'failed' ? 'selected' : ''}>ไม่ผ่าน/ถอน</option>
                    </select>
                  `}
                </div>
              </div>
              <div class="card-meta">
                <span>${item.credits} หน่วยกิต</span>
                ${warnings.length > 0 ? `<span class="tag tag-warn" title="${warnings.join(' | ')}">แจ้งเตือนเงื่อนไข (${warnings.length})</span>` : ''}
              </div>
              ${(item.isPlaceholder || item.isExtra || item.isTrackOverflow || STATE.flexibleMode) ? `
                <div class="card-actions" onclick="event.stopPropagation()">
                  ${(item.isPlaceholder || item.isTrackOverflow) ? (catGroup === 'Free'
                    ? `<button class="btn btn-sm" onclick="editFreeElective('${item.uid}')">ระบุชื่อวิชาเอง (ไม่บังคับ)</button>`
                    : `<button class="btn btn-sm" onclick="openPickerForSlot('${item.uid}')">เลือก/เปลี่ยนวิชา</button>`) : ''}
                  ${STATE.flexibleMode ? `<button class="btn btn-sm" onclick="openMoveModal('${item.uid}')">ย้ายเทอม</button>` : ''}
                  ${STATE.flexibleMode && item.status === 'failed' ? `<button class="btn btn-sm btn-accent" onclick="retakeCourse('${item.uid}')">+ ลงเรียนซ้ำ</button>` : ''}
                  ${(STATE.flexibleMode || item.isExtra || item.isTrackOverflow) ? `<button class="btn btn-sm btn-danger-outline" onclick="removeItem('${item.uid}')">ลบ</button>` : ''}
                </div>
              ` : ''}
            </div>
          `;
        });
      }

      html += `<button class="btn btn-sm" style="margin-top:4px;justify-content:center;" onclick="openPickerToAdd(${y}, ${s})">+ เพิ่มวิชาเพิ่มเติม / วิชาโท</button>`;
      html += `</div>`;
    });

    html += `</div></section>`;
  }

  container.innerHTML = html;
}

function renderAll() {
  renderSummary();
  renderRoadmap();
}

// =========================================================================
// 6. Card Interactions & Detail Drawer
// =========================================================================
function togglePass(uid, checked) {
  const item = STATE.items.find(i => i.uid === uid);
  if (!item) return;
  item.status = checked ? 'passed' : 'planned';
  saveState();
  renderAll();
}

function changeStatus(uid, newStatus) {
  const item = STATE.items.find(i => i.uid === uid);
  if (!item) return;
  item.status = newStatus;
  saveState();
  renderAll();
}

function selectCourse(courseId, uid) {
  SELECTED_COURSE_ID = courseId;
  renderRoadmap();
  openDrawer(courseId, uid);
}

function clearSelection() {
  SELECTED_COURSE_ID = null;
  document.getElementById('detailDrawer').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('open');
  renderRoadmap();
}

function openDrawer(courseId, uid) {
  const item = STATE.items.find(i => i.uid === uid);
  const c = DB.courseMap[courseId];
  document.getElementById('drawerCode').textContent = courseId;
  document.getElementById('drawerTitle').textContent = c ? c.title_th : (item ? item.title : courseId);
  document.getElementById('drawerTitleEn').textContent = c ? c.title_en : '';

  const warnings = item ? validateItem(item) : [];
  const conds = DB.condByCourse[courseId] || [];
  const unlocks = DB.unlocksByCourse[courseId] || [];
  const clos = DB.cloByCourse[courseId] || [];

  let body = '';

  if (warnings.length > 0) {
    body += `
      <div class="detail-block" style="background:#fef2f2;border:1px solid #fecaca;padding:10px;border-radius:8px;color:#991b1b;">
        <strong style="display:block;margin-bottom:4px;">ข้อควรระวังในการลงทะเบียน:</strong>
        <ul style="padding-left:18px;font-size:0.86rem;">
          ${warnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (item && item.trackNote) {
    body += `
      <div class="detail-block" style="background:#ecfdf5;border:1px solid #a7f3d0;padding:10px;border-radius:8px;color:#065f46;">
        <h4 style="color:#065f46;margin-bottom:4px;">คำแนะนำจากอาจารย์ประจำกลุ่ม</h4>
        <p style="font-size:0.88rem;line-height:1.45;">${item.trackNote}</p>
      </div>
    `;
  }

  if (c) {
    body += `
      <div class="detail-block">
        <h4>ข้อมูลรายวิชา</h4>
        <p style="font-size:0.9rem;">
          <strong>หน่วยกิต:</strong> ${c.credits} (${c.lecture_hours || 0}-${c.lab_hours || 0}-${c.self_study_hours || 0})<br>
          <strong>หมวดหมู่:</strong> ${c.course_category}<br>
          <strong>ภาคเรียนที่เปิดสอน:</strong> ${c.offered_terms || c.open_term_suggested || '-'}
        </p>
        ${c.description_summary_th ? `<p style="font-size:0.88rem;color:#334155;margin-top:8px;">${c.description_summary_th}</p>` : ''}
      </div>
    `;
  } else if (item && item.placeholderRule) {
    body += `
      <div class="detail-block">
        <h4>เงื่อนไขช่องวิชาเลือก</h4>
        <p style="font-size:0.9rem;">${item.placeholderRule}</p>
      </div>
    `;
  }

  body += `<div class="detail-block"><h4>เงื่อนไขตัวลงก่อน / วิชาควบ</h4>`;
  if (conds.length === 0) {
    body += `<p style="font-size:0.86rem;color:var(--muted);">ไม่มีเงื่อนไขบังคับก่อน</p>`;
  } else {
    conds.forEach(cd => {
      const ref = DB.courseMap[cd.condition_course_id];
      body += `
        <div class="rel-chip" onclick="jumpToCourse('${cd.condition_course_id}')">
          <strong>[${cd.condition_type}]</strong> ${cd.condition_course_id} ${ref ? ref.title_th : ''}
          <div style="font-size:0.76rem;color:var(--muted);">${cd.condition_note_th || ''}</div>
        </div>
      `;
    });
  }
  body += `</div>`;

  body += `<div class="detail-block"><h4>วิชาตัวต่อ (ที่พึ่งพาวิชานี้)</h4>`;
  if (unlocks.length === 0) {
    body += `<p style="font-size:0.86rem;color:var(--muted);">ไม่มีวิชาตัวต่อโดยตรง</p>`;
  } else {
    unlocks.forEach(uId => {
      const ref = DB.courseMap[uId];
      body += `<span class="rel-chip" onclick="jumpToCourse('${uId}')">${uId} ${ref ? ref.title_th : ''}</span>`;
    });
  }
  body += `</div>`;

  if (clos.length > 0) {
    body += `<div class="detail-block"><h4>ผลลัพธ์การเรียนรู้ (CLO / PLO)</h4>`;
    clos.forEach(cl => {
      body += `
        <div style="font-size:0.84rem;margin-bottom:6px;padding:6px 8px;background:#f8fafc;border-radius:6px;">
          <strong>${cl.clo_code} (${cl.mapped_plo_id})</strong>: ${cl.clo_description_th}
        </div>
      `;
    });
    body += `</div>`;
  }

  document.getElementById('drawerBody').innerHTML = body;
  document.getElementById('detailDrawer').classList.add('open');
  document.getElementById('drawerBackdrop').classList.add('open');
}

function closeDrawer() {
  document.getElementById('detailDrawer').classList.remove('open');
  document.getElementById('drawerBackdrop').classList.remove('open');
  if (SELECTED_COURSE_ID) {
    SELECTED_COURSE_ID = null;
    renderRoadmap();
  }
}

function jumpToCourse(courseId) {
  const found = STATE.items.find(i => i.courseId === courseId);
  SELECTED_COURSE_ID = courseId;
  renderRoadmap();
  openDrawer(courseId, found ? found.uid : null);
}

// =========================================================================
// 7. Elective Picker Modal
// =========================================================================
function openPickerForSlot(uid) {
  const slot = STATE.items.find(i => i.uid === uid);
  if (!slot) return;
  PICKER_CTX = { mode: 'replace', uid, year: slot.year, sem: slot.sem, category: slot.category };
  document.getElementById('pickerTitle').textContent = `เลือกวิชาสำหรับช่อง: ${slot.title} (${slot.credits} หน่วยกิต)`;
  setupPickerFilters(slot.category === 'Major_Elective');
  document.getElementById('customAddBox').style.display = 'none';
  document.getElementById('pickerModal').classList.add('open');
  renderPickerList();
}

function openPickerToAdd(year, sem) {
  PICKER_CTX = { mode: 'add', uid: null, year, sem, category: 'ALL' };
  document.getElementById('pickerTitle').textContent = `เพิ่มรายวิชาใน ปี ${year} ${sem === 3 ? 'ภาคฤดูร้อน' : 'เทอม ' + sem}`;
  setupPickerFilters(true);
  document.getElementById('customAddBox').style.display = 'block';
  document.getElementById('pickerModal').classList.add('open');
  renderPickerList();
}

function setupPickerFilters(showTracks) {
  document.getElementById('pickerSearch').value = '';
  const sel = document.getElementById('pickerTrackFilter');
  let opts = '<option value="ALL">แสดงทุกวิชาที่เกี่ยวข้อง</option>';
  if (showTracks) {
    const trackEntries = Object.entries(DB.trackNames);
    if (trackEntries.length > 0) {
      opts += '<optgroup label="กลุ่มความเชี่ยวชาญเฉพาะทาง">';
      trackEntries.forEach(([id, name]) => {
        opts += `<option value="${id}">${name}</option>`;
      });
      opts += '</optgroup>';
    }
    opts += '<optgroup label="กลุ่มวิชาเลือกอื่นๆ">';
    opts += '<option value="209_GENERAL">กลุ่ม 209 ทั่วไป (ไม่กำหนดกลุ่ม / ลงได้ทุกสาย)</option>';
    opts += '<option value="NON_209">กลุ่มวิชานอกภาควิชา (ไม่ใช่รหัส 209)</option>';
    opts += '</optgroup>';
  }
  sel.innerHTML = opts;
  sel.style.display = showTracks ? 'inline-block' : 'none';
}

function renderPickerList() {
  const q = document.getElementById('pickerSearch').value.toLowerCase();
  const trackFilter = document.getElementById('pickerTrackFilter').value;
  const activeIds = new Set(STATE.items.filter(i => i.status !== 'failed').map(i => i.courseId));
  const allTrackCourseIds = new Set(DB.tracks.map(t => t.course_id).filter(Boolean));

  let list = [...DB.courses];

  if (PICKER_CTX.mode === 'replace') {
    const slotGroup = getCategoryGroup(PICKER_CTX.category);
    if (slotGroup === 'GE') {
      list = list.filter(c => getCategoryGroup(c.course_category) === 'GE');
    } else if (slotGroup === 'MajorElec') {
      list = list.filter(c => c.course_category === 'Major_Elective');
    }
  }

  let selectedTrackCommonMap = null;
  if (trackFilter === '209_GENERAL') {
    list = list.filter(c => c.course_id.startsWith('209') && !allTrackCourseIds.has(c.course_id));
  } else if (trackFilter === 'NON_209') {
    list = list.filter(c => !c.course_id.startsWith('209'));
  } else if (trackFilter && trackFilter !== 'ALL') {
    const trackRows = DB.tracks.filter(t => t.track_id === trackFilter && t.course_id);
    selectedTrackCommonMap = {};
    trackRows.forEach(t => {
      const isCommon = isCommonOptionRow(t);
      if (selectedTrackCommonMap[t.course_id] === undefined || !isCommon) {
        selectedTrackCommonMap[t.course_id] = isCommon;
      }
    });
    list = list.filter(c => selectedTrackCommonMap[c.course_id] !== undefined);
  }

  if (q) {
    list = list.filter(c =>
      c.course_id.toLowerCase().includes(q) ||
      c.title_th.toLowerCase().includes(q) ||
      (c.title_en || '').toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => {
    if (selectedTrackCommonMap) {
      const aCommon = selectedTrackCommonMap[a.course_id] ? 1 : 0;
      const bCommon = selectedTrackCommonMap[b.course_id] ? 1 : 0;
      if (aCommon !== bCommon) return aCommon - bCommon;
    }
    const a209 = a.course_id.startsWith('209') ? 0 : 1;
    const b209 = b.course_id.startsWith('209') ? 0 : 1;
    if (a209 !== b209) return a209 - b209;
    return a.course_id.localeCompare(b.course_id);
  });

  const body = document.getElementById('pickerBody');
  if (list.length === 0) {
    body.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">ไม่พบรายวิชาที่ค้นหา</p>';
    return;
  }

  body.innerHTML = list.map(c => {
    const alreadyIn = activeIds.has(c.course_id);
    const curTermTag = PICKER_CTX.sem === 3 ? 'SUMMER' : `T${PICKER_CTX.sem}`;
    const offered = (c.offered_terms || '').split(',').map(s => s.trim().toUpperCase());
    const termWarn = c.offered_terms && c.offered_terms !== 'VERIFY' && !offered.includes(curTermTag)
      ? `<span class="tag tag-warn">เปิดสอน ${c.offered_terms}</span>` : '';

    const courseTracks = DB.tracksByCourse[c.course_id] || [];
    let groupBadge = '';
    if (courseTracks.length > 0) {
      groupBadge = courseTracks.map(t =>
        t.isCommon
          ? `<span class="tag tag-elec-free">${t.trackName} (ตัวเลือกร่วม)</span>`
          : `<span class="tag tag-elec-major">${t.trackName}</span>`
      ).join(' ');
    } else if (c.course_id.startsWith('209')) {
      groupBadge = '<span class="tag tag-elec-ge">209 ทั่วไป</span>';
    } else {
      groupBadge = '<span class="tag tag-minor">นอกภาควิชา</span>';
    }

    return `
      <div class="picker-item">
        <div>
          <div style="font-weight:700;font-size:0.9rem;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            <span>${c.course_id} — ${c.title_th}</span>
            ${groupBadge}
            ${termWarn}
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">${c.credits} หน่วยกิต | หมวด: ${c.course_category}</div>
        </div>
        <button class="btn btn-sm ${alreadyIn ? '' : 'btn-primary'}" ${alreadyIn ? 'disabled' : ''} onclick="pickCourse('${c.course_id}')">
          ${alreadyIn ? 'อยู่ในแผนแล้ว' : 'เลือกวิชานี้'}
        </button>
      </div>
    `;
  }).join('');
}

function pickCourse(courseId) {
  const c = DB.courseMap[courseId];
  if (!c) return;
  if (PICKER_CTX.mode === 'replace') {
    const slot = STATE.items.find(i => i.uid === PICKER_CTX.uid);
    if (slot) {
      const prevCredits = slot.credits;
      slot.courseId = c.course_id;
      slot.title = c.title_th;
      slot.credits = c.credits;
      slot.trackNote = '';

      if (slot.category === 'Major_Elective' && slot.isPlaceholder) {
        const diff = prevCredits - c.credits;
        if (diff > 0) {
          const child = createRemainderSlot(slot, diff);
          if (child) {
            showToast('แยกช่องหน่วยกิตอัตโนมัติ', `เพิ่มช่องว่างวิชาเอกเลือกคงเหลือ ${diff} หน่วยกิตในเทอมเดียวกันให้แล้วครับ`, 3600);
          }
        } else if (diff < 0) {
          let needToAbsorb = Math.abs(diff);
          const groupId = slot.slotGroupId || slot.uid;
          const emptySiblings = STATE.items.filter(other =>
            other.uid !== slot.uid &&
            (other.slotGroupId || other.uid) === groupId &&
            other.isPlaceholder &&
            other.courseId === other.originalCourseId
          );
          for (const sib of emptySiblings) {
            if (needToAbsorb <= 0) break;
            if (sib.credits <= needToAbsorb) {
              needToAbsorb -= sib.credits;
              STATE.items = STATE.items.filter(x => x.uid !== sib.uid);
            } else {
              sib.credits -= needToAbsorb;
              sib.originalCredits = sib.credits;
              sib.title = `${sib.originalTitle} (คงเหลือ ${sib.credits} หน่วยกิต)`;
              needToAbsorb = 0;
            }
          }
        }
      }
    }
  } else {
    const newUid = `custom_${Date.now()}_${c.course_id}`;
    STATE.items.push({
      uid: newUid,
      slotGroupId: newUid,
      isSplitChild: false,
      isTrackOverflow: false,
      year: PICKER_CTX.year,
      sem: PICKER_CTX.sem,
      courseId: c.course_id,
      originalCourseId: c.course_id,
      title: c.title_th,
      originalTitle: c.title_th,
      credits: c.credits,
      originalCredits: c.credits,
      category: c.course_category || 'Major_Elective',
      isPlaceholder: false,
      isExtra: true,
      placeholderRule: '',
      trackNote: '',
      status: 'planned'
    });
  }
  closePickerModal();
  saveState();
  renderAll();
}

function closePickerModal() {
  document.getElementById('pickerModal').classList.remove('open');
}

// =========================================================================
// 8. Flexible Mode Actions (Move, Retake, Add Year/Summer, Remove)
// =========================================================================
function openMoveModal(uid) {
  const item = STATE.items.find(i => i.uid === uid);
  if (!item) return;
  MOVE_UID = uid;
  document.getElementById('moveCourseLabel').textContent = `${item.courseId} — ${item.title}`;
  const ySel = document.getElementById('moveYearSelect');
  const maxY = Math.max(STATE.maxYear, 6);
  ySel.innerHTML = '';
  for (let y = 1; y <= maxY; y++) {
    ySel.innerHTML += `<option value="${y}" ${y === item.year ? 'selected' : ''}>ชั้นปีที่ ${y}</option>`;
  }
  document.getElementById('moveSemSelect').value = String(item.sem);
  document.getElementById('moveModal').classList.add('open');
}

function confirmMoveCourse() {
  const item = STATE.items.find(i => i.uid === MOVE_UID);
  if (!item) return;
  const newY = Number(document.getElementById('moveYearSelect').value);
  const newS = Number(document.getElementById('moveSemSelect').value);
  item.year = newY;
  item.sem = newS;
  if (newY > STATE.maxYear) STATE.maxYear = newY;
  if (newS === 3 && !STATE.extraSummers.includes(newY)) STATE.extraSummers.push(newY);
  closeMoveModal();
  saveState();
  renderAll();
}

function closeMoveModal() {
  document.getElementById('moveModal').classList.remove('open');
}

function retakeCourse(uid) {
  const item = STATE.items.find(i => i.uid === uid);
  if (!item) return;
  const nextYear = item.sem === 1 ? item.year : item.year + 1;
  const nextSem = item.sem === 1 ? 2 : 1;
  if (nextYear > STATE.maxYear) STATE.maxYear = nextYear;
  const newUid = `retake_${Date.now()}_${item.courseId}`;
  STATE.items.push({
    ...item,
    uid: newUid,
    slotGroupId: newUid,
    isSplitChild: false,
    isTrackOverflow: false,
    year: nextYear,
    sem: nextSem,
    status: 'planned'
  });
  saveState();
  renderAll();
}

function removeItem(uid) {
  if (!confirm('ต้องการนำรายวิชานี้ออกจากตารางใช่หรือไม่?')) return;
  STATE.items = STATE.items.filter(i => i.uid !== uid);
  saveState();
  renderAll();
}

function addSummerTerm(year) {
  if (!STATE.extraSummers.includes(year)) {
    STATE.extraSummers.push(year);
    saveState();
    renderAll();
  }
}

function addExtraYear() {
  if (STATE.maxYear >= 8) return;
  STATE.maxYear += 1;
  saveState();
  renderAll();
}

// =========================================================================
// 9. Export / Import Plan JSON & Custom / Free Elective Handlers
// =========================================================================
function exportPlanJSON() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `study-plan-indchem2569-${STATE.planType}.json`;
  a.click();
}

function importPlanJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && Array.isArray(parsed.items)) {
        STATE = parsed;
        STATE.items.forEach(it => {
          if (!it.slotGroupId) it.slotGroupId = it.uid;
          if (it.isSplitChild === undefined) it.isSplitChild = false;
          if (it.isTrackOverflow === undefined) it.isTrackOverflow = false;
        });
        saveState();
        syncControlsFromState();
        renderAll();
        showToast('นำเข้าแผนการเรียนเรียบร้อย', 'โหลดข้อมูลแผนการเรียนจากไฟล์ของคุณลงตารางแล้วครับ');
      }
    } catch (err) {
      alert('ไฟล์แผนการเรียนไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function editFreeElective(uid) {
  const slot = STATE.items.find(i => i.uid === uid);
  if (!slot) return;
  const currentCode = (!slot.courseId || slot.courseId.startsWith('FREE')) ? '' : slot.courseId;
  const newCode = prompt('ระบุรหัสวิชาเลือกเสรี (เช่น 004101) หรือเว้นว่างเพื่อใช้ค่าเริ่มต้น:', currentCode);
  if (newCode === null) return;
  const trimmedCode = newCode.trim();
  if (!trimmedCode) {
    slot.courseId = 'FREE_ELEC';
    slot.title = 'วิชาเลือกเสรี (เลือกวิชาใดก็ได้ใน มช.)';
  } else {
    const currentTitle = slot.title.startsWith('วิชาเลือกเสรี') ? '' : slot.title;
    const newTitle = prompt('ระบุชื่อวิชาเลือกเสรี (เช่น กีฬาเพื่อสุขภาพ):', currentTitle);
    if (newTitle === null) return;
    slot.courseId = trimmedCode;
    slot.title = newTitle.trim() || 'วิชาเลือกเสรี';
  }
  saveState();
  renderAll();
}

function addCustomCourse() {
  const code = document.getElementById('customCode').value.trim();
  const title = document.getElementById('customTitle').value.trim();
  const credits = Number(document.getElementById('customCredits').value) || 3;
  const category = document.getElementById('customCategory').value;

  if (!code || !title) {
    alert('กรุณากรอกทั้งรหัสวิชาและชื่อวิชาครับ');
    return;
  }

  const newUid = `extra_${Date.now()}_${code}`;
  STATE.items.push({
    uid: newUid,
    slotGroupId: newUid,
    isSplitChild: false,
    isTrackOverflow: false,
    year: PICKER_CTX.year,
    sem: PICKER_CTX.sem,
    courseId: code,
    originalCourseId: code,
    title: title,
    originalTitle: title,
    credits: credits,
    originalCredits: credits,
    category: category,
    isPlaceholder: false,
    isExtra: true,
    placeholderRule: '',
    trackNote: '',
    status: 'planned'
  });

  document.getElementById('customCode').value = '';
  document.getElementById('customTitle').value = '';
  document.getElementById('customCredits').value = '3';
  closePickerModal();
  saveState();
  renderAll();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    closePickerModal();
    closeMoveModal();
  }
});

window.addEventListener('DOMContentLoaded', initApp);
