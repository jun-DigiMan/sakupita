// ============================================================
// チーム日程調整アプリ
// ============================================================

// ---------- 日本祝日データ ----------
const JAPAN_HOLIDAYS = {
  // 2025
  '2025-01-01':'元日','2025-01-13':'成人の日',
  '2025-02-11':'建国記念の日','2025-02-23':'天皇誕生日','2025-02-24':'振替休日',
  '2025-03-20':'春分の日',
  '2025-04-29':'昭和の日',
  '2025-05-03':'憲法記念日','2025-05-04':'みどりの日','2025-05-05':'こどもの日','2025-05-06':'振替休日',
  '2025-07-21':'海の日',
  '2025-08-11':'山の日',
  '2025-09-15':'敬老の日','2025-09-22':'国民の休日','2025-09-23':'秋分の日',
  '2025-10-13':'スポーツの日',
  '2025-11-03':'文化の日','2025-11-23':'勤労感謝の日','2025-11-24':'振替休日',
  // 2026
  '2026-01-01':'元日','2026-01-12':'成人の日',
  '2026-02-11':'建国記念の日','2026-02-23':'天皇誕生日',
  '2026-03-20':'春分の日',
  '2026-04-29':'昭和の日',
  '2026-05-03':'憲法記念日','2026-05-04':'みどりの日','2026-05-05':'こどもの日',
  '2026-07-20':'海の日',
  '2026-08-11':'山の日',
  '2026-09-21':'敬老の日','2026-09-23':'秋分の日',
  '2026-10-12':'スポーツの日',
  '2026-11-03':'文化の日','2026-11-23':'勤労感謝の日',
  // 2027
  '2027-01-01':'元日','2027-01-11':'成人の日',
  '2027-02-11':'建国記念の日','2027-02-23':'天皇誕生日',
  '2027-03-21':'春分の日',
  '2027-04-29':'昭和の日',
  '2027-05-03':'憲法記念日','2027-05-04':'みどりの日','2027-05-05':'こどもの日',
  '2027-07-19':'海の日',
  '2027-08-11':'山の日',
  '2027-09-20':'敬老の日','2027-09-23':'秋分の日',
  '2027-10-11':'スポーツの日',
  '2027-11-03':'文化の日','2027-11-23':'勤労感謝の日',
};

// ---------- メンバーカラーパレット ----------
const MEMBER_COLORS = ['#222222','#e04f24','#1155cc','#10b981','#f59e0b','#8b5cf6','#ec4899','#00a2da'];

function loadMembersFromStorage() {
  try {
    const stored = localStorage.getItem('sakupita_members');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch(e) {}
  return CONFIG.MEMBERS.map(m => ({...m}));
}

function saveMembersToStorage() {
  localStorage.setItem('sakupita_members', JSON.stringify(state.members));
}

// ---------- State ----------
const state = {
  currentMonday: null,  // 表示中の週の月曜日
  busyData: {},         // { calendarId: [ {start, end}, ... ] }
  selectedSlot: null,   // クリックされたスロット情報
  selectedMember: null, // 選択された担当者
  selectedPurpose: '初回ヒアリング',
  isDemo: false,
  authReady: false,     // Googleカレンダー認証済み
  gapiReady: false,
  gisReady: false,
  tokenClient: null,
  slotMinutes: CONFIG.SLOT_MINUTES, // 30 or 60
  weekCount: 1,                     // 1 or 2
  members: loadMembersFromStorage(),
  calendarConnected: {},            // { calendarId: true/false }
};

const DAY_NAMES = ['月', '火', '水', '木', '金'];

// ---------- 認証TTL（30日） ----------
const AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function isAuthWithinTTL() {
  const t = parseInt(localStorage.getItem('sakupita_auth_time') || '0');
  return t > 0 && (Date.now() - t) < AUTH_TTL_MS;
}

// ---------- アクセストークン保存・復元 ----------
function saveStoredToken(resp) {
  try {
    const expiry = Date.now() + (resp.expires_in * 1000) - 60000; // 1分バッファ
    localStorage.setItem('sakupita_token', JSON.stringify({
      access_token: resp.access_token,
      expiry,
    }));
    // 期限5分前にサイレント自動更新（タブを開いている限り再接続不要）
    const refreshIn = (resp.expires_in - 300) * 1000;
    if (state._tokenRefreshTimer) clearTimeout(state._tokenRefreshTimer);
    state._tokenRefreshTimer = setTimeout(() => {
      if (localStorage.getItem('sakupita_signed_in') === '1' && state.tokenClient) {
        state.tokenClient.requestAccessToken({ prompt: '' });
      }
    }, Math.max(refreshIn, 10000));
  } catch(e) {}
}
function loadStoredToken() {
  try {
    const raw = localStorage.getItem('sakupita_token');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() > obj.expiry) { localStorage.removeItem('sakupita_token'); return null; }
    return obj;
  } catch(e) { return null; }
}

// ---------- 空き情報キャッシュ（2時間有効） ----------
function saveBusyCache(data) {
  try {
    const key = toDateStr(state.currentMonday) + '_' + state.weekCount;
    localStorage.setItem('sakupita_busy_cache', JSON.stringify({ key, data, ts: Date.now() }));
  } catch(e) {}
}
function loadBusyCache() {
  try {
    const raw = localStorage.getItem('sakupita_busy_cache');
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const key = toDateStr(state.currentMonday) + '_' + state.weekCount;
    if (obj.key !== key) return null;
    if (Date.now() - obj.ts > 2 * 60 * 60 * 1000) return null;
    return obj.data;
  } catch(e) { return null; }
}

// ---------- 初期化 ----------
window.addEventListener('DOMContentLoaded', () => {
  state.currentMonday = getMonday(new Date());
  processUrlParams(); // URLパラメータからメンバー追加
  renderLegend();

  document.getElementById('signin-btn').addEventListener('click', handleSignIn);

  // サインイン済みユーザー: Google API読み込みを待たず即座にカレンダーを表示
  if (localStorage.getItem('sakupita_signed_in') === '1') {
    document.getElementById('loading-screen').classList.add('hidden');
    showMainApp();
    // キャッシュデータがあれば即座にスロットも表示
    const cached = loadBusyCache();
    if (cached) state.busyData = cached;
    loadAndRender();
  }

  // メンバー管理モーダル
  document.getElementById('members-btn').addEventListener('click', openMembersModal);
  document.getElementById('members-modal-close').addEventListener('click', closeMembersModal);
  document.getElementById('members-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('members-modal')) closeMembersModal();
  });
  document.getElementById('members-add-btn').addEventListener('click', addMember);
  document.getElementById('members-url-add-btn').addEventListener('click', addMemberByUrl);
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('signout-header-btn').addEventListener('click', signOut);

  document.getElementById('prev-week').addEventListener('click', () => { shiftWeek(-1); });
  document.getElementById('next-week').addEventListener('click', () => { shiftWeek(1); });
  document.getElementById('today-btn').addEventListener('click', () => {
    state.currentMonday = getMonday(new Date());
    loadAndRender();
  });

  // スロット単位切り替え
  document.querySelectorAll('[data-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.slotMinutes = parseInt(btn.dataset.slot);
      document.querySelectorAll('[data-slot]').forEach(b => b.classList.toggle('active', b === btn));
      loadAndRender();
    });
  });

  // 週表示切り替え
  document.querySelectorAll('[data-week]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.weekCount = parseInt(btn.dataset.week);
      document.querySelectorAll('[data-week]').forEach(b => b.classList.toggle('active', b === btn));
      loadAndRender();
    });
  });

  // 予約フォーム
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('confirm-booking').addEventListener('click', handleBooking);
  document.getElementById('back-to-calendar').addEventListener('click', closeModal);

  // 名前: フォーカスを外した時にスペース正規化（全角→半角、なし→苗字辞書で自動分割）
  document.getElementById('customer-name').addEventListener('blur', () => {
    const el = document.getElementById('customer-name');
    let v = el.value.replace(/　/g, ' ').replace(/ +/g, ' ').trim();
    if (v.length > 1 && !/[ ]/.test(v)) v = splitJapaneseName(v);
    el.value = v;
  });

  // 電話番号: フォーカスを外した時に半角ハイフン形式に自動整形
  document.getElementById('customer-phone').addEventListener('blur', () => {
    const el = document.getElementById('customer-phone');
    const formatted = formatPhone(el.value);
    if (formatted) el.value = formatted;
  });
});

// ---------- Google API ----------
function gapiLoaded() { gapi.load('client', initGapiClient); }
async function initGapiClient() {
  await gapi.client.init({ apiKey: CONFIG.API_KEY });
  // 保存済みトークンがあれば即座に復元 → authReady=true でAPIコール可能
  const stored = loadStoredToken();
  if (stored) {
    gapi.client.setToken({ access_token: stored.access_token });
    state.authReady = true;
  }
  state.gapiReady = true;
  checkAndAutoSignIn();
}

