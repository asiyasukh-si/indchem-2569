// =========================================================================
// ตั้งค่ารหัสไฟล์ Google Sheets (รองรับทั้งหลักสูตร 2569 และ 2564)
// =========================================================================
const SPREADSHEET_ID_2569 = '1_IeTWmD1E6URJpAJo_xUE41ohTWBEucqk-oKRmbUs8s';
const SPREADSHEET_ID_2564 = '1qIIDnN_cdYACN4K7qhHHVNdhIKhR4Ki-qvDpx24Nl3A';

const ACTIVE_CURR_KEY = 'indchem_active_curriculum_year';
const OBE_APP_URL = 'https://asiyasukh-si.github.io/ICCourse69/';
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
  curriculumYear: '2569',    // '2569' | '2564'
  planType: 'Regular',       // 2569: 'Regular' | 'Coop', 2564: 'Plan1_Regular' | 'Plan1_Coop' | 'Plan2_Regular' | 'Plan2_Coop'
  selectedTrack: '',
  flexibleMode: false,
  maxYear: 4,
  extraSummers: [],          // e.g. [1, 2]
  items: []                  // { uid, slotGroupId, isSplitChild, isTrackOverflow, year, sem, courseId, originalCourseId, title, originalTitle, credits, originalCredits, category, isPlaceholder, isExtra, placeholderRule, trackNote, status }
};

function getActiveCurriculumYear() {
  return STATE.curriculumYear === '2564' ? '2564' : '2569';
}

function getActiveSpreadsheetId() {
  return getActiveCurriculumYear() === '2564' ? SPREADSHEET_ID_2564 : SPREADSHEET_ID_2569;
}

function getStorageKey(currYear) {
  const y = currYear || getActiveCurriculumYear();
  return y === '2564' ? 'indchem2564_planner_v1' : 'indchem2569_planner_v1';
}

function getDbCacheKey(currYear) {
  const y = currYear || getActiveCurriculumYear();
  return y === '2564' ? 'indchem2564_db_cache_v1' : 'indchem2569_db_cache_v1';
}

function isCoopPlanType(planType) {
  return planType === 'Coop' || planType === 'Plan1_Coop' || planType === 'Plan2_Coop';
}

let SELECTED_COURSE_ID = null;
let PICKER_CTX = null;       // { mode: 'replace' | 'add', uid, year, sem, category }
let MOVE_UID = null;
let RECENTLY_UPDATED_UIDS = new Set();
let FLASH_TIMER = null;

// =========================================================================
// Helper: Normalization, Ordering & Thai Display Formatters
// =========================================================================
function normalizeCourseId(id) {
  const s = String(id || '').trim();
  if (!s) return '';
  if (/^\d{4,5}$/.test(s)) return s.padStart(6, '0');
  return s;
}

