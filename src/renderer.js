const balanceEl = document.getElementById('balance');
const statusPillEl = document.getElementById('status-pill');
const updatedEl = document.getElementById('updated');
const hintEl = document.getElementById('hint');
const refreshButton = document.getElementById('refresh');
const openDashboardButton = document.getElementById('open-dashboard');

function setState(state) {
  document.body.classList.remove('loading', 'ok', 'error');
  document.body.classList.add(state.status === 'ok' ? 'ok' : state.status === 'error' ? 'error' : 'loading');

  balanceEl.textContent = state.balanceText || '--';
  statusPillEl.textContent =
    state.status === 'ok' ? '已更新' : state.status === 'error' ? '錯誤' : '載入中';

  if (state.lastUpdated) {
    updatedEl.textContent = `更新於 ${new Date(state.lastUpdated).toLocaleString('zh-TW')}`;
  } else {
    updatedEl.textContent = '尚未更新';
  }

  if (state.error) {
    hintEl.textContent = `抓取失敗：${state.error}`;
  } else if (state.rawText) {
    hintEl.textContent = '每 5 分鐘自動更新一次';
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

openDashboardButton.addEventListener('click', () => {
  window.codexBalance.openDashboard();
});

window.codexBalance.getState().then(setState);
window.codexBalance.onStateUpdate(setState);