function gisLoaded() {
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: async (resp) => {
      if (resp.error) {
        if (resp.error === 'access_denied') {
          localStorage.removeItem('sakupita_signed_in');
          localStorage.removeItem('sakupita_auth_time');
          localStorage.removeItem('sakupita_token');
        }
        // カレンダーは維持しつつ、再接続ボタンを表示
        showReconnectOverlay();
        return;
      }
      // 認証成功 → トークンを保存して次回リロード時に復元
      state.authReady = true;
      saveStoredToken(resp);
      localStorage.setItem('sakupita_signed_in', '1');
      localStorage.setItem('sakupita_auth_time', Date.now().toString());

      const mainVisible = !document.getElementById('main-app').classList.contains('hidden');
      if (mainVisible) {
        // リロード後: 最新データでスロットを更新
        const old = document.getElementById('slots-connecting');
        if (old) old.remove();
        try {
          state.busyData = await fetchFreeBusy();
          saveBusyCache(state.busyData);
        } catch(e) {
          console.warn('fetchFreeBusy failed:', e);
        }
        renderSlots();
        scrollToNow();
      } else {
        // 初回サインイン
        document.getElementById('signin-screen').classList.add('hidden');
        document.getElementById('loading-screen').classList.add('hidden');
        showMainApp();
        await loadAndRender();
      }
      startAutoRefresh();
      loadLogoBase64();
    },
    error_callback: () => {
      document.getElementById('loading-screen').classList.add('hidden');
      if (document.getElementById('main-app').classList.contains('hidden')) {
        document.getElementById('signin-screen').classList.remove('hidden');
      } else {
        showReconnectOverlay();
      }
    },
  });
  state.gisReady = true;
  checkAndAutoSignIn();
}

function checkAndAutoSignIn() {
  if (!state.gapiReady || !state.gisReady) return;
  document.getElementById('loading-screen').classList.add('hidden');

  if (localStorage.getItem('sakupita_signed_in') === '1') {
    if (document.getElementById('main-app').classList.contains('hidden')) {
      showMainApp();
    }
    if (state.authReady) {
      // トークン復元済み → 即座にfreeBusy取得してスロット表示
      loadAndRender();
    } else {
      // 保存トークンなし → ユーザーに再認証を促す
      state.tokenClient.requestAccessToken({ prompt: '' });
    }
  } else {
    // 未サインイン → サインイン画面
    document.getElementById('signin-screen').classList.remove('hidden');
  }
}

function handleSignIn() {
  // prompt: '' → 同意済みなら即座にサイレント取得、未同意なら同意画面を表示
  state.tokenClient.requestAccessToken({ prompt: '' });
}

// ---------- デモモード ----------
function startDemo() {
  state.isDemo = true;
  document.getElementById('loading-screen').classList.add('hidden');
  showMainApp();
  loadAndRender();
}

function showMainApp() {
  document.getElementById('main-app').classList.remove('hidden');
}

// ---------- メインロード ----------
async function loadAndRender() {
  updateWeekLabel();
  renderDateHeader();
  renderTimeColumn();

  showSlotsLoading();

  if (state.authReady) {
    try {
      state.busyData = await fetchFreeBusy();
      saveBusyCache(state.busyData);
    } catch(e) {
      console.warn('fetchFreeBusy failed:', e);
      state.busyData = loadBusyCache() || {};
    }
  } else {
    // 未認証: キャッシュがあれば使用
    state.busyData = loadBusyCache() || {};
  }

  renderSlots();
  scrollToNow();
}

// ---------- 定期自動更新（3分ごと） ----------
function startAutoRefresh() {
  if (state._autoRefreshTimer) clearInterval(state._autoRefreshTimer);
  state._autoRefreshTimer = setInterval(async () => {
    if (!state.authReady || state.isDemo) return;
    try {
      state.busyData = await fetchFreeBusy();
      renderSlots();
    } catch(e) { /* silent */ }
  }, 60 * 1000); // 1分
}

// ---------- 週移動 ----------
function shiftWeek(delta) {
  const d = new Date(state.currentMonday);
  d.setDate(d.getDate() + delta * state.weekCount * 7);
  state.currentMonday = d;
  loadAndRender();
}

// ---------- ラベル更新 ----------
function updateWeekLabel() {
  const mon = state.currentMonday;
  const lastFri = new Date(mon);
  lastFri.setDate(lastFri.getDate() + state.weekCount * 7 - 3); // +4 for 1wk, +11 for 2wk
  const fmt = (d) => `${d.getMonth()+1}/${d.getDate()}`;
  document.getElementById('week-label').textContent =
    `${mon.getFullYear()}年  ${fmt(mon)} 〜 ${fmt(lastFri)}`;
}

// ---------- 日付ヘッダー ----------
function renderDateHeader() {
  const el = document.getElementById('date-header');
  const today = toDateStr(new Date());
  el.innerHTML = `<div class="date-header-time"></div>`;
  const totalDays = state.weekCount * 5;
  for (let i = 0; i < totalDays; i++) {
    const weekOffset = Math.floor(i / 5);
    const dayIndex = i % 5;
    const d = new Date(state.currentMonday);
    d.setDate(d.getDate() + weekOffset * 7 + dayIndex);
    const ds = toDateStr(d);
    const isToday = ds === today;
    const holiday = JAPAN_HOLIDAYS[ds] || '';
    el.innerHTML += `
      <div class="date-header-day${isToday ? ' today' : ''}${holiday ? ' holiday' : ''}">
        <div class="date-day-name">${DAY_NAMES[dayIndex]}</div>
        <div class="date-day-num">${d.getDate()}</div>
        <div class="date-holiday-name">${holiday}</div>
      </div>`;
  }
}

// ---------- 時間ラベル ----------
function renderTimeColumn() {
  const el = document.getElementById('time-column');
  el.innerHTML = '';
  eachSlot((hour, min) => {
    const isHour = min === 0;
    const cls = isHour ? 'time-label hour' : 'time-label';
    const label = isHour ? `${String(hour).padStart(2,'0')}:00` : '';
    el.innerHTML += `<div class="${cls}">${label}</div>`;
  });
}

// ---------- 認証待ちスロット表示 ----------
function showSlotsWaiting() {
  const grid = document.getElementById('slots-grid');
  const totalDays = state.weekCount * 5;
  grid.style.gridTemplateColumns = `repeat(${totalDays}, 1fr)`;
  grid.innerHTML = '';
  for (let d = 0; d < totalDays; d++) {
    const col = document.createElement('div');
    col.className = 'day-column';
    eachSlot(() => {
      const slot = document.createElement('div');
      slot.className = 'time-slot';
      col.appendChild(slot);
    });
    grid.appendChild(col);
  }
}

// ---------- 再接続オーバーレイ ----------
function showReconnectOverlay() {
  const old = document.getElementById('slots-connecting');
  if (old) old.remove();
  const grid = document.getElementById('slots-grid');
  const wrapper = grid.parentElement;
  wrapper.style.position = 'relative';
  const overlay = document.createElement('div');
  overlay.id = 'slots-connecting';
  overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.85);z-index:5;';
  overlay.innerHTML = `
    <div style="text-align:center;">
      <p style="font-size:14px;color:#555;margin-bottom:16px;">Googleカレンダーへの接続が必要です</p>
      <button onclick="handleSignIn()" style="background:#1a2744;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:14px;cursor:pointer;font-weight:600;">
        Googleカレンダーに接続する
      </button>
    </div>`;
  wrapper.appendChild(overlay);
}

// ---------- ローディング表示 ----------
function showSlotsLoading() {
  const grid = document.getElementById('slots-grid');
  const totalDays = state.weekCount * 5;
  grid.style.gridTemplateColumns = `repeat(${totalDays}, 1fr)`;
  grid.innerHTML = '';
  for (let d = 0; d < totalDays; d++) {
    const col = document.createElement('div');
    col.className = 'day-column';
    eachSlot(() => {
      const slot = document.createElement('div');
      slot.className = 'time-slot';
      col.appendChild(slot);
    });
    grid.appendChild(col);
  }
  // 認証待ちの場合は接続中メッセージを重ねて表示
  if (!state.authReady && Object.keys(state.busyData).length === 0) {
    const overlay = document.createElement('div');
    overlay.id = 'slots-connecting';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.7);z-index:5;pointer-events:none;';
    overlay.innerHTML = '<span style="font-size:13px;color:#888;letter-spacing:.05em;">Googleカレンダーに接続中...</span>';
    const wrapper = grid.parentElement;
    wrapper.style.position = 'relative';
    const old = document.getElementById('slots-connecting');
    if (old) old.remove();
    wrapper.appendChild(overlay);
  } else {
    const old = document.getElementById('slots-connecting');
    if (old) old.remove();
  }
}

// ---------- スロット描画 ----------
function renderSlots() {
  const grid = document.getElementById('slots-grid');
  grid.innerHTML = '';
  const totalDays = state.weekCount * 5;
  grid.style.gridTemplateColumns = `repeat(${totalDays}, 1fr)`;

  for (let i = 0; i < totalDays; i++) {
    const weekOffset = Math.floor(i / 5);
    const dayIndex = i % 5;
    const date = new Date(state.currentMonday);
    date.setDate(date.getDate() + weekOffset * 7 + dayIndex);

    const dateStr = toDateStr(date);
    const isHoliday = !!JAPAN_HOLIDAYS[dateStr];

    const col = document.createElement('div');
    col.className = 'day-column';

    eachSlot((hour, min) => {
      const isHourStart = min === 0;
      const slot = document.createElement('div');
      slot.className = 'time-slot' + (isHourStart ? ' hour-start' : '') + (isHoliday ? ' holiday-blocked' : '');

      if (!isHoliday) {
        const slotStart = toISO(date, hour, min);
        const slotEnd   = toISO(date, hour, min + state.slotMinutes);
        const endMin    = min + state.slotMinutes;
        const endH      = hour + Math.floor(endMin / 60);
        const endM      = endMin % 60;
        const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

        const available = state.members.filter(m => !isBusy(m.calendarId, slotStart, slotEnd));

        if (available.length > 0 && (state.authReady || Object.keys(state.busyData).length > 0)) {
          const btn = document.createElement('button');
          btn.className = 'slot-btn';
          const avatars = available.map(m =>
            `<span class="slot-avatar-sm" style="background:${m.color}">${m.lastName}</span>`
          ).join('');
          btn.innerHTML = `
            <span class="slot-time-text">${fmt(hour, min)} - ${fmt(endH, endM)}</span>
            <span class="slot-avatars-row">${avatars}</span>`;
          btn.addEventListener('click', () => openModal(date, hour, min, available));
          slot.appendChild(btn);
        }
      }

      col.appendChild(slot);
    });

    grid.appendChild(col);
  }
}