function escapeHtml(str) {
  return String(str !== undefined && str !== null ? str : '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsStr(str) {
  return escapeHtml(
    String(str !== undefined && str !== null ? str : '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
  );
}

function isCommonOptionRow(trackRow) {
  return String(trackRow && trackRow.is_common_option).trim().toUpperCase() === 'TRUE';
}

function isEmptyPlaceholder(item) {
  return !!(item && item.isPlaceholder && item.courseId === item.originalCourseId);
}

function sortTermItemsForDisplay(termItems) {
  const result = [...termItems];
  const majorElecPositions = [];
  const majorElecItems = [];

  result.forEach((item, idx) => {
    if (getCategoryGroup(item.category) === 'MajorElec') {
      majorElecPositions.push(idx);
      majorElecItems.push({ item, origIdx: idx });
    }
  });

  majorElecItems.sort((a, b) => {
    const aFailed = a.item.status === 'failed' ? 1 : 0;
    const bFailed = b.item.status === 'failed' ? 1 : 0;
    if (aFailed !== bFailed) return aFailed - bFailed;

    const aEmpty = isEmptyPlaceholder(a.item) ? 1 : 0;
    const bEmpty = isEmptyPlaceholder(b.item) ? 1 : 0;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;

    const aSplit = a.item.isSplitChild ? 1 : 0;
    const bSplit = b.item.isSplitChild ? 1 : 0;
    if (aSplit !== bSplit) return aSplit - bSplit;

    return a.origIdx - b.origIdx;
  });

  majorElecPositions.forEach((pos, i) => {
    result[pos] = majorElecItems[i].item;
  });

  return result;
}

function getMajorElectiveSequenceMap() {
  const seqMap = {};
  const maxYear = Math.max(STATE.maxYear, ...STATE.items.map(i => i.year), 4);
  let seq = 1;

  for (let y = 1; y <= maxYear; y++) {
    [1, 2, 3].forEach(s => {
      const termItems = sortTermItemsForDisplay(
        STATE.items.filter(i => i.year === y && i.sem === s)
      );
      termItems.forEach(item => {
        if (item.status !== 'failed' && getCategoryGroup(item.category) === 'MajorElec') {
          seqMap[item.uid] = seq++;
        }
      });
    });
  }

  return seqMap;
}

function getDisplayTitleForItem(item, seqMap) {
  if (!item) return '';
  const seqNum = seqMap ? seqMap[item.uid] : null;
  if (getCategoryGroup(item.category) === 'MajorElec' && isEmptyPlaceholder(item) && seqNum) {
    return item.isSplitChild
      ? `วิชาเอกเลือกตัวที่ ${seqNum} (คงเหลือ ${item.credits} หน่วยกิต)`
      : `วิชาเอกเลือกตัวที่ ${seqNum}`;
  }
  return item.title;
}

function formatCategoryTh(cat) {
  const map = {
    GE: 'วิชาศึกษาทั่วไป',
    GE_Required: 'วิชาศึกษาทั่วไป (บังคับ)',
    GE_Elective: 'วิชาศึกษาทั่วไป (เลือก)',
    GE_Learner: 'วิชาศึกษาทั่วไป (Learner Person)',
    GE_CoCreator: 'วิชาศึกษาทั่วไป (Innovative Co-creator)',
    GE_ActiveCitizen: 'วิชาศึกษาทั่วไป (Active Citizen)',
    Core: 'วิชาแกนวิทยาศาสตร์',
    Core_Science: 'วิชาแกนวิทยาศาสตร์',
    Core_Required: 'วิชาแกนวิทยาศาสตร์',
    Major_Required: 'วิชาเอกบังคับ',
    Major_Elective_Req_P1: 'วิชาเอกบังคับเลือก (แผน 1 เคมีอุตสาหกรรม)',
    Major_Elective_Req_P2: 'วิชาเอกบังคับเลือก (แผน 2 ซิลิเกตฯ)',
    Major_Elective: 'วิชาเอกเลือก',
    Free_Elective: 'วิชาเลือกเสรี',
    Minor_Extra: 'วิชาโท / เรียนเพิ่มนอกแผน'
  };
  if (map[cat]) return map[cat];
  if (!cat) return '-';
  if (cat.startsWith('GE')) return 'วิชาศึกษาทั่วไป';
  if (cat.startsWith('Core')) return 'วิชาแกนวิทยาศาสตร์';
  if (cat.startsWith('Major_Elective_Req')) return 'วิชาเอกบังคับเลือกตามแผน';
  return cat;
}

function formatTermsTh(termStr) {
  const raw = String(termStr || '').trim();
  if (!raw || raw === '-') return 'ไม่ระบุ';
  const upper = raw.toUpperCase();
  if (upper === 'CLOSED' || upper === 'NONE') return 'ปิดการเรียนการสอนชั่วคราวในปีนี้';
  if (upper === 'VERIFY') return 'ตรวจสอบกับภาควิชา';
  if (upper === 'ALL') return 'เปิดสอนทุกภาคการศึกษา';

  const parts = upper.split(/[,/]/).map(s => s.trim()).filter(Boolean);
  const labels = parts.map(p => {
    if (p === 'T1' || p === '1') return 'ภาคการศึกษาที่ 1';
    if (p === 'T2' || p === '2') return 'ภาคการศึกษาที่ 2';
    if (p === 'SUMMER' || p === 'S' || p === 'T3' || p === '3') return 'ภาคฤดูร้อน';
    if (p === 'ALL') return 'ทุกภาคการศึกษา';
    if (p === 'CLOSED' || p === 'NONE') return 'ปิดชั่วคราวในปีนี้';
    return p;
  });
  return [...new Set(labels)].join(' และ ');
}

function formatShortTermsBadge(termStr) {
  const raw = String(termStr || '').trim();
  if (!raw || raw === '-') return 'ไม่ระบุภาคเรียน';
  const upper = raw.toUpperCase();
  if (upper === 'CLOSED' || upper === 'NONE') return 'ปิดชั่วคราวในปีนี้';
  if (upper === 'VERIFY') return 'รอตรวจสอบภาคเรียน';
  if (upper === 'ALL') return 'ทุกภาคเรียน';

  const parts = upper.split(/[,/]/).map(s => s.trim()).filter(Boolean);
  const hasT1 = parts.includes('T1') || parts.includes('1');
  const hasT2 = parts.includes('T2') || parts.includes('2');
  const hasSummer = parts.includes('SUMMER') || parts.includes('S') || parts.includes('T3') || parts.includes('3');

  if (hasT1 && hasT2 && !hasSummer) return 'ภาค 1 และ 2';
  const labels = [];
  if (hasT1) labels.push('ภาค 1');
  if (hasT2) labels.push('ภาค 2');
  if (hasSummer) labels.push('ภาคฤดูร้อน');
  return labels.length > 0 ? labels.join(', ') : raw;
}

function isCourseOfferedInSemester(course, sem) {
  if (!course) return true;
  const raw = String(course.offered_terms || '').trim();
  if (!raw || raw === '-') return true;
  const upper = raw.toUpperCase();
  if (upper === 'CLOSED' || upper === 'NONE') return false;
  if (upper === 'VERIFY' || upper === 'ALL') return true;

  const parts = upper.split(/[,/]/).map(s => s.trim()).filter(Boolean);
  if (parts.includes('CLOSED') || parts.includes('NONE')) return false;
  if (parts.length === 0 || parts.includes('ALL') || parts.includes('VERIFY')) return true;

  if (sem === 1) {
    return parts.includes('T1') || parts.includes('1');
  }
  if (sem === 2) {
    return parts.includes('T2') || parts.includes('2');
  }
  if (sem === 3) {
    return parts.includes('SUMMER') || parts.includes('S') || parts.includes('T3') || parts.includes('3');
  }
  return true;
}

function getCourseRecommendedYears(course, trackFilter) {
  if (!course) return [];
  const years = new Set();

  if (trackFilter && trackFilter !== 'ALL' && trackFilter !== '209_GENERAL' && trackFilter !== 'NON_209') {
    const specificRows = DB.tracks.filter(t => t.track_id === trackFilter && t.course_id === course.course_id);
    specificRows.forEach(t => {
      const y = Number(t.recommended_year);
      if (y >= 1 && y <= 8) years.add(y);
    });
  }

  const openTerm = String(course.open_term_suggested || '').trim();
  const m = openTerm.match(/Y(\d+)/i);
  if (m) {
    const y = Number(m[1]);
    if (y >= 1 && y <= 8) years.add(y);
  }

  const courseTracks = DB.tracksByCourse[course.course_id] || [];
  courseTracks.forEach(t => {
    if (Array.isArray(t.recommendedYears)) {
      t.recommendedYears.forEach(y => {
        if (y >= 1 && y <= 8) years.add(y);
      });
    }
  });

  return [...years].sort((a, b) => a - b);
}

function formatConditionTypeTh(type) {
  const map = {
    PREREQUISITE: 'วิชาบังคับก่อน',
    COREQUISITE: 'วิชาควบ / ผ่านมาก่อน',
    YEAR_STATUS: 'เงื่อนไขชั้นปี',
    SPECIAL_RULE: 'เงื่อนไขเฉพาะ'
  };
  return map[type] || type;
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
      background: #3b0764;
      color: #faf5ff;
      border-left: 5px solid #facc15;
      border-radius: 10px;
      padding: 12px 14px;
      box-shadow: 0 10px 25px rgba(59, 7, 100, 0.25);
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
      color: #fde047;
    }
    .toast-desc {
      font-size: 0.84rem;
      line-height: 1.45;
      color: #f3e8ff;
    }
    .toast-close {
      background: transparent;
      border: none;
      color: #d8b4fe;
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
      0% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.55); background-color: #fef9c3; border-color: #a855f7; }
      35% { box-shadow: 0 0 0 6px rgba(250, 204, 21, 0.35); background-color: #faf5ff; border-color: #eab308; }
      70% { box-shadow: 0 0 0 3px rgba(168, 85, 247, 0.2); background-color: #fffbeb; border-color: #c084fc; }
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
      background: linear-gradient(90deg, #f3e8ff 0%, #fef9c3 100%);
      border: 1px solid #d8b4fe;
      border-left: 4px solid #7c3aed;
      color: #4c1d95;
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 0.88rem;
    }
    .active-track-banner strong {
      color: #3b0764;
    }
    .tag-overflow {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fcd34d;
    }
    .desc-box {
      background: #faf5ff;
      border: 1px solid #e9d5ff;
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 8px;
    }
    .desc-lang-badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 4px;
      margin-bottom: 5px;
    }
    .desc-lang-th {
      background: #f3e8ff;
      color: #6b21a8;
    }
    .desc-lang-en {
      background: #fef3c7;
      color: #92400e;
    }
    .desc-text {
      font-size: 0.86rem;
      color: #334155;
      line-height: 1.55;
      margin: 0;
    }
    .desc-divider {
      border: none;
      border-top: 1px dashed #cbd5e1;
      margin: 10px 0;
    }
    .rel-chip.non-clickable {
      cursor: default;
      background: #f8fafc;
    }
    .rel-chip.non-clickable:hover {
      background: #f8fafc;
    }
    @media print {
      .toast-container, .active-track-banner .btn { display: none !important; }
    }
  `;
  document.head.appendChild(style);
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

async function fetchSheet(sheetName, currYear) {
  const ssId = (currYear || getActiveCurriculumYear()) === '2564' ? SPREADSHEET_ID_2564 : SPREADSHEET_ID_2569;
  const url = `https://docs.google.com/spreadsheets/d/${ssId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ไม่สามารถอ่านชีต ${sheetName} ได้ (HTTP ${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

function populateDBFromResults(results) {
  const [courses, conditions, tracks, studyPlans, rules, plos, cloMapping] = results;

  DB.courses = [];
  DB.courseMap = {};
  DB.conditions = [];
  DB.condByCourse = {};
  DB.unlocksByCourse = {};
  DB.tracks = [];
  DB.trackNames = {};
  DB.tracksByCourse = {};
  DB.studyPlans = [];
  DB.rules = [];
  DB.plos = {};
  DB.cloByCourse = {};

  // Process Courses
  DB.courses = courses.map(c => ({
    ...c,
    course_id: normalizeCourseId(c.course_id),
    credits: Number(c.credits) || 0
  }));
  DB.courses.forEach(c => { if (c.course_id) DB.courseMap[c.course_id] = c; });

  // Process Conditions
  DB.conditions = conditions.map(cond => ({
    ...cond,
    course_id: normalizeCourseId(cond.course_id),
    condition_course_id: (cond.condition_type === 'PREREQUISITE' || cond.condition_type === 'COREQUISITE')
      ? normalizeCourseId(cond.condition_course_id)
      : String(cond.condition_course_id || '').trim()
  }));

  DB.conditions.forEach(cond => {
    if (!cond.course_id) return;
    if (!DB.condByCourse[cond.course_id]) DB.condByCourse[cond.course_id] = [];
    DB.condByCourse[cond.course_id].push(cond);

    if ((cond.condition_type === 'PREREQUISITE' || cond.condition_type === 'COREQUISITE') && cond.condition_course_id) {
      if (!DB.unlocksByCourse[cond.condition_course_id]) DB.unlocksByCourse[cond.condition_course_id] = [];
      if (!DB.unlocksByCourse[cond.condition_course_id].includes(cond.course_id)) {
        DB.unlocksByCourse[cond.condition_course_id].push(cond.course_id);
      }
    }
  });

  // Process Tracks
  DB.tracks = tracks.map(t => ({
    ...t,
    course_id: normalizeCourseId(t.course_id)
  }));
  DB.tracks.forEach(t => {
    const tName = t.track_name_th || t.track_id;
    const isCommon = isCommonOptionRow(t);
    if (t.track_id && !DB.trackNames[t.track_id]) {
      DB.trackNames[t.track_id] = tName;
    }
    if (t.course_id && t.track_id) {
      if (!DB.tracksByCourse[t.course_id]) DB.tracksByCourse[t.course_id] = [];
      const recY = Number(t.recommended_year) || null;
      const recS = Number(t.recommended_sem) || null;
      const existing = DB.tracksByCourse[t.course_id].find(x => x.trackId === t.track_id);
      if (!existing) {
        DB.tracksByCourse[t.course_id].push({
          trackId: t.track_id,
          trackName: tName,
          isCommon,
          recommendedYears: recY ? [recY] : [],
          recommendedSems: recS ? [recS] : []
        });
      } else {
        if (!isCommon) existing.isCommon = false;
        if (recY && !existing.recommendedYears.includes(recY)) existing.recommendedYears.push(recY);
        if (recS && !existing.recommendedSems.includes(recS)) existing.recommendedSems.push(recS);
      }
    }
  });

  // Process Study Plans, Rules, PLOs, CLOs
  DB.studyPlans = studyPlans.map(p => ({
    ...p,
    course_id: normalizeCourseId(p.course_id)
  }));
  DB.rules = rules;
  plos.forEach(p => { DB.plos[p.outcome_id] = p; });
  cloMapping.forEach(m => {
    const cid = normalizeCourseId(m.course_id);
    if (!cid) return;
    if (!DB.cloByCourse[cid]) DB.cloByCourse[cid] = [];
    DB.cloByCourse[cid].push({ ...m, course_id: cid });
  });
}

async function loadCurriculumDatabase(currYear) {
  const loadingBox = document.getElementById('loadingBox');
  const cacheKey = getDbCacheKey(currYear);
  let renderedFromCache = false;

  try {
    const cachedRaw = localStorage.getItem(cacheKey);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Array.isArray(cached.results) && cached.results.length === SHEETS.length) {
        populateDBFromResults(cached.results);
        populateTrackDropdown();
        loadOrBuildState(currYear);
        loadingBox.style.display = 'none';
        document.getElementById('appRoot').style.display = 'block';
        renderAll();
        renderedFromCache = true;
      }
    }
  } catch (e) {}

  if (!renderedFromCache) {
    loadingBox.classList.remove('error');
    loadingBox.style.display = 'block';
    loadingBox.textContent = `กำลังดึงข้อมูลหลักสูตร พ.ศ. ${currYear} จากฐานข้อมูล Google Sheets...`;
  }

  try {
    const results = await Promise.all(SHEETS.map(s => fetchSheet(s, currYear)));
    populateDBFromResults(results);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ results, updatedAt: Date.now() }));
    } catch (e) {}

    populateTrackDropdown();
    if (!renderedFromCache) {
      loadOrBuildState(currYear);
    } else {
      syncControlsFromState();
    }

    loadingBox.style.display = 'none';
    document.getElementById('appRoot').style.display = 'block';
    renderAll();
  } catch (err) {
    if (!renderedFromCache) {
      loadingBox.classList.add('error');
      loadingBox.innerHTML = `<strong>เกิดข้อผิดพลาดในการโหลดข้อมูลหลักสูตร ${escapeHtml(currYear)} จาก Google Sheets</strong><br>${escapeHtml(err.message)}<br><small>กรุณาตรวจสอบว่าเปิดสิทธิ์แชร์ไฟล์เป็น Anyone with the link (Viewer) แล้ว</small>`;
    }
  }
}

