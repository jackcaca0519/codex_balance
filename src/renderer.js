const balanceEl = document.getElementById('balance');
const statusPillEl = document.getElementById('status-pill');
const updatedEl = document.getElementById('updated');
const resetAtEl = document.getElementById('reset-at');
const hintEl = document.getElementById('hint');
const refreshButton = document.getElementById('refresh');
const openDashboardButton = document.getElementById('open-dashboard');
const subBalanceEl = document.getElementById('sub-balance');
const orbitalMeterEl = document.getElementById('orbital-meter');
const orbitalMeterProgressEl = document.getElementById('orbital-meter-progress');
const orbitalMeterValueEl = document.getElementById('orbital-meter-value');
let currentState = null;
let isRefreshing = false;
let isOpeningDashboard = false;
let displayedPercent = 0;
let meterAnimationFrame = null;
const ORBITAL_CIRCUMFERENCE = 2 * Math.PI * 28;
const STATUS_ICONS = {
  loading: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v2.2M8 11.3v2.2M3.9 3.9l1.5 1.5M10.6 10.6l1.5 1.5M2.5 8h2.2M11.3 8h2.2M3.9 12.1l1.5-1.5M10.6 5.4l1.5-1.5"/></svg>',
  refreshing: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 0 0 3.6 4.2M3 2.9v2.9h2.9"/><path d="M3 10.5A5.5 5.5 0 0 0 12.4 11.8M13 13.1v-2.9h-2.9"/></svg>',
  opening: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5h6.5V10M12.5 3.5 7 9"/><path d="M13 7.5v4a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h4"/></svg>',
  login: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6" rx="1.5"/><path d="M5.5 7V5.8a2.5 2.5 0 1 1 5 0V7"/></svg>',
  error: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.2 13 12H3z"/><path d="M8 6.2v2.9M8 11.2h.01"/></svg>',
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.3 2.6 2.6 6.4-6.4"/></svg>',
};

function parsePercent(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)%\s*剩餘/);
  if (!match) return null;
  return Math.max(0, Math.min(100, Number(match[1])));
}

function animateMeterTo(targetPercent) {
  const safeTarget = Number.isFinite(targetPercent) ? targetPercent : 0;
  if (meterAnimationFrame) cancelAnimationFrame(meterAnimationFrame);

  const startValue = displayedPercent;
  const delta = safeTarget - startValue;
  const duration = 720;
  const startedAt = performance.now();

  const tick = (now) => {
    const elapsed = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    displayedPercent = startValue + delta * eased;
    const percentLabel = `${Math.round(displayedPercent)}%`;
    document.documentElement.style.setProperty('--meter-pct', percentLabel);
    orbitalMeterValueEl.textContent = percentLabel;
    orbitalMeterProgressEl.style.strokeDasharray = `${ORBITAL_CIRCUMFERENCE}`;
    orbitalMeterProgressEl.style.strokeDashoffset = `${ORBITAL_CIRCUMFERENCE * (1 - displayedPercent / 100)}`;

    if (elapsed < 1) {
      meterAnimationFrame = requestAnimationFrame(tick);
    } else {
      displayedPercent = safeTarget;
      orbitalMeterValueEl.textContent = `${Math.round(safeTarget)}%`;
      document.documentElement.style.setProperty('--meter-pct', `${Math.round(safeTarget)}%`);
      orbitalMeterProgressEl.style.strokeDashoffset = `${ORBITAL_CIRCUMFERENCE * (1 - safeTarget / 100)}`;
      meterAnimationFrame = null;
    }
  };

  meterAnimationFrame = requestAnimationFrame(tick);
}

