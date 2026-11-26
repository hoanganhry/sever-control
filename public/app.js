const groups = [
  { title: 'ESP & hiển thị', description: 'Thông tin và khung mục tiêu', features: [
    ['esp', 'Bật ESP', 'Hiển thị lớp thông tin ESP'],
    ['box', 'Khung mục tiêu', 'Vẽ khung quanh mục tiêu'],
    ['cornerBox', 'Khung góc', 'Dùng khung góc 2D'],
    ['box3d', 'Khung 3D', 'Dùng khung không gian 3D'],
    ['playerName', 'Tên người chơi', 'Hiển thị tên'],
    ['healthBar', 'Thanh máu', 'Hiển thị lượng máu'],
    ['distance', 'Khoảng cách', 'Hiển thị khoảng cách'],
    ['skeleton', 'Khung xương', 'Hiển thị bộ xương'],
    ['headMarker', 'Đánh dấu đầu', 'Hiển thị vị trí đầu'],
    ['xyz', 'Trục XYZ', 'Hiển thị tọa độ XYZ'],
    ['line', 'Đường nối', 'Nối mục tiêu với màn hình'],
    ['enemyCounter', 'Đếm người chơi', 'Hiển thị số người chơi']
  ]},
  { title: 'Ngắm', description: 'Điều khiển ngắm và hỗ trợ bắn', features: [
    ['aimbot', 'Aimbot', 'Ngắm tự động khi bắn'],
    ['silentAim', 'Silent Aim', 'Chế độ ngắm im lặng'],
    ['autoFire', 'Auto Fire', 'Tự động bắn'],
    ['aimKill', 'Aim Kill', 'Chế độ aim kill'],
    ['aimLine', 'Đường ngắm', 'Hiển thị đường tới mục tiêu'],
    ['fovCircle', 'Vòng FOV', 'Hiển thị vùng FOV'],
    ['aimlagScope', 'Aimlag Scope', 'Kích hoạt khi giữ scope']
  ]},
  { title: 'Điều khiển khác', description: 'Các thiết lập bổ sung của menu', features: [
    ['hideAutofireAnimation', 'Ẩn hoạt ảnh Auto Fire', 'Ẩn hoạt ảnh bắn tự động'],
    ['noReload', 'No Reload', 'Thiết lập không nạp đạn'],
    ['rapidFire', 'Rapid Fire', 'Thiết lập tốc độ bắn'],
    ['noRecoil', 'No Recoil', 'Thiết lập độ giật'],
    ['runSpeedX5', 'Run Speed x5', 'Tăng tốc độ chạy']
  ]}
];

const loginView = document.querySelector('#loginView');
const dashboardView = document.querySelector('#dashboardView');
const loginMessage = document.querySelector('#loginMessage');
const loginForm = document.querySelector('#loginForm');
const featureGroups = document.querySelector('#featureGroups');
const saveButton = document.querySelector('#saveButton');
const saveMessage = document.querySelector('#saveMessage');
const saveDot = document.querySelector('#saveDot');
const toast = document.querySelector('#toast');
let csrfToken = '';
let toastTimer;
let dirty = false;
let currentRevision = 0;

function announce(message, kind = 'info') {
  toast.textContent = message;
  toast.dataset.kind = kind;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (csrfToken && options.csrf) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `request_failed_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function setDirty(value) {
  dirty = value;
  saveMessage.textContent = value ? 'Có thay đổi chưa lưu' : 'Đã đồng bộ';
  saveDot.classList.toggle('pending', value);
  saveButton.disabled = !value;
}

function setView(isLoggedIn) {
  loginView.hidden = isLoggedIn;
  dashboardView.hidden = !isLoggedIn;
}

function createFeatureCards() {
  featureGroups.innerHTML = '';
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'feature-section';
    const heading = document.createElement('div');
    heading.className = 'group-heading';
    const title = document.createElement('h3');
    title.textContent = group.title;
    const description = document.createElement('p');
    description.textContent = group.description;
    heading.append(title, description);
    const grid = document.createElement('div');
    grid.className = 'feature-grid';
    for (const [key, label, detail] of group.features) {
      const card = document.createElement('label');
      card.className = 'feature-card';
      card.dataset.feature = key;
      const copy = document.createElement('span');
      copy.className = 'feature-copy';
      const name = document.createElement('strong');
      name.textContent = label;
      const sub = document.createElement('small');
      sub.textContent = detail;
      copy.append(name, sub);
      const switchWrap = document.createElement('span');
      switchWrap.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.key = key;
      input.setAttribute('aria-label', label);
      const track = document.createElement('span');
      track.className = 'switch-track';
      switchWrap.append(input, track);
      card.append(copy, switchWrap);
      grid.append(card);
      input.addEventListener('change', () => {
        normalizeFeatureChoices(key, input.checked);
        setDirty(true);
      });
    }
    section.append(heading, grid);
    featureGroups.append(section);
  }
}

function normalizeFeatureChoices(changedKey, enabled) {
  const changes = {
    box3d: enabled ? { cornerBox: false } : {},
    cornerBox: enabled ? { box3d: false } : {},
    aimbot: enabled ? { silentAim: false } : {},
    silentAim: enabled ? { aimbot: false } : {},
    aimKill: enabled ? { autoFire: false } : {}
  }[changedKey] || {};
  for (const [key, value] of Object.entries(changes)) {
    const input = document.querySelector(`input[data-key="${key}"]`);
    if (input) input.checked = value;
  }
}

function readSettings() {
  const features = {};
  for (const input of document.querySelectorAll('input[data-key]')) features[input.dataset.key] = input.checked;
  return {
    features,
    aim: {
      fov: Number(document.querySelector('#aimFov').value),
      range: Number(document.querySelector('#aimRange').value),
      headChance: Number(document.querySelector('#headChance').value),
      targetPart: Number(document.querySelector('#targetPart').value)
    },
    esp: {
      range: Number(document.querySelector('#espRange').value),
      lineOrigin: Number(document.querySelector('#lineOrigin').value),
      healthStyle: Number(document.querySelector('#healthStyle').value)
    },
    visuals: {
      fovOpacity: Number(document.querySelector('#fovOpacity').value),
      fovThickness: Number(document.querySelector('#fovThickness').value)
    }
  };
}

function fillSettings(settings) {
  for (const input of document.querySelectorAll('input[data-key]')) {
    input.checked = Boolean(settings.features?.[input.dataset.key]);
  }
  const values = {
    aimFov: settings.aim?.fov ?? 150,
    aimRange: settings.aim?.range ?? 150,
    headChance: settings.aim?.headChance ?? 100,
    targetPart: settings.aim?.targetPart ?? 0,
    espRange: settings.esp?.range ?? 150,
    lineOrigin: settings.esp?.lineOrigin ?? 0,
    healthStyle: settings.esp?.healthStyle ?? 1,
    fovOpacity: settings.visuals?.fovOpacity ?? 1,
    fovThickness: settings.visuals?.fovThickness ?? 2
  };
  for (const [id, value] of Object.entries(values)) document.querySelector(`#${id}`).value = value;
  updateRangeLabels();
}