// ---------- 空き判定 ----------
function isBusy(calendarId, slotStart, slotEnd) {
  const busyList = state.busyData[calendarId] || [];
  const s = new Date(slotStart).getTime();
  const e = new Date(slotEnd).getTime();
  return busyList.some(b => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return s < be && e > bs; // 重なっていれば busy
  });
}

// ---------- モーダルを開く ----------
function openModal(date, hour, min, availableMembers) {
  const endMin = min + state.slotMinutes;
  const endH = hour + Math.floor(endMin / 60);
  const endM = endMin % 60;
  const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const dayLabel = `${date.getMonth()+1}月${date.getDate()}日 (${DAY_NAMES[date.getDay()-1]})`;

  state.selectedSlot = { date, hour, min, endH, endM };
  state.selectedMember = availableMembers[0]; // デフォルトで最初のメンバー

  document.getElementById('modal-datetime').textContent =
    `${dayLabel}  ${fmt(hour, min)} 〜 ${fmt(endH, endM)}`;

  // 担当者ボタン生成
  const grid = document.getElementById('member-select-grid');
  grid.innerHTML = '';
  state.members.forEach(m => {
    const isAvailable = availableMembers.includes(m);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'member-select-btn' + (isAvailable ? '' : ' busy');
    btn.dataset.id = m.calendarId;
    if (isAvailable && m === availableMembers[0]) btn.classList.add('selected');
    if (isAvailable) btn.style.background = m === availableMembers[0] ? m.color : '';
    btn.innerHTML = `${m.name}${!isAvailable ? ' (×)' : ''}`;
    if (isAvailable) {
      btn.addEventListener('click', () => selectMember(m));
    }
    grid.appendChild(btn);
  });

  // フォームリセット
  document.getElementById('customer-name').value = '';
  document.getElementById('company-name').value = '';
  document.getElementById('customer-email').value = '';
  document.getElementById('customer-phone').value = '';
  document.getElementById('customer-dept').value = '';
  document.getElementById('customer-title').value = '';
  document.getElementById('meeting-comment').value = '';

  document.getElementById('booking-modal').classList.remove('hidden');
  document.getElementById('company-name').focus();
}

function selectMember(member) {
  state.selectedMember = member;
  document.querySelectorAll('.member-select-btn').forEach(btn => {
    const isSelected = btn.dataset.id === member.calendarId;
    btn.classList.toggle('selected', isSelected);
    btn.style.background = isSelected ? member.color : '';
    btn.style.color = isSelected ? 'white' : '';
    btn.style.borderColor = isSelected ? member.color : '';
  });
}

function showSuccessScreen({ customerName, companyName, customerEmail }) {
  // Step indicator → 完了状態に
  document.getElementById('booking-form-container').classList.add('hidden');
  document.getElementById('booking-success').classList.remove('hidden');

  // 詳細を埋める
  const { date, hour, min, endH, endM } = state.selectedSlot;
  const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  const dayLabel = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日（${DAY_NAMES[date.getDay()-1]}）`;

  document.getElementById('success-sub-msg').textContent = state.isDemo
    ? '（デモモード：メール送信はスキップされています）'
    : '確認メールをお送りしました。ご確認ください。';
  document.getElementById('success-member').textContent = state.selectedMember.name;
  document.getElementById('success-datetime').textContent = `${dayLabel} ${fmt(hour, min)} 〜 ${fmt(endH, endM)}`;
  document.getElementById('success-name').textContent = customerName;
  document.getElementById('success-email').textContent = customerEmail;

  const companyRow = document.getElementById('success-company-row');
  if (companyName) {
    document.getElementById('success-company').textContent = companyName;
    companyRow.classList.remove('hidden');
  } else {
    companyRow.classList.add('hidden');
  }

  // スクロールを先頭に
  document.getElementById('booking-modal').scrollTop = 0;
}

function closeModal() {
  document.getElementById('booking-modal').classList.add('hidden');
  document.getElementById('booking-form-container').classList.remove('hidden');
  document.getElementById('booking-success').classList.add('hidden');
  state.selectedSlot = null;
}

// ---------- 予約確定 ----------
async function handleBooking() {
  const customerName  = document.getElementById('customer-name').value.trim();
  const companyName   = document.getElementById('company-name').value.trim();
  const customerEmail = document.getElementById('customer-email').value.trim();
  const customerPhone = document.getElementById('customer-phone').value.trim();
  const customerDept  = document.getElementById('customer-dept').value.trim();
  const customerTitle = document.getElementById('customer-title').value.trim();
  const comment       = document.getElementById('meeting-comment').value.trim();

  if (!companyName)    { highlight('company-name');   return; }
  if (!customerName)   { highlight('customer-name');  return; }
  if (!customerEmail)  { highlight('customer-email'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    highlight('customer-email');
    alert('メールアドレスの形式が正しくありません。\n例: name@example.com');
    return;
  }
  if (!customerPhone)  { highlight('customer-phone'); return; }
  if (!/^\d{2,4}-\d{2,4}-\d{3,4}$/.test(customerPhone)) {
    highlight('customer-phone');
    alert('電話番号はハイフン形式で入力してください。\n例: 03-1234-5678 / 090-1234-5678');
    return;
  }
  if (!customerDept)   { highlight('customer-dept');  return; }
  if (!customerTitle)  { highlight('customer-title'); return; }
  if (!state.selectedMember) { alert('担当者を選択してください'); return; }

  const btn = document.getElementById('confirm-booking');
  btn.disabled = true;
  btn.textContent = '処理中...';

  const { date, hour, min, endH, endM } = state.selectedSlot;
  const title = CONFIG.EVENT_TITLE_FORMAT
    .replace('{customer}', customerName)
    .replace('{company}', companyName || '')
    .replace('{purpose}', comment || 'お打ち合わせ')
    .replace('{member}', state.selectedMember.name);

  const startISO = toISO(date, hour, min);
  const endISO   = toISO(date, endH, endM);

  try {
    if (state.isDemo) {
      await sleep(800); // デモ用待機
      addMockBusy(state.selectedMember.calendarId, startISO, endISO);
    } else if (!state.authReady) {
      // 未認証: 予約フォームを送信するためにサインインを要求
      btn.disabled = false;
      btn.textContent = '上記の内容で日程調整を完了する';
      if (state.tokenClient) {
        state._pendingBooking = { customerName, companyName, customerEmail, comment };
        state.tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        alert('カレンダー連携が初期化されていません。ページを再読み込みしてください。');
      }
      return;
    } else {
      const created = await createCalendarEvent({
        title, startISO, endISO,
        memberEmail: state.selectedMember.calendarId,
        customerEmail, customerPhone, companyName, customerName, customerDept, customerTitle, comment,
      });
      // 確認メール送信 → バウンス確認 → 成否をカレンダーに記録
      let mailStatus = '';
      try {
        const { date, hour, min, endH, endM } = state.selectedSlot;
        const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        const dateLabel = `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日（${DAY_NAMES[date.getDay()-1]}）${fmt(hour,min)} 〜 ${fmt(endH,endM)}`;
        const sendTimestamp = Math.floor(Date.now() / 1000);
        await sendConfirmationEmails({
          customerName, companyName, customerEmail,
          memberName:  state.selectedMember.name,
          memberEmail: state.selectedMember.calendarId,
          dateLabel,
          meetUrl: created.meetUrl || '',
        });
        // バウンスメール到着を待って確認（即時バウンスは数秒で届く）
        btn.textContent = 'メール到達確認中...';
        await sleep(5000);
        const bounceRes = await gapi.client.request({
          path: 'https://www.googleapis.com/gmail/v1/users/me/messages',
          params: {
            q: `(from:mailer-daemon OR from:postmaster) after:${sendTimestamp} "${customerEmail}"`,
            maxResults: 1,
          },
        });
        if (bounceRes.result.messages?.length > 0) {
          alert(`確認メールが届かなかった可能性があります。\nメールアドレスをご確認ください。\n\n送信先: ${customerEmail}`);
          mailStatus = `⚠️ メール未達（バウンス検知）\nメールアドレスを再確認してください。\n送信先: ${customerEmail}`;
        } else {
          mailStatus = `✅ 確認メール送信済み\n送信先: ${customerEmail}`;
        }
      } catch(mailErr) {
        console.warn('メール送信失敗:', mailErr);
        const errMsg = mailErr?.result?.error?.message || mailErr?.message || '';
        alert(`確認メールの送信に失敗しました。\nメールアドレスをご確認ください。\n\n予約自体は正常に完了しています。\n\n${errMsg ? '詳細: ' + errMsg : ''}`);
        mailStatus = `⚠️ メール送信失敗\nメールアドレスを再確認してください。\n送信先: ${customerEmail}`;
      }
      // カレンダーイベントにメール送信状況を追記（失敗時はタイトルにも反映）
      try {
        const baseDesc = `【顧客名】${companyName ? companyName + ' ' : ''}${customerName}様\n【部署名・役職名】${customerDept || ''}${customerTitle ? ' ' + customerTitle : ''}\n【電話番号】${customerPhone || ''}\n【メールアドレス】${customerEmail || ''}${comment ? '\n【コメント】' + comment : ''}`;
        const patchBody = {
          description: baseDesc + '\n\n' + mailStatus,
        };
        if (mailStatus.startsWith('⚠️')) {
          patchBody.summary = '⚠️ メール未達 要アドレス確認 / ' + title;
        }
        const patchRes = await gapi.client.request({
          path: `https://www.googleapis.com/calendar/v3/calendars/primary/events/${created.id}`,
          method: 'PATCH',
          params: { sendUpdates: 'none' },
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchBody),
        });
        console.log('カレンダーPATCH成功:', patchRes?.result?.description);
      } catch(patchErr) {
        console.error('イベント更新失敗:', patchErr);
      }
      // スプレッドシートへ記録（エラーは無視）
      try {
        const { date, hour, min, endH, endM } = state.selectedSlot;
        const fmt = (h, m) => `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
        const meetingDate = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${fmt(hour,min)}〜${fmt(endH,endM)}`;
        const sentDate = (() => { const n = new Date(); return `${n.getFullYear()}/${n.getMonth()+1}/${n.getDate()}`; })();
        await appendToSheet({
          companyName, customerName, customerDept, customerTitle,
          customerPhone, customerEmail,
          sentDate, meetingDate,
          comment,
        });
      } catch(sheetErr) {
        console.warn('スプレッドシート記録失敗:', sheetErr);
      }
    }

    // 予約済みスロットを即時反映（全メンバーをbusyに）
    if (!state.isDemo) {
      state.members.forEach(m => {
        if (!state.busyData[m.calendarId]) state.busyData[m.calendarId] = [];
        state.busyData[m.calendarId].push({ start: startISO, end: endISO });
      });
    }
    showSuccessScreen({ customerName, companyName, customerEmail });
    renderSlots(); // グリッド更新

  } catch (err) {
    console.error(err);
    const msg = err?.result?.error?.message || err?.message || JSON.stringify(err);
    alert('予約の登録に失敗しました: ' + msg);
    btn.disabled = false;
    btn.textContent = '上記の内容で日程調整を完了する';
  }
}

