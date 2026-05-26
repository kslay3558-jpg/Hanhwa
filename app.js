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
  const SIZES  = [10,15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,1000,1100,1200,1350,1500];
  /** U-볼트 호칭경 */
  const USIZES = [15,20,25,32,40,50,65,80,100,125,150,200,250,300,350,400,450,500];
  /**
   * U-볼트 핏치 (홀 간격 mm).
   * 출처: 일반 시판 U-볼트 카탈로그(국내 유통) 표준값. 누락된 사이즈는 표시 시 사용자에게 안내.
   */
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
    "5K":  {10:["M10",30,4],15:["M10",30,4],20:["M10",35,4],25:["M10",35,4],32:["M12",40,4],40:["M12",40,4],50:["M12",45,4],65:["M12",45,4],80:["M16",45,4],100:["M16",50,8],125:["M16",50,8],150:["M16",55,8],200:["M20",65,8],250:["M20",70,12],300:["M20",70,12],350:["M22",75,12],400:["M22",75,16],450:["M22",75,16],500:["M22",75,20],550:["M24",80,20],600:["M24",80,20],650:["M24",80,24],700:["M24",80,24],750:["M30",90,24],800:["M30",90,24],850:["M30",90,24],900:["M30",95,24],1000:["M30",100,28],1100:["M30",100,28],1200:["M30",105,32],1350:["M30",105,32],1500:["M30",110,36]},
    "10K": {10:["M12",40,4],15:["M12",40,4],20:["M12",45,4],25:["M16",45,4],32:["M16",50,4],40:["M16",50,4],50:["M16",50,4],65:["M16",55,4],80:["M16",55,8],100:["M16",55,8],125:["M20",65,8],150:["M20",70,8],200:["M20",70,12],250:["M22",75,12],300:["M22",75,16],350:["M22",80,16],400:["M24",85,16],450:["M24",90,20],500:["M24",90,20],550:["M30",100,20],600:["M30",100,24],650:["M30",105,24],700:["M30",105,24],750:["M30",110,24],800:["M30",110,28],850:["M30",110,28],900:["M30",115,28],1000:["M36",125,28],1100:["M36",130,28],1200:["M36",135,32],1350:["M42",145,36],1500:["M42",150,40]},
    "16K": {10:["M12",40,4],15:["M12",40,4],20:["M12",45,4],25:["M16",45,4],32:["M16",50,4],40:["M16",50,4],50:["M16",50,8],65:["M16",55,8],80:["M20",65,8],100:["M20",65,8],125:["M22",70,8],150:["M22",75,12],200:["M22",80,12],250:["M24",85,12],300:["M24",90,16],350:["M30",105,16],400:["M30",110,16],450:["M30",115,20],500:["M30",120,20],550:["M36",130,20],600:["M36",135,24],650:["M36",140,24],700:["M39",145,24],750:["M39",150,24],800:["M45",160,24],850:["M45",165,28],900:["M45",170,28],1000:["M52",185,28]},
    // 제공된 표 기준으로 30K는 400A까지만 데이터가 확인됨.
    "30K": {10:["M16",50,4],15:["M16",55,4],20:["M16",55,4],25:["M16",60,4],32:["M16",65,4],40:["M20",70,4],50:["M16",65,8],65:["M20",75,8],80:["M20",80,8],100:["M22",90,8],125:["M22",100,8],150:["M24",105,12],200:["M24",115,12],250:["M30",130,12],300:["M30",140,16],350:["M30",145,16],400:["M30",165,16]}
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

  const GAS_PIPE_TABLE = [
    { size: 250, flangeThickness: 22, boltSize: 'M20', formula: '(22x2) + 3 + 6 + 20 + 5', theoreticalLength: 78, recommendedLength: 80 },
    { size: 300, flangeThickness: 22, boltSize: 'M20', formula: '(22x2) + 3 + 6 + 20 + 5', theoreticalLength: 78, recommendedLength: 80 },
    { size: 350, flangeThickness: 16, boltSize: 'M22', formula: '(16x2) + 3 + 6 + 22 + 5', theoreticalLength: 68, recommendedLength: 70 },
    { size: 400, flangeThickness: 16, boltSize: 'M22', formula: '(16x2) + 3 + 6 + 22 + 5', theoreticalLength: 68, recommendedLength: 70 },
    { size: 450, flangeThickness: 16, boltSize: 'M22', formula: '(16x2) + 3 + 6 + 22 + 5', theoreticalLength: 68, recommendedLength: 70 },
    { size: 500, flangeThickness: 16, boltSize: 'M22', formula: '(16x2) + 3 + 6 + 22 + 5', theoreticalLength: 68, recommendedLength: 70 },
    { size: 550, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 600, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 650, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 700, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 750, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 800, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 850, flangeThickness: 16, boltSize: 'M20', formula: '(16x2) + 3 + 6 + 20 + 5', theoreticalLength: 66, recommendedLength: 70 },
    { size: 900, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 950, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1000, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1050, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1100, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1150, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1200, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1250, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1300, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1350, flangeThickness: 18, boltSize: 'M22', formula: '(18x2) + 3 + 6 + 22 + 5', theoreticalLength: 72, recommendedLength: 75 },
    { size: 1400, flangeThickness: 20, boltSize: 'M22', formula: '(20x2) + 3 + 6 + 22 + 5', theoreticalLength: 76, recommendedLength: 80 },
    { size: 1450, flangeThickness: 20, boltSize: 'M24', formula: '(20x2) + 3 + 6 + 24 + 5', theoreticalLength: 78, recommendedLength: 80 },
    { size: 1500, flangeThickness: 20, boltSize: 'M24', formula: '(20x2) + 3 + 6 + 24 + 5', theoreticalLength: 78, recommendedLength: 80 }
  ];
  const STORAGE_KEY = 'jis-calc-state-v2';
  const TUTORIAL_KEY = 'jis-calc-hide-tutorial';
  const THEME_KEY = 'jis-calc-theme';
  const LANG_KEY = 'jis-calc-lang';
  const HISTORY_LIMIT = 10;
  /** 외경 역산 검색 시 표시할 최대 허용 오차 (mm). 이 범위 내 후보를 모두 표시하고, 없으면 가장 가까운 5개를 표시한다. */
  const OD_SEARCH_RANGE = 20;
  /** Firestore 게시판 로드 타임아웃 (ms). 이 시간 내 응답 없으면 연결 실패 처리. */
  const FIRESTORE_TIMEOUT_MS = 5000;

  /* =====================================================================
     §1.5 I18N — Korean / Vietnamese / Indonesian
     외국인 노동자(외노자)를 위한 다국어 지원.
     숫자/단위/규격(M12, 100A, 5K 등)은 보편 표기로 유지.
     ===================================================================== */

  const SUPPORTED_LANGS = [
    { code: 'ko', native: '한국어',           flag: '🇰🇷' },
    { code: 'vi', native: 'Tiếng Việt',       flag: '🇻🇳' },
    { code: 'id', native: 'Bahasa Indonesia', flag: '🇮🇩' }
  ];

  const I18N = {
    ko: {
      // App
      'app.title':            '설비/배관 자재 계산기',
      'app.subtitle':         'JIS 규격 기반 · 오프라인 PWA',
      'app.toolbar':          '앱 도구',
      // Toolbar / projects
      'tb.proj_group':        '프로젝트 선택',
      'tb.proj_label':        '현장(프로젝트)',
      'tb.proj_select':       '현장(프로젝트) 선택',
      'tb.proj_new':          '새 현장 추가',
      'tb.proj_rename':       '현장 이름 변경',
      'tb.proj_delete':       '현장 삭제',
      'tb.undo':              '되돌리기',
      'tb.undo_title':        '되돌리기 (Ctrl+Z)',
      'tb.redo':              '다시 실행',
      'tb.redo_title':        '다시 실행 (Ctrl+Y)',
      'tb.theme':             '테마 전환',
      'tb.pipe_calc':         '파이프 사선 커팅 계산기 열기',
      'tb.help':              '사용 가이드 열기',
      'tb.help_btn':          '❓ 도움말',
      'tb.lang':              '언어 변경',
      'tb.lang_select':       '언어 선택',
      'proj.default':         '기본 현장',
      // Section labels
      'sec.input':            '자재 입력',
      'sec.queue':            '등록 대기열',
      'sec.result':           '집계 결과',
      'sec.result_aria':      '최종 집계 결과',
      // Card 1: find flange
      'card.find':            '🔍 플랜지 사이즈 역산',
      'form.od':              '플랜지 외경 (OD, mm)',
      'form.od_ph':           '예: 155',
      'btn.find':             '찾기',
      // Card 2: flange point
      'card.flange':          '🔩 플랜지 포인트',
      'form.rating':          '압력등급',
      'form.size':            '호칭경 (A)',
      'form.qty_pt':          '포인트 개소',
      'form.qty_dec':         '감소',
      'form.qty_inc':         '증가',
      'aria.qty_pt':          '포인트 개소 조절',
      'opt.ext':              '볼트 5mm 더 길게 (폴리파이프 / 두꺼운 밸브)',
      'opt.dn':               '더블 너트 적용 (너트 두께 자동 합산)',
      'opt.gsk':              '가스켓 포함',
      'aria.gsk_type':        '가스켓 종류',
      'aria.gsk_type_in':     '포함될 가스켓 종류',
      'gsk.normal':           '일반(RF)',
      'gsk.nl':               '논레이어',
      'gsk.gr':               '그라파이트',
      'gsk.metal':            '메탈',
      'gsk.full':             '풀페이스',
      'btn.add_pt':           '＋ 포인트 추가',
      'kbd.enter':            '(Enter)',
      // Card 3: extra gasket
      'card.gasket':          '⭕ 가스켓 추가',
      'form.gtype':           '재질/타입',
      'form.qty_sht':         '수량 (장)',
      'aria.qty_gsk':         '가스켓 수량 조절',
      'aria.qty_gsk_in':      '가스켓 수량',
      'btn.add_gsk':          '＋ 가스켓 추가',
      // Card 4: U-bolt
      'card.ubolt':           '⚓ U-볼트 추가',
      'card.gas_pipe':        '🛢 가스파이프 프리셋',
      'form.qty_set':         '수량 (Set)',
      'aria.qty_ub':          'U-볼트 수량 조절',
      'aria.qty_ub_in':       'U-볼트 수량',
      'btn.add_ub':           '＋ U-볼트 추가',
      'pitch.label':          '홀 간격',
      'pitch.none':           '홀 간격 데이터 없음 (수동 확인 필요)',
      'guide.flange_od_aria': '플랜지 OD 측정 위치 보기',
      'guide.ubolt_pitch_aria':'U-볼트 홀 센터 간격 보기',
      'guide.flange_od_svg_aria':'플랜지 OD 측정 위치 도면',
      'guide.ubolt_pitch_svg_aria':'U-볼트 홀 센터 간격 도면',
      'guide.flange_od_title':'플랜지 OD 측정 가이드',
      'guide.ubolt_pitch_title':'U-볼트 홀 센터 간격 가이드',
      'guide.flange_od_desc': 'OD(외경)는 플랜지 바깥쪽 끝에서 반대쪽 바깥쪽 끝까지 재는 전체 지름입니다.',
      'guide.ubolt_pitch_desc':'홀 센터 간격(C-C)은 왼쪽 볼트 구멍 중심에서 오른쪽 볼트 구멍 중심까지의 거리입니다.',
      'guide.close':          '확인',
      // Card 5: memo
      'card.memo':            '📝 추가 메모',
      'form.gas_pipe_preset': '가스파이프 프리셋',
      'gas.desc':             '제공한 가스파이프 표를 프리셋으로 정리했습니다. 기존 파이프 검색처럼 사이즈를 선택하면 해당 기준값을 바로 확인할 수 있습니다.',
      'gas.rule':             '길이 계산식 기준: (플랜지 두께 x 2) + 가스켓 3 + 와셔 6 + 볼트 규격값 + 여유 5',
      'gas.help':             '250A부터 1500A까지 제공된 가스파이프 프리셋을 선택할 수 있습니다.',
      'gas.col.size':         '사이즈',
      'gas.col.flange':       '플랜지 두께',
      'gas.col.bolt_size':    '볼트 사이즈',
      'gas.col.formula':      '길이 계산식',
      'gas.col.theoretical':  '이론상 길이',
      'gas.col.recommended':  '추천 볼트 길이',
      'form.memo_label':      '자유 메모',
      'form.memo_ph':         '기타 자재 또는 비고를 자유롭게 기입하세요.',
      // Queue
      'card.queue':           '📋 등록 대기열',
      'btn.calc':             '🧮 최종 집계',
      'kbd.ctrl_enter':       '(Ctrl+Enter)',
      'btn.clear':            '초기화',
      'q.empty_t':            '대기열이 비어 있어요',
      'q.empty_d':            '좌측 양식에서 자재를 추가하면 여기에 쌓입니다.',
      'q.flange':             '플랜지',
      'q.gasket':             '가스켓',
      'q.ubolt':              'U-볼트',
      'q.qty_aria':           '수량 조절',
      'q.qty_dec':            '수량 감소',
      'q.qty_inc':            '수량 증가',
      'q.qty_in_aria':        '항목 수량',
      'q.edit':               '편집',
      'q.dup':                '복제',
      'q.del':                '삭제',
      'q.del_title':          '삭제 (Delete)',
      'q.tag_5mm':            '+5mm',
      'q.tag_dn':             '더블너트',
      'q.tag_auto':           '자동 추가',
      'q.tag_pitch_unknown':  '핏치 미상',
      'q.pitch_known':        '홀 간격 {p}mm',
      'q.pitch_unknown':      '홀 간격 정보 없음',
      'q.aria_label':         '{title} {n}개 — Delete 키로 삭제 가능',
      'q.bolt_desc':          '{bS} × {bL}L · {bC}공/pt',
      'unit.count':           '{n}건',
      // Result panel
      'r.empty_t':            '아직 집계 결과가 없습니다',
      'r.empty_d':            '대기열에 자재를 추가한 뒤 [최종 집계] 버튼을 누르세요.',
      'r.shortcuts':          '단축키: {kbd1} 추가 · {kbd2} 삭제 · {kbd3} 집계 · {kbd4} 복사',
      'r.sc_label':           '단축키',
      'r.sc_add':             '추가',
      'r.sc_del':             '삭제',
      'r.sc_agg':             '집계',
      'r.sc_copy':            '복사',
      'r.title':              '✅ 최종 집계',
      'r.copy':               '📋 복사',
      'r.save_image':         '🖼 이미지 저장',
      'r.share':              '🔗 공유',
      'r.bolt':               '🔩 볼트 (Bolt)',
      'r.nut':                '🔩 너트 (Nut)',
      'r.gsk':                '⭕ 가스켓',
      'r.ub':                 '⚓ U-볼트',
      'r.tag_bolt':           '볼트',
      'r.tag_nut':            '너트',
      'r.tag_gsk':            '가스켓',
      'r.tag_ub':             'U볼트',
      'r.col_cat':            '분류',
      'r.col_spec':           '규격',
      'r.col_qty':            '수량',
      'r.col_bolt_spec':      '규격 (S × L)',
      'r.col_nut_spec':       '규격 (M)',
      'r.col_gsk_spec':       '규격 및 재질',
      'r.col_ub_spec':        '규격 (호칭경)',
      'r.col_qty_ea':         '수량(EA)',
      'r.col_qty_sheet':      '수량(장)',
      'r.col_qty_set':        '수량(Set)',
      'r.no_rows':            '내역 없음',
      'r.cc_pitch':           '(C-C: {p}mm)',
      'r.cc_unknown':         '(핏치 미상)',
      'r.memo_title':         '📝 추가 메모',
      'r.notice_pre':         '※ 자동 합산됨',
      'r.notice_total':       ' · 총 {n} 개 항목 / 너트는 규격(M)별 독립 집계 / 더블너트는 ×2',
      // Floating bar
      'fb.queue':             '🛒 대기열',
      'fb.show_result':       '🧮 결과보기',
      // Cart drawer
      'cart.title':           '🛒 현재 대기열',
      'cart.close':           '닫기',
      'cart.to_queue':        '대기열로 이동',
      'cart.empty':           '대기열이 비어 있어요',
      // Install banner
      'install.title':        '홈 화면에 추가',
      'install.desc':         '오프라인에서도 빠르게 사용할 수 있어요.',
      'install.btn':          '설치',
      'install.dismiss':      '닫기',
      'install.aria':         '홈 화면에 추가',
      // Bottom install CTA (compact)
      'cta.install_t':        '내 폰에 설치하기',
      'cta.install_btn':      '설치',
      'cta.install_aria':     '내 폰에 설치하기',
      'cta.install_hint_ios': 'Safari 공유 → "홈 화면에 추가"',
      'cta.install_hint_and': '메뉴(⋮) → "앱 설치"',
      // Edit modal
      'edit.title':           '✏️ 항목 편집',
      'edit.save':            '저장',
      'edit.cancel':          '취소',
      'edit.dn':              '더블 너트',
      // Tutorial
      'tut.title':            '🎉 사용 가이드',
      'tut.lang_label':       '🌐 언어 / Language / Ngôn ngữ / Bahasa',
      'tut.intro_pre':        '도면의 배관 자재를 ',
      'tut.intro_em':         '장바구니처럼 추가',
      'tut.intro_post':       '하면, 전체 필요 수량을 자동으로 합산하는 스마트 계산기입니다.',
      'tut.s1_t':             '1. 자재 담기',
      'tut.s1_d_pre':         '규격을 선택하고 ',
      'tut.s1_d_em':          '[＋ 추가]',
      'tut.s1_d_post':        ' 또는 Enter 키로 대기열에 담아주세요.',
      'tut.s2_t':             '2. JIS 자동 산출',
      'tut.s2_d':             '플랜지 규격만 넣으면 볼트 굵기·길이·수량이 자동 계산됩니다 (더블너트 시 너트 두께가 볼트 길이에 자동 합산).',
      'tut.s3_t':             '3. 합산 집계',
      'tut.s3_d_pre':         '',
      'tut.s3_d_em':          '[최종 집계]',
      'tut.s3_d_post':        ' 또는 Ctrl+Enter 로 동일 규격을 자동 병합합니다.',
      'tut.s4_t':             '4. 결과 복사',
      'tut.s4_d':             '집계 후 📋 복사 버튼(또는 Ctrl+C)으로 결과를 클립보드에 복사할 수 있습니다.',
      'tut.s5_t':             '5. 파이프 커팅 계산기 바로가기',
      'tut.s5_d':             '상단 파이프 아이콘을 누르면 파이프 사선 커팅 계산기로 이동합니다.',
      'tut.confirm':          '확인했어요, 시작할게요!',
      'tut.hide':             '다시 보지 않기',
      // Toasts
      't.added':              '✅ 추가됨 · 대기열 {n}건',
      't.added_g':            '✅ 가스켓 추가 · {n}건',
      't.added_u':            '✅ U-볼트 추가 · {n}건',
      't.no_data_bolt':       '⚠️ {r} {s}A 데이터가 없습니다. 다른 사이즈를 선택해주세요.',
      't.no_data_gsk':        '⚠️ {r} {s}A 가스켓 데이터 없음',
      't.no_items':           '⚠️ 등록된 자재가 없습니다.',
      't.copy_ok':            '✨ 복사 완료!',
      't.copy_fail':          '⚠️ 복사 실패',
      't.img_save':           '🖼 이미지 저장됨',
      't.share_unsupported':  '🔗 공유 미지원: 복사로 대체',
      't.dup':                '⎘ 항목 복제됨',
      't.saved':              '💾 저장됨',
      't.applied':            '✓ {r} {s}A 적용됨',
      't.installed':          '🎉 설치되었습니다!',
      't.install_ios':        'iOS는 공유 → "홈 화면에 추가"를 사용하세요.',
      't.theme_auto':         '자동',
      't.theme_dark':         '다크',
      't.theme_light':        '라이트',
      't.theme_changed':      '🎨 {mode} 테마',
      't.undo':               '↶ 되돌리기',
      't.redo':               '↷ 다시 실행',
      't.last_proj':          '⚠️ 마지막 현장은 삭제할 수 없습니다.',
      't.proj_deleted':       '🗑 현장 삭제됨',
      't.lang_changed':       '🌐 {name}',
      // Prompts
      'p.clear_confirm':      '대기열을 모두 비울까요?',
      'p.proj_new_q':         '새 현장 이름?',
      'p.proj_new_def':       '새 현장',
      'p.proj_rename_q':      '현장 이름 변경:',
      'p.proj_del_q':         '\'{name}\' 현장을 삭제할까요?',
      // Find flange
      'f.invalid':            '⚠️ 유효한 외경 값(>0)을 입력해주세요.',
      'f.candidates':         '🎯 OD {target}mm 근처 후보 ',
      'f.candidates_n':       '{n}개 후보',
      'f.no_match':           '⚠️ 허용 오차 내 일치 규격 없음 (최소 오차 {d}mm)',
      'f.apply_aria':         '{r} {s}A 적용',
      'pick.theme_title':     '테마: {mode} (클릭하여 전환)',
      // Export
      'x.title':              '[자재 집계 내역]',
      'x.bolt':               '[볼트]',
      'x.nut':                '[너트]',
      'x.gasket':             '[가스켓]',
      'x.ubolt':              '[U-볼트]',
      'x.unit_ea':            '개',
      'x.unit_sheet':         '장',
      'x.unit_set':           'set',
      'x.cc':                 '(C-C: {p}mm)',
      'x.cc_none':            '(핏치 정보 없음)',
      'x.memo':               '[추가 메모]',
      'x.csv_cat':            '카테고리',
      'x.csv_spec':           '규격',
      'x.csv_qty':            '수량',
      'x.csv_unit':           '단위',
      'x.cat_bolt':           '볼트',
      'x.cat_nut':            '너트',
      'x.cat_gsk':            '가스켓',
      'x.cat_ub':             'U-볼트',
      'x.cat_memo':           '메모',
      'x.fname_suffix':       '_자재집계',
      'x.share_title':        'JIS 자재 집계',
      'vis.today':            '오늘 방문자:',
      'vis.unit':             '명'
    },

    vi: {
      'app.title':            'Máy tính Vật tư Đường ống',
      'app.subtitle':         'Tiêu chuẩn JIS · PWA Ngoại tuyến',
      'app.toolbar':          'Công cụ ứng dụng',
      'tb.proj_group':        'Chọn dự án',
      'tb.proj_label':        'Dự án (công trường)',
      'tb.proj_select':       'Chọn dự án (công trường)',
      'tb.proj_new':          'Thêm dự án mới',
      'tb.proj_rename':       'Đổi tên dự án',
      'tb.proj_delete':       'Xóa dự án',
      'tb.undo':              'Hoàn tác',
      'tb.undo_title':        'Hoàn tác (Ctrl+Z)',
      'tb.redo':              'Làm lại',
      'tb.redo_title':        'Làm lại (Ctrl+Y)',
      'tb.theme':             'Đổi giao diện',
      'tb.pipe_calc':         'Mở máy tính cắt chéo ống',
      'tb.help':              'Mở hướng dẫn sử dụng',
      'tb.help_btn':          '❓ Hướng dẫn',
      'tb.lang':              'Đổi ngôn ngữ',
      'tb.lang_select':       'Chọn ngôn ngữ',
      'proj.default':         'Dự án mặc định',
      'sec.input':            'Nhập vật tư',
      'sec.queue':            'Hàng chờ đăng ký',
      'sec.result':           'Kết quả tổng hợp',
      'sec.result_aria':      'Kết quả tổng hợp cuối cùng',
      'card.find':            '🔍 Tìm Mặt bích',
      'form.od':              'Đường kính ngoài mặt bích (OD, mm)',
      'form.od_ph':           'VD: 155',
      'btn.find':             'Tìm',
      'card.flange':          '🔩 Điểm Mặt bích',
      'form.rating':          'Cấp áp suất',
      'form.size':            'Đường kính danh nghĩa (A)',
      'form.qty_pt':          'Số điểm',
      'form.qty_dec':         'Giảm',
      'form.qty_inc':         'Tăng',
      'aria.qty_pt':          'Điều chỉnh số điểm',
      'opt.ext':              'Bu lông dài thêm 5mm (ống poly / van dày)',
      'opt.dn':               'Dùng đai ốc đôi (tự động cộng độ dày đai ốc)',
      'opt.gsk':              'Bao gồm gioăng',
      'aria.gsk_type':        'Loại gioăng',
      'aria.gsk_type_in':     'Loại gioăng kèm theo',
      'gsk.normal':           'Thường (RF)',
      'gsk.nl':               'Non-layer',
      'gsk.gr':               'Graphite',
      'gsk.metal':            'Kim loại',
      'gsk.full':             'Full Face',
      'btn.add_pt':           '＋ Thêm điểm',
      'kbd.enter':            '(Enter)',
      'card.gasket':          '⭕ Thêm Gioăng',
      'form.gtype':           'Vật liệu / Loại',
      'form.qty_sht':         'Số lượng (tấm)',
      'aria.qty_gsk':         'Điều chỉnh số gioăng',
      'aria.qty_gsk_in':      'Số gioăng',
      'btn.add_gsk':          '＋ Thêm gioăng',
      'card.ubolt':           '⚓ Thêm Bu lông U',
      'card.gas_pipe':        '🛢 Preset ống gas',
      'form.qty_set':         'Số lượng (bộ)',
      'aria.qty_ub':          'Điều chỉnh số bu lông U',
      'aria.qty_ub_in':       'Số bu lông U',
      'btn.add_ub':           '＋ Thêm bu lông U',
      'pitch.label':          'Khoảng cách lỗ',
      'pitch.none':           'Không có dữ liệu khoảng cách lỗ (cần kiểm tra thủ công)',
      'guide.flange_od_aria': 'Xem vị trí đo OD mặt bích',
      'guide.ubolt_pitch_aria':'Xem khoảng cách tâm lỗ bu lông U',
      'guide.flange_od_svg_aria':'Sơ đồ vị trí đo OD mặt bích',
      'guide.ubolt_pitch_svg_aria':'Sơ đồ khoảng cách tâm lỗ bu lông U',
      'guide.flange_od_title':'Hướng dẫn đo OD mặt bích',
      'guide.ubolt_pitch_title':'Hướng dẫn khoảng cách tâm lỗ bu lông U',
      'guide.flange_od_desc': 'OD là đường kính tổng thể, đo từ mép ngoài này sang mép ngoài đối diện của mặt bích.',
      'guide.ubolt_pitch_desc':'Khoảng cách tâm lỗ (C-C) là khoảng cách từ tâm lỗ bu lông bên trái đến tâm lỗ bên phải.',
      'guide.close':          'Đã hiểu',
      'card.memo':            '📝 Ghi chú thêm',
      'form.gas_pipe_preset': 'Preset ống gas',
      'gas.desc':             'Đã sắp xếp bảng ống gas đã cung cấp thành preset. Giống phần chọn ống hiện có, chỉ cần chọn kích thước để xem ngay giá trị chuẩn tương ứng.',
      'gas.rule':             'Công thức tính chiều dài: (độ dày mặt bích x 2) + gioăng 3 + long đền 6 + giá trị cỡ bu lông + dư 5',
      'gas.help':             'Có thể chọn preset ống gas đã cung cấp từ 250A đến 1500A.',
      'gas.col.size':         'Kích thước',
      'gas.col.flange':       'Độ dày mặt bích',
      'gas.col.bolt_size':    'Cỡ bu lông',
      'gas.col.formula':      'Công thức chiều dài',
      'gas.col.theoretical':  'Chiều dài lý thuyết',
      'gas.col.recommended':  'Chiều dài bu lông đề xuất',
      'form.memo_label':      'Ghi chú tự do',
      'form.memo_ph':         'Ghi chú tự do về vật tư khác hoặc chú thích.',
      'card.queue':           '📋 Hàng chờ đăng ký',
      'btn.calc':             '🧮 Tổng hợp cuối',
      'kbd.ctrl_enter':       '(Ctrl+Enter)',
      'btn.clear':            'Xóa hết',
      'q.empty_t':            'Hàng chờ đang trống',
      'q.empty_d':            'Thêm vật tư từ form bên trái — chúng sẽ xuất hiện ở đây.',
      'q.flange':             'Mặt bích',
      'q.gasket':             'Gioăng',
      'q.ubolt':              'Bu lông U',
      'q.qty_aria':           'Điều chỉnh số lượng',
      'q.qty_dec':            'Giảm số lượng',
      'q.qty_inc':            'Tăng số lượng',
      'q.qty_in_aria':        'Số lượng mục',
      'q.edit':               'Sửa',
      'q.dup':                'Nhân đôi',
      'q.del':                'Xóa',
      'q.del_title':          'Xóa (Delete)',
      'q.tag_5mm':            '+5mm',
      'q.tag_dn':             'Đai ốc đôi',
      'q.tag_auto':           'Tự động thêm',
      'q.tag_pitch_unknown':  'Không có pitch',
      'q.pitch_known':        'Khoảng cách lỗ {p}mm',
      'q.pitch_unknown':      'Không có thông tin khoảng cách lỗ',
      'q.aria_label':         '{title} {n} — nhấn Delete để xóa',
      'q.bolt_desc':          '{bS} × {bL}L · {bC} lỗ/điểm',
      'unit.count':           '{n}',
      'r.empty_t':            'Chưa có kết quả tổng hợp',
      'r.empty_d':            'Hãy thêm vật tư vào hàng chờ rồi nhấn nút [Tổng hợp cuối].',
      'r.shortcuts':          'Phím tắt: {kbd1} Thêm · {kbd2} Xóa · {kbd3} Tổng hợp · {kbd4} Sao chép',
      'r.sc_label':           'Phím tắt',
      'r.sc_add':             'Thêm',
      'r.sc_del':             'Xóa',
      'r.sc_agg':             'Tổng hợp',
      'r.sc_copy':            'Sao chép',
      'r.title':              '✅ Tổng hợp cuối',
      'r.copy':               '📋 Sao chép',
      'r.save_image':         '🖼 Lưu ảnh',
      'r.share':              '🔗 Chia sẻ',
      'r.bolt':               '🔩 Bu lông (Bolt)',
      'r.nut':                '🔩 Đai ốc (Nut)',
      'r.gsk':                '⭕ Gioăng',
      'r.ub':                 '⚓ Bu lông U',
      'r.tag_bolt':           'Bu lông',
      'r.tag_nut':            'Đai ốc',
      'r.tag_gsk':            'Gioăng',
      'r.tag_ub':             'Bu lông U',
      'r.col_cat':            'Loại',
      'r.col_spec':           'Quy cách',
      'r.col_qty':            'SL',
      'r.col_bolt_spec':      'Quy cách (S × L)',
      'r.col_nut_spec':       'Quy cách (M)',
      'r.col_gsk_spec':       'Quy cách & Vật liệu',
      'r.col_ub_spec':        'Quy cách (DN)',
      'r.col_qty_ea':         'SL (cái)',
      'r.col_qty_sheet':      'SL (tấm)',
      'r.col_qty_set':        'SL (bộ)',
      'r.no_rows':            'Không có dữ liệu',
      'r.cc_pitch':           '(C-C: {p}mm)',
      'r.cc_unknown':         '(không có pitch)',
      'r.memo_title':         '📝 Ghi chú thêm',
      'r.notice_pre':         '※ Đã tự động cộng dồn',
      'r.notice_total':       ' · Tổng {n} mục / Đai ốc tính riêng theo cỡ (M) / Đai ốc đôi ×2',
      'fb.queue':             '🛒 Hàng chờ',
      'fb.show_result':       '🧮 Xem kết quả',
      // Cart drawer
      'cart.title':           '🛒 Hàng chờ hiện tại',
      'cart.close':           'Đóng',
      'cart.to_queue':        'Đến hàng chờ',
      'cart.empty':           'Hàng chờ trống',
      'install.title':        'Thêm vào màn hình chính',
      'install.desc':         'Có thể dùng nhanh ngay cả khi ngoại tuyến.',
      'install.btn':          'Cài đặt',
      'install.dismiss':      'Đóng',
      'install.aria':         'Thêm vào màn hình chính',
      'cta.install_t':        'Cài lên điện thoại',
      'cta.install_btn':      'Cài đặt',
      'cta.install_aria':     'Cài lên điện thoại',
      'cta.install_hint_ios': 'Safari · Chia sẻ → "Thêm vào MH chính"',
      'cta.install_hint_and': 'Menu (⋮) → "Cài đặt ứng dụng"',
      'edit.title':           '✏️ Sửa mục',
      'edit.save':            'Lưu',
      'edit.cancel':          'Hủy',
      'edit.dn':              'Đai ốc đôi',
      'tut.title':            '🎉 Hướng dẫn sử dụng',
      'tut.lang_label':       '🌐 Ngôn ngữ / Language / 언어 / Bahasa',
      'tut.intro_pre':        'Hãy ',
      'tut.intro_em':         'thêm vật tư đường ống như bỏ vào giỏ hàng',
      'tut.intro_post':       ', máy sẽ tự động cộng dồn tổng số lượng cần thiết.',
      'tut.s1_t':             '1. Thêm vật tư',
      'tut.s1_d_pre':         'Chọn quy cách rồi nhấn ',
      'tut.s1_d_em':          '[＋ Thêm]',
      'tut.s1_d_post':        ' hoặc phím Enter để bỏ vào hàng chờ.',
      'tut.s2_t':             '2. Tự động tính theo JIS',
      'tut.s2_d':             'Chỉ cần nhập quy cách mặt bích, đường kính·chiều dài·số lượng bu lông sẽ tự tính (đai ốc đôi sẽ tự cộng độ dày đai ốc vào chiều dài).',
      'tut.s3_t':             '3. Tổng hợp',
      'tut.s3_d_pre':         'Nhấn ',
      'tut.s3_d_em':          '[Tổng hợp cuối]',
      'tut.s3_d_post':        ' hoặc Ctrl+Enter để gộp các quy cách giống nhau.',
      'tut.s4_t':             '4. Sao chép kết quả',
      'tut.s4_d':             'Sau khi tổng hợp, nhấn nút 📋 Sao chép (hoặc Ctrl+C) để sao chép kết quả vào clipboard.',
      'tut.s5_t':             '5. Lối tắt máy tính cắt ống',
      'tut.s5_d':             'Nhấn biểu tượng ống ở thanh trên để chuyển sang máy tính cắt chéo ống.',
      'tut.confirm':          'Đã hiểu, bắt đầu!',
      'tut.hide':             'Không hiển thị lại',
      't.added':              '✅ Đã thêm · Hàng chờ {n}',
      't.added_g':            '✅ Đã thêm gioăng · {n}',
      't.added_u':            '✅ Đã thêm bu lông U · {n}',
      't.no_data_bolt':       '⚠️ Không có dữ liệu cho {r} {s}A. Hãy chọn cỡ khác.',
      't.no_data_gsk':        '⚠️ Không có dữ liệu gioăng {r} {s}A',
      't.no_items':           '⚠️ Chưa có vật tư nào.',
      't.copy_ok':            '✨ Đã sao chép!',
      't.copy_fail':          '⚠️ Sao chép thất bại',
      't.img_save':           '🖼 Đã lưu ảnh',
      't.share_unsupported':  '🔗 Không hỗ trợ chia sẻ: đã sao chép thay thế',
      't.dup':                '⎘ Đã nhân đôi mục',
      't.saved':              '💾 Đã lưu',
      't.applied':            '✓ Đã áp dụng {r} {s}A',
      't.installed':          '🎉 Đã cài đặt!',
      't.install_ios':        'iOS: dùng Chia sẻ → "Thêm vào màn hình chính".',
      't.theme_auto':         'Tự động',
      't.theme_dark':         'Tối',
      't.theme_light':        'Sáng',
      't.theme_changed':      '🎨 Giao diện {mode}',
      't.undo':               '↶ Hoàn tác',
      't.redo':               '↷ Làm lại',
      't.last_proj':          '⚠️ Không thể xóa dự án cuối cùng.',
      't.proj_deleted':       '🗑 Đã xóa dự án',
      't.lang_changed':       '🌐 {name}',
      'p.clear_confirm':      'Xóa toàn bộ hàng chờ?',
      'p.proj_new_q':         'Tên dự án mới?',
      'p.proj_new_def':       'Dự án mới',
      'p.proj_rename_q':      'Đổi tên dự án:',
      'p.proj_del_q':         'Xóa dự án \'{name}\'?',
      'f.invalid':            '⚠️ Hãy nhập giá trị OD hợp lệ (>0).',
      'f.candidates':         '🎯 OD {target}mm gần nhất ',
      'f.candidates_n':       '{n} ứng viên',
      'f.no_match':           '⚠️ Không có quy cách trong dung sai (sai lệch nhỏ nhất {d}mm)',
      'f.apply_aria':         'Áp dụng {r} {s}A',
      'pick.theme_title':     'Giao diện: {mode} (nhấn để đổi)',
      'x.title':              '[Tổng hợp Vật tư]',
      'x.bolt':               '[Bu lông]',
      'x.nut':                '[Đai ốc]',
      'x.gasket':             '[Gioăng]',
      'x.ubolt':              '[Bu lông U]',
      'x.unit_ea':            'cái',
      'x.unit_sheet':         'tấm',
      'x.unit_set':           'bộ',
      'x.cc':                 '(C-C: {p}mm)',
      'x.cc_none':            '(không có pitch)',
      'x.memo':               '[Ghi chú thêm]',
      'x.csv_cat':            'Danh mục',
      'x.csv_spec':           'Quy cách',
      'x.csv_qty':            'Số lượng',
      'x.csv_unit':           'Đơn vị',
      'x.cat_bolt':           'Bu lông',
      'x.cat_nut':            'Đai ốc',
      'x.cat_gsk':            'Gioăng',
      'x.cat_ub':             'Bu lông U',
      'x.cat_memo':           'Ghi chú',
      'x.fname_suffix':       '_tonghop_vattu',
      'x.share_title':        'Tổng hợp Vật tư JIS',
      'vis.today':            'Khách hôm nay:',
      'vis.unit':             'người'
    },

    id: {
      'app.title':            'Kalkulator Material Pipa',
      'app.subtitle':         'Standar JIS · PWA Offline',
      'app.toolbar':          'Alat aplikasi',
      'tb.proj_group':        'Pilih proyek',
      'tb.proj_label':        'Proyek (lokasi)',
      'tb.proj_select':       'Pilih proyek (lokasi)',
      'tb.proj_new':          'Tambah proyek baru',
      'tb.proj_rename':       'Ubah nama proyek',
      'tb.proj_delete':       'Hapus proyek',
      'tb.undo':              'Urungkan',
      'tb.undo_title':        'Urungkan (Ctrl+Z)',
      'tb.redo':              'Ulangi',
      'tb.redo_title':        'Ulangi (Ctrl+Y)',
      'tb.theme':             'Ganti tema',
      'tb.pipe_calc':         'Buka kalkulator potong miring pipa',
      'tb.help':              'Buka panduan penggunaan',
      'tb.help_btn':          '❓ Panduan',
      'tb.lang':              'Ganti bahasa',
      'tb.lang_select':       'Pilih bahasa',
      'proj.default':         'Proyek default',
      'sec.input':            'Input material',
      'sec.queue':            'Antrean pendaftaran',
      'sec.result':           'Hasil rekap',
      'sec.result_aria':      'Hasil rekap akhir',
      'card.find':            '🔍 Cari Flensa',
      'form.od':              'Diameter luar flensa (OD, mm)',
      'form.od_ph':           'cth: 155',
      'btn.find':             'Cari',
      'card.flange':          '🔩 Titik Flensa',
      'form.rating':          'Kelas tekanan',
      'form.size':            'Diameter nominal (A)',
      'form.qty_pt':          'Jumlah titik',
      'form.qty_dec':         'Kurang',
      'form.qty_inc':         'Tambah',
      'aria.qty_pt':          'Atur jumlah titik',
      'opt.ext':              'Baut 5mm lebih panjang (pipa poly / valve tebal)',
      'opt.dn':               'Pakai mur ganda (tebal mur otomatis ditambahkan)',
      'opt.gsk':              'Termasuk gasket',
      'aria.gsk_type':        'Jenis gasket',
      'aria.gsk_type_in':     'Jenis gasket yang disertakan',
      'gsk.normal':           'Biasa (RF)',
      'gsk.nl':               'Non-layer',
      'gsk.gr':               'Grafit',
      'gsk.metal':            'Logam',
      'gsk.full':             'Full Face',
      'btn.add_pt':           '＋ Tambah titik',
      'kbd.enter':            '(Enter)',
      'card.gasket':          '⭕ Tambah Gasket',
      'form.gtype':           'Material / Tipe',
      'form.qty_sht':         'Jumlah (lembar)',
      'aria.qty_gsk':         'Atur jumlah gasket',
      'aria.qty_gsk_in':      'Jumlah gasket',
      'btn.add_gsk':          '＋ Tambah gasket',
      'card.ubolt':           '⚓ Tambah Baut U',
      'card.gas_pipe':        '🛢 Preset pipa gas',
      'form.qty_set':         'Jumlah (Set)',
      'aria.qty_ub':          'Atur jumlah baut U',
      'aria.qty_ub_in':       'Jumlah baut U',
      'btn.add_ub':           '＋ Tambah baut U',
      'pitch.label':          'Jarak lubang',
      'pitch.none':           'Data jarak lubang tidak tersedia (perlu cek manual)',
      'guide.flange_od_aria': 'Lihat posisi ukur OD flensa',
      'guide.ubolt_pitch_aria':'Lihat jarak pusat lubang baut U',
      'guide.flange_od_svg_aria':'Diagram posisi ukur OD flensa',
      'guide.ubolt_pitch_svg_aria':'Diagram jarak pusat lubang baut U',
      'guide.flange_od_title':'Panduan ukur OD flensa',
      'guide.ubolt_pitch_title':'Panduan jarak pusat lubang baut U',
      'guide.flange_od_desc': 'OD adalah diameter total, diukur dari sisi luar flensa ke sisi luar yang berlawanan.',
      'guide.ubolt_pitch_desc':'Jarak pusat lubang (C-C) adalah jarak dari pusat lubang baut kiri ke pusat lubang baut kanan.',
      'guide.close':          'Mengerti',
      'card.memo':            '📝 Catatan tambahan',
      'form.gas_pipe_preset': 'Preset pipa gas',
      'gas.desc':             'Tabel pipa gas yang Anda berikan sudah diringkas sebagai preset. Seperti pencarian pipa yang ada, pilih ukuran untuk langsung melihat nilai acuannya.',
      'gas.rule':             'Rumus panjang: (tebal flange x 2) + gasket 3 + washer 6 + nilai ukuran baut + allowance 5',
      'gas.help':             'Preset pipa gas dari 250A sampai 1500A tersedia untuk dipilih.',
      'gas.col.size':         'Ukuran',
      'gas.col.flange':       'Tebal flange',
      'gas.col.bolt_size':    'Ukuran baut',
      'gas.col.formula':      'Rumus panjang',
      'gas.col.theoretical':  'Panjang teoritis',
      'gas.col.recommended':  'Panjang baut rekomendasi',
      'form.memo_label':      'Catatan bebas',
      'form.memo_ph':         'Catatan bebas untuk material lain atau keterangan.',
      'card.queue':           '📋 Antrean pendaftaran',
      'btn.calc':             '🧮 Rekap akhir',
      'kbd.ctrl_enter':       '(Ctrl+Enter)',
      'btn.clear':            'Reset',
      'q.empty_t':            'Antrean kosong',
      'q.empty_d':            'Tambahkan material dari form di kiri — akan muncul di sini.',
      'q.flange':             'Flensa',
      'q.gasket':             'Gasket',
      'q.ubolt':              'Baut U',
      'q.qty_aria':           'Atur jumlah',
      'q.qty_dec':            'Kurangi jumlah',
      'q.qty_inc':            'Tambah jumlah',
      'q.qty_in_aria':        'Jumlah item',
      'q.edit':               'Edit',
      'q.dup':                'Gandakan',
      'q.del':                'Hapus',
      'q.del_title':          'Hapus (Delete)',
      'q.tag_5mm':            '+5mm',
      'q.tag_dn':             'Mur ganda',
      'q.tag_auto':           'Auto',
      'q.tag_pitch_unknown':  'Pitch tidak diketahui',
      'q.pitch_known':        'Jarak lubang {p}mm',
      'q.pitch_unknown':      'Info jarak lubang tidak tersedia',
      'q.aria_label':         '{title} {n} — tekan Delete untuk hapus',
      'q.bolt_desc':          '{bS} × {bL}L · {bC} lubang/titik',
      'unit.count':           '{n}',
      'r.empty_t':            'Belum ada hasil rekap',
      'r.empty_d':            'Tambahkan material ke antrean lalu tekan tombol [Rekap akhir].',
      'r.shortcuts':          'Pintasan: {kbd1} tambah · {kbd2} hapus · {kbd3} rekap · {kbd4} salin',
      'r.sc_label':           'Pintasan',
      'r.sc_add':             'Tambah',
      'r.sc_del':             'Hapus',
      'r.sc_agg':             'Rekap',
      'r.sc_copy':            'Salin',
      'r.title':              '✅ Rekap akhir',
      'r.copy':               '📋 Salin',
      'r.save_image':         '🖼 Simpan Gambar',
      'r.share':              '🔗 Bagikan',
      'r.bolt':               '🔩 Baut (Bolt)',
      'r.nut':                '🔩 Mur (Nut)',
      'r.gsk':                '⭕ Gasket',
      'r.ub':                 '⚓ Baut U',
      'r.tag_bolt':           'Baut',
      'r.tag_nut':            'Mur',
      'r.tag_gsk':            'Gasket',
      'r.tag_ub':             'Baut U',
      'r.col_cat':            'Jenis',
      'r.col_spec':           'Spesifikasi',
      'r.col_qty':            'Jml',
      'r.col_bolt_spec':      'Spesifikasi (S × L)',
      'r.col_nut_spec':       'Spesifikasi (M)',
      'r.col_gsk_spec':       'Spesifikasi & Material',
      'r.col_ub_spec':        'Spesifikasi (DN)',
      'r.col_qty_ea':         'Jml (pcs)',
      'r.col_qty_sheet':      'Jml (lbr)',
      'r.col_qty_set':        'Jml (set)',
      'r.no_rows':            'Tidak ada data',
      'r.cc_pitch':           '(C-C: {p}mm)',
      'r.cc_unknown':         '(pitch tdk diketahui)',
      'r.memo_title':         '📝 Catatan tambahan',
      'r.notice_pre':         '※ Otomatis dijumlah',
      'r.notice_total':       ' · Total {n} item / Mur dihitung terpisah per ukuran (M) / Mur ganda ×2',
      'fb.queue':             '🛒 Antrean',
      'fb.show_result':       '🧮 Lihat hasil',
      // Cart drawer
      'cart.title':           '🛒 Antrean saat ini',
      'cart.close':           'Tutup',
      'cart.to_queue':        'Ke antrean',
      'cart.empty':           'Antrean kosong',
      'install.title':        'Tambah ke Layar Utama',
      'install.desc':         'Bisa dipakai cepat bahkan saat offline.',
      'install.btn':          'Pasang',
      'install.dismiss':      'Tutup',
      'install.aria':         'Tambah ke Layar Utama',
      'cta.install_t':        'Pasang di ponsel',
      'cta.install_btn':      'Pasang',
      'cta.install_aria':     'Pasang di ponsel',
      'cta.install_hint_ios': 'Safari · Bagikan → "Tambah ke Layar Utama"',
      'cta.install_hint_and': 'Menu (⋮) → "Pasang aplikasi"',
      'edit.title':           '✏️ Edit item',
      'edit.save':            'Simpan',
      'edit.cancel':          'Batal',
      'edit.dn':              'Mur ganda',
      'tut.title':            '🎉 Panduan Penggunaan',
      'tut.lang_label':       '🌐 Bahasa / Language / 언어 / Ngôn ngữ',
      'tut.intro_pre':        'Cukup ',
      'tut.intro_em':         'tambahkan material pipa seperti memasukkan ke keranjang',
      'tut.intro_post':       ', kalkulator akan otomatis menjumlahkan total kebutuhan.',
      'tut.s1_t':             '1. Tambah material',
      'tut.s1_d_pre':         'Pilih spesifikasi lalu tekan ',
      'tut.s1_d_em':          '[＋ Tambah]',
      'tut.s1_d_post':        ' atau tekan Enter untuk masukkan ke antrean.',
      'tut.s2_t':             '2. Hitung otomatis JIS',
      'tut.s2_d':             'Cukup masukkan spesifikasi flensa, ukuran·panjang·jumlah baut akan otomatis dihitung (mur ganda otomatis menambah ketebalan mur ke panjang baut).',
      'tut.s3_t':             '3. Rekap',
      'tut.s3_d_pre':         'Tekan ',
      'tut.s3_d_em':          '[Rekap akhir]',
      'tut.s3_d_post':        ' atau Ctrl+Enter untuk menggabungkan spesifikasi yang sama.',
      'tut.s4_t':             '4. Salin Hasil',
      'tut.s4_d':             'Setelah merekap, tekan tombol 📋 Salin (atau Ctrl+C) untuk menyalin hasil ke clipboard.',
      'tut.s5_t':             '5. Pintasan kalkulator potong pipa',
      'tut.s5_d':             'Tekan ikon pipa di bagian atas untuk pindah ke kalkulator potong miring pipa.',
      'tut.confirm':          'Mengerti, mulai sekarang!',
      'tut.hide':             'Jangan tampilkan lagi',
      't.added':              '✅ Ditambahkan · Antrean {n}',
      't.added_g':            '✅ Gasket ditambahkan · {n}',
      't.added_u':            '✅ Baut U ditambahkan · {n}',
      't.no_data_bolt':       '⚠️ Tidak ada data {r} {s}A. Pilih ukuran lain.',
      't.no_data_gsk':        '⚠️ Tidak ada data gasket {r} {s}A',
      't.no_items':           '⚠️ Belum ada material terdaftar.',
      't.copy_ok':            '✨ Tersalin!',
      't.copy_fail':          '⚠️ Gagal menyalin',
      't.img_save':           '🖼 Gambar tersimpan',
      't.share_unsupported':  '🔗 Berbagi tidak didukung: disalin sebagai gantinya',
      't.dup':                '⎘ Item digandakan',
      't.saved':              '💾 Tersimpan',
      't.applied':            '✓ {r} {s}A diterapkan',
      't.installed':          '🎉 Terpasang!',
      't.install_ios':        'iOS: gunakan Bagikan → "Tambah ke Layar Utama".',
      't.theme_auto':         'Otomatis',
      't.theme_dark':         'Gelap',
      't.theme_light':        'Terang',
      't.theme_changed':      '🎨 Tema {mode}',
      't.undo':               '↶ Urungkan',
      't.redo':               '↷ Ulangi',
      't.last_proj':          '⚠️ Tidak bisa menghapus proyek terakhir.',
      't.proj_deleted':       '🗑 Proyek dihapus',
      't.lang_changed':       '🌐 {name}',
      'p.clear_confirm':      'Kosongkan seluruh antrean?',
      'p.proj_new_q':         'Nama proyek baru?',
      'p.proj_new_def':       'Proyek baru',
      'p.proj_rename_q':      'Ubah nama proyek:',
      'p.proj_del_q':         'Hapus proyek \'{name}\'?',
      'f.invalid':            '⚠️ Masukkan nilai OD valid (>0).',
      'f.candidates':         '🎯 OD {target}mm terdekat ',
      'f.candidates_n':       '{n} kandidat',
      'f.no_match':           '⚠️ Tidak ada spesifikasi dalam toleransi (selisih min {d}mm)',
      'f.apply_aria':         'Terapkan {r} {s}A',
      'pick.theme_title':     'Tema: {mode} (klik untuk ganti)',
      'x.title':              '[Rekap Material]',
      'x.bolt':               '[Baut]',
      'x.nut':                '[Mur]',
      'x.gasket':             '[Gasket]',
      'x.ubolt':              '[Baut U]',
      'x.unit_ea':            'pcs',
      'x.unit_sheet':         'lbr',
      'x.unit_set':           'set',
      'x.cc':                 '(C-C: {p}mm)',
      'x.cc_none':            '(pitch tidak diketahui)',
      'x.memo':               '[Catatan tambahan]',
      'x.csv_cat':            'Kategori',
      'x.csv_spec':           'Spesifikasi',
      'x.csv_qty':            'Jumlah',
      'x.csv_unit':           'Satuan',
      'x.cat_bolt':           'Baut',
      'x.cat_nut':            'Mur',
      'x.cat_gsk':            'Gasket',
      'x.cat_ub':             'Baut U',
      'x.cat_memo':           'Catatan',
      'x.fname_suffix':       '_rekap_material',
      'x.share_title':        'Rekap Material JIS',
      'vis.today':            'Pengunjung hari ini:',
      'vis.unit':             'orang'
    }
  };

  /** Map gasket type stored value (always Korean key) to translation key. */
  const GTYPE_TO_KEY = {
    '일반': 'gsk.normal', '논레이어': 'gsk.nl',
    '그라파이트': 'gsk.gr', '메탈': 'gsk.metal', '풀페이스': 'gsk.full'
  };

  const Lang = {
    /** @type {string} */ current: 'ko',
    detect() {
      try {
        const saved = localStorage.getItem(LANG_KEY);
        if (saved && I18N[saved]) return saved;
      } catch (e) {}
      const nav = (navigator.language || 'ko').toLowerCase();
      if (nav.startsWith('vi')) return 'vi';
      if (nav.startsWith('id') || nav.startsWith('in')) return 'id'; // 'in' = legacy Indonesian code
      return 'ko';
    },
    set(lang) {
      if (!I18N[lang]) lang = 'ko';
      this.current = lang;
      try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
      document.documentElement.lang = lang;
    },
    /**
     * Translate a key with optional {placeholders}.
     * @param {string} key
     * @param {Object<string,string|number>} [params]
     * @returns {string}
     */
    t(key, params) {
      const dict = I18N[this.current] || I18N.ko;
      let s = dict[key];
      if (s == null) s = (I18N.ko[key] != null ? I18N.ko[key] : key);
      if (params) {
        s = s.replace(/\{(\w+)\}/g, (_, k) => params[k] != null ? String(params[k]) : '{' + k + '}');
      }
      return s;
    },
    /** Translate gasket type string (stored as Korean key). */
    tGType(g) {
      const k = GTYPE_TO_KEY[g];
      return k ? this.t(k) : g;
    }
  };
  /** Shorthand. */
  const t = (k, p) => Lang.t(k, p);

  /**
   * Walk the DOM and apply translations to elements with data-i18n
   * (textContent) and data-i18n-attr="attr1:key1,attr2:key2" (attributes).
   */
  function applyI18n(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(node => {
      const key = node.getAttribute('data-i18n');
      if (key) node.textContent = t(key);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(node => {
      const spec = node.getAttribute('data-i18n-attr');
      if (!spec) return;
      for (const pair of spec.split(',')) {
        const [attr, key] = pair.split(':').map(s => s && s.trim());
        if (attr && key) node.setAttribute(attr, t(key));
      }
    });
    // Update <html lang>
    document.documentElement.lang = Lang.current;
    // Update document title
    document.title = t('app.title');
  }

  /* =====================================================================
     §2. UTILITIES
     ===================================================================== */

  /** @param {string} sel @param {Element|Document} [root] */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * Safari 15 이하에서 scrollIntoView({ behavior: 'smooth' })가 동작하지 않을 수 있습니다.
   * CSS scroll-behavior를 통해 폴리필합니다.
   */
  function smoothScrollIntoView(element, options = {}) {
    if (typeof element.scrollIntoView === 'function') {
      try {
        element.scrollIntoView({ behavior: 'smooth', ...options });
      } catch (e) {
        element.scrollIntoView(false);
      }
    }
  }

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
      // Strict type-narrowing: only DOM Nodes (Elements/Text/Fragments) are
      // appended directly. All other values are stringified and wrapped in a
      // Text node, which DOES escape HTML metacharacters by definition. No
      // call site of el() ever passes raw HTML strings; appendChild does not
      // parse HTML, so XSS is structurally impossible here.
      if (c && typeof c === 'object' && typeof c.nodeType === 'number') {
        node.appendChild(/** @type {Node} */ (c));
      } else {
        node.appendChild(document.createTextNode(String(c)));
      }
    }
    return node;
  }

  /** Debounce trailing-call. Preserves `this` via closure. */
  function debounce(fn, ms) {
    let t;
    return function debounced(...args) {
      const ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), ms);
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

    get current() { return this.projects[this.currentProject] || (this.projects[this.currentProject] = { name: t('proj.default'), queue: [], memo: '' }); },
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
      // Project data is intentionally NOT persisted — app always starts fresh.
      // Only language preference (LANG_KEY) is saved across sessions.
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
            if (typeof p.name !== 'string') p.name = t('proj.default');
          }
        }
      } catch (e) { /* corrupted */ }
    },

    addProject(name) {
      const id = 'p_' + Date.now().toString(36);
      this.projects[id] = { name: String(name || t('p.proj_new_def')).slice(0, 40), queue: [], memo: '' };
      this.currentProject = id;
      this.history.length = 0; this.future.length = 0;
      this.save();
      return id;
    },
    renameProject(id, name) {
      if (this.projects[id]) {
        this.projects[id].name = String(name || t('proj.default')).slice(0, 40);
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
        const k = `${q.r} ${q.s}A (${Lang.tGType(q.gtype)})`;
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
    let out = t('x.title') + '\n\n';
    for (const [k, v] of agg.sB) out += `${t('x.bolt')} ${k} : ${v}${t('x.unit_ea')}\n`;
    if (agg.sN.length) out += '\n';
    for (const [k, v] of agg.sN) out += `${t('x.nut')} ${k} : ${v}${t('x.unit_ea')}\n`;
    if (agg.sG.length) out += '\n';
    for (const [k, v] of agg.sG) out += `${t('x.gasket')} ${k} : ${v}${t('x.unit_sheet')}\n`;
    if (agg.sU.length) out += '\n';
    for (const [k, v] of agg.sU) {
      const p = UBOLT_PITCH[parseInt(k, 10)];
      out += `${t('x.ubolt')} ${k}${p ? ' ' + t('x.cc', { p }) : ' ' + t('x.cc_none')} : ${v}${t('x.unit_set')}\n`;
    }
    if (memo && memo.trim()) out += `\n${t('x.memo')}\n${memo.trim()}\n`;
    return out;
  }

  /** Build CSV export. */
  function buildExportCSV(agg, memo) {
    const rows = [[t('x.csv_cat'), t('x.csv_spec'), t('x.csv_qty'), t('x.csv_unit')]];
    for (const [k, v] of agg.sB) rows.push([t('x.cat_bolt'), k, v, t('x.unit_ea')]);
    for (const [k, v] of agg.sN) rows.push([t('x.cat_nut'),  k, v, t('x.unit_ea')]);
    for (const [k, v] of agg.sG) rows.push([t('x.cat_gsk'),  k, v, t('x.unit_sheet')]);
    for (const [k, v] of agg.sU) {
      const p = UBOLT_PITCH[parseInt(k, 10)];
      rows.push([t('x.cat_ub'), `${k}${p ? ` (C-C ${p}mm)` : ''}`, v, t('x.unit_set')]);
    }
    if (memo && memo.trim()) rows.push([t('x.cat_memo'), memo.trim().replace(/\n/g, ' '), '', '']);
    const esc = (s) => {
      const str = String(s);
      return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
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

    populateGasPipePresetSelect(selectEl) {
      if (!selectEl) return;
      const prev = parseInt(selectEl.value, 10);
      selectEl.textContent = '';
      for (const row of GAS_PIPE_TABLE) {
        selectEl.appendChild(el(
          'option',
          { value: row.size },
          `${row.size}A · ${row.boltSize} · ${row.recommendedLength} mm`
        ));
      }
      const nextValue = GAS_PIPE_TABLE.some(row => row.size === prev) ? prev : GAS_PIPE_TABLE[0]?.size;
      if (nextValue != null) selectEl.value = String(nextValue);
    },

    populateProjectSelect(selectEl) {
      if (!selectEl) return;
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
        node.appendChild(document.createTextNode(t('pitch.label') + ': '));
        node.appendChild(el('b', null, String(p)));
        node.appendChild(document.createTextNode(' mm'));
      } else {
        node.appendChild(document.createTextNode(t('pitch.none')));
      }
    },

    renderGasPipeTable() {
      const wrap = $('#gasPipeTableWrap');
      if (!wrap) return;
      const selectedSize = parseInt($('#gasPipePreset')?.value, 10);
      const row = GAS_PIPE_TABLE.find((item) => item.size === selectedSize) || GAS_PIPE_TABLE[0];
      if (!row) return;

      const thead = el('thead', null,
        el('tr', null,
          el('th', null, t('gas.col.size')),
          el('th', null, t('gas.col.flange')),
          el('th', null, t('gas.col.bolt_size')),
          el('th', null, t('gas.col.formula')),
          el('th', null, t('gas.col.theoretical')),
          el('th', null, t('gas.col.recommended'))
        )
      );
      const tbody = el('tbody', null,
        el('tr', null,
          el('td', null, `${row.size}A`),
          el('td', null, `${row.flangeThickness} mm`),
          el('td', null, row.boltSize),
          el('td', null, row.formula),
          el('td', null, `${row.theoreticalLength} mm`),
          el('td', null, `${row.recommendedLength} mm`)
        )
      );

      wrap.textContent = '';
      wrap.appendChild(el('div', { class: 'gas-note' }, t('gas.desc')));
      wrap.appendChild(el('div', { class: 'gas-rule' }, t('gas.rule')));
      wrap.appendChild(el('div', { class: 'gas-note gas-note-sub' }, t('gas.help')));
      wrap.appendChild(el('div', { class: 'gas-table-scroll' },
        el('table', { class: 'res-flat-table gas-pipe-table' }, thead, tbody)
      ));
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

      qCount.textContent = t('unit.count', { n: queue.length });

      // Cart FAB badge
      const cartBadge = $('#cartFabBadge');
      if (cartBadge) {
        if (queue.length > 0) {
          cartBadge.textContent = String(queue.length);
          cartBadge.hidden = false;
          cartBadge.classList.add('pop');
          setTimeout(() => cartBadge.classList.remove('pop'), 220);
        } else {
          cartBadge.hidden = true;
        }
      }

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
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 64 64');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '2.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        for (const d of [
          'M12 22h40l-4 28a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4l-4-28z',
          'M22 22V14a10 10 0 0 1 20 0v8'
        ]) {
          const p = document.createElementNS(SVG_NS, 'path');
          p.setAttribute('d', d);
          svg.appendChild(p);
        }
        const empty = el('div', { class: 'empty-state' });
        empty.appendChild(svg);
        empty.appendChild(el('strong', null, t('q.empty_t')));
        empty.appendChild(el('span', null, t('q.empty_d')));
        tb.appendChild(empty);
        this.updateUndoRedoButtons();
        return;
      }

      queue.forEach((q, i) => tb.appendChild(this.renderQueueItem(q, i)));
      tb.scrollTop = tb.scrollHeight;
      this.updateUndoRedoButtons();
    },

    /** Render read-only cart drawer content. */
    renderCartModal() {
      const body = $('#cartDrawerBody');
      if (!body) return;
      body.textContent = '';
      const queue = Store.queue;
      if (!queue.length) {
        body.appendChild(el('p', { style: 'text-align:center;color:var(--c-text-sub);padding:24px 0;', 'data-i18n': 'cart.empty' }, t('cart.empty')));
        return;
      }
      queue.forEach((q, i) => {
        let title = '', desc = '';
        if (q.type === 'bolt') {
          title = `${q.r} ${q.s}A ${t('q.flange')}`;
          desc  = t('q.bolt_desc', { bS: q.bS, bL: q.bL, bC: q.bC });
        } else if (q.type === 'gasket') {
          title = `${q.r} ${q.s}A ${t('q.gasket')}`;
          desc  = Lang.tGType(q.gtype);
        } else if (q.type === 'ubolt') {
          title = `${t('q.ubolt')} ${q.s}A`;
          const p = UBOLT_PITCH[q.s];
          desc  = p ? t('q.pitch_known', { p }) : t('q.pitch_unknown');
        }
        const delBtn = el('button', {
          class: 'cart-item-ro-del', type: 'button',
          'data-action': 'cart-del', 'data-index': String(i),
          title: t('q.del_title'), 'aria-label': t('q.del')
        }, '✕');
        const row = el('div', { class: 'cart-item-ro' },
          el('div', { class: 'cart-item-ro-info' },
            el('div', { class: 'cart-item-ro-title' }, title),
            desc ? el('div', { class: 'cart-item-ro-desc' }, desc) : null
          ),
          el('span', { class: 'cart-item-ro-qty' }, '× ' + q.qty),
          delBtn
        );
        body.appendChild(row);
      });
    },

    /** Render one queue row (XSS-safe). */
    renderQueueItem(q, i) {
      let title = '';
      const tags = [];

      if (q.type === 'bolt') {
        title = `${q.r} ${q.s}A`;
        if (q.ext) tags.push({ label: '+5mm', kind: 'blue' });
        if (q.doubleNut) tags.push({ label: t('q.tag_dn'), kind: 'blue' });
      } else if (q.type === 'gasket') {
        title = `${q.r} ${q.s}A ${t('q.gasket')}`;
      } else if (q.type === 'ubolt') {
        title = `${t('q.ubolt')} ${q.s}A`;
        const p = UBOLT_PITCH[q.s];
        if (!p) tags.push({ label: t('q.tag_pitch_unknown'), kind: 'warn' });
      }

      const titleNode = el('div', { class: 'q-title' },
        el('span', { class: 'q-title-text' }, title)
      );

      const tagsRow = tags.length
        ? el('div', { class: 'q-tags' }, ...tags.map(tg => el('span', { class: 'q-tag ' + (tg.kind || '') }, tg.label)))
        : null;

      const stepper = el('div', { class: 'q-mini-stepper', role: 'group', 'aria-label': t('q.qty_aria') },
        el('button', { type: 'button', 'data-action': 'q-qty-dec', 'data-index': i, 'aria-label': t('q.qty_dec') }, '−'),
        el('input', { type: 'number', value: q.qty, min: '1', inputmode: 'numeric', 'data-action': 'q-qty-set', 'data-index': i, 'aria-label': t('q.qty_in_aria') }),
        el('button', { type: 'button', 'data-action': 'q-qty-inc', 'data-index': i, 'aria-label': t('q.qty_inc') }, '+')
      );

      const actions = el('div', { class: 'q-actions' },
        stepper,
        el('button', { class: 'icon-btn', 'data-action': 'q-del', 'data-index': i, title: t('q.del_title'), 'aria-label': t('q.del') }, '✕')
      );

      return el('div',
        { class: 'q-item', draggable: 'true', 'data-index': i, tabindex: '0',
          'aria-label': t('q.aria_label', { title, n: q.qty }),
          'aria-keyshortcuts': 'Delete' },
        el('div', { class: 'q-item-main' },
          el('div', { class: 'q-handle', 'aria-hidden': 'true' }, '⋮⋮'),
          el('div', { class: 'q-info' }, titleNode, tagsRow)
        ),
        actions
      );
    },

    updateUndoRedoButtons() {
      const u = $('#btnUndo'); if (u) u.disabled = !Store.canUndo();
      const r = $('#btnRedo'); if (r) r.disabled = !Store.canRedo();
    },

    /** Render result panel. */
    renderResult(agg, memo) {
      const card = $('#resultCard');
      const placeholder = $('#resultPlaceholder');
      placeholder.style.display = 'none';
      card.textContent = '';
      card.classList.add('show');

      const head = el('div', { class: 'res-head' },
        el('h2', null, t('r.title'))
      );
      card.appendChild(head);

      card.appendChild(this._flatList(agg));

      if (memo && memo.trim()) {
        const memoBox = el('div', { style: 'margin-top:12px;' },
          el('div', { style: 'font-size:.82rem;font-weight:700;color:var(--c-text-sub);margin-bottom:6px;' }, t('r.memo_title')),
          el('div', { style: 'background:var(--c-surface-2);padding:12px;border:1px solid var(--c-border);border-radius:var(--r-md);white-space:pre-wrap;font-size:.85rem;line-height:1.55;' }, memo.trim())
        );
        card.appendChild(memoBox);
      }

      const totalCount = agg.sB.reduce((s, [, v]) => s + v, 0)
                       + agg.sN.reduce((s, [, v]) => s + v, 0)
                       + agg.sG.reduce((s, [, v]) => s + v, 0)
                       + agg.sU.reduce((s, [, v]) => s + v, 0);
      const totalNode = el('span', null, '0');
      const noticeParts = t('r.notice_total', { n: '\u0001' }).split('\u0001');
      const notice = el('div', { class: 'notice' },
        el('b', null, t('r.notice_pre')),
        document.createTextNode(noticeParts[0] || ''), totalNode,
        document.createTextNode(noticeParts[1] || '')
      );
      card.appendChild(notice);
      countUp(totalNode, totalCount, 600);

      // Action strip (copy / save-image)
      const strip = el('div', { class: 'res-action-strip' },
        el('button', { class: 'btn btn-sm btn-secondary', 'data-action': 'copy-result', title: 'Ctrl+C' }, t('r.copy')),
        el('button', { class: 'btn btn-sm btn-ghost', 'data-action': 'save-image' }, t('r.save_image'))
      );
      card.appendChild(strip);

      // Scroll into view (mobile)
      if (window.matchMedia('(max-width: 1199px)').matches) {
        smoothScrollIntoView(card, { block: 'start' });
      }
    },

    /** Build a single flat table listing every item across all categories. */
    _flatList(agg) {
      const thead = el('thead', null,
        el('tr', null,
          el('th', null, t('r.col_cat')),
          el('th', { style: 'text-align:left;' }, t('r.col_spec')),
          el('th', null, t('r.col_qty'))
        )
      );
      const tbody = el('tbody');

      const sections = [
        { cat: 'bolt', rows: agg.sB, unit: t('x.unit_ea') },
        { cat: 'nut',  rows: agg.sN, unit: t('x.unit_ea') },
        { cat: 'gsk',  rows: agg.sG, unit: t('x.unit_sheet') },
        { cat: 'ub',   rows: agg.sU, unit: t('x.unit_set') },
      ];
      const catLabels = {
        bolt: t('r.tag_bolt'), nut: t('r.tag_nut'), gsk: t('r.tag_gsk'), ub: t('r.tag_ub')
      };

      let hasAny = false;
      for (const { cat, rows, unit } of sections) {
        for (const [k, v] of rows) {
          hasAny = true;
          let specCell;
          if (cat === 'ub') {
            const sNum = parseInt(k, 10);
            const p = UBOLT_PITCH[sNum];
            specCell = el('td', { class: 'spec-cell' },
              document.createTextNode(k),
              el('span', { class: 'spec-sub' }, p ? t('r.cc_pitch', { p }) : t('r.cc_unknown'))
            );
          } else {
            specCell = el('td', { class: 'spec-cell' }, k);
          }
          tbody.appendChild(el('tr', null,
            el('td', null, el('span', { class: `res-cat-tag res-cat-tag-${cat}` }, catLabels[cat])),
            specCell,
            el('td', null, el('b', null, v + ' ' + unit))
          ));
        }
      }

      if (!hasAny) {
        tbody.appendChild(el('tr', null,
          el('td', { colspan: '3', class: 'muted' }, t('r.no_rows'))
        ));
      }

      return el('div', { class: 'res-flat-wrapper' },
        el('table', { class: 'res-flat-table' }, thead, tbody)
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

  /** ----- Search (외경 역산) with debounce — tolerance 없이 가장 가까운 후보 표시 ----- */
  function findFlange() {
    const raw = $('#searchOD').value.trim();
    const target = parseFloat(raw);
    const res = $('#searchResult');
    res.textContent = '';
    res.classList.remove('show');
    if (raw === '') return;                                   // empty: hide silently
    if (!Number.isFinite(target) || target <= 0) {           // invalid: feedback
      res.classList.add('show');
      res.appendChild(el('div', { class: 'err' }, t('f.invalid')));
      return;
    }

    const sorted = FLANGE_OD_DATA
      .map(f => ({ ...f, diff: Math.abs(f.od - target) }))
      .sort((a, b) => a.diff - b.diff);

    res.classList.add('show');

    // ±OD_SEARCH_RANGE mm 이내 후보, 없으면 가장 가까운 5개
    const within = sorted.filter(f => f.diff <= OD_SEARCH_RANGE);
    const toShow = within.length > 0 ? within : sorted.slice(0, 5);

    if (within.length > 0) {
      res.appendChild(el('div', null,
        document.createTextNode(t('f.candidates', { target })),
        el('b', null, t('f.candidates_n', { n: within.length }))
      ));
    } else {
      res.appendChild(el('div', { class: 'err' },
        t('f.no_match', { d: sorted[0].diff })));
    }

    const list = el('div', { style: 'margin-top:6px;' });
    for (const m of toShow) {
      const diffSign = m.od > target ? '+' : '';
      const diffLabel = m.diff === 0 ? ' ✓' : ` (${diffSign}${(m.od - target).toFixed(0)}mm)`;
      list.appendChild(el('button', {
        class: 'badge-pill',
        type: 'button',
        'data-action': 'search-pick',
        'data-rating': m.r,
        'data-size': m.s,
        'aria-label': t('f.apply_aria', { r: m.r, s: m.s })
      }, `${m.r} ${m.s}A · ${m.od}mm${diffLabel}`));
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
      showDataWarn(t('t.no_data_bolt', { r, s }));
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
    toast(t('t.added', { n: Store.queue.length }));
  }

  function actionAddGasket() {
    const r = $('#grating').value;
    const s = parseInt($('#gsize').value, 10);
    const qty = toPosInt($('#gqty').value);
    const type = $('#gtype').value;
    const item = buildGasketItem(r, s, qty, type, false);
    if (!item) { toast(t('t.no_data_gsk', { r, s })); return; }
    Store.snapshot();
    Store.queue.push(item);
    $('#gqty').value = 1;
    Store.save();
    View.renderQueue();
    toast(t('t.added_g', { n: Store.queue.length }));
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
    toast(t('t.added_u', { n: Store.queue.length }));
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
      toast(t('t.no_items'));
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
        // Fallback for non-secure contexts (e.g. http://) or older browsers
        // where navigator.clipboard is unavailable. execCommand is deprecated
        // but remains the only synchronous copy path in those environments.
        const ta = document.createElement('textarea');
        ta.value = lastExportText;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(t('t.copy_ok'));
    } catch (e) {
      toast(t('t.copy_fail'));
    }
  }

  function actionExportCSV() {
    if (!lastExportCSV) { actionCalculate(); if (!lastExportCSV) return; }
    const projName = (Store.projects[Store.currentProject] || {}).name || 'export';
    const fname = `${sanitizeFilename(projName)}${t('x.fname_suffix')}.csv`;
    const blob = new Blob([lastExportCSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: fname });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(t('t.csv_dl'));
  }

  async function actionShareResult() {
    if (!lastExportText) { actionCalculate(); if (!lastExportText) return; }
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('x.share_title'),
          text: lastExportText
        });
      } catch (e) { /* user cancelled */ }
    } else {
      actionCopyResult();
      toast(t('t.share_unsupported'));
    }
  }

  function actionPrintResult() {
    if (!lastExportText) actionCalculate();
    window.print();
  }

  /** Save result as PNG image via canvas. */
  function actionSaveImage() {
    if (!lastExportText) { actionCalculate(); if (!lastExportText) return; }

    const isDark = document.documentElement.dataset.theme === 'dark';
    const bg      = isDark ? '#1a2035' : '#ffffff';
    const surface = isDark ? '#1e2b42' : '#f8fafc';
    const fg      = isDark ? '#e2e8f0' : '#1e293b';
    const fgSub   = isDark ? '#94a3b8' : '#64748b';
    const fgMute  = isDark ? '#475569'  : '#94a3b8';
    const border  = isDark ? '#2d3f5c' : '#e2e8f0';
    const primary = isDark ? '#60a5fa' : '#3b82f6';
    const success = isDark ? '#4ade80' : '#22c55e';

    const agg = aggregate(Store.queue);
    const allRows = [
      ...agg.sB.map(([k, v]) => [t('r.tag_bolt'), k, String(v)]),
      ...agg.sN.map(([k, v]) => [t('r.tag_nut'),  k, String(v)]),
      ...agg.sG.map(([k, v]) => [t('r.tag_gsk'),  k, String(v)]),
      ...agg.sU.map(([k, v]) => {
        const p = UBOLT_PITCH[parseInt(k, 10)];
        return [t('r.tag_ub'), k + (p ? ` (C-C ${p}mm)` : ''), String(v)];
      }),
    ];

    const projName = (Store.projects[Store.currentProject] || {}).name || '';
    const memo = Store.memo ? Store.memo.trim() : '';

    const pad   = 28;
    const cW    = 620;
    const rowH  = 38;
    const thH   = 40;
    const titleH = projName ? 68 : 48;
    const memoLines = memo ? memo.split('\n') : [];
    const memoH = memo ? 14 + memoLines.length * 20 + 20 : 0;
    const cH    = pad + titleH + thH + Math.max(allRows.length, 1) * rowH + memoH + 36 + pad;

    const dpr    = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    canvas.width  = cW * dpr;
    canvas.height = cH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const font = (w, sz) => `${w} ${sz}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const rRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    };

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cW, cH);

    // Title
    let y = pad;
    ctx.fillStyle = success;
    ctx.font = font('800', 17);
    ctx.fillText(t('r.title'), pad, y + 20);
    y += 26;
    if (projName) {
      ctx.fillStyle = fgSub;
      ctx.font = font('400', 12);
      ctx.fillText(projName, pad, y + 14);
      y += 20;
    }
    y += 10;

    // Table
    const tableTop = y;
    const tableH   = thH + Math.max(allRows.length, 1) * rowH;

    const colCatW  = 90;
    const colQtyW  = 70;
    const colSpecW = cW - pad * 2 - colCatW - colQtyW;
    const xCat  = pad;
    const xSpec = pad + colCatW;
    const xQty  = pad + colCatW + colSpecW;

    // Table outer border
    rRect(pad, tableTop, cW - pad * 2, tableH, 8);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    rRect(pad, tableTop, cW - pad * 2, tableH, 8);
    ctx.clip();

    // Header
    ctx.fillStyle = surface;
    ctx.fillRect(pad, tableTop, cW - pad * 2, thH);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, tableTop + thH); ctx.lineTo(xQty + colQtyW, tableTop + thH);
    ctx.stroke();
    ctx.fillStyle = fgSub;
    ctx.font = font('700', 10);
    ctx.textAlign = 'center';
    ctx.fillText(t('x.csv_cat').toUpperCase(),  xCat + colCatW / 2,   tableTop + thH / 2 + 4);
    ctx.textAlign = 'left';
    ctx.fillText(t('x.csv_spec').toUpperCase(), xSpec + 10,           tableTop + thH / 2 + 4);
    ctx.textAlign = 'right';
    ctx.fillText(t('x.csv_qty').toUpperCase(),  xQty  + colQtyW - 10, tableTop + thH / 2 + 4);
    ctx.textAlign = 'left';

    // Data rows
    if (allRows.length === 0) {
      ctx.fillStyle = fgMute;
      ctx.font = font('400', 12);
      ctx.textAlign = 'center';
      ctx.fillText(t('r.no_rows'), pad + (cW - pad * 2) / 2, tableTop + thH + rowH / 2 + 5);
      ctx.textAlign = 'left';
    } else {
      allRows.forEach(([cat, spec, qty], idx) => {
        const ry = tableTop + thH + idx * rowH;
        if (idx % 2 === 1) {
          ctx.fillStyle = isDark ? '#243050' : '#f8fafc';
          ctx.fillRect(pad, ry, cW - pad * 2, rowH);
        }
        if (idx < allRows.length - 1) {
          ctx.strokeStyle = border;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(pad, ry + rowH); ctx.lineTo(xQty + colQtyW, ry + rowH);
          ctx.stroke();
        }
        const cy = ry + rowH / 2 + 5;
        ctx.fillStyle = fgSub;
        ctx.font = font('600', 11);
        ctx.textAlign = 'center';
        ctx.fillText(cat, xCat + colCatW / 2, cy);
        ctx.fillStyle = fg;
        ctx.font = font('400', 13);
        ctx.textAlign = 'left';
        const maxSpecW = colSpecW - 20;
        let specText = spec;
        while (ctx.measureText(specText).width > maxSpecW && specText.length > 1) {
          specText = specText.slice(0, -1);
        }
        if (specText !== spec) specText += '…';
        ctx.fillText(specText, xSpec + 10, cy);
        ctx.fillStyle = primary;
        ctx.font = font('800', 14);
        ctx.textAlign = 'right';
        ctx.fillText(qty, xQty + colQtyW - 10, cy);
        ctx.textAlign = 'left';
      });
    }

    ctx.restore();

    y = tableTop + tableH;

    // Memo
    if (memo) {
      y += 14;
      ctx.fillStyle = fgSub;
      ctx.font = font('700', 11);
      ctx.fillText(t('r.memo_title'), pad, y);
      y += 18;
      ctx.fillStyle = fg;
      ctx.font = font('400', 12);
      for (const line of memoLines) {
        ctx.fillText(line, pad + 4, y);
        y += 20;
      }
    }

    // Footer date
    ctx.fillStyle = fgMute;
    ctx.font = font('400', 10);
    ctx.fillText(new Date().toLocaleDateString(), pad, cH - pad + 8);

    // Download
    canvas.toBlob((blob) => {
      if (!blob) { toast(t('t.copy_fail')); return; }
      const safe = sanitizeFilename(projName || 'result');
      const fname = `${safe}${t('x.fname_suffix')}.png`;
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: fname });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast(t('t.img_save'));
    }, 'image/png');
  }

  /** ----- Queue item actions ----- */
  function actionDeleteItem(i, afterDelete) {
    const node = $(`.q-item[data-index="${i}"]`);
    if (node) {
      node.classList.add('removing');
      setTimeout(() => {
        Store.snapshot();
        Store.queue.splice(i, 1);
        Store.save();
        View.renderQueue();
        if (afterDelete) afterDelete();
      }, 220);
    } else {
      Store.snapshot();
      Store.queue.splice(i, 1);
      Store.save();
      View.renderQueue();
      if (afterDelete) afterDelete();
    }
  }

  function actionDuplicateItem(i) {
    const item = Store.queue[i];
    if (!item) return;
    Store.snapshot();
    Store.queue.splice(i + 1, 0, clone(item));
    Store.save();
    View.renderQueue();
    toast(t('t.dup'));
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
          el('label', { for: 'editRating' }, t('form.rating')),
          (() => {
            const sel = el('select', { id: 'editRating' });
            ['5K', '10K', '16K', '30K'].forEach(r => sel.appendChild(el('option', { value: r, selected: r === item.r ? true : null }, r)));
            return sel;
          })()
        ),
        el('div', { class: 'field' },
          el('label', { for: 'editSize' }, t('form.size')),
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
          el('span', { class: 'toggle-title' }, t('opt.ext')),
          el('label', { class: 'switch' },
            el('input', { type: 'checkbox', id: 'editExt', checked: item.ext ? true : null }),
            el('span', { class: 'slider' })
          )
        ),
        el('div', { class: 'toggle-row' },
          el('span', { class: 'toggle-title' }, t('edit.dn')),
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
          el('label', { for: 'editGRating' }, t('form.rating')),
          (() => {
            const sel = el('select', { id: 'editGRating' });
            ['5K','10K','16K','30K'].forEach(r => sel.appendChild(el('option', { value: r, selected: r === item.r ? true : null }, r)));
            return sel;
          })()
        ),
        el('div', { class: 'field' },
          el('label', { for: 'editGSize' }, t('form.size')),
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
          el('label', { for: 'editGType' }, t('form.gtype')),
          (() => {
            const sel = el('select', { id: 'editGType' });
            ['일반','논레이어','그라파이트','메탈','풀페이스'].forEach(g =>
              sel.appendChild(el('option', { value: g, selected: g === item.gtype ? true : null }, Lang.tGType(g))));
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
      const gtype = $('#editGType').value;
      const newItem = buildGasketItem(r, s, item.qty, gtype, item.auto);
      if (newItem) Store.queue[i] = newItem;
    }
    Store.save();
    View.renderQueue();
    ModalCtl.close($('#editModal'));
    toast(t('t.saved'));
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
    const name = window.prompt(t('p.proj_new_q'), t('p.proj_new_def'));
    if (!name) return;
    Store.addProject(name.trim());
    View.syncForm();
    View.resetResult();
    View.renderQueue();
  }

  function actionProjectRename() {
    const cur = Store.current;
    const name = window.prompt(t('p.proj_rename_q'), cur.name);
    if (!name) return;
    Store.renameProject(Store.currentProject, name.trim());
    View.populateProjectSelect($('#projectSelect'));
  }

  function actionProjectDelete() {
    if (Object.keys(Store.projects).length <= 1) {
      toast(t('t.last_proj'));
      return;
    }
    if (!window.confirm(t('p.proj_del_q', { name: Store.current.name }))) return;
    Store.deleteProject(Store.currentProject);
    View.syncForm();
    View.resetResult();
    View.renderQueue();
    toast(t('t.proj_deleted'));
  }

  /** ----- Theme ----- */
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    // Theme is intentionally NOT persisted — only language setting is saved.
    const btn = $('#btnTheme');
    btn.textContent = mode === 'dark' ? '☀️' : mode === 'light' ? '🌙' : '🌗';
    const modeName = mode === 'auto' ? t('t.theme_auto') : mode === 'dark' ? t('t.theme_dark') : t('t.theme_light');
    btn.title = t('pick.theme_title', { mode: modeName });
  }
  function actionToggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    applyTheme(next);
    const nextName = next === 'auto' ? t('t.theme_auto') : next === 'dark' ? t('t.theme_dark') : t('t.theme_light');
    toast(t('t.theme_changed', { mode: nextName }));
  }

  /** ----- Tutorial ----- */
  function maybeShowTutorial() {
    let seen = false;
    try { seen = localStorage.getItem(TUTORIAL_KEY) === 'true'; } catch (e) {}
    if (!seen) {
      ModalCtl.open($('#tutorialModal'));
    }
  }
  function closeTutorial() {
    if ($('#chkHideTutorial').checked) {
      try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (e) {}
    }
    ModalCtl.close($('#tutorialModal'));
  }

  const DEFAULT_MEASURE_GUIDE = 'flange-od';
  const MEASURE_GUIDES = {
    'flange-od': {
      titleKey: 'guide.flange_od_title',
      panelId: 'guidePanelFlangeOd'
    },
    'ubolt-pitch': {
      titleKey: 'guide.ubolt_pitch_title',
      panelId: 'guidePanelUboltPitch'
    }
  };

  function actionOpenMeasureGuide(kind) {
    const guide = MEASURE_GUIDES[kind] || MEASURE_GUIDES[DEFAULT_MEASURE_GUIDE];
    $('#measureGuideTitle').textContent = t(guide.titleKey);
    $$('#measureGuideBody [data-guide-panel]').forEach(panel => {
      panel.hidden = panel.id !== guide.panelId;
    });
    ModalCtl.open($('#measureGuideModal'));
  }

  /** ----- Action router (event delegation) ----- */
  const actions = {
    'find-flange':       () => findFlange(),
    'search-pick':       (el2) => {
      const r = el2.dataset.rating, s = parseInt(el2.dataset.size, 10);
      $('#rating').value = r; View.populateSizeSelect($('#size'), r);
      $('#size').value = s;
      smoothScrollIntoView($('#size'), { block: 'center' });
      $('#size').focus();
      toast(t('t.applied', { r, s }));
    },
    'rating-change':     () => View.populateSizeSelect($('#size'), $('#rating').value),
    'grating-change':    () => View.populateSizeSelect($('#gsize'), $('#grating').value),
    'usize-change':      () => View.updatePitchInfo(parseInt($('#usize').value, 10)),
    'gas-preset-change': () => View.renderGasPipeTable(),
    'qty-inc':           (el2) => { const inp = $('#' + el2.dataset.target); inp.value = toPosInt(inp.value) + 1; },
    'qty-dec':           (el2) => { const inp = $('#' + el2.dataset.target); inp.value = Math.max(1, toPosInt(inp.value) - 1); },
    'add-bolt':          actionAddBolt,
    'add-gasket':        actionAddGasket,
    'add-ubolt':         actionAddUbolt,
    'calculate':         actionCalculate,
    'clear-all':         () => {
      if (Store.queue.length && !window.confirm(t('p.clear_confirm'))) return;
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
    'cart-del':          (el2) => actionDeleteItem(+el2.dataset.index, () => View.renderCartModal()),
    'copy-result':       actionCopyResult,
    'save-image':        actionSaveImage,
    'share-result':      actionShareResult,
    'print-result':      actionPrintResult,
    'undo':              () => { if (Store.undo()) { Store.save(); View.renderQueue(); toast(t('t.undo')); } },
    'redo':              () => { if (Store.redo()) { Store.save(); View.renderQueue(); toast(t('t.redo')); } },
    'theme-toggle':      actionToggleTheme,
    'open-measure-guide':(el2) => actionOpenMeasureGuide(el2.dataset.guide),
    'close-measure-guide':() => ModalCtl.close($('#measureGuideModal')),
    'open-tutorial':     () => ModalCtl.open($('#tutorialModal')),
    'close-tutorial':    closeTutorial,
    'open-cart':         () => { View.renderCartModal(); ModalCtl.open($('#cartModal')); },
    'close-cart':        () => { ModalCtl.close($('#cartModal')); },
    'cart-calculate':    () => { ModalCtl.close($('#cartModal')); actionCalculate(); },
    'project-change':    () => { const s = $('#projectSelect'); if (s) actionProjectChange(s.value); },
    'project-new':       actionProjectNew,
    'project-rename':    actionProjectRename,
    'project-delete':    actionProjectDelete,
    'edit-save':         actionSaveEdit,
    'edit-cancel':       () => ModalCtl.close($('#editModal')),
    'install-app':       () => triggerInstall(),
    'install-dismiss':   () => { $('#installBanner').classList.remove('show'); try { localStorage.setItem('jis-install-dismissed','1'); } catch (e) {} },
    'lang-change':       (el2) => actionLangChange(el2.value || el2.dataset.lang),
    'lang-pick':         (el2) => actionLangChange(el2.dataset.lang),
    'acc-toggle':        (el2) => {
      const body = document.getElementById(el2.getAttribute('aria-controls'));
      if (!body) return;
      const willOpen = el2.getAttribute('aria-expanded') !== 'true';
      el2.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) {
        body.removeAttribute('aria-hidden');
        body.removeAttribute('inert');
      } else {
        body.setAttribute('aria-hidden', 'true');
        body.setAttribute('inert', '');
      }
      // Focus the first input when opening for accessibility
      if (willOpen) {
        const first = body.querySelector('input, select, textarea');
        if (first) requestAnimationFrame(() => first.focus({ preventScroll: false }));
      }
    }
  };

  /**
   * Switch UI language.
   * @param {string} lang
   */
  function actionLangChange(lang) {
    if (!lang || !I18N[lang] || lang === Lang.current) return;
    Lang.set(lang);
    applyI18n();
    // Re-render dynamic UI that uses translations at build-time
    View.populateSizeSelect($('#size'),  $('#rating').value);
    View.populateSizeSelect($('#gsize'), $('#grating').value);
    View.populateUSizeSelect($('#usize'));
    View.populateGasPipePresetSelect($('#gasPipePreset'));
    View.updatePitchInfo(parseInt($('#usize').value, 10));
    View.renderGasPipeTable();
    View.populateProjectSelect($('#projectSelect'));
    View.renderQueue();
    // Re-render result if currently shown
    if ($('#resultCard').children.length) {
      const agg = aggregate(Store.queue);
      const total = agg.sB.length + agg.sN.length + agg.sG.length + agg.sU.length;
      if (total) View.renderResult(agg, Store.memo);
    }
    // Sync language selects (header + tutorial)
    document.querySelectorAll('select[data-action="lang-change"]').forEach(s => { s.value = lang; });
    document.querySelectorAll('[data-action="lang-pick"]').forEach(b => {
      b.classList.toggle('active', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', b.dataset.lang === lang ? 'true' : 'false');
    });
    // Re-localize bottom install CTA button label & per-platform hint
    reflectInstalledState();
    // Update theme button title (uses i18n)
    let savedTh = 'auto';
    try { savedTh = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) {}
    applyTheme(savedTh);
    // Toast in new language
    const meta = SUPPORTED_LANGS.find(l => l.code === lang);
    toast(t('t.lang_changed', { name: (meta ? meta.flag + ' ' + meta.native : lang) }));
  }

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
      if (name === 'project-change' || name === 'rating-change' || name === 'grating-change' || name === 'usize-change' || name === 'lang-change' || name === 'gas-preset-change') {
        actions[name](target, e);
      }
      if (name === 'q-qty-set') {
        actionUpdateQty(+target.dataset.index, 0, target.value);
      }
    });

    // Search debounced
    $('#searchOD').addEventListener('input', debouncedFindFlange);

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
      // Guard: acc-head 버튼 자체에 포커스된 경우 Enter는 toggle 동작에 위임
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !inEditable) {
        if (e.target.classList.contains('acc-head')) return;
        if (e.target.closest('.measure-help-btn')) return;
        const card = e.target.closest('.card');
        if (card) {
          // Only trigger if the accordion body is open (not inert/hidden)
          const body = card.querySelector('.acc-body');
          if (body && body.hasAttribute('inert')) return;
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
          const body = card.querySelector('.acc-body');
          if (body && body.hasAttribute('inert')) return;
          if (card.querySelector('[data-action="add-bolt"]')) { e.preventDefault(); actionAddBolt(); }
          else if (card.querySelector('[data-action="add-gasket"]')) { e.preventDefault(); actionAddGasket(); }
          else if (card.querySelector('[data-action="add-ubolt"]')) { e.preventDefault(); actionAddUbolt(); }
          else if (card.querySelector('[data-action="find-flange"]')) { e.preventDefault(); findFlange(); }
        }
      }

      // Delete on focused queue item → delete (Backspace excluded to avoid back-nav conflict)
      if (e.key === 'Delete' && document.activeElement && document.activeElement.classList.contains('q-item')) {
        const idx = +document.activeElement.dataset.index;
        if (Number.isFinite(idx)) { e.preventDefault(); actionDeleteItem(idx); }
      }
    });

    // Modal backdrop close
    [$('#editModal'), $('#measureGuideModal'), $('#tutorialModal'), $('#cartModal')].forEach(m => {
      m.addEventListener('click', (e) => {
        if (e.target === m) {
          if (m.id === 'tutorialModal') closeTutorial();
          else if (m.id === 'measureGuideModal') ModalCtl.close($('#measureGuideModal'));
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
  const MSG_ADDED_HOME = '🏠 홈 화면에 추가되었습니다!';

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // Don't register on file:// or non-http(s)
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          reg.update().catch(() => { /* offline */ });
          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });
        })
        .catch(() => { /* offline / unsupported */ });
    });
  }

  /**
   * iOS Safari에서 가상 키보드가 올라오면 window.innerHeight가 줄어들지 않아
   * fixed position 요소(floating-bar 등)가 키보드에 덮입니다.
   * visualViewport API를 사용해 floating-bar의 bottom offset을 보정합니다.
   */
  function bindVisualViewport() {
    if (!window.visualViewport) return;
    const floatingBar = $('#floatingBar');
    if (!floatingBar) return;

    function onViewportChange() {
      const vv = window.visualViewport;
      // 키보드가 올라왔을 때: layoutViewport 높이 - visualViewport 높이 - visualViewport offsetTop
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (keyboardHeight > 0) {
        // 키보드만큼 위로 올려서 floating-bar가 키보드 위에 표시되도록
        floatingBar.style.setProperty('--kb-offset', keyboardHeight + 'px');
      } else {
        floatingBar.style.removeProperty('--kb-offset');
      }
    }

    window.visualViewport.addEventListener('resize', onViewportChange);
    window.visualViewport.addEventListener('scroll', onViewportChange);
  }

  function bindInstallBanner() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      // Reveal the bottom CTA now that prompting is actually possible (Chromium).
      reflectInstalledState();
      try {
        if (localStorage.getItem('jis-install-dismissed') === '1') return;
      } catch (err) {}
      $('#installBanner').classList.add('show');
    });
    window.addEventListener('appinstalled', () => {
      $('#installBanner').classList.remove('show');
      deferredInstallPrompt = null;
      reflectInstalledState();
      toast(MSG_ADDED_HOME);
    });
  }

  /** Detects standalone (PWA-installed) mode. */
  function isAppInstalled() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: window-controls-overlay)').matches) return true;
    } catch (e) {}
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  /** Coarse iOS detection (incl. iPadOS reporting as Mac with touch). */
  function isIOSLike() {
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    if (ua.includes('Mac') && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  /**
   * Updates the bottom install CTA visibility and per-platform hint.
   * - Hidden when the app is already installed (standalone display-mode).
   * - On iOS/iPadOS Safari the install prompt API doesn't exist, so the CTA
   *   is always shown with iOS-specific instructions when not yet installed.
   * - On Chromium the CTA is shown only after `beforeinstallprompt` fired
   *   (so we don't tease users on browsers that can't actually install).
   */
  function reflectInstalledState() {
    const cta = $('#installCta');
    if (!cta) return;
    const installed = isAppInstalled();
    const ios = isIOSLike();
    const canPrompt = !!deferredInstallPrompt;
    // Visibility rules
    const visible = !installed && (canPrompt || ios);
    cta.hidden = !visible;
    if (!visible) return;
    // Per-platform hint
    const hint = $('#installCtaHint');
    if (hint) {
      const key = ios ? 'cta.install_hint_ios' : 'cta.install_hint_and';
      hint.setAttribute('data-i18n', key);
      hint.textContent = t(key);
    }
  }

  /**
   * iOS에서 "홈 화면에 추가" 단계별 가이드를 하단 슬라이드업 시트로 표시.
   */
  function showIOSInstallGuide() {
    if (document.getElementById('iosInstallGuide')) return;
    const overlay = document.createElement('div');
    overlay.id = 'iosInstallGuide';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '홈 화면에 추가 방법');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9100',
      'display:flex;align-items:flex-end;justify-content:center',
      'background:rgba(0,0,0,.52)'
    ].join(';');

    const sheet = document.createElement('div');
    sheet.style.cssText = [
      'background:var(--c-surface,#fff);color:var(--c-text,#111)',
      'width:100%;max-width:480px',
      'border-radius:20px 20px 0 0',
      'padding:24px 22px calc(28px + env(safe-area-inset-bottom))',
      'box-shadow:0 -4px 24px rgba(0,0,0,.18)',
      'font-family:inherit',
      'animation:_iosGuideUp .32s cubic-bezier(.34,1.56,.64,1)'
    ].join(';');

    const styleTag = document.createElement('style');
    styleTag.textContent = '@keyframes _iosGuideUp{from{transform:translateY(100%)}to{transform:none}}';
    sheet.appendChild(styleTag);

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:18px';

    const title = document.createElement('strong');
    title.style.cssText = 'font-size:1.05rem;flex:1';
    title.textContent = '📱 홈 화면에 추가하기';

    const closeBtn = document.createElement('button');
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.style.cssText = [
      'background:none;border:none;padding:4px 6px',
      'font-size:1.2rem;cursor:pointer;color:var(--c-text-mute,#888)',
      'border-radius:6px;line-height:1'
    ].join(';');
    closeBtn.textContent = '✕';

    header.appendChild(title);
    header.appendChild(closeBtn);
    sheet.appendChild(header);

    const steps = [
      ['①', ['화면 하단 ', '공유 버튼 ⎋', ' 을 탭해요']],
      ['②', ['"홈 화면에 추가"', ' 를 찾아 탭해요']],
      ['③', ['오른쪽 위 ', '"추가"', ' 를 탭하면 완료! 🎉']]
    ];
    const ol = document.createElement('ol');
    ol.style.cssText = 'margin:0 0 18px;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px';
    steps.forEach(([num, parts]) => {
      const li = document.createElement('li');
      li.style.cssText = 'display:flex;align-items:flex-start;gap:12px;font-size:.95rem;line-height:1.5';
      const badge = document.createElement('span');
      badge.style.cssText = [
        'flex-shrink:0;width:28px;height:28px;border-radius:50%',
        'background:var(--c-primary,#2563eb);color:#fff',
        'display:flex;align-items:center;justify-content:center',
        'font-size:.8rem;font-weight:800;margin-top:1px'
      ].join(';');
      badge.textContent = num;
      const text = document.createElement('span');
      // Odd indices are bold, even indices are plain text
      parts.forEach((part, i) => {
        if (i % 2 === 1) {
          const strong = document.createElement('strong');
          strong.textContent = part;
          text.appendChild(strong);
        } else {
          text.appendChild(document.createTextNode(part));
        }
      });
      li.appendChild(badge);
      li.appendChild(text);
      ol.appendChild(li);
    });
    sheet.appendChild(ol);

    const note = document.createElement('div');
    note.style.cssText = [
      'background:var(--c-surface-2,#f4f4f4);border-radius:10px',
      'padding:10px 14px;font-size:.82rem',
      'color:var(--c-text-sub,#555);display:flex;align-items:center;gap:8px'
    ].join(';');
    const noteIcon = document.createElement('span');
    noteIcon.textContent = 'ℹ️';
    const noteText = document.createElement('span');
    noteText.textContent = 'Safari 브라우저에서만 홈 화면 추가가 가능합니다.';
    note.appendChild(noteIcon);
    note.appendChild(noteText);
    sheet.appendChild(note);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }

  async function triggerInstall() {
    if (!deferredInstallPrompt) {
      if (isIOSLike()) {
        showIOSInstallGuide();
      } else {
        toast(t('t.install_ios'));
      }
      return;
    }
    try {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      if (result && result.outcome === 'accepted') {
        toast(MSG_ADDED_HOME);
      }
    } catch (e) {}
    deferredInstallPrompt = null;
    $('#installBanner').classList.remove('show');
    reflectInstalledState();
  }

  /* =====================================================================
     §8. INIT
     ===================================================================== */

  function init() {
    // Language (must run BEFORE any UI text is built, so default project name etc.
    // are localized correctly).
    Lang.set(Lang.detect());
    applyI18n();

    // Theme (always start fresh — not persisted)
    applyTheme('auto');

    // Store is intentionally NOT loaded — app always starts with a fresh state.
    // Only language preference is persisted across sessions.

    // Populate selects
    View.populateSizeSelect($('#size'), $('#rating').value);
    View.populateSizeSelect($('#gsize'), $('#grating').value);
    View.populateUSizeSelect($('#usize'));
    View.populateGasPipePresetSelect($('#gasPipePreset'));
    View.updatePitchInfo(parseInt($('#usize').value, 10));
    View.renderGasPipeTable();
    View.populateProjectSelect($('#projectSelect'));

    // Sync language UI to current selection
    document.querySelectorAll('select[data-action="lang-change"]').forEach(s => { s.value = Lang.current; });
    document.querySelectorAll('[data-action="lang-pick"]').forEach(b => {
      const active = b.dataset.lang === Lang.current;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Sync form values from store
    $('#memoInput').value = Store.memo || '';

    // Render
    View.renderQueue();

    // Events
    bindGlobalEvents();

    // Tutorial
    setTimeout(maybeShowTutorial, 200);

    // PWA
    registerSW();
    bindInstallBanner();
    reflectInstalledState();

    // iOS Safari: 가상 키보드가 올라올 때 floating-bar가 키보드에 가리지 않도록 보정
    bindVisualViewport();

    // Visitor counter
    initVisitorCounter();

    // Bulletin board
    initBoard();

    // KMA temperature alert
    initTempAlert();
  }

  function initVisitorCounter() {
    const today = new Date().toISOString().slice(0, 10);
    const key = 'visitor_' + today;
    let count = 0;
    try {
      if (!sessionStorage.getItem('jis-visited-' + today)) {
        sessionStorage.setItem('jis-visited-' + today, '1');
        count = (parseInt(localStorage.getItem(key) || '0', 10) || 0) + 1;
        localStorage.setItem(key, String(count));
      } else {
        count = parseInt(localStorage.getItem(key) || '0', 10) || 0;
      }
    } catch (e) { /* storage unavailable (e.g. in-app browser) */ }
    $('#visitorCount').textContent = count;

    const btn  = $('#visitorToggle');
    const wrap = $('#visitorCountWrap');
    if (btn && wrap) {
      btn.addEventListener('click', () => {
        const shown = !wrap.hidden;
        wrap.hidden = shown;
        btn.setAttribute('aria-expanded', String(!shown));
      });
    }
  }

  /* =====================================================================
     §10. POST BOARD (게시판)
     - Firestore 전용 온라인 게시판 (Firebase Web SDK v12 Modular)
     - 컬렉션: posts / 필드: title, content, authorId, createdAt, password
     ===================================================================== */

  const POSTS_COL = 'posts';          // Firestore 컬렉션 이름

  const Board = {
    fmtDate(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    /* ── Firestore 경로 헬퍼 ── */
    _col()       { return window._fbFS.collection(window._fbDb, POSTS_COL); },
    _doc(postId) { return window._fbFS.doc(window._fbDb, POSTS_COL, postId); },

    /* ------------------------------------------------------------------
     * load() — 게시글 목록을 최신순으로 반환
     * 5초 타임아웃: Firestore 연결이 응답 없이 대기하는 경우를 방지.
     * ------------------------------------------------------------------ */
    async load() {
      const { getDocs, query, orderBy } = window._fbFS;
      const fetchSnap = getDocs(query(this._col(), orderBy('createdAt', 'desc')));
      const timeout   = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore 응답 시간 초과')), FIRESTORE_TIMEOUT_MS)
      );
      const snap = await Promise.race([fetchSnap, timeout]);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    /* ------------------------------------------------------------------
     * addPost() — 새 게시글 등록
     * ------------------------------------------------------------------ */
    async addPost(title, content, password) {
      await window._fbFS.addDoc(this._col(), {
        title,
        content,
        authorId:  'anonymous_user',
        createdAt: new Date().toISOString(),
        password
      });
    },

    /* ------------------------------------------------------------------
     * deletePost() — 비밀번호 확인 후 게시글 삭제
     * ------------------------------------------------------------------ */
    async deletePost(postId, password) {
      const MASTER_PW = '5867';
      const ref  = this._doc(postId);
      const snap = await window._fbFS.getDoc(ref);
      if (!snap.exists()) return false;
      if (snap.data().password !== password && password !== MASTER_PW) return false;
      await window._fbFS.deleteDoc(ref);
      return true;
    }
  };

  async function renderBoardModal() {
    const body = $('#boardBody');
    if (!body) return;
    body.textContent = '';

    // ── 서버 연결 상태 표시기 ──────────────────────────────────────────────
    const statusEl = $('#boardStatus');
    function setStatus(state, label) {
      if (!statusEl) return;
      statusEl.className = `board-status board-status--${state}`;
      statusEl.textContent = label;
    }
    setStatus('checking', '확인 중');

    // ── Firebase 초기화 여부 확인 ───────────────────────────────────────────
    if (!window._fbDb || !window._fbFS) {
      setStatus('offline', '서버 연결 안됨');
      body.appendChild(el('p', { class: 'board-empty' }, '❌ Firebase가 초기화되지 않았습니다. 새로고침 후 다시 시도해주세요.'));
      return;
    }

    // ── KakaoTalk 인앱 브라우저: Firestore 연결 불가 안내 ──────────────────
    if (/KAKAOTALK/i.test(navigator.userAgent)) {
      setStatus('offline', '외부 브라우저 필요');
      const isAndroid = /Android/i.test(navigator.userAgent);
      const msgDiv = el('div', { class: 'board-empty', style: 'line-height:1.9;text-align:center' });
      msgDiv.appendChild(document.createTextNode('📱 카카오톡 브라우저에서는 게시판 서버에 연결할 수 없습니다.'));
      msgDiv.appendChild(el('br'));
      if (isAndroid) {
        const intentUrl = 'intent://' + location.host + location.pathname + location.search
          + '#Intent;scheme=' + location.protocol.replace(':', '')
          + ';package=com.android.chrome'
          + ';S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end';
        const link = el('a', {
          href: intentUrl,
          style: 'font-weight:700;color:var(--c-primary);text-decoration:underline'
        }, '📲 크롬으로 열기');
        msgDiv.appendChild(link);
        msgDiv.appendChild(document.createTextNode(' 또는 우측 상단 ··· → 다른 브라우저로 열기'));
      } else {
        msgDiv.appendChild(document.createTextNode('우측 상단 ··· → 다른 브라우저로 열기를 눌러 사파리/크롬에서 이용해주세요.'));
      }
      body.appendChild(msgDiv);
      return;
    }

    // 예상치 못한 예외가 발생해도 상태 표시기가 "확인 중"에 고착되지 않도록 감싸기
    try {

    // ── Write form ─────────────────────────────────────────────────────
    const writeSection   = el('div', { class: 'board-write-section' });
    const writeToggleBtn = el('button', { class: 'btn btn-primary board-write-toggle', type: 'button' }, '✏️ 글 작성');
    const writeForm      = el('div', { class: 'board-write-form' });

    const titleInput   = el('input',    { type: 'text',     placeholder: '제목',            maxlength: '100',  class: 'board-input',    'aria-label': '제목' });
    const contentInput = el('textarea', {                   placeholder: '내용을 입력하세요', maxlength: '5000', class: 'board-textarea', rows: '4', 'aria-label': '내용' });
    const pwInput      = el('input',    { type: 'password', placeholder: '삭제용 비밀번호 (4자 이상)', maxlength: '30', class: 'board-input', 'aria-label': '삭제용 비밀번호' });
    const submitBtn    = el('button',   { type: 'button',   class: 'btn btn-success' }, '등록');
    const cancelBtn    = el('button',   { type: 'button',   class: 'btn btn-ghost'   }, '취소');

    writeForm.append(titleInput, contentInput, pwInput, el('div', { class: 'board-btn-row' }, submitBtn, cancelBtn));

    writeToggleBtn.addEventListener('click', () => {
      const open = writeForm.classList.toggle('open');
      writeToggleBtn.textContent = open ? '접기' : '✏️ 글 작성';
      if (open) titleInput.focus();
    });

    submitBtn.addEventListener('click', async () => {
      const title    = titleInput.value.trim();
      const content  = contentInput.value.trim();
      const password = pwInput.value.trim();
      if (!title)            { toast('제목을 입력해주세요.');               titleInput.focus();   return; }
      if (!content)          { toast('내용을 입력해주세요.');               contentInput.focus(); return; }
      if (password.length < 4) { toast('비밀번호를 4자 이상 입력해주세요.'); pwInput.focus();      return; }
      submitBtn.disabled = true;
      submitBtn.textContent = '등록 중…';
      try {
        await Board.addPost(title, content, password);
        toast('게시글이 등록되었습니다.');
        await renderBoardModal();
      } catch (e) {
        toast('등록에 실패했습니다. 다시 시도해주세요.');
        submitBtn.disabled = false;
        submitBtn.textContent = '등록';
      }
    });

    cancelBtn.addEventListener('click', () => {
      writeForm.classList.remove('open');
      writeToggleBtn.textContent = '✏️ 글 작성';
    });

    writeSection.append(writeToggleBtn, writeForm);
    body.appendChild(writeSection);

    // ── Loading indicator ────────────────────────────────────────────────
    const loading = el('p', { class: 'board-empty' }, '⏳ 불러오는 중…');
    body.appendChild(loading);

    let posts;
    try {
      posts = await Board.load();
      setStatus('online', '서버 연결됨');
    } catch (e) {
      setStatus('offline', '서버 연결 안됨');
      const msg = e && e.message ? `(${e.message})` : '';
      loading.textContent = `❌ 게시글을 불러오지 못했습니다. 네트워크를 확인해주세요. ${msg}`;
      return;
    }
    loading.remove();

    if (!posts.length) {
      body.appendChild(el('p', { class: 'board-empty' }, '아직 등록된 게시글이 없습니다.'));
      return;
    }

    // ── Post rows ─────────────────────────────────────────────────────
    posts.forEach(p => {
      const wrap   = el('div', { class: 'cb-wrap' });
      const row    = el('div', { class: 'cb-row' });
      const delBtn = el('button', { class: 'icon-btn board-del', type: 'button', title: '게시글 삭제', 'aria-label': '게시글 삭제' }, '🗑');

      row.append(
        el('div', { class: 'cb-nick' }, p.title || '(제목 없음)'),
        el('div', { class: 'cb-body' },
          el('div', { class: 'cb-content' }, p.content),
          el('div', { class: 'cb-meta' }, Board.fmtDate(p.createdAt))
        ),
        delBtn
      );

      delBtn.addEventListener('click', () => {
        // 비밀번호 확인 인라인 팝업
        wrap.querySelectorAll('.board-pw-confirm').forEach(e => e.remove());
        const area  = el('div', { class: 'board-pw-confirm' });
        const input = el('input',  { type: 'password', placeholder: '삭제용 비밀번호 입력', class: 'board-input board-pw-input' });
        const okBtn = el('button', { type: 'button', class: 'btn btn-danger', style: 'width:auto;min-height:0;font-size:.8rem;padding:5px 10px;white-space:nowrap;flex-shrink:0;' }, '삭제');
        const noBtn = el('button', { type: 'button', class: 'btn btn-ghost',  style: 'width:auto;min-height:0;font-size:.8rem;padding:5px 10px;white-space:nowrap;flex-shrink:0;' }, '취소');
        okBtn.addEventListener('click', async () => {
          const pw = input.value.trim();
          if (!pw) { input.focus(); return; }
          try {
            if (await Board.deletePost(p.id, pw)) {
              toast('게시글이 삭제되었습니다.');
              await renderBoardModal();
            } else {
              toast('비밀번호가 일치하지 않습니다.');
            }
          } catch { toast('삭제에 실패했습니다. 다시 시도해주세요.'); }
        });
        noBtn.addEventListener('click', () => area.remove());
        area.appendChild(el('div', { class: 'board-pw-row' }, input, okBtn, noBtn));
        wrap.appendChild(area);
        input.focus();
      });

      wrap.appendChild(row);
      body.appendChild(wrap);
    });

    } catch (e) {
      // 예상치 못한 오류 → 상태를 "서버 연결 안됨"으로 변경
      setStatus('offline', '서버 연결 안됨');
      body.textContent = '';
      body.appendChild(el('p', { class: 'board-empty' }, '❌ 오류가 발생했습니다. 새로고침 후 다시 시도해주세요.'));
    }
  }

  function initBoard() {
    const toggleBtn = $('#boardToggle');
    const modal     = $('#boardModal');
    const closeBtn  = $('#boardClose');
    if (!toggleBtn || !modal) return;

    function openBoard() {
      renderBoardModal().catch((err) => console.error('Board modal error:', err));
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
    }
    function closeBoard() {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      toggleBtn.focus();
    }

    toggleBtn.addEventListener('click', openBoard);
    closeBtn && closeBtn.addEventListener('click', closeBoard);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeBoard(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('show')) closeBoard();
    });
  }

  /* =====================================================================
     §11. KMA TEMPERATURE ALERT — 기상청 AWS 온도 알림
     매일 12:03~12:15 에 기상청 294 관측소 분 데이터를 읽어
     28°C 이상이면 Web Notification 으로 폰에 알림.
     ===================================================================== */

  const KMA_AWS_URL = 'http://www.kma.go.kr/cgi-bin/aws/nph-aws_txt_min?0&0&mindb_01m&294&a';
  const KMA_AWS_FETCH_URL = 'https://corsproxy.io/?' + encodeURIComponent(KMA_AWS_URL);
  const KMA_ALERT_THRESHOLD = 28;
  const KMA_ALERT_START_MINUTES = 12 * 60 + 3;
  const KMA_ALERT_END_MINUTES = 12 * 60 + 15;
  const KMA_ALERT_TAG = 'kma-temp-alert';
  const KMA_CHECK_INTERVAL_MS = 60 * 1000;
  const KMA_FETCH_TIMEOUT_MS = 8000;
  const KMA_MIN_VALID_TEMP = -50;
  const KMA_MAX_VALID_TEMP = 60;

  let kmaAlertTimer = 0;
  let kmaAlertInFlight = false;
  let kmaAlertIconPromise = null;

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function getLocalDateKey(date = new Date()) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function getKmaAlertSessionKey(date = new Date()) {
    return `kma-alert-sent-${getLocalDateKey(date)}`;
  }

  function hasSentKmaAlertToday(date = new Date()) {
    try {
      return sessionStorage.getItem(getKmaAlertSessionKey(date)) === '1';
    } catch (e) {
      return false;
    }
  }

  function markKmaAlertSent(date = new Date()) {
    try {
      sessionStorage.setItem(getKmaAlertSessionKey(date), '1');
    } catch (e) {}
  }

  function isWithinKmaAlertWindow(date = new Date()) {
    const minutes = date.getHours() * 60 + date.getMinutes();
    return minutes >= KMA_ALERT_START_MINUTES && minutes <= KMA_ALERT_END_MINUTES;
  }

  function splitKmaLine(line) {
    return String(line || '')
      .trim()
      .split(/[,\s]+/)
      .map(token => token.trim())
      .filter(Boolean);
  }

  function normalizeKmaToken(token) {
    return String(token || '').toLowerCase().replace(/[^a-z가-힣]/g, '');
  }

  function coerceKmaTemperature(token) {
    const value = Number.parseFloat(String(token));
    return Number.isFinite(value) && value >= KMA_MIN_VALID_TEMP && value <= KMA_MAX_VALID_TEMP ? value : NaN;
  }

  function findKmaTemperatureColumn(lines) {
    const keywords = new Set(['ta', 'temp', 'temperature', 'airtemp', '기온']);
    for (const raw of lines) {
      if (!raw || raw[0] !== '#') continue;
      const tokens = splitKmaLine(raw.replace(/^#+\s*/, ''));
      const index = tokens.findIndex(token => keywords.has(normalizeKmaToken(token)));
      if (index !== -1) return index;
    }
    return -1;
  }

  function parseKmaTemperature(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      console.warn('KMA temperature alert parse failed: empty response');
      return NaN;
    }

    const dataLines = lines.filter(line => line && line[0] !== '#');
    if (!dataLines.length) {
      console.warn('KMA temperature alert parse failed: no data line found');
      return NaN;
    }

    let targetDataLine = '';
    let tokens = [];
    for (const line of dataLines) {
      const lineTokens = splitKmaLine(line);
      if (lineTokens.some(token => token === '12:00')) {
        targetDataLine = line;
        tokens = lineTokens;
        break;
      }
    }
    if (!targetDataLine) {
      console.warn('[KMA] 12:00 데이터 줄을 찾지 못했습니다.');
      return NaN;
    }

    if (!tokens.length) {
      console.warn('KMA temperature alert parse failed: 12:00 data line is empty');
      return NaN;
    }

    const headerIndex = findKmaTemperatureColumn(lines);
    if (headerIndex >= 0 && headerIndex < tokens.length) {
      const byHeader = coerceKmaTemperature(tokens[headerIndex]);
      if (Number.isFinite(byHeader)) return byHeader;
    }

    for (const token of tokens) {
      if (!/[.+-]/.test(token)) continue;
      const value = coerceKmaTemperature(token);
      if (Number.isFinite(value)) return value;
    }

    for (const token of tokens) {
      const value = coerceKmaTemperature(token);
      if (Number.isFinite(value)) return value;
    }

    console.warn('KMA temperature alert parse failed: no valid temperature token');
    return NaN;
  }

  async function getKmaAlertIcon() {
    if (kmaAlertIconPromise) return kmaAlertIconPromise;
    kmaAlertIconPromise = (async () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const href = manifestLink && manifestLink.getAttribute('href');
      if (!href) return '';
      try {
        const manifestUrl = new URL(href, location.href);
        const response = await fetch(manifestUrl.href, { cache: 'force-cache' });
        if (!response.ok) return '';
        const manifest = await response.json();
        const iconSrc = manifest && Array.isArray(manifest.icons) && manifest.icons[0] && manifest.icons[0].src;
        return iconSrc ? new URL(iconSrc, manifestUrl.href).href : '';
      } catch (e) {
        return '';
      }
    })();
    return kmaAlertIconPromise;
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;
    try {
      await Notification.requestPermission();
    } catch (e) {
      console.warn('KMA temperature alert permission request failed:', e);
    }
  }

  async function notifyKmaTemperature(temp) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      toast(`⚠️ 현재 기온 ${temp.toFixed(1)}°C이지만 브라우저 알림 권한이 없습니다.`, 4000);
      return true;
    }

    try {
      const options = {
        body: `현재 기온 ${temp.toFixed(1)}°C — 28°C 이상입니다! (기상청 294 관측소)`,
        tag: KMA_ALERT_TAG
      };
      const icon = await getKmaAlertIcon();
      if (icon) options.icon = icon;
      new Notification('🌡️ 기온 경보', options);
      return true;
    } catch (e) {
      console.warn('KMA temperature alert notification failed:', e);
      toast(`⚠️ 현재 기온 ${temp.toFixed(1)}°C이지만 브라우저 알림을 표시하지 못했습니다.`, 4000);
      return true;
    }
  }

  async function checkKmaTemperatureAlert(now = new Date()) {
    if (kmaAlertInFlight) return;
    if (!isWithinKmaAlertWindow(now)) return;
    if (hasSentKmaAlertToday(now)) return;

    kmaAlertInFlight = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), KMA_FETCH_TIMEOUT_MS) : 0;
    try {
      const response = await fetch(KMA_AWS_FETCH_URL, {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) {
        console.warn('KMA temperature alert fetch failed:', response.status, response.statusText);
        return;
      }

      const text = await response.text();
      const temp = parseKmaTemperature(text);
      if (!Number.isFinite(temp)) return;
      if (temp < KMA_ALERT_THRESHOLD) return;

      const sent = await notifyKmaTemperature(temp);
      if (sent) markKmaAlertSent(now);
    } catch (e) {
      console.warn('KMA temperature alert fetch failed:', e);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      kmaAlertInFlight = false;
    }
  }

  function updateNotifPermBtn() {
    const btn = document.getElementById('notifPermBtn');
    if (!btn || typeof Notification === 'undefined') return;
    const perm = Notification.permission;
    btn.hidden = (perm === 'granted' || perm === 'denied');
  }

  function initTempAlert() {
    requestNotificationPermission().then(updateNotifPermBtn);

    const permBtn = document.getElementById('notifPermBtn');
    if (permBtn) {
      updateNotifPermBtn();
      permBtn.addEventListener('click', async () => {
        await requestNotificationPermission();
        updateNotifPermBtn();
      });
    }

    const tick = () => {
      checkKmaTemperatureAlert().catch((e) => {
        console.warn('KMA temperature alert check failed:', e);
      });
    };

    tick();
    if (kmaAlertTimer) clearInterval(kmaAlertTimer);
    kmaAlertTimer = window.setInterval(tick, KMA_CHECK_INTERVAL_MS);
  }

  /* =====================================================================
     §9. KAKAOTALK BROWSER COMPATIBILITY
     카카오톡 인앱 브라우저에서 기능이 제한되므로 외부 브라우저로 유도.
     ===================================================================== */

  function handleKakaoTalkBrowser() {
    if (!/KAKAOTALK/i.test(navigator.userAgent)) return;
    const isAndroid = /Android/i.test(navigator.userAgent);

    const showBanner = () => {
      if (document.getElementById('kakaoBanner')) return;
      const b = document.createElement('div');
      b.id = 'kakaoBanner';
      b.setAttribute('role', 'alert');
      b.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:9999',
        'background:#fef3c7;border-bottom:2px solid #f59e0b',
        'padding:10px 14px;text-align:center',
        'font-size:13px;color:#78350f;line-height:1.7;font-family:inherit'
      ].join(';');

      let html = '⚠️ 카카오톡 브라우저에서는 일부 기능이 제한됩니다.<br>';
      if (isAndroid) {
        const intentUrl = 'intent://' + location.host + location.pathname + location.search
          + '#Intent;scheme=' + location.protocol.replace(':', '')
          + ';package=com.android.chrome'
          + ';S.browser_fallback_url=' + encodeURIComponent(location.href) + ';end';
        html += '<a href="' + intentUrl + '" style="font-weight:700;color:#92400e;text-decoration:underline">📱 크롬으로 열기</a>'
          + ' &nbsp;또는 우측 상단 <b>···</b> → <b>다른 브라우저로 열기</b>';
      } else {
        html += '우측 상단 <b>···</b> → <b>다른 브라우저로 열기</b>를 눌러 사파리/크롬으로 여세요.';
      }
      b.innerHTML = html;

      if (document.body) document.body.insertBefore(b, document.body.firstChild);
    };

    if (document.body) showBanner();
    else document.addEventListener('DOMContentLoaded', showBanner);
  }

  handleKakaoTalkBrowser();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
