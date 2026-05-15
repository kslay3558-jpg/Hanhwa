/* ============================================================================
 * JIS 배관 자재 계산기 — Application Script
 *
 * 구조 (sections):
 *   §1. CONSTANTS / DATA  — JIS B 2220 데이터, 상수
 *   §2. UTILITIES         — DOM/문자열/배열/포맷 헬퍼
 *   §3. STORE             — 상태 + localStorage + Undo/Redo + Projects
 *   §4. MODEL              — 자재 객체 생성/계산 로직
 *   §5. VIEW              — 렌더링 함수 (textContent 기반, XSS-safe)
 *   §6. CONTROLLER        — 이벤트 위임 + data-action 라우팅
 *   §7. PWA               — Service Worker 등록 + 설치 배너
 *   §8. INIT              — 부트스트랩
 *
 * 모든 동작은 IIFE 안에서 격리되어 전역 오염이 없습니다.
 * ============================================================================ */
(() => {
  'use strict';

  /* =====================================================================
     §1. CONSTANTS / DATA
     ===================================================================== */

  /** 플랜지 호칭경 (JIS 일반) */
  const SIZES  = [15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500,550,600];
  /** U-볼트 호칭경 */
  const USIZES = [15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500];
  /** U-볼트 핏치 (홀 간격 mm). 누락된 사이즈는 표시 시 안내한다. */
  const UBOLT_PITCH = {
    15: 34, 20: 40, 25: 46, 32: 56, 40: 62, 50: 74,
    65: 90, 80: 104, 100: 130, 125: 156, 150: 182,
    200: 234, 250: 286, 300: 338, 350: 376, 400: 428, 450: 480, 500: 532
  };

  /**
   * 플랜지 볼트 규격 (JIS B 2220 기준).
   * 형식: [볼트 굵기 'M??', 기본 볼트 길이 mm, 1포인트당 볼트 개수]
   */
  const DATA = {
    "5K":  {15:["M10",30,4],20:["M10",35,4],25:["M10",35,4],32:["M12",40,4],40:["M12",40,4],50:["M12",45,4],65:["M12",45,4],80:["M16",45,4],100:["M16",50,8],125:["M16",50,8],150:["M16",55,8],200:["M20",65,8],250:["M20",70,12],300:["M20",70,12],350:["M22",75,12],400:["M22",75,16],450:["M22",75,16],500:["M22",75,20],550:["M24",80,20],600:["M24",80,20]},
    "10K": {15:["M12",40,4],20:["M12",45,4],25:["M16",45,4],32:["M16",50,4],40:["M16",50,4],50:["M16",50,4],65:["M16",55,4],80:["M16",55,8],100:["M16",55,8],125:["M20",65,8],150:["M20",70,8],200:["M20",70,12],250:["M22",75,12],300:["M22",80,16],350:["M22",80,16],400:["M24",85,16],450:["M24",90,20],500:["M24",90,20],550:["M30",100,20],600:["M30",100,24]},
    "16K": {15:["M12",40,4],20:["M12",45,4],25:["M16",45,4],32:["M16",50,4],40:["M16",50,4],50:["M16",50,8],65:["M16",55,8],80:["M20",65,8],100:["M20",65,8],125:["M22",70,8],150:["M22",75,12],200:["M22",80,12],250:["M24",85,12],300:["M24",90,16],350:["M24",90,16],400:["M30",105,16],450:["M30",110,16],500:["M30",115,20],550:["M30",120,20],600:["M36",130,20]},
    "30K": {15:["M16",60,4],20:["M16",60,4],25:["M16",65,4],32:["M16",65,4],40:["M20",70,4],50:["M16",65,8],65:["M20",80,8],80:["M20",85,8],100:["M22",95,8],125:["M24",105,12],150:["M24",115,12],200:["M30",135,12],250:["M30",140,16],300:["M30",145,16],350:["M36",160,16]}
  };
  const RATING_ORDER = { "5K": 1, "10K": 2, "16K": 3, "30K": 4 };

  /**
   * JIS B 2220 RF 플랜지 외경 (OD, mm).
   * 출처: JIS B 2220 (강제 플랜지 규격) 일반 인용값.
   * 누락되면 외경 역산 정확도가 떨어지므로 가능한 모든 사이즈 수록.
   */
  const FLANGE_OD_DATA = [
    // 5K
    { r:"5K",  s:15,  od: 80 }, { r:"5K", s:20, od: 85 }, { r:"5K", s:25, od: 95 },
    { r:"5K",  s:32, od:115 }, { r:"5K", s:40, od:120 }, { r:"5K", s:50, od:130 },
    { r:"5K",  s:65, od:155 }, { r:"5K", s:80, od:180 }, { r:"5K", s:100,od:200 },
    { r:"5K",  s:125,od:235 }, { r:"5K", s:150,od:265 }, { r:"5K", s:200,od:320 },
    { r:"5K",  s:250,od:385 }, { r:"5K", s:300,od:430 }, { r:"5K", s:350,od:480 },
    { r:"5K",  s:400,od:540 }, { r:"5K", s:450,od:605 }, { r:"5K", s:500,od:655 },
    { r:"5K",  s:550,od:720 }, { r:"5K", s:600,od:770 },
    // 10K
    { r:"10K", s:15, od: 95 }, { r:"10K",s:20, od:100 }, { r:"10K",s:25, od:125 },
    { r:"10K", s:32, od:135 }, { r:"10K",s:40, od:140 }, { r:"10K",s:50, od:155 },
    { r:"10K", s:65, od:175 }, { r:"10K",s:80, od:185 }, { r:"10K",s:100,od:210 },
    { r:"10K", s:125,od:250 }, { r:"10K",s:150,od:280 }, { r:"10K",s:200,od:330 },
    { r:"10K", s:250,od:400 }, { r:"10K",s:300,od:445 }, { r:"10K",s:350,od:490 },
    { r:"10K", s:400,od:560 }, { r:"10K",s:450,od:620 }, { r:"10K",s:500,od:675 },
    { r:"10K", s:550,od:745 }, { r:"10K",s:600,od:795 },
    // 16K (JIS B 2220 보강)
    { r:"16K", s:15, od: 95 }, { r:"16K",s:20, od:100 }, { r:"16K",s:25, od:125 },
    { r:"16K", s:32, od:135 }, { r:"16K",s:40, od:140 }, { r:"16K",s:50, od:155 },
    { r:"16K", s:65, od:175 }, { r:"16K",s:80, od:200 }, { r:"16K",s:100,od:225 },
    { r:"16K", s:125,od:270 }, { r:"16K",s:150,od:305 }, { r:"16K",s:200,od:350 },
    { r:"16K", s:250,od:430 }, { r:"16K",s:300,od:480 }, { r:"16K",s:350,od:540 },
    { r:"16K", s:400,od:605 }, { r:"16K",s:450,od:675 }, { r:"16K",s:500,od:730 },
    { r:"16K", s:550,od:795 }, { r:"16K",s:600,od:845 },
    // 30K (JIS B 2220 보강)
    { r:"30K", s:15, od:115 }, { r:"30K",s:20, od:120 }, { r:"30K",s:25, od:130 },
    { r:"30K", s:32, od:140 }, { r:"30K",s:40, od:160 }, { r:"30K",s:50, od:165 },
    { r:"30K", s:65, od:200 }, { r:"30K",s:80, od:210 }, { r:"30K",s:100,od:250 },
    { r:"30K", s:125,od:295 }, { r:"30K",s:150,od:345 }, { r:"30K",s:200,od:415 },
    { r:"30K", s:250,od:485 }, { r:"30K",s:300,od:560 }, { r:"30K",s:350,od:620 }
  ];

  const STORAGE_KEY = 'jis-calc-state-v2';
  const TUTORIAL_KEY = 'jis-calc-hide-tutorial';
  const THEME_KEY = 'jis-calc-theme';
  const HISTORY_LIMIT = 10;

  /* =====================================================================
     §2. UTILITIES
     ===================================================================== */

  /** @param {string} sel @param {Element|Document} [root] */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** Create element with optional attrs/children, escaping all text. */
  function el(tag, attrs = null, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      if (c instanceof Node) node.appendChild(c);
      else node.appendChild(document.createTextNode(String(c)));
    }
    return node;
  }

  /** Debounce with leading-or-trailing call. */
  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  /** Parse positive integer with fallback. */
  function toPosInt(v, fallback = 1) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** Sanitize for filename. */
  function sanitizeFilename(s) {
    return String(s).replace(/[^\w\u00C0-\uFFFF\-가-힣 ]+/g, '_').slice(0, 60) || 'export';
  }

  /** Stable JSON deep clone. */
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** Toast (a11y: role=status). */
  let toastTimer;
  function toast(message, ms = 2000) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /** Get nut thickness (rough JIS thumb rule). */
  function getNutThickness(mSize) {
    const m = parseInt(String(mSize).replace('M', ''), 10);
    if (!Number.isFinite(m)) return 0;
    return Math.ceil(m / 5) * 5;
  }

  /** Add ripple effect to a button click. */
  function addRipple(btn, evt) {
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const r = el('span', { class: 'ripple' });
    const size = Math.max(rect.width, rect.height);
    r.style.width = r.style.height = size + 'px';
    r.style.left = ((evt.clientX || rect.left + rect.width / 2) - rect.left - size / 2) + 'px';
    r.style.top  = ((evt.clientY || rect.top + rect.height / 2) - rect.top  - size / 2) + 'px';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  /** Animate count-up from 0 to target. */
  function countUp(node, target, duration = 600) {
    if (!Number.isFinite(target)) { node.textContent = String(target); return; }
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* =====================================================================
     §3. STORE — state, persistence, undo/redo, projects
     ===================================================================== */

  /**
   * @typedef {Object} Item
   * @property {'bolt'|'gasket'|'ubolt'} type
   * @property {string=} r       — rating (5K/10K/16K/30K)
   * @property {number=} s       — size A
   * @property {number}  qty
   * @property {boolean=} ext, doubleNut, auto
   * @property {string=} bS, gtype
   * @property {number=} bL, bC
   * @property {number=} pitch
   */
  const Store = {
    /** @type {string} */ currentProject: 'default',
    /** @type {Object<string,{name:string,queue:Item[],memo:string}>} */ projects: { default: { name: '기본 현장', queue: [], memo: '' } },
    /** @type {Item[][]} */ history: [],
    /** @type {Item[][]} */ future: [],
    listeners: new Set(),

    get current() { return this.projects[this.currentProject] || (this.projects[this.currentProject] = { name: '기본 현장', queue: [], memo: '' }); },
    get queue() { return this.current.queue; },
    set queue(v) { this.current.queue = v; },
    get memo() { return this.current.memo; },
    set memo(v) { this.current.memo = v; },

    /** Snapshot current queue for undo. */
    snapshot() {
      this.history.push(clone(this.queue));
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      this.future.length = 0;
    },
    undo() {
      if (!this.history.length) return false;
      this.future.push(clone(this.queue));
      this.queue = this.history.pop();
      return true;
    },
    redo() {
      if (!this.future.length) return false;
      this.history.push(clone(this.queue));
      this.queue = this.future.pop();
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
      return true;
    },
    canUndo() { return this.history.length > 0; },
    canRedo() { return this.future.length > 0; },

    save() {
      try {
        const data = {
          currentProject: this.currentProject,
          projects: this.projects
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) { /* quota or disabled */ }
    },
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          if (data.projects && typeof data.projects === 'object') this.projects = data.projects;
          if (typeof data.currentProject === 'string' && this.projects[data.currentProject]) {
            this.currentProject = data.currentProject;
          }
          // Sanitize: ensure queue is array, memo is string
          for (const p of Object.values(this.projects)) {
            if (!Array.isArray(p.queue)) p.queue = [];
            if (typeof p.memo !== 'string') p.memo = '';
            if (typeof p.name !== 'string') p.name = '현장';
          }
        }
      } catch (e) { /* corrupted */ }
    },

    addProject(name) {
      const id = 'p_' + Date.now().toString(36);
      this.projects[id] = { name: String(name || '새 현장').slice(0, 40), queue: [], memo: '' };
      this.currentProject = id;
      this.history.length = 0; this.future.length = 0;
      this.save();
      return id;
    },
    renameProject(id, name) {
      if (this.projects[id]) {
        this.projects[id].name = String(name || '현장').slice(0, 40);
        this.save();
      }
    },
    deleteProject(id) {
      if (Object.keys(this.projects).length <= 1) return false;
      delete this.projects[id];
      if (this.currentProject === id) {
        this.currentProject = Object.keys(this.projects)[0];
      }
      this.history.length = 0; this.future.length = 0;
      this.save();
      return true;
    },
    switchProject(id) {
      if (this.projects[id]) {
        this.currentProject = id;
        this.history.length = 0; this.future.length = 0;
        this.save();
      }
    }
  };

  /* =====================================================================
     §4. MODEL — calculation
     ===================================================================== */

  /**
   * Build a bolt item with auto-calculated length.
   * Returns null if data is missing for that rating/size.
   */
  function buildBoltItem(r, s, qty, opts) {
    const row = DATA[r] && DATA[r][s];
    if (!row) return null;
    const [bS, baseL, bC] = row;
    let len = baseL;
    if (opts.ext) len += 5;
    if (opts.doubleNut) len += getNutThickness(bS);
    return { type: 'bolt', r, s, qty, ext: !!opts.ext, doubleNut: !!opts.doubleNut, bS, bL: len, bC };
  }

  function buildGasketItem(r, s, qty, gtype, auto = false) {
    if (!DATA[r] || !DATA[r][s]) return null;
    return { type: 'gasket', r, s, qty, gtype: String(gtype || '일반'), auto: !!auto };
  }

  function buildUboltItem(s, qty) {
    return { type: 'ubolt', s, qty, pitch: UBOLT_PITCH[s] || null };
  }

  /** Aggregate the queue into bolt/nut/gasket/ubolt maps. */
  function aggregate(queue) {
    const bM = {}, nM = {}, gM = {}, uM = {};
    for (const q of queue) {
      if (q.type === 'bolt') {
        const bK = `${q.bS} × ${q.bL}L`;
        const nK = q.bS;
        const bolts = q.bC * q.qty;
        const nuts  = bolts * (q.doubleNut ? 2 : 1);
        bM[bK] = (bM[bK] || 0) + bolts;
        nM[nK] = (nM[nK] || 0) + nuts;
      } else if (q.type === 'gasket') {
        const k = `${q.r} ${q.s}A (${q.gtype})`;
        gM[k] = (gM[k] || 0) + q.qty;
      } else if (q.type === 'ubolt') {
        const k = `${q.s}A`;
        uM[k] = (uM[k] || 0) + q.qty;
      }
    }
    const sB = Object.entries(bM).sort((a, b) => {
      const ma = a[0].match(/M(\d+)/), mb = b[0].match(/M(\d+)/);
      const da = (ma ? +ma[1] : 0) - (mb ? +mb[1] : 0);
      if (da) return da;
      return parseInt(a[0].split('×')[1], 10) - parseInt(b[0].split('×')[1], 10);
    });
    const sN = Object.entries(nM).sort((a, b) => {
      const ma = a[0].match(/M(\d+)/), mb = b[0].match(/M(\d+)/);
      return (ma ? +ma[1] : 0) - (mb ? +mb[1] : 0);
    });
    const sG = Object.entries(gM).sort((a, b) => {
      const [ra, sa] = a[0].split(' '), [rb, sb] = b[0].split(' ');
      return (RATING_ORDER[ra] - RATING_ORDER[rb]) || (parseInt(sa, 10) - parseInt(sb, 10));
    });
    const sU = Object.entries(uM).sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10));
    return { sB, sN, sG, sU };
  }

  /** Build plaintext export. */
  function buildExportText(agg, memo) {
    let t = '[자재 집계 내역]\n\n';
    for (const [k, v] of agg.sB) t += `[볼트] ${k} : ${v}개\n`;
    if (agg.sN.length) t += '\n';
    for (const [k, v] of agg.sN) t += `[너트] ${k} : ${v}개\n`;
    if (agg.sG.length) t += '\n';
    for (const [k, v] of agg.sG) t += `[가스켓] ${k} : ${v}장\n`;
    if (agg.sU.length) t += '\n';
    for (const [k, v] of agg.sU) {
      const p = UBOLT_PITCH[parseInt(k, 10)];
      t += `[U-볼트] ${k}${p ? ` (C-C: ${p}mm)` : ' (핏치 정보 없음)'} : ${v}set\n`;
    }
    if (memo && memo.trim()) t += `\n[추가 메모]\n${memo.trim()}\n`;
    return t;
  }

  /** Build CSV export. */
  function buildExportCSV(agg, memo) {
    const rows = [['카테고리', '규격', '수량', '단위']];
    for (const [k, v] of agg.sB) rows.push(['볼트', k, v, '개']);
    for (const [k, v] of agg.sN) rows.push(['너트', k, v, '개']);
    for (const [k, v] of agg.sG) rows.push(['가스켓', k, v, '장']);
    for (const [k, v] of agg.sU) {
      const p = UBOLT_PITCH[parseInt(k, 10)];
      rows.push(['U-볼트', `${k}${p ? ` (C-C ${p}mm)` : ''}`, v, 'set']);
    }
    if (memo && memo.trim()) rows.push(['메모', memo.trim().replace(/\n/g, ' '), '', '']);
    const esc = (s) => {
      const str = String(s);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
  }

  /* =====================================================================
     §5. VIEW — DOM rendering (XSS-safe via textContent / el())
     ===================================================================== */

  const View = {
    populateSizeSelect(selectEl, rating) {
      const prev = parseInt(selectEl.value, 10);
      selectEl.textContent = '';
      for (const s of SIZES) {
        if (DATA[rating] && DATA[rating][s]) {
          selectEl.appendChild(el('option', { value: s }, s + 'A'));
        }
      }
      if ([...selectEl.options].some(o => +o.value === prev)) selectEl.value = prev;
    },

    populateUSizeSelect(selectEl) {
      selectEl.textContent = '';
      for (const s of USIZES) selectEl.appendChild(el('option', { value: s }, s + 'A'));
    },

    populateProjectSelect(selectEl) {
      selectEl.textContent = '';
      for (const [id, p] of Object.entries(Store.projects)) {
        selectEl.appendChild(el('option', { value: id }, p.name));
      }
      selectEl.value = Store.currentProject;
    },

    updatePitchInfo(s) {
      const node = $('#uPitchInfo');
      const p = UBOLT_PITCH[s];
      node.textContent = '';
      node.classList.toggle('missing', !p);
      if (p) {
        node.appendChild(document.createTextNode('홀 간격: '));
        node.appendChild(el('b', null, String(p)));
        node.appendChild(document.createTextNode(' mm'));
      } else {
        node.appendChild(document.createTextNode('홀 간격 데이터 없음 (수동 확인 필요)'));
      }
    },

    /**
     * Render queue list. Uses DOM API only (no innerHTML w/ user data).
     */
    renderQueue() {
      const tb = $('#qBody');
      const qCount = $('#qCount');
      const fb = $('#floatingBar');
      const fbBadge = $('#floatCount');
      const queue = Store.queue;

      qCount.textContent = `${queue.length}건`;

      // Floating bar (mobile)
      if (queue.length > 0) {
        fb.classList.add('show');
        fb.setAttribute('aria-hidden', 'false');
        fbBadge.textContent = String(queue.length);
        fbBadge.classList.add('pop');
        setTimeout(() => fbBadge.classList.remove('pop'), 220);
      } else {
        fb.classList.remove('show');
        fb.setAttribute('aria-hidden', 'true');
      }

      tb.textContent = '';

      if (!queue.length) {
        const empty = el('div', { class: 'empty-state' },
          el('svg', { viewBox: '0 0 64 64', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }),
          el('strong', null, '대기열이 비어 있어요'),
          el('span', null, '좌측 양식에서 자재를 추가하면 여기에 쌓입니다.')
        );
        // Add basket icon
        const svg = empty.querySelector('svg');
        svg.innerHTML = '<path d="M12 22h40l-4 28a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4l-4-28z"/><path d="M22 22V14a10 10 0 0 1 20 0v8"/>';
        tb.appendChild(empty);
        this.updateUndoRedoButtons();
        return;
      }

      queue.forEach((q, i) => tb.appendChild(this.renderQueueItem(q, i)));
      tb.scrollTop = tb.scrollHeight;
      this.updateUndoRedoButtons();
    },

    /** Render one queue row (XSS-safe). */
    renderQueueItem(q, i) {
      let title = '', desc = '';
      const tags = [];

      if (q.type === 'bolt') {
        title = `${q.r} ${q.s}A 플랜지`;
        desc  = `${q.bS} × ${q.bL}L · ${q.bC}공/pt`;
        if (q.ext) tags.push({ label: '+5mm', kind: 'blue' });
        if (q.doubleNut) tags.push({ label: '더블너트', kind: 'blue' });
      } else if (q.type === 'gasket') {
        title = `${q.r} ${q.s}A 가스켓`;
        desc  = q.gtype + (q.auto ? ' · 자동 추가' : '');
      } else if (q.type === 'ubolt') {
        title = `U-볼트 ${q.s}A`;
        const p = UBOLT_PITCH[q.s];
        desc  = p ? `홀 간격 ${p}mm` : '홀 간격 정보 없음';
        if (!p) tags.push({ label: '핏치 미상', kind: 'warn' });
      }

      const titleNode = el('div', { class: 'q-title' },
        document.createTextNode(title + ' '),
        el('span', { class: 'q-qty' }, '× ' + q.qty)
      );

      const descRow = el('div', null,
        desc ? el('span', { class: 'q-desc' }, desc) : null,
        tags.length
          ? el('div', { class: 'q-tags' }, ...tags.map(t => el('span', { class: 'q-tag ' + (t.kind || '') }, t.label)))
          : null
      );

      const stepper = el('div', { class: 'q-mini-stepper', role: 'group', 'aria-label': '수량 조절' },
        el('button', { type: 'button', 'data-action': 'q-qty-dec', 'data-index': i, 'aria-label': '수량 감소' }, '−'),
        el('input', { type: 'number', value: q.qty, min: '1', inputmode: 'numeric', 'data-action': 'q-qty-set', 'data-index': i, 'aria-label': '항목 수량' }),
        el('button', { type: 'button', 'data-action': 'q-qty-inc', 'data-index': i, 'aria-label': '수량 증가' }, '+')
      );

      const actions = el('div', { class: 'q-actions' },
        stepper,
        (q.type === 'bolt' || q.type === 'gasket')
          ? el('button', { class: 'icon-btn', 'data-action': 'q-edit', 'data-index': i, title: '편집', 'aria-label': '항목 편집' }, '✎')
          : null,
        el('button', { class: 'icon-btn', 'data-action': 'q-dup', 'data-index': i, title: '복제', 'aria-label': '항목 복제' }, '⎘'),
        el('button', { class: 'icon-btn', 'data-action': 'q-del', 'data-index': i, title: '삭제 (Delete)', 'aria-label': '항목 삭제' }, '✕')
      );

      const item = el('div',
        { class: 'q-item', draggable: 'true', 'data-index': i, tabindex: '0', 'aria-label': `${title} ${q.qty}개` },
        el('div', { class: 'q-handle', 'aria-hidden': 'true' }, '⋮⋮'),
        el('div', { class: 'q-info' }, titleNode, descRow),
        actions
      );
      return item;
    },

    updateUndoRedoButtons() {
      $('#btnUndo').disabled = !Store.canUndo();
      $('#btnRedo').disabled = !Store.canRedo();
    },

    /** Render result panel. */
    renderResult(agg, memo) {
      const card = $('#resultCard');
      const placeholder = $('#resultPlaceholder');
      placeholder.style.display = 'none';
      card.textContent = '';
      card.classList.add('show');

      const head = el('div', { class: 'res-head' },
        el('h2', null, '✅ 최종 집계'),
        el('div', { class: 'res-actions' },
          el('button', { class: 'btn btn-sm btn-secondary', 'data-action': 'copy-result', title: 'Ctrl+C' }, '📋 복사'),
          el('button', { class: 'btn btn-sm btn-secondary', 'data-action': 'export-csv' }, '⬇ CSV'),
          el('button', { class: 'btn btn-sm btn-secondary', 'data-action': 'share-result' }, '🔗 공유'),
          el('button', { class: 'btn btn-sm btn-ghost',     'data-action': 'print-result' }, '🖨 인쇄')
        )
      );
      card.appendChild(head);

      const tables = el('div', { class: 'res-tables' },
        this._tableSection('🔩 볼트 (Bolt)',  ['규격 (S × L)', '수량(EA)'], agg.sB),
        this._tableSection('🔩 너트 (Nut)',   ['규격 (M)',     '수량(EA)'], agg.sN),
        this._tableSection('⭕ 가스켓',       ['규격 및 재질', '수량(장)'], agg.sG, true),
        this._tableSection('⚓ U-볼트',       ['규격 (호칭경)', '수량(Set)'], agg.sU, false, true)
      );
      card.appendChild(tables);

      if (memo && memo.trim()) {
        const memoBox = el('div', { class: 'table-sec', style: 'margin-top:12px;' },
          el('h3', null, '📝 추가 메모'),
          el('div', { style: 'background:var(--c-surface-2);padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);white-space:pre-wrap;font-size:.85rem;line-height:1.55;' }, memo.trim())
        );
        card.appendChild(memoBox);
      }

      const totalCount = agg.sB.reduce((s, [, v]) => s + v, 0)
                       + agg.sN.reduce((s, [, v]) => s + v, 0)
                       + agg.sG.reduce((s, [, v]) => s + v, 0)
                       + agg.sU.reduce((s, [, v]) => s + v, 0);
      const totalNode = el('span', null, '0');
      const notice = el('div', { class: 'notice' },
        el('b', null, '※ 자동 합산됨'),
        document.createTextNode(' · 총 '), totalNode, document.createTextNode(' 개 항목 / 너트는 규격(M)별 독립 집계 / 더블너트는 ×2')
      );
      card.appendChild(notice);
      countUp(totalNode, totalCount, 700);

      // Scroll into view (mobile)
      if (window.matchMedia('(max-width: 1199px)').matches) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },

    _tableSection(title, headers, rows, leftAlign = false, extraDesc = false) {
      const thead = el('thead', null, el('tr', null, ...headers.map(h => el('th', null, h))));
      const tbody = el('tbody');
      if (!rows.length) {
        tbody.appendChild(el('tr', null, el('td', { colspan: headers.length, class: 'muted' }, '내역 없음')));
      } else {
        for (const [k, v] of rows) {
          let firstCell;
          if (extraDesc) {
            const sNum = parseInt(k, 10);
            const p = UBOLT_PITCH[sNum];
            firstCell = el('td', null,
              k,
              el('span', { style: 'display:block;font-size:.7rem;color:var(--c-text-mute);margin-top:2px;' },
                p ? `(C-C: ${p}mm)` : '(핏치 미상)')
            );
          } else {
            firstCell = el('td', leftAlign ? { style: 'text-align:left;' } : null, k);
          }
          tbody.appendChild(el('tr', null, firstCell, el('td', null, el('b', null, String(v)))));
        }
      }
      return el('div', { class: 'table-sec' },
        el('h3', null, title),
        el('div', { class: 'table-wrapper' }, el('table', null, thead, tbody))
      );
    },

    /** Reset result view to placeholder. */
    resetResult() {
      $('#resultCard').classList.remove('show');
      $('#resultCard').textContent = '';
      $('#resultPlaceholder').style.display = '';
    },

    syncForm() {
      $('#memoInput').value = Store.memo || '';
      this.populateProjectSelect($('#projectSelect'));
    }
  };

  /* =====================================================================
     §6. CONTROLLER — events, actions, modal, drag-reorder, search
     ===================================================================== */

  let lastExportText = '';
  let lastExportCSV  = '';
  let editingIndex   = -1;

  /** ----- Modal / focus trap ----- */
  const ModalCtl = {
    activeModal: null,
    lastFocus: null,
    open(modalEl) {
      this.lastFocus = document.activeElement;
      modalEl.classList.add('show');
      modalEl.setAttribute('aria-hidden', 'false');
      this.activeModal = modalEl;
      // Focus first focusable
      const first = modalEl.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (first) first.focus();
    },
    close(modalEl) {
      modalEl = modalEl || this.activeModal;
      if (!modalEl) return;
      modalEl.classList.remove('show');
      modalEl.setAttribute('aria-hidden', 'true');
      if (this.activeModal === modalEl) this.activeModal = null;
      if (this.lastFocus && typeof this.lastFocus.focus === 'function') {
        this.lastFocus.focus();
      }
    },
    trap(e) {
      if (!this.activeModal || e.key !== 'Tab') return;
      const focusables = this.activeModal.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  /** ----- Search (외경 역산) with tolerance & debounce ----- */
  function findFlange() {
    const target = parseFloat($('#searchOD').value);
    const tol = parseInt($('#tolerance').value, 10) || 0;
    const res = $('#searchResult');
    res.textContent = '';
    res.classList.remove('show');
    if (!Number.isFinite(target) || target <= 0) return;

    const sorted = FLANGE_OD_DATA
      .map(f => ({ ...f, diff: Math.abs(f.od - target) }))
      .sort((a, b) => a.diff - b.diff);

    res.classList.add('show');

    // Within tolerance candidates
    const within = sorted.filter(f => f.diff <= tol);
    if (within.length) {
      res.appendChild(el('div', null,
        document.createTextNode(`🎯 OD ${target}mm · 허용 오차 ±${tol}mm 이내 `),
        el('b', null, `${within.length}개 후보`)
      ));
      const list = el('div', { style: 'margin-top:6px;' });
      for (const m of within) {
        const sign = m.od === target ? '' : (m.od > target ? '+' : '');
        list.appendChild(el('button', {
          class: 'badge-pill',
          type: 'button',
          'data-action': 'search-pick',
          'data-rating': m.r,
          'data-size': m.s,
          'aria-label': `${m.r} ${m.s}A 적용`
        }, `${m.r} ${m.s}A · ${m.od}mm (${sign}${(m.od - target).toFixed(0)})`));
      }
      res.appendChild(list);
      return;
    }

    // No within-tolerance: show closest ±5
    const closest = sorted[0];
    res.appendChild(el('div', { class: 'err' },
      `⚠️ 허용 오차 내 일치 규격 없음 (최소 오차 ${closest.diff}mm)`));
    const top = sorted.slice(0, 5);
    const list = el('div', { style: 'margin-top:6px;' });
    for (const m of top) {
      list.appendChild(el('button', {
        class: 'badge-pill', type: 'button',
        'data-action': 'search-pick', 'data-rating': m.r, 'data-size': m.s
      }, `${m.r} ${m.s}A · ${m.od}mm (Δ${m.diff})`));
    }
    res.appendChild(list);
  }
  const debouncedFindFlange = debounce(findFlange, 300);

  /** ----- Add actions ----- */
  function actionAddBolt() {
    const r = $('#rating').value;
    const s = parseInt($('#size').value, 10);
    const qty = toPosInt($('#qty').value);
    const ext = $('#optExtended').checked;
    const doubleNut = $('#optDoubleNut').checked;
    const includeGasket = $('#optGasket').checked;
    const gType = $('#gTypeInFlange').value;

    const item = buildBoltItem(r, s, qty, { ext, doubleNut });
    if (!item) {
      showDataWarn(`⚠️ ${r} ${s}A 데이터가 없습니다. 다른 사이즈를 선택해주세요.`);
      return;
    }
    Store.snapshot();
    Store.queue.push(item);
    if (includeGasket) {
      const g = buildGasketItem(r, s, qty, gType, true);
      if (g) Store.queue.push(g);
    }
    $('#qty').value = 1;
    Store.save();
    View.renderQueue();
    toast(`✅ 추가됨 · 대기열 ${Store.queue.length}건`);
  }

  function actionAddGasket() {
    const r = $('#grating').value;
    const s = parseInt($('#gsize').value, 10);
    const qty = toPosInt($('#gqty').value);
    const type = $('#gtype').value;
    const item = buildGasketItem(r, s, qty, type, false);
    if (!item) { toast(`⚠️ ${r} ${s}A 가스켓 데이터 없음`); return; }
    Store.snapshot();
    Store.queue.push(item);
    $('#gqty').value = 1;
    Store.save();
    View.renderQueue();
    toast(`✅ 가스켓 추가 · ${Store.queue.length}건`);
  }

  function actionAddUbolt() {
    const s = parseInt($('#usize').value, 10);
    const qty = toPosInt($('#uqty').value);
    if (!s) return;
    const item = buildUboltItem(s, qty);
    Store.snapshot();
    Store.queue.push(item);
    $('#uqty').value = 1;
    Store.save();
    View.renderQueue();
    toast(`✅ U-볼트 추가 · ${Store.queue.length}건`);
  }

  function showDataWarn(msg) {
    const w = $('#dataWarn');
    w.textContent = msg;
    w.classList.add('show');
    setTimeout(() => w.classList.remove('show'), 3500);
  }

  /** ----- Calculation ----- */
  function actionCalculate() {
    const memoContent = $('#memoInput').value.trim();
    if (!Store.queue.length && !memoContent) {
      toast('⚠️ 등록된 자재가 없습니다.');
      return;
    }
    Store.memo = memoContent;
    Store.save();
    const agg = aggregate(Store.queue);
    lastExportText = buildExportText(agg, memoContent);
    lastExportCSV  = buildExportCSV(agg, memoContent);
    View.renderResult(agg, memoContent);
  }

  /** ----- Copy / CSV / Share / Print ----- */
  async function actionCopyResult() {
    if (!lastExportText) { actionCalculate(); if (!lastExportText) return; }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(lastExportText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = lastExportText;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast('✨ 복사 완료!');
    } catch (e) {
      toast('⚠️ 복사 실패');
    }
  }

  function actionExportCSV() {
    if (!lastExportCSV) { actionCalculate(); if (!lastExportCSV) return; }
    const projName = (Store.projects[Store.currentProject] || {}).name || 'export';
    const fname = `${sanitizeFilename(projName)}_자재집계.csv`;
    const blob = new Blob([lastExportCSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: fname });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('⬇ CSV 다운로드');
  }

  async function actionShareResult() {
    if (!lastExportText) { actionCalculate(); if (!lastExportText) return; }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'JIS 자재 집계',
          text: lastExportText
        });
      } catch (e) { /* user cancelled */ }
    } else {
      actionCopyResult();
      toast('🔗 공유 미지원: 복사로 대체');
    }
  }

  function actionPrintResult() {
    if (!lastExportText) actionCalculate();
    window.print();
  }

  /** ----- Queue item actions ----- */
  function actionDeleteItem(i) {
    const node = $(`.q-item[data-index="${i}"]`);
    if (node) {
      node.classList.add('removing');
      setTimeout(() => {
        Store.snapshot();
        Store.queue.splice(i, 1);
        Store.save();
        View.renderQueue();
      }, 220);
    } else {
      Store.snapshot();
      Store.queue.splice(i, 1);
      Store.save();
      View.renderQueue();
    }
  }

  function actionDuplicateItem(i) {
    const item = Store.queue[i];
    if (!item) return;
    Store.snapshot();
    Store.queue.splice(i + 1, 0, clone(item));
    Store.save();
    View.renderQueue();
    toast('⎘ 항목 복제됨');
  }

  function actionUpdateQty(i, delta, absolute) {
    const item = Store.queue[i];
    if (!item) return;
    const newQty = absolute != null ? toPosInt(absolute) : Math.max(1, item.qty + delta);
    if (newQty === item.qty) return;
    Store.snapshot();
    item.qty = newQty;
    Store.save();
    View.renderQueue();
  }

  /** ----- Edit modal ----- */
  function openEditModal(i) {
    const item = Store.queue[i];
    if (!item) return;
    editingIndex = i;
    const body = $('#editModalBody');
    body.textContent = '';
    if (item.type === 'bolt') {
      body.appendChild(el('div', { class: 'form-grid col-2' },
        el('div', { class: 'field' },
          el('label', { for: 'editRating' }, '압력등급'),
          (() => {
            const sel = el('select', { id: 'editRating' });
            ['5K', '10K', '16K', '30K'].forEach(r => sel.appendChild(el('option', { value: r, selected: r === item.r ? true : null }, r)));
            return sel;
          })()
        ),
        el('div', { class: 'field' },
          el('label', { for: 'editSize' }, '호칭경 (A)'),
          (() => {
            const sel = el('select', { id: 'editSize' });
            for (const s of SIZES) {
              if (DATA[item.r] && DATA[item.r][s]) {
                sel.appendChild(el('option', { value: s, selected: s === item.s ? true : null }, s + 'A'));
              }
            }
            return sel;
          })()
        )
      ));
      body.appendChild(el('div', { class: 'option-box', style: 'margin-top:10px;' },
        el('div', { class: 'toggle-row' },
          el('span', { class: 'toggle-title' }, '볼트 5mm 더 길게'),
          el('label', { class: 'switch' },
            el('input', { type: 'checkbox', id: 'editExt', checked: item.ext ? true : null }),
            el('span', { class: 'slider' })
          )
        ),
        el('div', { class: 'toggle-row' },
          el('span', { class: 'toggle-title' }, '더블 너트'),
          el('label', { class: 'switch' },
            el('input', { type: 'checkbox', id: 'editDN', checked: item.doubleNut ? true : null }),
            el('span', { class: 'slider' })
          )
        )
      ));
      // Re-populate size when rating changes
      body.querySelector('#editRating').addEventListener('change', (e) => {
        const sel = body.querySelector('#editSize');
        sel.textContent = '';
        for (const s of SIZES) {
          if (DATA[e.target.value] && DATA[e.target.value][s]) {
            sel.appendChild(el('option', { value: s }, s + 'A'));
          }
        }
      });
    } else if (item.type === 'gasket') {
      body.appendChild(el('div', { class: 'form-grid col-2' },
        el('div', { class: 'field' },
          el('label', { for: 'editGRating' }, '압력등급'),
          (() => {
            const sel = el('select', { id: 'editGRating' });
            ['5K','10K','16K','30K'].forEach(r => sel.appendChild(el('option', { value: r, selected: r === item.r ? true : null }, r)));
            return sel;
          })()
        ),
        el('div', { class: 'field' },
          el('label', { for: 'editGSize' }, '호칭경 (A)'),
          (() => {
            const sel = el('select', { id: 'editGSize' });
            for (const s of SIZES) {
              if (DATA[item.r] && DATA[item.r][s]) {
                sel.appendChild(el('option', { value: s, selected: s === item.s ? true : null }, s + 'A'));
              }
            }
            return sel;
          })()
        ),
        el('div', { class: 'field full-on-mobile', style: 'grid-column:1/-1;' },
          el('label', { for: 'editGType' }, '재질/타입'),
          (() => {
            const sel = el('select', { id: 'editGType' });
            ['일반','논레이어','그라파이트','메탈','풀페이스'].forEach(t =>
              sel.appendChild(el('option', { value: t, selected: t === item.gtype ? true : null }, t === '일반' ? '일반(RF)' : t)));
            return sel;
          })()
        )
      ));
    }
    ModalCtl.open($('#editModal'));
  }

  function actionSaveEdit() {
    const i = editingIndex;
    const item = Store.queue[i];
    if (!item) { ModalCtl.close($('#editModal')); return; }
    Store.snapshot();
    if (item.type === 'bolt') {
      const r = $('#editRating').value;
      const s = parseInt($('#editSize').value, 10);
      const ext = $('#editExt').checked;
      const dn = $('#editDN').checked;
      const newItem = buildBoltItem(r, s, item.qty, { ext, doubleNut: dn });
      if (newItem) Store.queue[i] = newItem;
    } else if (item.type === 'gasket') {
      const r = $('#editGRating').value;
      const s = parseInt($('#editGSize').value, 10);
      const t = $('#editGType').value;
      const newItem = buildGasketItem(r, s, item.qty, t, item.auto);
      if (newItem) Store.queue[i] = newItem;
    }
    Store.save();
    View.renderQueue();
    ModalCtl.close($('#editModal'));
    toast('💾 저장됨');
  }

  /** ----- Drag & drop reorder ----- */
  let dragSrcIdx = -1;
  function bindDrag() {
    const list = $('#qBody');
    list.addEventListener('dragstart', (e) => {
      const t = e.target.closest('.q-item');
      if (!t) return;
      dragSrcIdx = +t.dataset.index;
      t.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(dragSrcIdx)); } catch (_) {}
    });
    list.addEventListener('dragend', (e) => {
      const t = e.target.closest('.q-item');
      if (t) t.classList.remove('dragging');
      $$('.q-item.drop-target').forEach(n => n.classList.remove('drop-target'));
    });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const t = e.target.closest('.q-item');
      $$('.q-item.drop-target').forEach(n => n.classList.remove('drop-target'));
      if (t) t.classList.add('drop-target');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const t = e.target.closest('.q-item');
      if (!t || dragSrcIdx < 0) return;
      const dstIdx = +t.dataset.index;
      if (dstIdx === dragSrcIdx) return;
      Store.snapshot();
      const [moved] = Store.queue.splice(dragSrcIdx, 1);
      Store.queue.splice(dstIdx, 0, moved);
      Store.save();
      View.renderQueue();
      dragSrcIdx = -1;
    });
  }

  /** ----- Project actions ----- */
  function actionProjectChange(id) {
    Store.switchProject(id);
    View.syncForm();
    View.resetResult();
    View.renderQueue();
    toast(`📁 ${Store.current.name}`);
  }

  function actionProjectNew() {
    const name = window.prompt('새 현장 이름?', '새 현장');
    if (!name) return;
    Store.addProject(name.trim());
    View.syncForm();
    View.resetResult();
    View.renderQueue();
  }

  function actionProjectRename() {
    const cur = Store.current;
    const name = window.prompt('현장 이름 변경:', cur.name);
    if (!name) return;
    Store.renameProject(Store.currentProject, name.trim());
    View.populateProjectSelect($('#projectSelect'));
  }

  function actionProjectDelete() {
    if (Object.keys(Store.projects).length <= 1) {
      toast('⚠️ 마지막 현장은 삭제할 수 없습니다.');
      return;
    }
    if (!window.confirm(`'${Store.current.name}' 현장을 삭제할까요?`)) return;
    Store.deleteProject(Store.currentProject);
    View.syncForm();
    View.resetResult();
    View.renderQueue();
    toast('🗑 현장 삭제됨');
  }

  /** ----- Theme ----- */
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    const btn = $('#btnTheme');
    btn.textContent = mode === 'dark' ? '☀️' : mode === 'light' ? '🌙' : '🌗';
    btn.title = `테마: ${mode === 'auto' ? '자동' : mode === 'dark' ? '다크' : '라이트'} (클릭하여 전환)`;
  }
  function actionToggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    applyTheme(next);
    toast(`🎨 ${next === 'auto' ? '자동' : next === 'dark' ? '다크' : '라이트'} 테마`);
  }

  /** ----- Tutorial ----- */
  function maybeShowTutorial() {
    if (localStorage.getItem(TUTORIAL_KEY) !== 'true') {
      ModalCtl.open($('#tutorialModal'));
    }
  }
  function closeTutorial() {
    if ($('#chkHideTutorial').checked) {
      try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) {}
    }
    ModalCtl.close($('#tutorialModal'));
  }

  /** ----- Action router (event delegation) ----- */
  const actions = {
    'find-flange':       () => findFlange(),
    'search-pick':       (el2) => {
      const r = el2.dataset.rating, s = parseInt(el2.dataset.size, 10);
      $('#rating').value = r; View.populateSizeSelect($('#size'), r);
      $('#size').value = s;
      $('#size').scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('#size').focus();
      toast(`✓ ${r} ${s}A 적용됨`);
    },
    'rating-change':     () => View.populateSizeSelect($('#size'), $('#rating').value),
    'grating-change':    () => View.populateSizeSelect($('#gsize'), $('#grating').value),
    'usize-change':      () => View.updatePitchInfo(parseInt($('#usize').value, 10)),
    'qty-inc':           (el2) => { const inp = $('#' + el2.dataset.target); inp.value = toPosInt(inp.value) + 1; },
    'qty-dec':           (el2) => { const inp = $('#' + el2.dataset.target); inp.value = Math.max(1, toPosInt(inp.value) - 1); },
    'add-bolt':          actionAddBolt,
    'add-gasket':        actionAddGasket,
    'add-ubolt':         actionAddUbolt,
    'calculate':         actionCalculate,
    'clear-all':         () => {
      if (Store.queue.length && !window.confirm('대기열을 모두 비울까요?')) return;
      Store.snapshot();
      Store.queue = [];
      Store.memo = '';
      $('#memoInput').value = '';
      Store.save();
      View.renderQueue();
      View.resetResult();
      lastExportText = lastExportCSV = '';
    },
    'q-del':             (el2) => actionDeleteItem(+el2.dataset.index),
    'q-dup':             (el2) => actionDuplicateItem(+el2.dataset.index),
    'q-edit':            (el2) => openEditModal(+el2.dataset.index),
    'q-qty-inc':         (el2) => actionUpdateQty(+el2.dataset.index, 1),
    'q-qty-dec':         (el2) => actionUpdateQty(+el2.dataset.index, -1),
    'copy-result':       actionCopyResult,
    'export-csv':        actionExportCSV,
    'share-result':      actionShareResult,
    'print-result':      actionPrintResult,
    'undo':              () => { if (Store.undo()) { Store.save(); View.renderQueue(); toast('↶ 되돌리기'); } },
    'redo':              () => { if (Store.redo()) { Store.save(); View.renderQueue(); toast('↷ 다시 실행'); } },
    'theme-toggle':      actionToggleTheme,
    'open-tutorial':     () => ModalCtl.open($('#tutorialModal')),
    'close-tutorial':    closeTutorial,
    'project-change':    () => actionProjectChange($('#projectSelect').value),
    'project-new':       actionProjectNew,
    'project-rename':    actionProjectRename,
    'project-delete':    actionProjectDelete,
    'edit-save':         actionSaveEdit,
    'edit-cancel':       () => ModalCtl.close($('#editModal')),
    'install-app':       () => triggerInstall(),
    'install-dismiss':   () => { $('#installBanner').classList.remove('show'); try { localStorage.setItem('jis-install-dismissed','1'); } catch (e) {} }
  };

  function bindGlobalEvents() {
    // Click delegation
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const name = target.dataset.action;
      const handler = actions[name];
      if (!handler) return;
      // Ripple on real .btn elements
      if (target.classList.contains('btn')) addRipple(target, e);
      handler(target, e);
    });

    // Change delegation (selects)
    document.addEventListener('change', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const name = target.dataset.action;
      if (name === 'project-change' || name === 'rating-change' || name === 'grating-change' || name === 'usize-change') {
        actions[name](target, e);
      }
      if (name === 'q-qty-set') {
        actionUpdateQty(+target.dataset.index, 0, target.value);
      }
    });

    // Search debounced
    $('#searchOD').addEventListener('input', debouncedFindFlange);
    $('#tolerance').addEventListener('input', () => {
      $('#toleranceVal').value = `±${$('#tolerance').value}mm`;
      debouncedFindFlange();
    });

    // Memo autosave
    $('#memoInput').addEventListener('input', debounce(() => {
      Store.memo = $('#memoInput').value;
      Store.save();
    }, 400));

    // Validate qty inputs (>=1)
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[type=number][min="1"]')) {
        const v = parseInt(e.target.value, 10);
        if (e.target.value !== '' && (!Number.isFinite(v) || v < 1)) e.target.value = 1;
      }
    });

    // Modal: ESC + backdrop close + focus trap
    document.addEventListener('keydown', (e) => {
      if (ModalCtl.activeModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (ModalCtl.activeModal.id === 'tutorialModal') closeTutorial();
          else ModalCtl.close();
          return;
        }
        ModalCtl.trap(e);
        return;
      }

      // Global keyboard shortcuts (skip when typing in textarea/select)
      const tag = (e.target.tagName || '').toLowerCase();
      const inEditable = tag === 'textarea' || tag === 'select' || (tag === 'input' && e.target.type === 'text');
      const inNumber = tag === 'input' && e.target.type === 'number';

      // Ctrl+Enter → calculate
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        actionCalculate();
        return;
      }
      // Ctrl+C with selection? — only when result exists and no text selection
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        const sel = window.getSelection();
        if (lastExportText && (!sel || sel.toString().length === 0) && !inEditable) {
          e.preventDefault();
          actionCopyResult();
        }
        return;
      }
      // Ctrl+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        if (!inEditable) { e.preventDefault(); actions.undo(); } return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        if (!inEditable) { e.preventDefault(); actions.redo(); } return;
      }

      // Enter in flange/gasket/ubolt area → add
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !inEditable) {
        const card = e.target.closest('.card');
        if (card) {
          if (card.querySelector('[data-action="add-bolt"]')) { e.preventDefault(); actionAddBolt(); return; }
          if (card.querySelector('[data-action="add-gasket"]')) { e.preventDefault(); actionAddGasket(); return; }
          if (card.querySelector('[data-action="add-ubolt"]')) { e.preventDefault(); actionAddUbolt(); return; }
          if (card.querySelector('[data-action="find-flange"]')) { e.preventDefault(); findFlange(); return; }
        }
      }
      // Also allow Enter directly on number inputs to trigger their card's add action
      if (e.key === 'Enter' && inNumber) {
        const card = e.target.closest('.card');
        if (card) {
          if (card.querySelector('[data-action="add-bolt"]')) { e.preventDefault(); actionAddBolt(); }
          else if (card.querySelector('[data-action="add-gasket"]')) { e.preventDefault(); actionAddGasket(); }
          else if (card.querySelector('[data-action="add-ubolt"]')) { e.preventDefault(); actionAddUbolt(); }
          else if (card.querySelector('[data-action="find-flange"]')) { e.preventDefault(); findFlange(); }
        }
      }

      // Delete on focused queue item → delete
      if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement && document.activeElement.classList.contains('q-item')) {
        const idx = +document.activeElement.dataset.index;
        if (Number.isFinite(idx)) { e.preventDefault(); actionDeleteItem(idx); }
      }
    });

    // Modal backdrop close
    [$('#editModal'), $('#tutorialModal')].forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) {
          if (m.id === 'tutorialModal') closeTutorial();
          else ModalCtl.close(m);
        }
      });
    });

    // Drag-reorder
    bindDrag();
  }

  /* =====================================================================
     §7. PWA — Service Worker + install banner
     ===================================================================== */

  let deferredInstallPrompt = null;

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Don't register on file:// or non-http(s)
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline / unsupported */ });
    });
  }

  function bindInstallBanner() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      try {
        if (localStorage.getItem('jis-install-dismissed') === '1') return;
      } catch (err) {}
      $('#installBanner').classList.add('show');
    });
    window.addEventListener('appinstalled', () => {
      $('#installBanner').classList.remove('show');
      toast('🎉 설치되었습니다!');
    });
  }

  async function triggerInstall() {
    if (!deferredInstallPrompt) {
      toast('iOS는 공유 → "홈 화면에 추가"를 사용하세요.');
      return;
    }
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (e) {}
    deferredInstallPrompt = null;
    $('#installBanner').classList.remove('show');
  }

  /* =====================================================================
     §8. INIT
     ===================================================================== */

  function init() {
    // Theme
    let savedTheme = 'auto';
    try { savedTheme = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {}
    applyTheme(savedTheme);

    // Load store
    Store.load();

    // Populate selects
    View.populateSizeSelect($('#size'), $('#rating').value);
    View.populateSizeSelect($('#gsize'), $('#grating').value);
    View.populateUSizeSelect($('#usize'));
    View.updatePitchInfo(parseInt($('#usize').value, 10));
    View.populateProjectSelect($('#projectSelect'));

    // Sync form values from store
    $('#memoInput').value = Store.memo || '';
    $('#toleranceVal').value = `±${$('#tolerance').value}mm`;

    // Render
    View.renderQueue();

    // Events
    bindGlobalEvents();

    // Tutorial
    setTimeout(maybeShowTutorial, 200);

    // PWA
    registerSW();
    bindInstallBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