// ---------- Google Calendar イベント作成（Google Meet付き） ----------
// 'primary' = サインイン中ユーザーのカレンダー（常に書き込み可能）
// 担当者・顧客を attendee に追加して招待メールを自動送信
async function createCalendarEvent({ title, startISO, endISO, memberEmail, customerEmail, customerPhone, companyName, customerName, customerDept, customerTitle, comment }) {
  const attendees = [];
  if (memberEmail)   attendees.push({ email: memberEmail });
  if (customerEmail) attendees.push({ email: customerEmail });

  const event = {
    summary: title,
    description: `【顧客名】${companyName ? companyName + ' ' : ''}${customerName}様\n【部署名・役職名】${customerDept || ''}${customerTitle ? ' ' + customerTitle : ''}\n【電話番号】${customerPhone || ''}\n【メールアドレス】${customerEmail || ''}${comment ? '\n【コメント】' + comment : ''}`,
    start: { dateTime: startISO, timeZone: 'Asia/Tokyo' },
    end:   { dateTime: endISO,   timeZone: 'Asia/Tokyo' },
    attendees,
    conferenceData: {
      createRequest: {
        requestId: `sakupita-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: { useDefault: true },
  };
  const res = await gapi.client.request({
    path: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    method: 'POST',
    params: {
      conferenceDataVersion: 1,
      sendUpdates: attendees.length > 0 ? 'all' : 'none',
    },
    body: event,
  });
  const created = res.result;
  const meetUrl = created.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || '';
  return { ...created, meetUrl };
}

// ---------- ロゴbase64読み込み（白抜き版をCanvasで生成） ----------
async function loadLogoBase64() {
  if (state._logoBase64 !== undefined) return state._logoBase64;
  try {
    const img = new Image();
    img.src = 'logo-header-t.png'; // 透過PNG（ヘッダー用）
    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.filter = 'brightness(0) invert(1)'; // 白抜きに変換
    ctx.drawImage(img, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    state._logoBase64 = dataUrl.split(',')[1];
    return state._logoBase64;
  } catch(e) { state._logoBase64 = null; return null; }
}

// ---------- メール送信（CIDインライン画像対応） ----------
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192)
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}

async function sendGmail(to, subject, htmlBody) {
  const logoBase64 = await loadLogoBase64();
  const subjectB64 = utf8ToBase64(subject);
  const htmlB64    = utf8ToBase64(htmlBody);

  let raw;
  if (logoBase64) {
    const bd = 'sakupita_' + Date.now();
    const logoLines = logoBase64.match(/.{1,76}/g).join('\r\n');
    raw =
      `To: ${to}\r\n` +
      `Subject: =?UTF-8?B?${subjectB64}?=\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: multipart/related; boundary="${bd}"\r\n\r\n` +
      `--${bd}\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      htmlB64 + `\r\n\r\n` +
      `--${bd}\r\n` +
      `Content-Type: image/png\r\n` +
      `Content-Transfer-Encoding: base64\r\n` +
      `Content-ID: <sakupita_logo>\r\n` +
      `Content-Disposition: inline; filename="logo.png"\r\n\r\n` +
      logoLines + `\r\n\r\n` +
      `--${bd}--`;
  } else {
    raw =
      `To: ${to}\r\n` +
      `Subject: =?UTF-8?B?${subjectB64}?=\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/html; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n` +
      htmlB64;
  }
  const encoded = btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gapi.client.request({
    path: 'https://www.googleapis.com/gmail/v1/users/me/messages/send',
    method: 'POST',
    body: { raw: encoded },
  });
}

async function sendConfirmationEmails({ customerName, companyName, customerEmail, memberName, memberEmail, dateLabel, meetUrl }) {
  const subject = 'お打ち合わせ日程確定のご連絡';
  const logoTag = `<img src="cid:sakupita_logo" alt="サクピタ" style="height:87px;">`;
  const meetHtml = meetUrl
    ? `<p style="margin:16px 0;"><strong>■ Google Meet URL</strong><br><a href="${meetUrl}" style="color:#1155cc;">${meetUrl}</a></p><p>当日は上記URLよりGoogle Meetにてご参加ください。</p>`
    : '';

  const header = `<div style="background:#1a2744;padding:16px 24px;border-radius:8px 8px 0 0;">${logoTag}</div>`;
  const footer = `<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"><p style="font-size:12px;color:#999;">株式会社DigiMan　|　サクピタ 自動送信メール</p>`;

  const wrap = (body) => `<div style="font-family:'Noto Sans JP',sans-serif;font-size:15px;line-height:1.8;color:#1a1a1a;max-width:600px;margin:0 auto;">${header}<div style="background:#fff;padding:32px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 8px 8px;">${body}${footer}</div></div>`;

  const table = (rows) => `<table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">${rows.map(([k,v])=>`<tr><td style="padding:10px 14px;background:#f5f5f5;border:1px solid #e0e0e0;width:30%;font-weight:600;">${k}</td><td style="padding:10px 14px;border:1px solid #e0e0e0;">${v}</td></tr>`).join('')}</table>`;

  const customerBody = wrap(
    `<p>${customerName} 様</p>` +
    `<p>この度はお打ち合わせのご予約をいただき、誠にありがとうございます。<br>以下の日程でお打ち合わせが確定いたしましたのでご連絡申し上げます。</p>` +
    table([['担当者', memberName], ['会社名', companyName || '—'], ['日時', dateLabel]]) +
    meetHtml +
    `<p>ご不明な点がございましたら、担当者までお気軽にご連絡ください。<br>どうぞよろしくお願いいたします。</p>`
  );

  const memberBody = wrap(
    `<p>${memberName} さん</p>` +
    `<p>新しいお打ち合わせの予約が入りました。</p>` +
    table([['顧客', `${companyName ? companyName + '　' : ''}${customerName} 様`], ['メール', customerEmail], ['日時', dateLabel]]) +
    meetHtml
  );

  await Promise.all([
    sendGmail(customerEmail, subject, customerBody),
    sendGmail(memberEmail,   subject, memberBody),
  ]);
}

// ---------- スプレッドシート連携 ----------
async function appendToSheet({ companyName, customerName, customerDept, customerTitle, customerPhone, customerEmail, sentDate, meetingDate, comment }) {
  let sheetId = CONFIG.SHEET_ID || localStorage.getItem('sakupita_sheet_id');

  if (!sheetId) {
    // 初回: スプレッドシートを自動作成
    const created = await gapi.client.request({
      path: 'https://sheets.googleapis.com/v4/spreadsheets',
      method: 'POST',
      body: {
        properties: { title: 'サクピタ 予約記録' },
        sheets: [{ properties: { title: 'Sheet1' } }],
      },
    });
    sheetId = created.result.spreadsheetId;
    localStorage.setItem('sakupita_sheet_id', sheetId);
    CONFIG.SHEET_ID = sheetId;

    // ヘッダー行を追加
    await gapi.client.request({
      path: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1%21A1:append`,
      method: 'POST',
      params: { valueInputOption: 'USER_ENTERED' },
      body: { values: [['企業名', '担当者名', '部署', '役職', '電話番号', 'メールアドレス', 'メール送信日', '商談日', 'コメント']] },
    });
  }

  await gapi.client.request({
    path: `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1%21A1:append`,
    method: 'POST',
    params: { valueInputOption: 'USER_ENTERED' },
    body: { values: [[companyName, customerName, customerDept, customerTitle, customerPhone, customerEmail, sentDate, meetingDate, comment]] },
  });
}

// ---------- Google Calendar Free/Busy 取得 ----------
async function fetchFreeBusy() {
  const mon = state.currentMonday;
  const fri = new Date(mon); fri.setDate(fri.getDate() + state.weekCount * 7);

  const res = await gapi.client.request({
    path: 'https://www.googleapis.com/calendar/v3/freeBusy',
    method: 'POST',
    body: {
      timeMin: mon.toISOString(),
      timeMax: fri.toISOString(),
      timeZone: 'Asia/Tokyo',
      items: state.members.map(m => ({ id: m.calendarId })),
    },
  });

  const result = {};
  state.members.forEach(m => {
    const calData = res.result.calendars[m.calendarId];
    result[m.calendarId] = calData?.busy || [];
    state.calendarConnected[m.calendarId] = !(calData?.errors?.length > 0);
  });
  return result;
}

// ---------- モックデータ生成 ----------
function generateMockBusy() {
  const result = {};
  state.members.forEach(m => {
    result[m.calendarId] = [];
    const totalDays = state.weekCount * 5;
    for (let i = 0; i < totalDays; i++) {
      const weekOffset = Math.floor(i / 5);
      const dayIndex = i % 5;
      const date = new Date(state.currentMonday);
      date.setDate(date.getDate() + weekOffset * 7 + dayIndex);
      const busyBlocks = generateDayBusy(date, m.name);
      result[m.calendarId].push(...busyBlocks);
    }
  });
  return result;
}

function generateDayBusy(date, seed) {
  // シード値で一貫したランダムデータを生成
  const rng = seededRandom(toDateStr(date) + seed);
  const busy = [];
  const { start, end } = CONFIG.WORKING_HOURS;

  let h = start;
  while (h < end) {
    if (rng() < 0.35) { // 35%の確率でbusy
      const duration = rng() < 0.5 ? 1 : 0.5; // 1h or 0.5h
      busy.push({
        start: toISO(date, h, 0),
        end:   toISO(date, h + duration, 0),
      });
      h += duration;
    } else {
      h += 0.5;
    }
  }
  return busy;
}

function addMockBusy(calendarId, start, end) {
  if (!state.busyData[calendarId]) state.busyData[calendarId] = [];
  state.busyData[calendarId].push({ start, end });
}

// ---------- シードRNG ----------
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function() {
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xffffffff;
  };
}

// ---------- 凡例 ----------
function renderLegend() {
  const el = document.getElementById('header-legend');
  if (!el) return;
  el.innerHTML = state.members.map(m => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${m.color}">${m.lastName}</div>
      <span>${m.name}</span>
    </div>`).join('');
}

// ---------- トースト ----------
function showToast(msg) {
  const toast = document.getElementById('success-toast');
  document.getElementById('toast-msg').textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 4000);
}

// ---------- 現在時刻にスクロール ----------
function scrollToNow() {
  const now = new Date();
  const { start } = CONFIG.WORKING_HOURS;
  const minutesFromStart = (now.getHours() - start) * 60 + now.getMinutes();
  if (minutesFromStart < 0) return;
  const scrollPx = (minutesFromStart / CONFIG.SLOT_MINUTES) * parseInt(getComputedStyle(document.documentElement).getPropertyValue('--slot-h'));
  document.querySelector('.calendar-body')?.scrollTo({ top: scrollPx - 120, behavior: 'smooth' });
}

// ---------- ユーティリティ ----------
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function eachSlot(fn) {
  const { start, end } = CONFIG.WORKING_HOURS;
  const step = state.slotMinutes;
  for (let h = start; h < end; h++) {
    for (let m = 0; m < 60; m += step) {
      fn(h, m);
    }
  }
}

function toISO(date, hour, min) {
  const d = new Date(date);
  d.setHours(Math.floor(hour + min / 60), min % 60, 0, 0);
  return d.toISOString();
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function highlight(id) {
  const el = document.getElementById(id);
  el.focus();
  el.style.borderColor = '#e04f24';
  el.style.boxShadow = '0 0 0 3px rgba(224,79,36,.15)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1500);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 日本語名前自動分割 ----------
const JP_SURNAMES = (() => {
  const list = [
    // 5文字以上
    '勅使河原','勅使川原',
    // 4文字
    '小笠原','武者小路','長曾我部','喜多川','大久保','飛鳥井','東海林',
    // 3文字
    '長谷川','五十嵐','小野寺','佐々木','三田村','百々瀬',
    '大久保','大河内','御手洗','長曾我','物部川',
    '三宅島','小田切','長谷部','長谷野',
    '宮本武','細川藤','一条院',
    '長谷山','三反田','五十里',
    '三条西','四条畷',
    '久保田','久保野','久保山',
    '榊原','菅原','東海',
    '大谷田','小田原','中田島',
    '宮本','宮崎','宮田','宮川','宮島','宮内','宮野','宮沢','宮林',
    '平野','平田','平山','平岡','平川','平井','平松','平林','平沼','平塚',
    '西村','西田','西川','西山','西島','西野','西原','西沢','西本','西岡','西尾',
    '東野','東山','東田','東川','東海','東条',
    '南野','南田','南川','南山','南原','南沢',
    '北野','北川','北山','北島','北村','北原','北沢','北本','北田',
    '上田','上野','上原','上村','上山','上川','上林','上地',
    '下田','下村','下山','下川','下野','下原',
    '内田','内山','内野','内川','内藤','内海','内村',
    '長田','長野','長谷','長尾','長島','長江','長岡','長井','長沢','長浜',
    '高田','高野','高橋','高山','高島','高木','高松','高林','高村','高岡','高倉','高瀬','高瀬','高梨',
    '村上','村田','村山','村川','村松','村木','村井',
    '山田','山本','山口','山崎','山下','山内','山川','山中','山野','山岸','山根','村岡','山形','山岡',
    '川上','川下','川田','川口','川崎','川村','川島','川野','川本','川瀬','川合','川畑','川端',
    '田中','田村','田口','田島','田野','田川','田辺','田代','田尻',
    '松本','松田','松村','松井','松山','松岡','松野','松川','松原','松下','松浦','松島','松林','松尾',
    '石川','石田','石井','石橋','石山','石原','石野','石島','石黒','石倉',
    '森田','森本','森山','森川','森野','森島','森岡','森下',
    '岡田','岡本','岡野','岡山','岡崎','岡村','岡島','岡部',
    '藤田','藤本','藤原','藤井','藤山','藤野','藤川','藤島','藤村','藤沢','藤枝',
    '木村','木下','木田','木山','木原','木内','木津',
    '池田','池上','池野','池本','池沢',
    '橋本','橋田','橋川','橋野',
    '島田','島本','島野','島崎','島村','島津','島袋',
    '岩田','岩本','岩崎','岩野','岩山','岩川','岩井','岩上','岩間',
    '坂本','坂田','坂野','坂口','坂井','坂上','坂下','坂崎',
    '近藤','近野','近田','近江',
    '遠藤','遠野','遠山',
    '伊藤','伊野','伊田','伊川','伊東','伊賀',
    '加藤','加野','加田','加山','加島','加賀',
    '吉田','吉本','吉村','吉川','吉野','吉岡','吉原','吉井','吉沢','吉山','吉永','吉住',
    '清水','清野','清田','清川','清原','清家',
    '水野','水田','水島','水口','水本','水上','水谷',
    '青木','青野','青山','青田','青島','青川','青柳',
    '原田','原野','原口','原島','原山','原沢',
    '竹内','竹田','竹本','竹村','竹野','竹川','竹島','竹山','竹下','竹中',
    '和田','和野','和泉',
    '浜田','浜野','浜本','浜川','浜島','浜口','浜村','浜崎',
    '金子','金田','金野','金川','金村','金山','金島','金澤',
    '今村','今田','今野','今井','今川','今泉',
    '久保','久野','久田','久米',
    '本田','本村','本野','本山','本間','本庄','本橋',
    '奥田','奥野','奥村','奥山','奥川','奥原',
    '馬場','馬田',
    '荒木','荒田','荒野','荒川','荒井',
    '福田','福本','福村','福島','福山','福野','福川','福井','福原','福地',
    '横山','横田','横野','横川','横井','横島','横尾',
    '安田','安野','安川','安井','安原','安倍','安部',
    '後藤','後野',
    '辻田','辻野','辻村','辻川','辻本','辻井',
    '堀田','堀野','堀川','堀内','堀江','堀井','堀口',
    '菅野','菅原','菅田','菅井','菅村','菅沢',
    '瀬田','瀬野','瀬川','瀬島','瀬口',
    '古田','古川','古野','古井','古山','古村','古島','古賀',
    '新田','新野','新川','新井','新山','新村','新島','新原',
    '増田','増野','増川','増村','増山',
    '野田','野口','野村','野島','野川','野山','野本','野中',
    '市川','市田','野','市島',
    '谷口','谷野','谷田','谷川','谷本','谷村','谷島','谷崎',
    '河野','河田','河本','河村','河島','河口','河合',
    '神田','神野','神山','神村','神川','神崎',
    '角田','角野','角川',
    '富田','富野','富川','富山','富本','富島',
    '丸山','丸田','丸野','丸川',
    '武田','武川','武野','武山','武村','武内',
    '江口','江田','江野','江島','江川','江村','江原',
    '土田','土野','土川','土井','土山','土屋',
    '工藤',
    '関野','関田','関川','関村','関口','関山',
    '榊原','榊田',
    '杉本','杉田','杉山','杉野','杉村','杉浦','杉崎',
    '服部',
    '塚本','塚田','塚野','塚原',
    '桜井','桜田',
    '永田','永野','永川','永山','永井','永本','永島','永村','永瀬','永沢',
    '熊田','熊川','熊野','熊本','熊谷',
    '浅田','浅野','浅川','浅井','浅沼',
    '深田','深川','深野','深山','深沢',
    '滝田','滝川','滝野','滝本','滝口',
    '秋田','秋川','秋野','秋山','秋本','秋元',
    '春田','春野','春山','春原',
    '千葉',
    '岸田','岸川','岸野','岸本','岸井',
    '栗田','栗川','栗野','栗山','栗原','栗本',
    '鎌田','鎌野','鎌倉',
    '根田','根本','根野','根岸',
    '磯田','磯野','磯崎','磯部',
    '沢田','沢野','沢村',
    '湯田','湯野','湯川','湯本','湯浅',
    '沖田','沖野','沖本','沖縄',
    '津田','津野','津川','津本','津島','津山',
    '浦田','浦野','浦川','浦本','浦島',
    '滑川','滑野',
    '溝口','溝田','溝川','溝野',
    '相田','相野','相川','相原','相沢','相馬',
    '荻野','荻田','荻原','荻沢',
    '萩野','萩田','萩原',
    '芦田','芦野','芦川','芦原',
    '柳田','柳野','柳川','柳原','柳沢',
    '梅田','梅野','梅川','梅原','梅沢','梅村',
    '桐野','桐原','桐山',
    '桃野','桃山',
    '橘田','橘野','橘川',
    '葛野','葛原','葛西',
    '鶴田','鶴野','鶴川',
    '亀田','亀野','亀川','亀山','亀井',
    '鷹野','鷹田','鷹岡',
    '鳥田','鳥野','鳥居',
    '鹿野','鹿田','鹿島','鹿児',
    '猪野','猪田','猪川','猪俣',
    '犬飼','犬塚',
    '牛野','牛田','牛川',
    '馬野','馬川','馬渕',
    '鮫島','鯉田',
    '柿田','柿野','柿沼',
    '栃野','栃木',
    '八木','八田','八島','八幡',
    '七野','七川',
    '三野','三田','三川','三原','三島','三沢',
    '五野','五島',
    '一野','一川','一島','一条',
    '二野','二川','二島',
    '百野','百田','百川',
    '千野','千田','千川',
    '万野','万田',
    '宝田','宝野','宝川',
    '神保','神谷','神林','神原','神島',
    '天野','天田','天川','天山','天原','天本','天沢',
    '上原','上地',
    '下地','下条',
    '矢野','矢田','矢川','矢島','矢部','矢口',
    '弓野','弓田',
    '刀田','刀野',
    '船田','船野','船川','船橋','船越',
    '橋野','橋田','橋川',
    '門田','門野','門川',
    '道田','道野','道川',
    '辺田','辺野',
    '城田','城野','城川',
    '村岡','村瀬',
    '小沢','小田','小島','小谷','小泉','小池','小松','小笠','小椋',
    '中沢','中谷','中尾','中本','中林','中地',
    '大沢','大谷','大塚','大石','大西','大橋','大原','大黒','大友','大槻',
    '正田','正野','正木','正岡',
    '光野','光田','光川',
    '国田','国野','国川','国分',
    '世田','世野','世川',
    '里田','里野','里川',
    '家田','家野','家川',
    '坊田','坊野','坊川',
    '堂田','堂野','堂川',
    '寺田','寺野','寺川','寺島','寺本','寺沢','寺内','寺尾',
    '社田','社野','社川',
    '渡辺','渡部','渡邊','渡邉',
    '斉藤','齋藤','斎藤','齊藤',
    '佐伯','佐野','佐久','佐原','佐山','佐川','佐藤',
    '鈴木','鈴谷',
    '林田','林野','林本',
    '田中',
    '阿部','阿川','阿野',
    '河原','川原',
    '小原','小黒','小宮','小寺',
    '大岩','大北','大竹','大成','大村','大浦','大木','大坪',
    '中出','中平','中尾',
    '高村','高倉','高見','高尾',
    '島袋',
    '池袋',
    '富岡','富士','富永',
    '新庄','新谷','新宮','新保',
    '上杉','上條','上坂',
    '下坂','下条',
    '岩瀬','岩崎','岩間','岩城',
    '堀越',
    '細川','細田','細野','細井','細谷',
    '松尾','松枝','松浦',
    '浜松','浜野',
    '菊地','菊池','菊田','菊川','菊谷',
    '豊田','豊野','豊川','豊島',
    '長沼','長澤',
    '永澤',
    '旭野','旭田',
    '塩田','塩野','塩川','塩原','塩見',
    '粟野','粟田',
    '鬼頭','鬼木',
    '野々村',
    '大澤','大橋',
    '茂野','茂田',
    '中澤',
    '川澤','川畑','川端','川越','川内',
    '入江','入野','入田','入沢',
    '出口','出野','出田',
    '月野','月田','月川',
    '日野','日田','日川',
    '木野','木田','木沢',
    '岡崎','岡上','岡下','岡沢',
    '吉尾','吉住',
    '水谷','水沢',
    '河内',
    '矢作','矢吹',
    '早坂','早田','早野',
    '南波','南野',
    '北条','北澤',
    // 2文字（頻出）
    '佐藤','鈴木','高橋','田中','渡辺','伊藤','山本','中村','小林','加藤',
    '吉田','山田','山口','松本','井上','木村','林','斎藤','清水','山崎',
    '森','阿部','池田','橋本','山下','石川','中島','前田','藤田','小川',
    '後藤','岡田','石井','村上','近藤','坂本','遠藤','青木','藤井','西村',
    '福田','太田','三浦','藤原','松田','岡本','中川','中野','原田','小野',
    '竹内','金子','和田','中山','石田','上田','森田','柴田','酒井','工藤',
    '横山','宮崎','内田','高田','多田','大野','河野','安藤','今井','丸山',
    '江口','川口','菊地','吉川','菅原','三浦','服部','馬場','市川','村田',
    '武田','早川','大山','松下','岸','熊谷','相馬',
    // 1文字
    '林','森','山','川','田','野','原','本','上','下',
    '中','大','小','長','高','内','外','北','南','東',
    '西','前','後','岸','谷','池','坂','岡','浜','浦',
    '沢','津','江','河','堀','坂','峰','丘','宮','島',

    // 4文字以上
    '勅使河原','武者小路','小笠原','長谷川','五十嵐','小野寺','東海林','一ノ瀬',
    // 3文字
    '安倍川','大久保','三ツ井','長谷部','長谷山',
    '佐々木','三浦','大島','大野','大西','大橋','大原','大谷','大塚','大石','大川','大木','大山','大田','大村','大沢','大畑',
    '小島','小山','小沢','小田','小池','小泉','小松','小林','小川','小野','小関','小柳',
    '中島','中野','中川','中山','中田','中西','中村','中井','中本','中原','中尾','中谷',
    '宮本','宮崎','宮田','宮川','宮島','宮内','宮野','宮沢',
    '平野','平田','平山','平岡','平川','平井','平松','平林',
    '西村','西田','西川','西山','西島','西野','西原','西沢','西本','西岡',
    '東野','東山','東田','東川',
    '南野','南田','南川','南山',
    '北野','北川','北山','北島','北村',
    '上田','上野','上原','上村','上山','上川',
    '下田','下村','下山','下川','下野',
    '内田','内山','内野','内川','内藤','内海',
    '外山','外川',
    '長田','長野','長谷','長尾','長島','長江','長岡','長井','長沢',
    '高田','高野','高橋','高山','高島','高木','高松','高林','高村','高岡','高倉','高瀬',
    '村上','村田','村山','村川','村松','村木',
    '山田','山本','山口','山崎','山下','山内','山川','山中','山野','山岸','山根','山村','山岡','山形',
    '川上','川下','川田','川口','川崎','川村','川島','川野','川本','川瀬','川合','川畑',
    '田中','田村','田口','田島','田野','田川','田辺','田代',
    '松本','松田','松村','松井','松山','松岡','松野','松川','松原','松下','松浦','松島','松林',
    '石川','石田','石井','石橋','石山','石原','石野','石島',
    '森田','森本','森山','森川','森野','森島','森岡',
    '岡田','岡本','岡野','岡山','岡崎','岡村','岡島',
    '藤田','藤本','藤原','藤井','藤山','藤野','藤川','藤島','藤村','藤沢',
    '木村','木下','木田','木山','木原',
    '池田','池上','池野','池本',
    '橋本','橋田','橋川',
    '島田','島本','島野','島崎','島村',
    '岩田','岩本','岩崎','岩野','岩山','岩川','岩井',
    '林田','林野','林本',
    '坂本','坂田','坂野','坂口','坂井','坂上','坂下',
    '近藤','近野','近田',
    '遠藤','遠野',
    '伊藤','伊野','伊田','伊川',
    '加藤','加野','加田','加山','加島',
    '吉田','吉本','吉村','吉川','吉野','吉岡','吉原','吉井','吉沢','吉山',
    '清水','清野','清田','清川',
    '水野','水田','水島','水口','水本','水上',
    '青木','青野','青山','青田','青島','青川',
    '赤木','赤野','赤田','赤川','赤嶺',
    '白石','白川','白井','白山','白野',
    '黒田','黒木','黒川','黒野','黒島',
    '原田','原野','原口','原島','原山',
    '竹内','竹田','竹本','竹村','竹野','竹川','竹島','竹山','竹下',
    '和田','和野','和田',
    '浜田','浜野','浜本','浜川','浜島','浜口','浜村',
    '山田','川田','海田','池田',
    '金子','金田','金野','金川','金村','金山','金島',
    '木田','木原','木下',
    '今村','今田','今野','今井','今川',
    '久保','久野','久田',
    '本田','本村','本野','本山','本間','本庄',
    '奥田','奥野','奥村','奥山','奥川',
    '馬場','馬田',
    '荒木','荒田','荒野','荒川','荒井',
    '福田','福本','福村','福島','福山','福野','福川','福井','福原',
    '横山','横田','横野','横川','横井','横島',
    '安田','安野','安川','安井','安原',
    '後藤','後野',
    '辻田','辻野','辻村','辻川',
    '堀田','堀野','堀川','堀内','堀江','堀井',
    '菅野','菅原','菅田','菅井','菅村',
    '瀬田','瀬野','瀬川','瀬島','瀬口',
    '古田','古川','古野','古井','古山','古村','古島',
    '新田','新野','新川','新井','新山','新村','新島','新原',
    '鈴木','鈴田',
    '渡辺','渡野','渡田',
    '増田','増野','増川','増村',
    '野田','野口','野村','野島','野川','野山','野本',
    '市川','市田','市野','市島',
    '谷口','谷野','谷田','谷川','谷本','谷村','谷島',
    '久保田','久保野','久保山',
    '河野','河田','河本','河野','河村','河島','河口',
    '神田','神野','神山','神村','神川',
    '角田','角野','角川',
    '富田','富野','富川','富山','富本','富島',
    '高木','高田','高野',
    '丸山','丸田','丸野','丸川',
    '上野','上田','上山','上村',
    '武田','武野','武川','武村','武山','武島',
    '児島','児野',
    '江口','江田','江野','江島','江川','江村',
    '土田','土野','土川','土井','土山','土屋',
    '松尾','松葉',
    '工藤','工野',
    '関野','関田','関川','関村','関口','関山','関島',
    '榊原','榊野','榊田',
    '野々村','野々田',
    // 2文字（頻出）
    '佐藤','鈴木','高橋','田中','渡辺','伊藤','山本','中村','小林','加藤',
    '吉田','山田','山口','松本','井上','木村','林','斎藤','清水','山崎',
    '森','阿部','池田','橋本','山下','石川','中島','前田','藤田','小川',
    '後藤','岡田','石井','村上','近藤','坂本','遠藤','青木','藤井','西村',
    '福田','太田','三浦','藤原','松田','岡本','中川','中野','原田','小野',
    '竹内','金子','和田','中山','石田','上田','森田','柴田','酒井','工藤',
    '横山','宮崎','内田','高田','多田','大野','河野','安藤','今井','丸山',
    '江口','川口','长谷','吉川','菅原','橋田','笠原','辻','堀','菊地',
    '菊池','尾崎','久保','丸','渡','谷','矢野','岸','村','南','北',
    '関','門','森','林','山','田','川','島','野','原','坂','沢',
    '杉本','杉田','杉山','杉野','杉村','杉浦',
    '服部','服田',
    '塚本','塚田','塚野','塚原',
    '桜井','桜田','桜野','桜本',
    '永田','永野','永川','永山','永井','永本','永島','永村',
    '岡','浜','沢','葛','茅','宮','澤','濱','辺','邊','辻','辻','戸',
    '馬','鹿','熊','鳥','鶴','亀','鷹','狐','狸','猫','犬','牛',
    '春','夏','秋','冬','月','日','星','空','風','雨','雪','花',
    // 沖縄系姓
    '与那嶺','喜屋武','我喜屋','具志堅','東江','知念','仲里','仲本','仲間','仲地',
    '宮平','宮城','大城','比嘉','金城','玉城','島袋','花城','親川','照屋',
    '名嘉','平良','城間','渡嘉敷','座喜味','新垣','安次嶺','真栄田','真栄城',
    '嘉手納','屋良','稲嶺','中村','仲村渠','幸地','奥間','砂川','前原',
    // 4文字・複合姓
    '一ノ瀬','三ノ輪','四ツ谷','五十嵐','長曾我部','勅使河原',
    // 追加3文字
    '須賀川','野々山','越智山','三輪田','菅沼田','沼田野','竹ノ内',
    '万里小路',
    // 追加2〜3文字
    '須藤','須田','須野','須山','須川',
    '植田','植野','植村','植木','植原',
    '戸田','戸野','戸川','戸島','戸口',
    '成田','成野','成川','成本','成島',
    '望月','望田',
    '児玉','児野','児島',
    '結城','結野',
    '三輪','三上','三好','三谷',
    '丹羽','丹野','丹田',
    '稲田','稲野','稲垣','稲川','稲村','稲岡',
    '広瀬','広田','広野','広川','広山','広島','広原',
    '桑原','桑田','桑野','桑沢',
    '飯田','飯島','飯野','飯村','飯川',
    '笠原','笠野','笠田','笠山',
    '落合','落田','落野',
    '長坂','長尾','長縄',
    '春日','春本',
    '天野','天田','天川',
    '菅沼','菅島',
    '戸塚','戸沢',
    '児童','兒玉',
    '越智','越田','越野','越川',
    '別府','別所','別野',
    '辰巳','辰野','辰田',
    '黒澤','黒沢',
    '白鳥','白澤',
    '浅沼','浅海',
    '飛田','飛川','飛野',
    '松葉','松枝',
    '宇野','宇田','宇川','宇山',
    '根岸','根本','根田',
    '東條','東郷','東出',
    '柏原','柏野','柏田','柏山',
    '日向','日置','日高','日浦',
    '土居','土橋','土岐',
    '磯部','磯崎','磯田',
    '植松','植西',
    '葛城','葛岡',
    '野瀬','野沢',
    '片山','片野','片田','片川','片岡','片桐',
    '向田','向野','向川',
    '竹沢','竹腰',
    '奥平','奥野','奥沢',
    '大倉','大窪','大池','大城','大串','大矢','大貫',
    '小寺','小暮','小関','小嶋',
    '中條','中嶋','中筋',
    '萩山','萩沢',
    '菱田','菱野',
    '藤浦','藤枝',
    '玉田','玉野','玉川','玉木','玉置',
    '辻本','辻口','辻野',
    '桧山','桧野',
    '栗栖','栗橋',
    '笹川','笹田','笹野','笹山','笹本','笹岡','笹島','笹原',
    '半田','半野',
    '牧田','牧野','牧川','牧山','牧本','牧原',
    '中嶋','中澤',
    '波田','波野','波川',
    '友田','友野','友川','友山',
    '松岡','松葉',
    '種田','種野','種川',
    '粕谷','粕野',
    '峯田','峯野','峯川','峰田','峰野','峰川',
    '葛谷','葛田',
    '仙田','仙野','仙川','仙波',
    '門脇','門間',
    '布田','布野','布川',
    '平賀','平沼','平尾','平澤',
    '太田','太野','太川',
    '大須賀','大曲','大橋','大浦',
    '上坪',
    '高須','高瀬','高見','高尾','高梨','高野',
    '西澤','西條','西出','西尾',
    '浅野','浅田','浅川',
    '野島','野崎',
    '大澤',
    '柴野','柴田','柴山','柴原','柴沢',
    '酒井','酒野','酒田',
    '多田','多野','多川','多田川',
    '安藤','安原','安野',
    '今泉','今中','今橋',
    '宮下','宮澤','宮腰',
    '山際','山澤',
    '川澄','川添',
    '田澤','田頭',
    '吉澤','吉岡',
    '赤嶺','赤羽','赤坂',
    // 1文字
    '王','林','森','山','田','川','島','野','原','坂',
  ];
  // 長い順にソートして最長一致
  return [...new Set(list)].sort((a, b) => b.length - a.length);
})();

function splitJapaneseName(name) {
  const clean = name.replace(/\s/g, '');
  for (const s of JP_SURNAMES) {
    if (clean.startsWith(s) && clean.length > s.length) {
      return s + ' ' + clean.slice(s.length);
    }
  }
  // 辞書未登録: 2文字後にスペース挿入（フォールバック）
  return clean.length > 2 ? clean.slice(0, 2) + ' ' + clean.slice(2) : clean;
}

// ---------- 電話番号自動整形 ----------
function formatPhone(raw) {
  // 全角数字→半角、全角ハイフン→半角、スペース除去
  const normalized = raw
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－ー−‐ ]/g, '')
    .replace(/\s/g, '');
  if (!normalized) return '';

  const digits = normalized.replace(/-/g, '');
  if (!/^\d+$/.test(digits)) return normalized;

  const d = digits;
  const len = d.length;

  if (len === 11) {
    // 携帯・IP電話: 090/080/070/050 → XXX-XXXX-XXXX
    return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  }

  if (len === 10) {
    if (/^(0120|0570|0800|0990)/.test(d)) {
      // フリーダイヤル・ナビダイヤル: XXXX-XXX-XXX
      return `${d.slice(0,4)}-${d.slice(4,7)}-${d.slice(7)}`;
    }
    if (/^(03|06)/.test(d)) {
      // 東京・大阪（2桁市外局番）: XX-XXXX-XXXX
      return `${d.slice(0,2)}-${d.slice(2,6)}-${d.slice(6)}`;
    }
    // その他の市外局番（3桁）: XXX-XXX-XXXX
    return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  }

  return normalized;
}

// ---------- URLパラメータからメンバー追加 ----------
function processUrlParams() {
  const params = new URLSearchParams(window.location.search);
  // ?add=名前:メール  または  ?add=メール（名前省略可）
  const addParam = params.get('add');
  if (!addParam) return;

  let name, email;
  if (addParam.includes(':')) {
    [name, email] = addParam.split(':');
  } else {
    email = addParam;
    name = email.split('@')[0]; // メールのローカル部を仮名前に
  }
  name  = decodeURIComponent(name.trim());
  email = decodeURIComponent(email.trim().toLowerCase());

  if (!email.includes('@')) return;
  if (state.members.some(m => m.calendarId === email)) {
    // 既に登録済みならパラメータだけ消す
    history.replaceState(null, '', window.location.pathname);
    return;
  }

  const lastName = name.replace(/[\s　]/g, '').slice(0, 2);
  const usedColors = state.members.map(m => m.color);
  const color = MEMBER_COLORS.find(c => !usedColors.includes(c))
              || MEMBER_COLORS[state.members.length % MEMBER_COLORS.length];

  state.members.push({ name, lastName, calendarId: email, color });
  saveMembersToStorage();
  // URLパラメータを消す（再読み込みで二重追加しない）
  history.replaceState(null, '', window.location.pathname);
}

// ---------- メンバー管理 ----------
function openMembersModal() {
  renderMembersList();
  document.getElementById('members-modal').classList.remove('hidden');
}

function closeMembersModal() {
  document.getElementById('members-modal').classList.add('hidden');
}

function renderMembersList() {
  const list = document.getElementById('members-list');
  list.innerHTML = state.members.map((m, i) => {
    const connected = state.calendarConnected[m.calendarId];
    const connLabel = connected === false
      ? `<span class="member-conn-label disconnected">未連携</span>`
      : connected === true
        ? `<span class="member-conn-label connected">連携済</span>`
        : '';
    return `
    <div class="member-row">
      <div class="member-row-badge" style="background:${m.color}">${m.lastName}</div>
      <div class="member-row-info">
        <span class="member-row-name">${m.name} ${connLabel}</span>
        <span class="member-row-email">${m.calendarId}</span>
      </div>
      <button class="member-row-del" onclick="removeMember(${i})">削除</button>
    </div>`;
  }).join('');
}

function addMember() {
  const nameEl  = document.getElementById('new-member-name');
  const emailEl = document.getElementById('new-member-email');
  const name  = nameEl.value.trim();
  const email = emailEl.value.trim().toLowerCase();

  if (!name || !email) return;
  if (!email.includes('@')) { alert('正しいメールアドレスを入力してください'); return; }
  if (state.members.some(m => m.calendarId === email)) { alert('このメールアドレスは既に登録されています'); return; }

  const lastName = name.replace(/[\s　]/g, '').slice(0, 2);
  const usedColors = state.members.map(m => m.color);
  const color = MEMBER_COLORS.find(c => !usedColors.includes(c)) || MEMBER_COLORS[state.members.length % MEMBER_COLORS.length];

  state.members.push({ name, lastName, calendarId: email, color });
  saveMembersToStorage();
  renderMembersList();
  nameEl.value = '';
  emailEl.value = '';
  loadAndRender();
}

function removeMember(index) {
  if (state.members.length <= 1) { alert('メンバーは1名以上必要です'); return; }
  if (!confirm(`「${state.members[index].name}」を削除しますか？`)) return;
  state.members.splice(index, 1);
  saveMembersToStorage();
  renderMembersList();
  loadAndRender();
}

function signOut() {
  if (!confirm('サインアウトしますか？')) return;
  localStorage.removeItem('sakupita_signed_in');
  localStorage.removeItem('sakupita_auth_time');
  localStorage.removeItem('sakupita_token');
  localStorage.removeItem('sakupita_busy_cache');
  state.authReady = false;
  try {
    const token = gapi.client.getToken();
    if (token) google.accounts.oauth2.revoke(token.access_token, () => {});
    gapi.client.setToken(null);
  } catch(e) {}
  state.busyData = {};
  state.calendarConnected = {};
  closeMembersModal();
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('signin-screen').classList.remove('hidden');
}

// ---------- URLからメンバー追加 ----------
function addMemberByUrl() {
  const input = document.getElementById('members-url-input');
  const urlStr = input.value.trim();
  if (!urlStr) return;

  // calendar.app.google URL → CORSプロキシ経由でメールアドレスを抽出
  if (urlStr.includes('calendar.app.google')) {
    resolveCalendarAppUrl(urlStr, input);
    return;
  }

  let addParam = null;
  try {
    const url = urlStr.includes('?') ? new URL(urlStr.includes('://') ? urlStr : 'https://dummy/' + urlStr) : null;
    addParam = url ? url.searchParams.get('add') : null;
    if (!addParam) {
      const qs = urlStr.startsWith('?') ? urlStr.slice(1) : urlStr;
      addParam = new URLSearchParams(qs).get('add');
    }
  } catch(e) {}

  if (!addParam) { alert('有効な連携URLを入力してください'); return; }

  let name, email;
  if (addParam.includes(':')) {
    [name, email] = addParam.split(':');
  } else {
    email = addParam;
    name = email.split('@')[0];
  }
  name  = decodeURIComponent(name.trim());
  email = decodeURIComponent(email.trim().toLowerCase());

  if (!email.includes('@')) { alert('メールアドレスが正しくありません'); return; }
  if (state.members.some(m => m.calendarId === email)) { alert('このメールアドレスは既に登録されています'); return; }

  addMemberFromEmail(name, email);
  input.value = '';
}

async function resolveCalendarAppUrl(urlStr, input) {
  const btn = document.getElementById('members-url-add-btn');
  btn.disabled = true;
  btn.textContent = '解析中...';

  const proxies = [
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  let html = '';
  for (const makeUrl of proxies) {
    try {
      const res = await fetch(makeUrl(urlStr), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        html = data.contents || data.body || '';
      } else {
        html = await res.text();
      }
      if (html.length > 500) break; // 取得成功
    } catch(e) { continue; }
  }

  btn.disabled = false;
  btn.textContent = '追加';

  // メールアドレスを抽出（Googleサービス系を除外）
  const emailMatches = html.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || [];
  const filtered = [...new Set(emailMatches)].filter(e =>
    !e.match(/google|gstatic|googleapis|googleusercontent|sentry|w3\.org|schema\.org|example|noreply|support|feedback/i)
  );

  // 名前を取得（title タグから）
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].replace(/\s*[-|–].*$/, '').trim() : '';

  if (filtered.length > 0) {
    let selectedEmail = filtered[0];
    if (filtered.length > 1) {
      const choice = prompt(`複数のメールアドレスが見つかりました。番号を選んでください:\n\n${filtered.map((e, i) => `${i+1}: ${e}`).join('\n')}`);
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < filtered.length) selectedEmail = filtered[idx];
    }
    const name = rawTitle || selectedEmail.split('@')[0];
    addMemberFromEmail(name, selectedEmail);
    input.value = '';
  } else {
    // 自動取得失敗 → 手動入力
    const name = rawTitle || '';
    const nameHint = name ? `「${name}」` : 'この方';
    const email = prompt(`${nameHint}のGmailアドレスを入力してください:\n（URLから自動取得できませんでした）`);
    if (email && email.includes('@')) {
      addMemberFromEmail(name || email.split('@')[0], email.trim().toLowerCase());
      input.value = '';
    }
  }
}

function addMemberFromEmail(name, email) {
  if (state.members.some(m => m.calendarId === email)) {
    alert('このメールアドレスは既に登録されています');
    return;
  }
  const lastName = name.replace(/[\s　]/g, '').slice(0, 2);
  const usedColors = state.members.map(m => m.color);
  const color = MEMBER_COLORS.find(c => !usedColors.includes(c)) || MEMBER_COLORS[state.members.length % MEMBER_COLORS.length];
  state.members.push({ name, lastName, calendarId: email, color });
  saveMembersToStorage();
  renderMembersList();
  loadAndRender();
}