async function initApp() {
  injectEffectStyles();
  let initialCurr = '2569';
  try {
    const urlCurr = new URLSearchParams(window.location.search).get('curr');
    const savedCurr = localStorage.getItem(ACTIVE_CURR_KEY);
    if (urlCurr === '2564' || urlCurr === '2569') {
      initialCurr = urlCurr;
    } else if (savedCurr === '2564' || savedCurr === '2569') {
      initialCurr = savedCurr;
    }
  } catch (e) {}
  STATE.curriculumYear = initialCurr;
  await loadCurriculumDatabase(initialCurr);
}

async function switchCurriculumYear(newCurrYear) {
  const targetYear = newCurrYear === '2564' ? '2564' : '2569';
  if (getActiveCurriculumYear() === targetYear && STATE.items.length > 0) return;

  // บันทึกสถานะของหลักสูตรเดิมลงคีย์ของหลักสูตรเดิมก่อนสลับ
  const prevYear = getActiveCurriculumYear();
  saveState(prevYear);

  STATE.curriculumYear = targetYear;
  try {
    localStorage.setItem(ACTIVE_CURR_KEY, targetYear);
  } catch (e) {}

  SELECTED_COURSE_ID = null;
  RECENTLY_UPDATED_UIDS.clear();
  closeDrawer();
  await loadCurriculumDatabase(targetYear);
  showToast(
    `สลับเป็นหลักสูตร พ.ศ. ${targetYear}`,
    targetYear === '2564'
      ? 'แสดงโครงสร้างแผนการเรียน หลักสูตรปรับปรุง พ.ศ. 2564 (สำหรับนักศึกษารหัส 64–68 แผน 1 และแผน 2)'
      : 'แสดงโครงสร้างแผนการเรียน หลักสูตรปรับปรุง พ.ศ. 2569 (สำหรับนักศึกษารหัส 69–73)'
  );
}