function syncMeter(state) {
  const parsedPercent = parsePercent(state?.balanceText);
  const hasPercent = parsedPercent !== null;

  orbitalMeterEl.classList.toggle('is-passive', !hasPercent);

  if (hasPercent) {
    subBalanceEl.textContent = 'Weekly usage remaining';
    animateMeterTo(parsedPercent);
    return;
  }

  if (meterAnimationFrame) {
    cancelAnimationFrame(meterAnimationFrame);
    meterAnimationFrame = null;
  }
  displayedPercent = 0;
  document.documentElement.style.setProperty('--meter-pct', '0%');
  orbitalMeterProgressEl.style.strokeDasharray = `${ORBITAL_CIRCUMFERENCE}`;
  orbitalMeterProgressEl.style.strokeDashoffset = `${ORBITAL_CIRCUMFERENCE}`;
  subBalanceEl.textContent = state?.status === 'error' ? 'Usage signal unavailable' : 'Waiting for usage data';
  orbitalMeterValueEl.textContent = '--';
}

function syncStatusPill(state = currentState) {
  let statusKey = 'loading';
  let label = '載入中';

  if (isOpeningDashboard) {
    statusKey = 'opening';
    label = '開啟中';
  } else if (isRefreshing) {
    statusKey = 'refreshing';
    label = '刷新中';
  } else if (!state) {
    statusKey = 'loading';
    label = '載入中';
  } else if (state.balanceText === '請先登入') {
    statusKey = 'login';
    label = '請登入';
  } else if (state.status === 'error') {
    statusKey = 'error';
    label = '錯誤';
  } else if (state.status === 'ok') {
    statusKey = 'ok';
    label = '已更新';
  }

  statusPillEl.innerHTML = STATUS_ICONS[statusKey];
  statusPillEl.dataset.status = statusKey;
  statusPillEl.setAttribute('aria-label', label);
  statusPillEl.setAttribute('title', label);
}

window.codexBalance.onRefreshStarted(({ startedAt, forceReload }) => {
  isRefreshing = true;
  updatedEl.textContent = `刷新中 ${new Date(startedAt).toLocaleString('zh-TW')}`;
  hintEl.textContent = forceReload ? '正在重新載入分析頁並抓最新餘額...' : '正在背景更新...';
  syncStatusPill();
});

function setState(state) {
  currentState = state;
  isRefreshing = false;
  document.body.classList.remove('loading', 'ok', 'error');
  document.body.classList.add(state.status === 'ok' ? 'ok' : state.status === 'error' ? 'error' : 'loading');

  balanceEl.textContent = state.balanceText || '--';
  balanceEl.classList.toggle('long', (state.balanceText || '').length > 28);
  syncMeter(state);
  syncStatusPill(state);

  if (state.lastUpdated) {
    updatedEl.textContent = `更新於 ${new Date(state.lastUpdated).toLocaleString('zh-TW')}`;
  } else {
    updatedEl.textContent = '尚未更新';
  }

  resetAtEl.textContent = state.resetAtText ? `重設時間 ${state.resetAtText}` : '重設時間 --';

  if (state.error) {
    hintEl.textContent = `抓取失敗：${state.error}`;
  } else if (state.balanceText === '請先登入') {
    hintEl.textContent = '目前讀到的是登入頁，請在儀表板視窗完成登入';
  } else if (state.rawText) {
    hintEl.textContent = '每 2 分鐘自動更新一次';
  } else {
    hintEl.textContent = '請先登入並打開 Usage Dashboard';
  }
}

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = '更新中';
  try {
    const state = await window.codexBalance.refreshNow();
    setState(state);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = '重整';
  }
});

openDashboardButton.addEventListener('click', async () => {
  isOpeningDashboard = true;
  syncStatusPill();
  openDashboardButton.disabled = true;
  const originalText = openDashboardButton.textContent;
  openDashboardButton.textContent = '開啟中';
  hintEl.textContent = '正在打開 Usage 視窗...';
  try {
    await window.codexBalance.openDashboard();
    hintEl.textContent = '已打開 Usage 視窗';
  } catch (error) {
    hintEl.textContent = `開啟失敗：${error?.message || error}`;
  } finally {
    isOpeningDashboard = false;
    syncStatusPill();
    openDashboardButton.disabled = false;
    openDashboardButton.textContent = originalText;
  }
});

window.codexBalance.getState().then(setState);
window.codexBalance.onStateUpdate(setState);
