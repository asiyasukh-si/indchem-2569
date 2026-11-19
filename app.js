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
  items: []                  // { uid, year, sem, courseId, originalCourseId, title, originalTitle, credits, originalCredits, category, isPlaceholder, isExtra, placeholderRule, trackNote, status }
};

let SELECTED_COURSE_ID = null;
let PICKER_CTX = null;       // { mode: 'replace' | 'add', uid, year, sem, category }
let MOVE_UID = null;

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
      if (t.track_id && !DB.trackNames[t.track_id]) {
        DB.trackNames[t.track_id] = t.track_name_th || t.track_id;
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
// 2. State Management
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
      return {
        uid: `slot_${idx}_${p.course_id}`,
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

function loadOrBuildState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
        STATE = parsed;
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
  saveState();
  syncControlsFromState();
  renderAll();
}

function applySelectedTrack() {
  const trackId = document.getElementById('trackSelect').value;
  if (!trackId) {
    alert('กรุณาเลือกสายความเชี่ยวชาญจากรายการก่อนครับ');
    return;
  }
  STATE.selectedTrack = trackId;

  const requiredIds = new Set(STATE.items.filter(i => !i.isPlaceholder).map(i => i.courseId));
  const allTrackRows = DB.tracks.filter(t => t.track_id === trackId);
  const trackCourses = allTrackRows
    .filter(t => t.course_id && !requiredIds.has(t.course_id))
    .sort((a, b) => (a.priority_level || '').localeCompare(b.priority_level || ''));

  const fallbackNoteObj = allTrackRows.find(t => t.fallback_note_th && t.fallback_note_th.trim());
  const fallbackNote = fallbackNoteObj ? fallbackNoteObj.fallback_note_th.trim() : '';

  const majorElecSlots = STATE.items.filter(i => i.isPlaceholder && i.category === 'Major_Elective');

  // รีเซ็ตช่องวิชาเอกเลือกทั้งหมดกลับสู่ค่าตั้งต้นก่อนจัดวางใหม่
  majorElecSlots.forEach(slot => {
    const origInfo = DB.courseMap[slot.originalCourseId];
    slot.courseId = slot.originalCourseId;
    slot.title = origInfo ? origInfo.title_th : slot.originalTitle;
    slot.credits = slot.originalCredits || (origInfo ? origInfo.credits : slot.credits);
    slot.trackNote = '';
  });

  const usedIds = new Set();
  const filledSlotUids = new Set();

  const assignToSlot = (slot, candidate) => {
    usedIds.add(candidate.course_id);
    filledSlotUids.add(slot.uid);
    const cInfo = DB.courseMap[candidate.course_id];
    slot.courseId = candidate.course_id;
    slot.title = cInfo ? cInfo.title_th : candidate.course_title_th;
    slot.credits = cInfo ? cInfo.credits : (Number(candidate.credits) || slot.credits);
    slot.trackNote = '';
  };

  const isCreditTypeMatch = (slot, tc) => {
    const isLabSlot = (slot.originalCredits || slot.credits) === 1 || String(slot.originalCourseId).includes('LAB');
    const cInfo = DB.courseMap[tc.course_id];
    const cr = cInfo ? cInfo.credits : Number(tc.credits);
    return isLabSlot ? cr === 1 : cr !== 1;
  };

  // รอบที่ 1: จับคู่ตรงทั้งชั้นปี (recommended_year) และภาคเรียน (recommended_sem) ที่อาจารย์แนะนำ
  majorElecSlots.forEach(slot => {
    if (filledSlotUids.has(slot.uid)) return;
    const candidate = trackCourses.find(tc => {
      if (usedIds.has(tc.course_id)) return false;
      if (!isCreditTypeMatch(slot, tc)) return false;
      const recY = Number(tc.recommended_year);
      const recS = Number(tc.recommended_sem);
      return recY === slot.year && recS === slot.sem;
    });
    if (candidate) assignToSlot(slot, candidate);
  });

  // รอบที่ 2: จับคู่ตรงภาคเรียนที่แนะนำ (recommended_sem) หรือเทอมที่เปิดสอน (open_term_suggested)
  majorElecSlots.forEach(slot => {
    if (filledSlotUids.has(slot.uid)) return;
    const candidate = trackCourses.find(tc => {
      if (usedIds.has(tc.course_id)) return false;
      if (!isCreditTypeMatch(slot, tc)) return false;
      const recS = Number(tc.recommended_sem);
      const cInfo = DB.courseMap[tc.course_id];
      const termMatch = recS === slot.sem || (cInfo && cInfo.open_term_suggested && cInfo.open_term_suggested.includes(`T${slot.sem}`));
      return termMatch;
    });
    if (candidate) assignToSlot(slot, candidate);
  });

  // รอบที่ 3: เติมรายวิชาที่เหลือในกลุ่มลงในช่องว่างที่ยังเหลือ
  majorElecSlots.forEach(slot => {
    if (filledSlotUids.has(slot.uid)) return;
    const candidate = trackCourses.find(tc => {
      if (usedIds.has(tc.course_id)) return false;
      return isCreditTypeMatch(slot, tc);
    });
    if (candidate) assignToSlot(slot, candidate);
  });

  // รอบที่ 4: ช่องที่ยังว่างอยู่ (กรณีกลุ่มมีวิชาไม่ครบจำนวนช่อง) ให้แสดงคำแนะนำ fallback_note_th
  majorElecSlots.forEach(slot => {
    if (!filledSlotUids.has(slot.uid) && fallbackNote) {
      slot.trackNote = fallbackNote;
    }
  });

  saveState();
  renderAll();
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
    const extra = c.data.passed - c.target;
    const statusText = isDone
      ? (extra > 0 ? `<span style="color:var(--success);font-weight:600;">เกิน +${extra} นก.</span>` : `<span style="color:var(--success);font-weight:600;">ครบเกณฑ์</span>`)
      : `ในแผน ${c.data.planned}`;

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

  for (let y = 1; y <= maxYear; y++) {
    const hasSummer = STATE.items.some(i => i.year === y && i.sem === 3) || STATE.extraSummers.includes(y);
    const sems = hasSummer ? [1, 2, 3] : [1, 2];

    html += `<section class="year-section">`;
    html += `
      <div class="year-header">
        <div class="year-title">ชั้นปีที่ ${y}</div>
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

          let hlBadge = '';
          if (hlRole === 'prereq') hlBadge = '<span class="tag tag-hl-prereq">ตัวลงก่อน</span>';
          if (hlRole === 'coreq') hlBadge = '<span class="tag tag-hl-coreq">วิชาควบ</span>';
          if (hlRole === 'unlock') hlBadge = '<span class="tag tag-hl-unlock">ตัวต่อ</span>';

          const phClass = item.isPlaceholder ? 'is-placeholder' : '';
          let elecBadge = '';
          if (item.isPlaceholder) {
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
            <div class="course-card cat-${catGroup} status-${item.status} ${phClass} ${hlClass}" onclick="selectCourse('${item.courseId}', '${item.uid}')">
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
              ${(item.isPlaceholder || item.isExtra || STATE.flexibleMode) ? `
                <div class="card-actions" onclick="event.stopPropagation()">
                  ${item.isPlaceholder ? (catGroup === 'Free'
                    ? `<button class="btn btn-sm" onclick="editFreeElective('${item.uid}')">ระบุชื่อวิชาเอง (ไม่บังคับ)</button>`
                    : `<button class="btn btn-sm" onclick="openPickerForSlot('${item.uid}')">เลือก/เปลี่ยนวิชา</button>`) : ''}
                  ${STATE.flexibleMode ? `<button class="btn btn-sm" onclick="openMoveModal('${item.uid}')">ย้ายเทอม</button>` : ''}
                  ${STATE.flexibleMode && item.status === 'failed' ? `<button class="btn btn-sm btn-accent" onclick="retakeCourse('${item.uid}')">+ ลงเรียนซ้ำ</button>` : ''}
                  ${(STATE.flexibleMode || item.isExtra) ? `<button class="btn btn-sm btn-danger-outline" onclick="removeItem('${item.uid}')">ลบ</button>` : ''}
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

  const selBar = document.getElementById('selectionStatus');
  if (SELECTED_COURSE_ID) {
    const c = DB.courseMap[SELECTED_COURSE_ID];
    selBar.innerHTML = `
      <span>กำลังดูสายโซ่วิชา: <strong>${SELECTED_COURSE_ID} ${c ? c.title_th : ''}</strong></span>
      <button class="btn btn-sm" style="margin-left:8px;" onclick="clearSelection()">ล้างการไฮไลต์</button>
    `;
  } else {
    selBar.innerHTML = `<span style="color:var(--muted);">ยังไม่ได้เลือกรายวิชา</span>`;
  }
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
  closeDrawer();
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
  document.getElementById('pickerTitle').textContent = `เลือกวิชาสำหรับช่อง: ${slot.originalTitle}`;
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
  sel.innerHTML = '<option value="ALL">แสดงทุกวิชาที่เกี่ยวข้อง</option>';
  if (showTracks) {
    Object.entries(DB.trackNames).forEach(([id, name]) => {
      sel.innerHTML += `<option value="${id}">สาย: ${name}</option>`;
    });
  }
  sel.style.display = showTracks ? 'inline-block' : 'none';
}

function renderPickerList() {
  const q = document.getElementById('pickerSearch').value.toLowerCase();
  const trackFilter = document.getElementById('pickerTrackFilter').value;
  const activeIds = new Set(STATE.items.filter(i => i.status !== 'failed').map(i => i.courseId));

  let list = [...DB.courses];

  if (PICKER_CTX.mode === 'replace') {
    const slotGroup = getCategoryGroup(PICKER_CTX.category);
    if (slotGroup === 'GE') {
      list = list.filter(c => getCategoryGroup(c.course_category) === 'GE');
    } else if (slotGroup === 'MajorElec') {
      list = list.filter(c => c.course_category === 'Major_Elective');
    }
  }

  if (trackFilter && trackFilter !== 'ALL') {
    const inTrack = new Set(DB.tracks.filter(t => t.track_id === trackFilter).map(t => t.course_id));
    list = list.filter(c => inTrack.has(c.course_id));
  }

  if (q) {
    list = list.filter(c =>
      c.course_id.toLowerCase().includes(q) ||
      c.title_th.toLowerCase().includes(q) ||
      (c.title_en || '').toLowerCase().includes(q)
    );
  }

  // เรียงรหัส 209xxx ขึ้นก่อนเสมอ
  list.sort((a, b) => {
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

    return `
      <div class="picker-item">
        <div>
          <div style="font-weight:700;font-size:0.9rem;">${c.course_id} — ${c.title_th} ${termWarn}</div>
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
      slot.courseId = c.course_id;
      slot.title = c.title_th;
      slot.credits = c.credits;
      slot.trackNote = '';
    }
  } else {
    STATE.items.push({
      uid: `custom_${Date.now()}_${c.course_id}`,
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
  STATE.items.push({
    ...item,
    uid: `retake_${Date.now()}_${item.courseId}`,
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
        saveState();
        syncControlsFromState();
        renderAll();
        alert('นำเข้าแผนการเรียนเรียบร้อยแล้วครับ');
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

  STATE.items.push({
    uid: `extra_${Date.now()}_${code}`,
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

window.addEventListener('DOMContentLoaded', initApp);