function updateRangeLabels() {
  const labels = {
    aimFov: value => `${Math.round(value)} px`,
    aimRange: value => `${Math.round(value)} m`,
    headChance: value => `${Math.round(value)}%`,
    espRange: value => `${Math.round(value)} m`,
    fovOpacity: value => `${Math.round(Number(value) * 100)}%`,
    fovThickness: value => `${Number(value).toFixed(1)} px`
  };
  for (const [id, format] of Object.entries(labels)) {
    document.querySelector(`#${id}Value`).textContent = format(document.querySelector(`#${id}`).value);
  }
}

function setConnection(client) {
  const badge = document.querySelector('#connectionBadge');
  badge.classList.toggle('online', Boolean(client?.online));
  badge.classList.toggle('offline', !client?.online);
  badge.querySelector('span').textContent = client?.online ? 'Client đang kết nối' : 'Chưa kết nối';
}

function updateMeta(data) {
  currentRevision = data.revision;
  document.querySelector('#revisionValue').textContent = `#${data.revision}`;
  document.querySelector('#updatedValue').textContent = new Date(data.updatedAt).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' });
  setConnection(data.client);
  if (data.csrf) csrfToken = data.csrf;
}

async function loadState({ preserveDirty = false } = {}) {
  const data = await api('/api/admin/state');
  updateMeta(data);
  if (!(preserveDirty && dirty)) fillSettings(data.settings);
  if (!(preserveDirty && dirty)) setDirty(false);
  return data;
}

async function saveState() {
  saveButton.disabled = true;
  saveButton.classList.add('loading');
  try {
    const data = await api('/api/admin/state', { method: 'PUT', csrf: true, body: { settings: readSettings() } });
    updateMeta(data);
    setDirty(false);
    announce('Đã lưu cấu hình mới. Client sẽ nhận trong vài giây.', 'success');
  } catch (error) {
    saveButton.disabled = false;
    announce(error.status === 401 ? 'Phiên đăng nhập đã hết hạn.' : 'Không lưu được cấu hình.', 'error');
    if (error.status === 401) setView(false);
  } finally {
    saveButton.classList.remove('loading');
  }
}

async function restoreSession() {
  try {
    createFeatureCards();
    const data = await loadState();
    setView(true);
    setDirty(false);
    return data;
  } catch (error) {
    if (error.status !== 401) announce('Không tải được trang quản trị.', 'error');
    setView(false);
    return null;
  }
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = loginForm.querySelector('button');
  button.disabled = true;
  loginMessage.textContent = '';
  try {
    const data = await api('/api/admin/login', { method: 'POST', body: { password: document.querySelector('#password').value } });
    csrfToken = data.csrf;
    document.querySelector('#password').value = '';
    await restoreSession();
  } catch {
    loginMessage.textContent = 'Mật khẩu không đúng hoặc máy chủ chưa sẵn sàng.';
  } finally {
    button.disabled = false;
  }
});

saveButton.addEventListener('click', saveState);
document.querySelector('#refreshButton').addEventListener('click', async () => {
  try {
    await loadState();
    announce('Đã tải cấu hình mới nhất.', 'success');
  } catch {
    announce('Không tải được cấu hình.', 'error');
  }
});
document.querySelector('#disableAllButton').addEventListener('click', () => {
  for (const input of document.querySelectorAll('input[data-key]')) input.checked = false;
  setDirty(true);
  announce('Đã tắt các công tắc. Nhấn Lưu cấu hình để áp dụng.', 'info');
});
document.querySelector('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST', csrf: true, body: {} }); } catch { /* The session may already have expired. */ }
  csrfToken = '';
  setView(false);
});
for (const input of document.querySelectorAll('input[type="range"], select')) {
  input.addEventListener('input', () => { updateRangeLabels(); setDirty(true); });
  input.addEventListener('change', () => setDirty(true));
}

createFeatureCards();
restoreSession();
setInterval(async () => {
  if (dashboardView.hidden) return;
  try { await loadState({ preserveDirty: true }); }
  catch (error) { if (error.status === 401) setView(false); }
}, 10_000);