function populateTrackDropdown() {
  const sel = document.getElementById('trackSelect');
  sel.innerHTML = '<option value="">-- เลือกสายความเชี่ยวชาญ --</option>';
  Object.entries(DB.trackNames).forEach(([id, name]) => {
    sel.innerHTML += `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
  });
}

// =========================================================================
// 2. State Management & Credit-Aware Slot Splitting / Carry-Over
// =========================================================================
function buildDefaultItems(planType) {
  let allowedTypes = [];
  if (getActiveCurriculumYear() === '2564') {
    if (planType === 'Plan1_Coop') allowedTypes = ['All_64', 'Plan1_All', 'Plan1_Coop'];
    else if (planType === 'Plan2_Regular') allowedTypes = ['All_64', 'Plan2_All', 'Plan2_Regular'];
    else if (planType === 'Plan2_Coop') allowedTypes = ['All_64', 'Plan2_All', 'Plan2_Coop'];
    else allowedTypes = ['All_64', 'Plan1_All', 'Plan1_Regular'];
  } else {
    allowedTypes = planType === 'Coop'
      ? ['Regular_and_Coop', 'Coop_Only']
      : ['Regular_and_Coop', 'Regular_Only'];
  }

  return DB.studyPlans
    .filter(p => allowedTypes.includes(p.plan_type))
    .map((p, idx) => {
      const isPh = String(p.is_placeholder).toUpperCase() === 'TRUE';
      const cid = normalizeCourseId(p.course_id);
      const cInfo = DB.courseMap[cid];
      const baseCredits = cInfo ? cInfo.credits : (Number(p.credits) || 0);
      const uid = `slot_${idx}_${cid}`;
      return {
        uid,
        slotGroupId: uid,
        isSplitChild: false,
        isTrackOverflow: false,
        year: Number(p.year_level) || 1,
        sem: Number(p.semester) || 1,
        courseId: cid,
        originalCourseId: cid,
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

function loadOrBuildState(currYear) {
  const targetYear = currYear === '2564' ? '2564' : '2569';
  const defaultPlan = targetYear === '2564' ? 'Plan1_Regular' : 'Regular';
  try {
    const saved = localStorage.getItem(getStorageKey(targetYear));
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
        STATE = parsed;
        STATE.curriculumYear = targetYear;
        if (targetYear === '2564' && !['Plan1_Regular', 'Plan1_Coop', 'Plan2_Regular', 'Plan2_Coop'].includes(STATE.planType)) {
          STATE.planType = 'Plan1_Regular';
        } else if (targetYear === '2569' && !['Regular', 'Coop'].includes(STATE.planType)) {
          STATE.planType = 'Regular';
        }
        STATE.items.forEach(it => {
          it.courseId = normalizeCourseId(it.courseId);
          it.originalCourseId = normalizeCourseId(it.originalCourseId);
          if (!it.slotGroupId) it.slotGroupId = it.uid;
          if (it.isSplitChild === undefined) it.isSplitChild = false;
          if (it.isTrackOverflow === undefined) it.isTrackOverflow = false;
        });
        syncControlsFromState();
        return;
      }
    }
  } catch (e) {}
  STATE = {
    curriculumYear: targetYear,
    planType: defaultPlan,
    selectedTrack: '',
    flexibleMode: false,
    maxYear: 4,
    extraSummers: [],
    items: buildDefaultItems(defaultPlan)
  };
  saveState();
  syncControlsFromState();
}

function saveState(currYearOverride) {
  const targetKey = getStorageKey(currYearOverride || STATE.curriculumYear);
  localStorage.setItem(targetKey, JSON.stringify(STATE));
}

function syncControlsFromState() {
  const is64 = getActiveCurriculumYear() === '2564';
  const btn69 = document.getElementById('btnCurr2569');
  const btn64 = document.getElementById('btnCurr2564');
  if (btn69) btn69.classList.toggle('active', !is64);
  if (btn64) btn64.classList.toggle('active', is64);

  const hdrMain = document.getElementById('headerMainTitle');
  if (hdrMain) {
    hdrMain.textContent = is64
      ? 'คู่มือการเรียนและวางแผนลงทะเบียน หลักสูตรเคมีอุตสาหกรรม มช. ฉบับปรับปรุง พ.ศ. 2564 (สำหรับนักศึกษารหัส 64-68)'
      : 'คู่มือการเรียนและวางแผนลงทะเบียน หลักสูตรเคมีอุตสาหกรรม มช. ฉบับปรับปรุง พ.ศ. 2569 (สำหรับนักศึกษารหัส 69-73)';
  }

  const grp69 = document.getElementById('planGroup2569');
  const grp64 = document.getElementById('planGroup2564');
  if (grp69) grp69.style.display = is64 ? 'none' : 'inline-flex';
  if (grp64) grp64.style.display = is64 ? 'inline-flex' : 'none';

  if (!is64) {
    document.getElementById('btnPlanRegular')?.classList.toggle('active', STATE.planType === 'Regular');
    document.getElementById('btnPlanCoop')?.classList.toggle('active', STATE.planType === 'Coop');
  } else {
    document.getElementById('btnPlan64P1Reg')?.classList.toggle('active', STATE.planType === 'Plan1_Regular');
    document.getElementById('btnPlan64P1Coop')?.classList.toggle('active', STATE.planType === 'Plan1_Coop');
    document.getElementById('btnPlan64P2Reg')?.classList.toggle('active', STATE.planType === 'Plan2_Regular');
    document.getElementById('btnPlan64P2Coop')?.classList.toggle('active', STATE.planType === 'Plan2_Coop');
  }

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
    .sort((a, b) => {
      const yDiff = (Number(a.recommended_year) || 9) - (Number(b.recommended_year) || 9);
      if (yDiff !== 0) return yDiff;
      const sDiff = (Number(a.recommended_sem) || 9) - (Number(b.recommended_sem) || 9);
      if (sDiff !== 0) return sDiff;
      return (a.priority_level || '').localeCompare(b.priority_level || '');
    });

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
  let carriedOverCount = 0;

  const getCourseCredits = (tc) => {
    const cInfo = DB.courseMap[tc.course_id];
    const cr = cInfo ? cInfo.credits : Number(tc.credits);
    return cr > 0 ? cr : 3;
  };

  const findBestSlot = (filterFn, cr, sortChronological = false) => {
    const eligible = majorElecSlots.filter(slot =>
      !filledSlotUids.has(slot.uid) &&
      cr <= slot.credits &&
      filterFn(slot)
    );
    if (eligible.length === 0) return null;
    if (sortChronological) {
      eligible.sort((a, b) => termOrder(a.year, a.sem) - termOrder(b.year, b.sem) || a.credits - b.credits);
    } else {
      eligible.sort((a, b) => a.credits - b.credits || termOrder(a.year, a.sem) - termOrder(b.year, b.sem));
    }
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

  const fillSlotsWithPool = (pool, allowCarryOverAndOverflow) => {
    // รอบที่ 1: จับคู่ตรงทั้งชั้นปี (recommended_year) และภาคเรียน (recommended_sem)
    // หากเทอมนั้นเต็มแล้ว ให้ขยับไปทดแทนในช่องว่างของเทอมถัดไป (Carry-Over) ก่อนสร้างช่องงอก
    pool.forEach(tc => {
      if (usedIds.has(tc.course_id)) return;
      const recY = Number(tc.recommended_year);
      const recS = Number(tc.recommended_sem);
      if (!recY || !recS) return;
      const cr = getCourseCredits(tc);
      const exactSlot = findBestSlot(s => s.year === recY && s.sem === recS, cr);
      if (exactSlot) {
        assignToSlot(exactSlot, tc);
      } else if (allowCarryOverAndOverflow) {
        const recOrder = termOrder(recY, recS);
        // 1.1) ทดแทนไปยังช่องว่างในเทอมถัดไปก่อน (ไม่สร้างช่องงอกเพิ่ม)
        const nextTermSlot = findBestSlot(s => termOrder(s.year, s.sem) > recOrder, cr, true);
        if (nextTermSlot) {
          assignToSlot(nextTermSlot, tc);
          carriedOverCount++;
        } else {
          // 1.2) หากไม่มีช่องว่างในเทอมถัดไปเลย ลองดูช่องว่างเทอมก่อนหน้า
          const anyEmptySlot = findBestSlot(() => true, cr, true);
          if (anyEmptySlot) {
            assignToSlot(anyEmptySlot, tc);
            carriedOverCount++;
          } else {
            // 1.3) หากช่องว่างตลอดทั้งแผนเต็มหมดแล้วจริงๆ จึงสร้างช่องงอกเพิ่ม (ยกเว้นปี 4 เทอม 2 แผนสหกิจศึกษา)
            const isCoopBlockedTerm = isCoopPlanType(STATE.planType) && recY === 4 && recS === 2;
            if (!isCoopBlockedTerm) {
              usedIds.add(tc.course_id);
              const ovItem = createTrackOverflowItem(recY, recS, tc, cr);
              overflowItems.push(ovItem);
            }
          }
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
        cr,
        true
      );
      if (slot) assignToSlot(slot, tc);
    });

    // รอบที่ 3: เติมรายวิชาที่เหลือลงในช่องว่างที่ยังเหลือ
    pool.forEach(tc => {
      if (usedIds.has(tc.course_id)) return;
      const cr = getCourseCredits(tc);
      const slot = findBestSlot(() => true, cr, true);
      if (slot) assignToSlot(slot, tc);
    });
  };

  // ขั้นที่ 1: ลงวิชาเฉพาะกลุ่มหลัก (is_common_option = FALSE)
  fillSlotsWithPool(coreTrackCourses, true);

  // ขั้นที่ 2: เติมวิชาตัวเลือกร่วมของกลุ่มนั้น (is_common_option = TRUE) เฉพาะในช่องว่างที่เหลือ
  fillSlotsWithPool(commonTrackCourses, false);

  // ขั้นที่ 3: รันเลขลำดับต่อเนื่องตามเวลาจริงและการเรียงลำดับแสดงผล (วิชาที่ลงแล้วอยู่บน ช่องว่างอยู่ล่าง)
  const seqMap = getMajorElectiveSequenceMap();
  const remainingSlots = [];
  majorElecSlots.forEach(slot => {
    if (isEmptyPlaceholder(slot)) {
      slot.title = getDisplayTitleForItem(slot, seqMap);
      if (fallbackNote) {
        slot.trackNote = fallbackNote;
      }
      remainingSlots.push(slot);
    }
  });

  const totalPlacedCount = filledSlotUids.size + overflowItems.length;

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

  const remainingCredits = remainingSlots.reduce((sum, s) => sum + s.credits, 0);
  const overflowCredits = overflowItems.reduce((sum, o) => sum + o.credits, 0);

  const plannedMajorElecCredits = STATE.items
    .filter(i => i.status !== 'failed' && i.category === 'Major_Elective')
    .reduce((sum, i) => sum + i.credits, 0);
  const overMinCredits = Math.max(0, plannedMajorElecCredits - baseMajorElecCredits);

  let desc = `จัดวางวิชาสาย ${escapeHtml(trackName)} ลงตารางปี 3–4 จำนวน ${totalPlacedCount} วิชาเรียบร้อยแล้ว`;
  if (carriedOverCount > 0) {
    desc += ` (ทดแทนไปยังเทอมถัดไป ${carriedOverCount} วิชา)`;
  }
  if (overflowItems.length > 0) {
    desc += ` (เพิ่มเกินแผน ${overflowItems.length} วิชา / +${overflowCredits} นก.)`;
  }
  if (remainingSlots.length > 0) {
    desc += ` เหลือช่องว่าง ${remainingSlots.length} ช่อง (${remainingCredits} นก.) รันเลขตามลำดับเวลาให้แล้ว`;
  }
  if (overMinCredits > 0) {
    desc += `<br><span style="color:#fde68a;font-weight:600;">หมายเหตุ: วางแผนวิชาเอกเลือกเกินเกณฑ์ขั้นต่ำ +${overMinCredits} หน่วยกิต (กดปุ่มลบบนการ์ดที่เพิ่มเกินได้หากไม่ต้องการเรียนเกิน)</span>`;
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
    const rawTermUpper = String(cInfo.offered_terms).trim().toUpperCase();
    if (rawTermUpper === 'CLOSED' || rawTermUpper === 'NONE') {
      warnings.push('วิชานี้ถูกตั้งค่าปิดการเรียนการสอนชั่วคราวในปีการศึกษานี้');
    } else {
      const offered = rawTermUpper.split(',').map(s => s.trim());
      const curTermTag = item.sem === 3 ? 'SUMMER' : `T${item.sem}`;
      if (offered.length > 0 && !offered.includes(curTermTag) && !offered.includes('ALL')) {
        warnings.push(`ปกติวิชานี้เปิดสอนเฉพาะ ${formatTermsTh(cInfo.offered_terms)}`);
      }
    }
  }

  // 2) ตรวจสอบ Prerequisite / Corequisite / Year Status / Special Rule
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
        } else if (c.condition_type === 'SPECIAL_RULE') {
          // เงื่อนไขเฉพาะ (เช่น คะแนน e-Pro) ไม่ถือว่าผิดแผนอัตโนมัติ แต่จะแสดงในแถบรายละเอียด
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

  const is64 = getActiveCurriculumYear() === '2564';
  const isCoop = isCoopPlanType(STATE.planType);
  const isPlan2 = STATE.planType === 'Plan2_Regular' || STATE.planType === 'Plan2_Coop';

  const total = calc(() => true);
  const ge = calc(i => getCategoryGroup(i.category) === 'GE');
  const core = calc(i => getCategoryGroup(i.category) === 'Core');
  const majorAll = calc(i => ['MajorReq', 'MajorElec'].includes(getCategoryGroup(i.category)));
  const majorReq = calc(i => getCategoryGroup(i.category) === 'MajorReq');
  const majorElec = calc(i => getCategoryGroup(i.category) === 'MajorElec');
  const major300 = calc(i => {
    if (!['MajorReq', 'MajorElec'].includes(getCategoryGroup(i.category))) return false;
    const m = String(i.courseId).match(/^\d{3}(\d)/);
    return m && Number(m[1]) >= 3;
  });
  const major400 = calc(i => {
    if (!['MajorReq', 'MajorElec'].includes(getCategoryGroup(i.category))) return false;
    const m = String(i.courseId).match(/^\d{3}(\d)/);
    return m && Number(m[1]) >= 4;
  });
  const free = calc(i => getCategoryGroup(i.category) === 'Free');
  const minor = calc(i => getCategoryGroup(i.category) === 'Minor');

  let cards = [];
  if (!is64) {
    const majorReqRuleId = isCoop ? 'MAJOR_REQ_COOP' : 'MAJOR_REQ_REG';
    const majorReqFallback = isCoop ? 61 : 58;
    const majorElecRuleId = isCoop ? 'MAJOR_ELEC_COOP' : 'MAJOR_ELEC_REG';
    const majorElecFallback = isCoop ? 15 : 18;
    const planSuffix = isCoop ? 'สหกิจฯ' : 'แผนปกติ';
    cards = [
      { title: 'หน่วยกิตรวมตลอดหลักสูตร', data: total, target: getRuleMin('TOTAL_CREDITS', 135) },
      { title: 'หมวดวิชาศึกษาทั่วไป (GE)', data: ge, target: getRuleMin('GE_TOTAL', 24) },
      { title: 'วิชาแกนวิทยาศาสตร์', data: core, target: getRuleMin('CORE_TOTAL', 29) },
      { title: 'วิชาเอกรวม (บังคับ + เลือก)', data: majorAll, target: getRuleMin('MAJOR_TOTAL', 76) },
      { title: `วิชาเอกบังคับ (${planSuffix})`, data: majorReq, target: getRuleMin(majorReqRuleId, majorReqFallback) },
      { title: `วิชาเอกเลือก (${planSuffix})`, data: majorElec, target: getRuleMin(majorElecRuleId, majorElecFallback) },
      { title: 'วิชาเอกระดับ 300 ขึ้นไป', data: major300, target: getRuleMin('MAJOR_LVL300_PLUS', 36), isLevelRule: true },
      { title: 'วิชาเอกระดับ 400', data: major400, target: getRuleMin('MAJOR_LVL400', 18), isLevelRule: true },
      { title: 'วิชาเลือกเสรี', data: free, target: getRuleMin('FREE_ELEC', 6) }
    ];
  } else {
    const planLabel = isPlan2 ? 'แผน 2 ซิลิเกตฯ' : 'แผน 1 เคมีอุตสาหกรรม';
    const totalTarget = isPlan2 ? getRuleMin('TOTAL_CREDITS_P2', 139) : getRuleMin('TOTAL_CREDITS_P1', 138);
    const majorTotalTarget = isPlan2 ? getRuleMin('MAJOR_TOTAL_P2', 74) : getRuleMin('MAJOR_TOTAL_P1', 73);
    const majorReqTarget = isPlan2 ? (41 + 18) : (41 + 17);
    cards = [
      { title: `หน่วยกิตรวม (${planLabel})`, data: total, target: totalTarget },
      { title: 'หมวดวิชาศึกษาทั่วไป (GE)', data: ge, target: getRuleMin('GE_TOTAL', 30) },
      { title: 'วิชาแกนวิทยาศาสตร์', data: core, target: getRuleMin('CORE_TOTAL', 29) },
      { title: `วิชาเอกรวม (${planLabel})`, data: majorAll, target: majorTotalTarget },
      { title: `วิชาเอกบังคับ + บังคับเลือก (${planLabel})`, data: majorReq, target: majorReqTarget },
      { title: 'วิชาเอกเลือก (ไม่น้อยกว่า)', data: majorElec, target: getRuleMin('MAJOR_ELEC_ALL', 15) },
      { title: 'วิชาเอกระดับ 300 ขึ้นไป', data: major300, target: getRuleMin('MAJOR_LVL300_PLUS', 36), isLevelRule: true },
      { title: 'วิชาเอกระดับ 400', data: major400, target: getRuleMin('MAJOR_LVL400', 18), isLevelRule: true },
      { title: 'วิชาเลือกเสรี', data: free, target: getRuleMin('FREE_ELEC', 6) }
    ];
  }

  const grid = document.getElementById('summaryGrid');
  let html = cards.map(c => {
    const pct = Math.min(100, Math.round((c.data.passed / c.target) * 100));
    const isDone = c.data.passed >= c.target;
    const missingPlanned = c.target - c.data.planned;
    const isShort = missingPlanned > 0;

    let statusText = '';
    let cardClass = 'stat-card';
    let fillClass = isDone ? 'done' : '';

    if (isShort) {
      statusText = `<span style="color:var(--danger);font-weight:700;">จัดลงตาราง ${c.data.planned} นก. (ขาดอีก ${missingPlanned} นก.)</span>`;
      cardClass += ' stat-short';
      fillClass = 'short';
    } else {
      statusText = `<span style="color:var(--success);font-weight:600;">จัดลงตาราง ${c.data.planned} นก. (ครบเกณฑ์)</span>`;
    }

    return `
      <div class="${cardClass}">
        <div class="stat-title">${c.title}</div>
        <div class="stat-value">
          <span>${c.data.passed} / ${c.target} <span style="font-size:0.78rem;font-weight:500;">นก.</span></span>
          <span class="stat-sub">${statusText}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill ${fillClass}" style="width:${pct}%"></div>
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
          <span class="stat-sub">จัดลงตาราง ${minor.planned} นก.</span>
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
  const majorElecSeqMap = getMajorElectiveSequenceMap();
  let html = '';

  if (STATE.selectedTrack && DB.trackNames[STATE.selectedTrack]) {
    html += `
      <div class="active-track-banner">
        <div>กำลังแสดงแผนตามสายความเชี่ยวชาญ: <strong>${escapeHtml(DB.trackNames[STATE.selectedTrack])}</strong></div>
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
      const termItems = sortTermItemsForDisplay(
        STATE.items.filter(i => i.year === y && i.sem === s)
      );
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
          const seqNum = majorElecSeqMap[item.uid];
          const displayTitle = getDisplayTitleForItem(item, majorElecSeqMap);

          let hlBadge = '';
          if (hlRole === 'prereq') hlBadge = '<span class="tag tag-hl-prereq">ตัวลงก่อน</span>';
          if (hlRole === 'coreq') hlBadge = '<span class="tag tag-hl-coreq">วิชาควบ</span>';
          if (hlRole === 'unlock') hlBadge = '<span class="tag tag-hl-unlock">ตัวต่อ</span>';

          const phClass = item.isPlaceholder ? 'is-placeholder' : '';
          let elecBadge = '';
          if (item.isTrackOverflow) {
            elecBadge = `<span class="tag tag-overflow">วิชาเอกเลือก${seqNum ? `ตัวที่ ${seqNum}` : ''} (เพิ่มตามสาย)</span>`;
          } else if (catGroup === 'MajorElec') {
            elecBadge = `<span class="tag tag-elec-major">วิชาเอกเลือก${seqNum ? `ตัวที่ ${seqNum}` : ''}</span>`;
          } else if (item.isPlaceholder) {
            if (catGroup === 'GE') elecBadge = '<span class="tag tag-elec-ge">เลือกศึกษาทั่วไป (GE)</span>';
            else if (catGroup === 'Free') elecBadge = '<span class="tag tag-elec-free">วิชาเลือกเสรี</span>';
            else elecBadge = '<span class="tag tag-elec">ช่องวิชาเลือก</span>';
          } else if (catGroup === 'Minor') {
            elecBadge = '<span class="tag tag-minor">วิชาโท / เรียนเพิ่ม</span>';
          } else if (item.isExtra) {
            elecBadge = '<span class="tag tag-elec-free">ลงเพิ่มเติม</span>';
          }

          html += `
            <div class="course-card cat-${escapeHtml(catGroup)} status-${escapeHtml(item.status)} ${phClass} ${hlClass} ${flashClass}" onclick="selectCourse('${escapeJsStr(item.courseId)}', '${escapeJsStr(item.uid)}')">
              <div class="card-top">
                <div>
                  <div class="card-id">
                    <span>${escapeHtml(item.courseId)}</span>
                    ${hlBadge}
                    ${elecBadge}
                  </div>
                  <div class="card-title">${escapeHtml(displayTitle)}</div>
                  ${DB.courseMap[item.courseId]?.title_en ? `<div class="card-title-en">(${escapeHtml(DB.courseMap[item.courseId].title_en)})</div>` : ''}
                  ${item.trackNote ? `<div style="font-size:0.78rem;color:#5b21b6;background:linear-gradient(90deg,#faf5ff 0%,#fefce8 100%);border:1px solid #e9d5ff;border-radius:6px;padding:6px 8px;margin-top:6px;line-height:1.4;"><strong>คำแนะนำกลุ่ม:</strong> ${escapeHtml(item.trackNote)}</div>` : ''}
                </div>
                <div onclick="event.stopPropagation()">
                  ${!STATE.flexibleMode ? `
                    <label class="pass-checkbox" title="ติ๊กเมื่อสอบผ่านวิชานี้แล้ว">
                      <input type="checkbox" ${item.status === 'passed' ? 'checked' : ''} onchange="togglePass('${escapeJsStr(item.uid)}', this.checked)" />
                      <span>ผ่าน</span>
                    </label>
                  ` : `
                    <select class="btn btn-sm" onchange="changeStatus('${escapeJsStr(item.uid)}', this.value)">
                      <option value="planned" ${item.status === 'planned' ? 'selected' : ''}>วางแผนไว้</option>
                      <option value="enrolled" ${item.status === 'enrolled' ? 'selected' : ''}>กำลังเรียน</option>
                      <option value="passed" ${item.status === 'passed' ? 'selected' : ''}>ผ่านแล้ว</option>
                      <option value="failed" ${item.status === 'failed' ? 'selected' : ''}>ไม่ผ่าน/ถอน</option>
                    </select>
                  `}
                </div>
              </div>
              <div class="card-meta">
                <span>${escapeHtml(item.credits)} หน่วยกิต</span>
                ${warnings.length > 0 ? `<span class="tag tag-warn" title="${escapeHtml(warnings.join(' | '))}">แจ้งเตือนเงื่อนไข (${warnings.length})</span>` : ''}
              </div>
              ${(item.isPlaceholder || item.isExtra || item.isTrackOverflow || STATE.flexibleMode) ? `
                <div class="card-actions" onclick="event.stopPropagation()">
                  ${(item.isPlaceholder || item.isTrackOverflow) ? (catGroup === 'Free'
                    ? `<button class="btn btn-sm" onclick="editFreeElective('${escapeJsStr(item.uid)}')">ระบุชื่อวิชาเอง (ไม่บังคับ)</button>`
                    : `<button class="btn btn-sm" onclick="openPickerForSlot('${escapeJsStr(item.uid)}')">เลือก/เปลี่ยนวิชา</button>`) : ''}
                  ${(item.isPlaceholder && !isEmptyPlaceholder(item)) ? `<button class="btn btn-sm btn-danger-outline" onclick="clearSlotCourse('${escapeJsStr(item.uid)}')" title="คืนค่าช่องนี้กลับเป็นช่องว่างเริ่มต้น">ล้างค่า</button>` : ''}
                  ${STATE.flexibleMode ? `<button class="btn btn-sm" onclick="openMoveModal('${escapeJsStr(item.uid)}')">ย้ายเทอม</button>` : ''}
                  ${STATE.flexibleMode && item.status === 'failed' ? `<button class="btn btn-sm btn-accent" onclick="retakeCourse('${escapeJsStr(item.uid)}')">+ ลงเรียนซ้ำ</button>` : ''}
                  ${(STATE.flexibleMode || item.isExtra || item.isTrackOverflow) ? `<button class="btn btn-sm btn-danger-outline" onclick="removeItem('${escapeJsStr(item.uid)}')">ลบ</button>` : ''}
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
  const seqMap = getMajorElectiveSequenceMap();
  document.getElementById('drawerCode').textContent = courseId;
  document.getElementById('drawerTitle').textContent = c ? c.title_th : (item ? getDisplayTitleForItem(item, seqMap) : courseId);
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
          ${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  if (item && item.trackNote) {
    body += `
      <div class="detail-block" style="background:linear-gradient(90deg,#faf5ff 0%,#fefce8 100%);border:1px solid #e9d5ff;padding:10px;border-radius:8px;color:#4c1d95;">
        <h4 style="color:#5b21b6;margin-bottom:4px;">คำแนะนำจากอาจารย์ประจำกลุ่ม</h4>
        <p style="font-size:0.88rem;line-height:1.45;">${escapeHtml(item.trackNote)}</p>
      </div>
    `;
  }

  if (c) {
    const descTh = (c.description_full_th || '').trim() || (c.description_summary_th || '').trim();
    const descEn = (c.description_full_en || '').trim();
    const offeredLabel = formatTermsTh(c.offered_terms || c.open_term_suggested);
    const isMajorCourse209 = /^209\d{3}$/.test(c.course_id);

    body += `
      <div class="detail-block">
        <h4>ข้อมูลรายวิชา</h4>
        <p style="font-size:0.9rem;">
          <strong>หน่วยกิต:</strong> ${escapeHtml(c.credits)} (${escapeHtml(c.lecture_hours || 0)}-${escapeHtml(c.lab_hours || 0)}-${escapeHtml(c.self_study_hours || 0)})<br>
          <strong>หมวดวิชา:</strong> ${escapeHtml(formatCategoryTh(c.course_category))}<br>
          <strong>ภาคเรียนที่เปิดสอน:</strong> ${escapeHtml(offeredLabel)}
        </p>
        ${isMajorCourse209 ? `
          <div style="margin-top:10px;">
            <a class="btn btn-sm btn-primary" href="${OBE_APP_URL}?course=${encodeURIComponent(c.course_id)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
              ดูข้อกำหนดกระบวนวิชา (มคอ. 3 / ผู้สอน) &#8599;
            </a>
          </div>
        ` : ''}
      </div>
    `;

    if (descTh || descEn) {
      body += `
        <div class="detail-block">
          <h4>คำอธิบายลักษณะกระบวนวิชา (Course Description)</h4>
          <div class="desc-box">
            ${descTh ? `
              <div>
                <span class="desc-lang-badge desc-lang-th">ภาษาไทย</span>
                <p class="desc-text">${escapeHtml(descTh)}</p>
              </div>
            ` : ''}
            ${descTh && descEn ? '<hr class="desc-divider" />' : ''}
            ${descEn ? `
              <div>
                <span class="desc-lang-badge desc-lang-en">English</span>
                <p class="desc-text">${escapeHtml(descEn)}</p>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }
  } else if (item && item.placeholderRule) {
    body += `
      <div class="detail-block">
        <h4>เงื่อนไขช่องวิชาเลือก</h4>
        <p style="font-size:0.9rem;">${escapeHtml(item.placeholderRule)}</p>
      </div>
    `;
  }

  body += `<div class="detail-block"><h4>เงื่อนไขตัวลงก่อน / วิชาควบ</h4>`;
  if (conds.length === 0) {
    body += `<p style="font-size:0.86rem;color:var(--muted);">ไม่มีเงื่อนไขบังคับก่อน</p>`;
  } else {
    conds.forEach(cd => {
      const typeLabel = formatConditionTypeTh(cd.condition_type);
      const isCourseRef = (cd.condition_type === 'PREREQUISITE' || cd.condition_type === 'COREQUISITE') && Boolean(DB.courseMap[cd.condition_course_id]);
      const ref = isCourseRef ? DB.courseMap[cd.condition_course_id] : null;
      const mainLabel = isCourseRef
        ? `${cd.condition_course_id} ${ref.title_th}`
        : (cd.condition_type === 'YEAR_STATUS' || cd.condition_type === 'SPECIAL_RULE'
          ? (cd.condition_note_th || cd.condition_course_id)
          : cd.condition_course_id);

      body += `
        <div class="rel-chip ${isCourseRef ? '' : 'non-clickable'}" ${isCourseRef ? `onclick="jumpToCourse('${escapeJsStr(cd.condition_course_id)}')"` : ''}>
          <strong>[${escapeHtml(typeLabel)}]</strong> ${escapeHtml(mainLabel)}
          ${(isCourseRef && cd.condition_note_th) ? `<div style="font-size:0.76rem;color:var(--muted);">${escapeHtml(cd.condition_note_th)}</div>` : ''}
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
      body += `<span class="rel-chip" onclick="jumpToCourse('${escapeJsStr(uId)}')">${escapeHtml(uId)} ${escapeHtml(ref ? ref.title_th : '')}</span>`;
    });
  }
  body += `</div>`;

  if (clos.length > 0) {
    body += `<div class="detail-block"><h4>ผลลัพธ์การเรียนรู้ (CLO / PLO)</h4>`;
    clos.forEach(cl => {
      body += `
        <div style="font-size:0.84rem;margin-bottom:6px;padding:6px 8px;background:#f8fafc;border-radius:6px;">
          <strong>${escapeHtml(cl.clo_code)} (${escapeHtml(cl.mapped_plo_id)})</strong>: ${escapeHtml(cl.clo_description_th)}
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
function updatePickerTermControls() {
  const showAllCheckbox = document.getElementById('pickerShowAllTerms');
  const showAllLabel = document.getElementById('pickerShowAllTermsLabel');
  const clearBtn = document.getElementById('pickerClearSlotBtn');

  if (showAllCheckbox) {
    showAllCheckbox.checked = false;
  }
  if (showAllLabel && PICKER_CTX) {
    const semText = PICKER_CTX.sem === 3 ? 'ภาคฤดูร้อน' : `ภาคการศึกษาที่ ${PICKER_CTX.sem}`;
    showAllLabel.textContent = `แสดงวิชาทุกภาคการศึกษา (ค่าเริ่มต้นกรองเฉพาะ ${semText})`;
  }
  if (clearBtn && PICKER_CTX) {
    if (PICKER_CTX.mode === 'replace' && PICKER_CTX.uid) {
      const slot = STATE.items.find(i => i.uid === PICKER_CTX.uid);
      clearBtn.style.display = (slot && slot.isPlaceholder && !isEmptyPlaceholder(slot)) ? 'inline-flex' : 'none';
    } else {
      clearBtn.style.display = 'none';
    }
  }
}

function openPickerForSlot(uid) {
  const slot = STATE.items.find(i => i.uid === uid);
  if (!slot) return;
  const seqMap = getMajorElectiveSequenceMap();
  const displayTitle = getDisplayTitleForItem(slot, seqMap);
  PICKER_CTX = { mode: 'replace', uid, year: slot.year, sem: slot.sem, category: slot.category };
  document.getElementById('pickerTitle').textContent = `เลือกวิชาสำหรับช่อง: ${displayTitle} (ชั้นปีที่ ${slot.year} ${slot.sem === 3 ? 'ภาคฤดูร้อน' : 'ภาคการศึกษาที่ ' + slot.sem} | ${slot.credits} หน่วยกิต)`;
  setupPickerFilters(slot.category === 'Major_Elective');
  updatePickerTermControls();
  document.getElementById('customAddBox').style.display = 'none';
  document.getElementById('pickerModal').classList.add('open');
  renderPickerList();
}

function openPickerToAdd(year, sem) {
  PICKER_CTX = { mode: 'add', uid: null, year, sem, category: 'ALL' };
  document.getElementById('pickerTitle').textContent = `เพิ่มรายวิชาใน ชั้นปีที่ ${year} ${sem === 3 ? 'ภาคฤดูร้อน' : 'ภาคการศึกษาที่ ' + sem}`;
  setupPickerFilters(true);
  updatePickerTermControls();
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
        opts += `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
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
  if (!PICKER_CTX) return;
  const q = document.getElementById('pickerSearch').value.toLowerCase();
  const trackFilter = document.getElementById('pickerTrackFilter').value;
  const showAllTerms = !!document.getElementById('pickerShowAllTerms')?.checked;
  const activeIds = new Set(STATE.items.filter(i => i.status !== 'failed').map(i => i.courseId));
  const allTrackCourseIds = new Set(DB.tracks.map(t => t.course_id).filter(Boolean));
  const targetYear = Number(PICKER_CTX.year) || 3;
  const targetSem = Number(PICKER_CTX.sem) || 1;

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

  // 1) ซ่อนรายวิชาที่ตั้งค่าปิดการเรียนการสอนชั่วคราว (CLOSED) เสมอเมื่อยังไม่ติ๊กแสดงทุกภาคการศึกษา
  if (!showAllTerms) {
    list = list.filter(c => {
      const t = String(c.offered_terms || '').trim().toUpperCase();
      return t !== 'CLOSED' && t !== 'NONE';
    });
  }

  // 2) กรองตามภาคการศึกษาที่เปิดสอน (ค่าเริ่มต้นเมื่อยังไม่ติ๊ก "แสดงวิชาทุกภาคการศึกษา")
  if (!showAllTerms && (targetSem === 1 || targetSem === 2)) {
    list = list.filter(c => isCourseOfferedInSemester(c, targetSem));
  }

  if (q) {
    list = list.filter(c =>
      c.course_id.toLowerCase().includes(q) ||
      c.title_th.toLowerCase().includes(q) ||
      (c.title_en || '').toLowerCase().includes(q) ||
      (c.description_full_th || '').toLowerCase().includes(q) ||
      (c.description_full_en || '').toLowerCase().includes(q) ||
      (c.description_summary_th || '').toLowerCase().includes(q)
    );
  }

  // 2) เรียงลำดับโดยนำรายวิชาที่ชั้นปีแนะนำตรงกับชั้นปีของช่องที่กำลังเลือกขึ้นไว้ด้านบนสุดก่อน
  // ตามด้วยรายวิชาของชั้นปีอื่น และวิชาที่ยังไม่ระบุชั้นปี
  const getYearSortRank = (course) => {
    const recYears = getCourseRecommendedYears(course, trackFilter);
    if (recYears.length === 0) return { tier: 2, dist: 99, minYear: 99 };
    if (recYears.includes(targetYear)) return { tier: 0, dist: 0, minYear: targetYear };
    const minDist = Math.min(...recYears.map(y => Math.abs(y - targetYear)));
    return { tier: 1, dist: minDist, minYear: recYears[0] };
  };

  list.sort((a, b) => {
    const rA = getYearSortRank(a);
    const rB = getYearSortRank(b);
    if (rA.tier !== rB.tier) return rA.tier - rB.tier;
    if (rA.dist !== rB.dist) return rA.dist - rB.dist;
    if (rA.minYear !== rB.minYear) return rA.minYear - rB.minYear;

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
    body.innerHTML = `<p style="text-align:center;color:var(--muted);padding:20px;">ไม่พบรายวิชาที่เปิดสอนในภาคการศึกษานี้ หรือตรงกับคำค้นหา<br><small>คุณสามารถติ๊กช่อง <strong>"แสดงวิชาทุกภาคการศึกษา"</strong> ด้านบนเพื่อดูรายวิชาทั้งหมดได้ครับ</small></p>`;
    return;
  }

  body.innerHTML = list.map(c => {
    const alreadyIn = activeIds.has(c.course_id);
    const recYears = getCourseRecommendedYears(c, trackFilter);
    const isMatchedYear = recYears.includes(targetYear);
    let yearBadge = '';
    if (recYears.length > 0) {
      yearBadge = `<span class="tag ${isMatchedYear ? 'tag-year-match' : 'tag-year-other'}">แนะนำปี ${escapeHtml(recYears.join('/'))}</span>`;
    }

    const rawTerms = String(c.offered_terms || '').trim();
    const isVerifyTerm = !rawTerms || rawTerms.toUpperCase() === 'VERIFY';
    const shortTermLabel = formatShortTermsBadge(rawTerms);
    const offeredInTargetSem = isCourseOfferedInSemester(c, targetSem);
    const termBadgeClass = !offeredInTargetSem
      ? 'tag-warn'
      : (isVerifyTerm ? 'tag-term-verify' : 'tag-term-badge');
    const termBadge = `<span class="tag ${termBadgeClass}">${escapeHtml(shortTermLabel)}</span>`;

    const courseTracks = DB.tracksByCourse[c.course_id] || [];
    let groupBadge = '';
    if (courseTracks.length > 0) {
      groupBadge = courseTracks.map(t =>
        t.isCommon
          ? `<span class="tag tag-elec-free">${escapeHtml(t.trackName)} (ตัวเลือกร่วม)</span>`
          : `<span class="tag tag-elec-major">${escapeHtml(t.trackName)}</span>`
      ).join(' ');
    } else if (c.course_id.startsWith('209')) {
      groupBadge = '<span class="tag tag-elec-ge">209 ทั่วไป</span>';
    } else {
      groupBadge = '<span class="tag tag-minor">นอกภาควิชา</span>';
    }

    const conds = DB.condByCourse[c.course_id] || [];
    let condHtml = '';
    if (conds.length > 0) {
      const condParts = conds.map(cd => {
        const typeLabel = formatConditionTypeTh(cd.condition_type);
        const label = (cd.condition_type === 'YEAR_STATUS' || cd.condition_type === 'SPECIAL_RULE')
          ? (cd.condition_note_th || cd.condition_course_id)
          : cd.condition_course_id;
        return `${typeLabel}: ${label}`;
      });
      condHtml = `<div class="picker-item-cond"><strong>เงื่อนไขก่อนเรียน:</strong> ${escapeHtml([...new Set(condParts)].join(' | '))}</div>`;
    }

    const descTh = (c.description_summary_th || c.description_full_th || '').trim();
    const descEn = (c.description_full_en || '').trim();
    let descHtml = '';
    if (descTh || descEn) {
      descHtml = `
        <details style="margin-top:4px;font-size:0.78rem;color:var(--muted);">
          <summary style="cursor:pointer;color:var(--primary);font-weight:600;user-select:none;">ดูคำอธิบายรายวิชา (TH / EN)</summary>
          <div class="picker-item-desc">
            ${descTh ? `<div><strong>TH:</strong> ${escapeHtml(descTh)}</div>` : ''}
            ${descEn ? `<div style="margin-top:${descTh ? '4px' : '0'};"><strong>EN:</strong> ${escapeHtml(descEn)}</div>` : ''}
          </div>
        </details>
      `;
    }

    return `
      <div class="picker-item">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.9rem;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
            <span>${escapeHtml(c.course_id)} — ${escapeHtml(c.title_th)}</span>
            ${yearBadge}
            ${termBadge}
            ${groupBadge}
          </div>
          ${c.title_en ? `<div style="font-size:0.78rem;color:var(--muted);">${escapeHtml(c.title_en)}</div>` : ''}
          <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;">${escapeHtml(c.credits)} หน่วยกิต | หมวด: ${escapeHtml(formatCategoryTh(c.course_category))}</div>
          ${condHtml}
          ${descHtml}
        </div>
        <button class="btn btn-sm ${alreadyIn ? '' : 'btn-primary'}" ${alreadyIn ? 'disabled' : ''} onclick="pickCourse('${escapeJsStr(c.course_id)}')">
          ${alreadyIn ? 'อยู่ในแผนแล้ว' : 'เลือกวิชานี้'}
        </button>
      </div>
    `;
  }).join('');
}

function clearSlotCourse(uid, fromModal = false) {
  let slot = STATE.items.find(i => i.uid === uid);
  if (!slot || !slot.isPlaceholder) return;

  const groupId = slot.slotGroupId || slot.uid;
  const origInfo = DB.courseMap[slot.originalCourseId];

  // คืนค่าช่องที่ถูกเลือกให้กลับเป็นช่องว่างเริ่มต้นก่อน
  slot.courseId = slot.originalCourseId;
  slot.title = origInfo ? origInfo.title_th : slot.originalTitle;
  slot.trackNote = '';
  slot.status = 'planned';

  // หากเป็นช่องที่เคยแตกหน่วยกิตย่อย (slotGroupId เดียวกัน) ให้ยุบรวมช่องว่างย่อยที่ยังไม่ได้เลือกวิชาเข้าด้วยกัน
  const groupSiblings = STATE.items.filter(other =>
    (other.slotGroupId || other.uid) === groupId &&
    other.isPlaceholder
  );

  if (groupSiblings.length > 1) {
    const emptyGroupItems = groupSiblings.filter(it => isEmptyPlaceholder(it));
    if (emptyGroupItems.length > 1) {
      // ยุบรวมหน่วยกิตของช่องว่างทั้งหมดในกลุ่มเดียวกันไว้ที่ช่องหลัก (หรือช่องแรกของกลุ่ม)
      const primarySlot = emptyGroupItems.find(it => !it.isSplitChild) || emptyGroupItems[0];
      const mergedCredits = emptyGroupItems.reduce((sum, it) => sum + (Number(it.credits) || 0), 0);
      primarySlot.credits = mergedCredits;
      if (!primarySlot.isSplitChild) {
        primarySlot.originalCredits = mergedCredits;
      }
      const removeUids = new Set(
        emptyGroupItems.filter(it => it.uid !== primarySlot.uid).map(it => it.uid)
      );
      STATE.items = STATE.items.filter(it => !removeUids.has(it.uid));
      slot = primarySlot;
    }
  } else {
    slot.credits = slot.originalCredits || (origInfo ? origInfo.credits : 3);
  }

  // รันเลขลำดับวิชาเอกเลือกใหม่ตามตำแหน่งจริงในตาราง
  const seqMap = getMajorElectiveSequenceMap();
  STATE.items.forEach(it => {
    if (isEmptyPlaceholder(it) && getCategoryGroup(it.category) === 'MajorElec') {
      it.title = getDisplayTitleForItem(it, seqMap);
    }
  });

  if (SELECTED_COURSE_ID && !STATE.items.some(i => i.courseId === SELECTED_COURSE_ID)) {
    closeDrawer();
  }

  if (fromModal) {
    closePickerModal();
  }

  saveState();
  renderAll();
  showToast('คืนค่าช่องวิชาเลือกเรียบร้อย', 'ล้างรายวิชาที่เลือกและคำนวณหน่วยกิตพร้อมตรวจสอบเงื่อนไขใหม่แล้วครับ', 3200);
}

function clearSlotFromPicker() {
  if (!PICKER_CTX || PICKER_CTX.mode !== 'replace' || !PICKER_CTX.uid) return;
  clearSlotCourse(PICKER_CTX.uid, true);
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
  const seqMap = getMajorElectiveSequenceMap();
  document.getElementById('moveCourseLabel').textContent = `${item.courseId} — ${getDisplayTitleForItem(item, seqMap)}`;
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
  a.download = `study-plan-indchem${getActiveCurriculumYear()}-${STATE.planType}.json`;
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
          it.courseId = normalizeCourseId(it.courseId);
          it.originalCourseId = normalizeCourseId(it.originalCourseId);
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
    slot.courseId = normalizeCourseId(trimmedCode);
    slot.title = newTitle.trim() || 'วิชาเลือกเสรี';
  }
  saveState();
  renderAll();
}

function addCustomCourse() {
  const code = normalizeCourseId(document.getElementById('customCode').value.trim());
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
