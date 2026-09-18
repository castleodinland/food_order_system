/* ============ 点餐小屋 前端应用 v1.1.0 ============ */

const SLOTS = [
  { key: 'breakfast', name: '早餐', emoji: '🌅' },
  { key: 'lunch', name: '午餐', emoji: '🍚' },
  { key: 'afternoon', name: '下午茶', emoji: '🍰' },
  { key: 'dinner', name: '晚餐', emoji: '🍲' },
  { key: 'late', name: '夜宵', emoji: '🌙' },
];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const state = {
  view: 'role',
  hasPassword: false,
  today: '',
  calMonth: '',
  selDate: '',
  selSlot: '',
  cart: [],
  editingDish: null,
  orderCache: {},
  categories: [],    // [{id, name, emoji}]
  catMap: {},        // name -> {emoji}
};

const app = () => document.getElementById('app');
const modalRoot = () => document.getElementById('modal-root');

/* ---------------- 基础工具 ---------------- */

async function api(path, opts = {}) {
  const o = Object.assign({ headers: {} }, opts);
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(path, o);
  let data = {};
  try { data = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) throw new Error(data.error || '请求失败，请重试');
  return data;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function parseDate(dstr) {
  const [y, m, d] = dstr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return { y, m, d, wd: WEEKDAYS[dt.getDay()], wdNum: dt.getDay() };
}

function dateTitle(dstr) {
  const p = parseDate(dstr);
  return p.y + '年' + p.m + '月' + p.d + '日 星期' + p.wd;
}

function shortTitle(dstr) {
  const p = parseDate(dstr);
  return p.m + '月' + p.d + '日 · 星期' + p.wd;
}

function addDays(dstr, n) {
  const [y, m, d] = dstr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return dt.getFullYear() + '-' + mm + '-' + dd;
}

function slotInfo(key) { return SLOTS.find(s => s.key === key) || { key, name: key, emoji: '🍽️' }; }

function dishInSlot(dish, slotKey) {
  return dish.slots.includes('all') || dish.slots.includes(slotKey);
}

function catEmoji(catName) {
  return (state.catMap[catName] && state.catMap[catName].emoji) || '🍽️';
}

function dishPhotoHTML(d, big) {
  if (d.hasPhoto) {
    return '<img class="dish-photo' + (big ? '' : '') + '" src="/api/photo/' + d.id + '" alt="' + esc(d.name) + '" loading="lazy">';
  }
  return '<div class="dish-photo">' + catEmoji(d.category) + '</div>';
}

function openModal(html) {
  modalRoot().innerHTML = '<div class="modal-mask"><div class="modal">' + html + '</div></div>';
  modalRoot().querySelector('.modal-mask').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  return modalRoot().querySelector('.modal');
}

function closeModal() { modalRoot().innerHTML = ''; }

async function loadCategories() {
  if (state.categories.length) return;
  try {
    const data = await api('/api/categories');
    state.categories = data.categories || [];
    state.catMap = {};
    state.categories.forEach(c => { state.catMap[c.name] = c; });
  } catch (e) { /* ignore */ }
}

/* ---------------- 渲染入口 ---------------- */

async function render() {
  const v = state.view;
  if (v === 'role') return renderRole();
  if (v === 'chefAuth') return renderChefAuth();
  if (v === 'chefHome') return renderChefHome();
  if (v === 'chefDishes') return renderChefDishes();
  if (v === 'chefCategories') return renderChefCategories();
  if (v === 'chefOrders') return renderChefOrders();
  if (v === 'chefSlotDetail') return renderChefSlotDetail();
  if (v === 'chefResetPw') return renderChefResetPw();
  if (v === 'customerCal') return renderCustomerCal();
  if (v === 'customerDay') return renderCustomerDay();
  if (v === 'slotEditor') return renderSlotEditor();
}

/* ---------------- 角色选择 ---------------- */

function renderRole() {
  app().innerHTML = `
    <div class="role-wrap">
      <div style="text-align:center;margin-bottom:0.5rem;">
        <div style="font-size:4.5rem;line-height:1;">🍚</div>
        <div class="page-title">欢迎来到点餐小屋</div>
        <div class="page-sub">请选择你的角色吧～</div>
      </div>
      <button class="role-btn chef" onclick="goto('chefAuth')">
        <span class="emoji">🧑‍🍳</span>我是厨师
        <span class="hint">录入菜品 · 查看顾客订餐</span>
      </button>
      <button class="role-btn customer" onclick="customerEnter()">
        <span class="emoji">🍔</span>我是顾客
        <span class="hint">查看历史点餐 · 安排今天吃什么</span>
      </button>
    </div>`;
}

function goto(view) { state.view = view; render(); }

async function customerEnter() {
  if (!state.today) {
    try { const s = await api('/api/state'); state.today = s.today; } catch (e) { /* ignore */ }
  }
  state.calMonth = state.today ? state.today.slice(0, 7) : new Date().toISOString().slice(0, 7);
  goto('customerCal');
}

/* ---------------- 厨师：密码 ---------------- */

async function renderChefAuth() {
  try {
    const s = await api('/api/state');
    state.hasPassword = s.hasPassword;
    if (s.chefAuthed) return goto('chefHome');
  } catch (e) { /* ignore */ }

  const isSetup = !state.hasPassword;
  app().innerHTML = `
    <div class="container" style="max-width:520px;">
      <div class="back-bar"><button class="btn btn-plain btn-sm" onclick="goto('role')">⬅ 返回</button></div>
      <div class="page-title">${isSetup ? '🔐 初次使用，请设置密码' : '🔐 厨师请输入密码'}</div>
      <div class="page-sub">${isSetup ? '设置后每次进入都需要输入哦' : '欢迎回来，大厨！'}</div>
      <div class="card">
        <label class="field-label">密码（至少 4 位）</label>
        <input type="password" id="pw1" placeholder="请输入密码">
        ${isSetup ? '<label class="field-label">再输一次密码</label><input type="password" id="pw2" placeholder="请再输入一次">' : ''}
        <div style="margin-top:1.4rem;text-align:center;">
          <button class="btn btn-big" onclick="chefSubmitPw()">${isSetup ? '✅ 设置并进入' : '🚪 进入厨房'}</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => { const el = document.getElementById('pw1'); if (el) el.focus(); }, 50);
}

async function chefSubmitPw() {
  const pw1 = document.getElementById('pw1').value.trim();
  try {
    if (!state.hasPassword) {
      const pw2 = document.getElementById('pw2').value.trim();
      if (pw1.length < 4) return toast('密码至少 4 位哦～', 'err');
      if (pw1 !== pw2) return toast('两次输入的密码不一样～', 'err');
      await api('/api/chef/setup', { method: 'POST', body: { password: pw1 } });
    } else {
      await api('/api/chef/login', { method: 'POST', body: { password: pw1 } });
    }
    toast('欢迎回来，大厨！🍳', 'ok');
    goto('chefHome');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 厨师：主页 ---------------- */

async function renderChefHome() {
  let hasNew = false;
  try { const c = await api('/api/changes'); hasNew = c.dates.length > 0; } catch (e) { /* ignore */ }
  app().innerHTML = `
    <div class="container">
      <div class="navbar">
        <div class="title">🧑‍🍳 厨房工作台</div>
        <button class="btn btn-plain btn-sm" onclick="chefLogout()">👋 退出</button>
      </div>
      <div class="home-grid">
        <button class="home-btn" style="background:linear-gradient(150deg,#ffb35c,#ff8fab)" onclick="goto('chefDishes')">
          <span class="emoji">📝</span>录入菜品
        </button>
        <button class="home-btn" style="background:linear-gradient(150deg,#a8e6cf,#dcedc1)" onclick="goto('chefCategories')">
          <span class="emoji">🏷️</span>品类管理
        </button>
        <button class="home-btn" style="background:linear-gradient(150deg,#6ecbff,#9d8fff)" onclick="goto('chefOrders')">
          ${hasNew ? '<span class="red-dot"></span>' : ''}
          <span class="emoji">📋</span>查看顾客订餐列表
          ${hasNew ? '<span style="font-size:1rem;font-weight:normal;">有新变动哦！</span>' : ''}
        </button>
        <button class="home-btn" style="background:linear-gradient(150deg,#e0e0e0,#c8c8c8)" onclick="goto('chefResetPw')">
          <span class="emoji">🔑</span>重设密码
        </button>
      </div>
    </div>`;
}

async function chefLogout() {
  try { await api('/api/chef/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  state.hasPassword = true;
  goto('role');
}

/* ---------------- 厨师：重设密码 ---------------- */

function renderChefResetPw() {
  app().innerHTML = `
    <div class="container" style="max-width:520px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('chefHome')">⬅ 返回</button>
          <div class="title">🔑 重设密码</div>
        </div>
      </div>
      <div class="card">
        <div class="page-sub">修改后下次进入需要使用新密码哦～</div>
        <label class="field-label">当前密码</label>
        <input type="password" id="rp-old" placeholder="请输入当前密码">
        <label class="field-label">新密码（至少 4 位）</label>
        <input type="password" id="rp-new1" placeholder="请输入新密码">
        <label class="field-label">再输一次新密码</label>
        <input type="password" id="rp-new2" placeholder="请再输入一次新密码">
        <div style="margin-top:1.4rem;text-align:center;">
          <button class="btn btn-big" onclick="chefResetPwSubmit()">✅ 确认修改</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => { const el = document.getElementById('rp-old'); if (el) el.focus(); }, 50);
}

async function chefResetPwSubmit() {
  const old = document.getElementById('rp-old').value.trim();
  const pw1 = document.getElementById('rp-new1').value.trim();
  const pw2 = document.getElementById('rp-new2').value.trim();
  if (!old) return toast('请输入当前密码～', 'err');
  if (pw1.length < 4) return toast('新密码至少 4 位哦～', 'err');
  if (pw1 !== pw2) return toast('两次输入的新密码不一样～', 'err');
  try {
    await api('/api/chef/reset', { method: 'POST', body: { oldPassword: old, newPassword: pw1 } });
    toast('密码修改成功！请记住新密码哦 🔑', 'ok');
    goto('chefHome');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 厨师：品类管理 ---------------- */

async function renderChefCategories() {
  await loadCategories();
  const items = state.categories.map(c => `
    <div class="cat-manage-item">
      <span class="cat-emoji-big">${esc(c.emoji)}</span>
      <div class="cat-info">${esc(c.name)}</div>
      <div style="display:flex;gap:0.5rem;">
        <button class="btn btn-blue btn-sm" onclick="catEdit(${c.id}, '${esc(c.name).replace(/'/g, '')}', '${esc(c.emoji)}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="catDelete(${c.id}, '${esc(c.name).replace(/'/g, '')}')">🗑</button>
      </div>
    </div>`).join('');

  app().innerHTML = `
    <div class="container" style="max-width:720px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('chefHome')">⬅ 返回</button>
          <div class="title">🏷️ 品类管理</div>
        </div>
        <button class="btn btn-green btn-sm" onclick="catAdd()">➕ 新增品类</button>
      </div>
      ${state.categories.length === 0
        ? '<div class="card text-center" style="padding:3rem;"><div style="font-size:3rem;">🏷️</div><div class="muted">还没有品类，点击右上角"新增品类"开始吧！</div></div>'
        : items}
    </div>`;
}

function catAdd() {
  const m = openModal(`
    <h3>➕ 新增品类</h3>
    <label class="field-label">品类名称 *</label>
    <input type="text" id="cat-name" placeholder="例如：主食" maxlength="20">
    <label class="field-label">Emoji 图标</label>
    <input type="text" id="cat-emoji" placeholder="例如：🍚" maxlength="4" value="🍽️">
    <hr class="divider">
    <div style="display:flex;gap:0.8rem;justify-content:center;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn btn-big" onclick="catAddSave()">💾 保存</button>
    </div>`);
}

async function catAddSave() {
  const name = document.getElementById('cat-name').value.trim();
  const emoji = document.getElementById('cat-emoji').value.trim() || '🍽️';
  if (!name) return toast('请填写品类名称～', 'err');
  try {
    await api('/api/categories', { method: 'POST', body: { name, emoji } });
    state.categories = []; // 刷新缓存
    closeModal();
    toast('品类添加成功！🎉', 'ok');
    renderChefCategories();
  } catch (e) { toast(e.message, 'err'); }
}

function catEdit(id, name, emoji) {
  const m = openModal(`
    <h3>✏️ 编辑品类</h3>
    <label class="field-label">品类名称 *</label>
    <input type="text" id="cat-name" value="${esc(name)}" maxlength="20">
    <label class="field-label">Emoji 图标</label>
    <input type="text" id="cat-emoji" value="${esc(emoji)}" maxlength="4">
    <hr class="divider">
    <div style="display:flex;gap:0.8rem;justify-content:center;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn btn-big" onclick="catEditSave(${id})">💾 保存</button>
    </div>`);
}

async function catEditSave(id) {
  const name = document.getElementById('cat-name').value.trim();
  const emoji = document.getElementById('cat-emoji').value.trim() || '🍽️';
  if (!name) return toast('请填写品类名称～', 'err');
  try {
    await api('/api/categories/' + id, { method: 'PUT', body: { name, emoji } });
    state.categories = [];
    closeModal();
    toast('品类修改成功！', 'ok');
    renderChefCategories();
  } catch (e) { toast(e.message, 'err'); }
}

async function catDelete(id, name) {
  if (!confirm('确定要删除品类「' + name + '」吗？\n已有菜品的品类标记不会自动清除。')) return;
  try {
    await api('/api/categories/' + id, { method: 'DELETE' });
    state.categories = [];
    toast('已删除 🗑', 'ok');
    renderChefCategories();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- 厨师：菜品管理 ---------------- */

async function renderChefDishes() {
  await loadCategories();
  let dishes = [];
  try { dishes = (await api('/api/dishes')).dishes; } catch (e) { return toast(e.message, 'err'); }
  const items = dishes.map(d => `
    <div class="dish-manage-item">
      ${d.hasPhoto ? '<img src="/api/photo/' + d.id + '" alt="">' : '<div class="no-photo">' + catEmoji(d.category) + '</div>'}
      <div class="info">
        <div class="name">${esc(d.name)}</div>
        <div class="chip-row">
          <span class="mini-chip cat-chip">${catEmoji(d.category)} ${esc(d.category || '未分类')}</span>
          ${d.slots.includes('all') ? '<span class="mini-chip">🕐 全部时段</span>'
            : d.slots.map(s => '<span class="mini-chip">' + slotInfo(s).emoji + slotInfo(s).name + '</span>').join('')}
        </div>
        ${d.options.length ? '<div class="chip-row">' + d.options.map(o => '<span class="mini-chip">' + esc(o) + '</span>').join('') + '</div>' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        <button class="btn btn-blue btn-sm" onclick='dishEdit(${jsAttr(d)})'>✏️ 编辑</button>
        <button class="btn btn-danger btn-sm" onclick="dishDelete(${d.id}, '${esc(d.name).replace(/'/g, '')}')">🗑 删除</button>
      </div>
    </div>`).join('');

  app().innerHTML = `
    <div class="container">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('chefHome')">⬅ 返回</button>
          <div class="title">📝 菜品管理</div>
        </div>
        <button class="btn btn-green btn-sm" onclick="dishFormOpen(null)">➕ 新增菜品</button>
      </div>
      ${dishes.length === 0 ? '<div class="card text-center" style="padding:3rem;"><div style="font-size:3rem;">🍳</div><div class="muted">还没有菜品，点击右上角"新增菜品"开始吧！</div></div>' : items}
    </div>`;
}

function dishFormOpen(dish) {
  state.editingDish = dish;
  const d = dish || { name: '', category: '', options: [], slots: ['all'] };
  const catChips = state.categories.map(c => {
    const on = d.category === c.name;
    return '<button class="chip ' + (on ? 'slot-on' : '') + '" data-cat="' + esc(c.name) + '" onclick="dishCatPick(this)">' + esc(c.emoji) + ' ' + esc(c.name) + '</button>';
  }).join('');

  const m = openModal(`
    <h3>${dish ? '✏️ 编辑菜品' : '➕ 新增菜品'}</h3>
    <label class="field-label">菜品名称 *</label>
    <input type="text" id="d-name" placeholder="例如：荷包蛋" value="${esc(d.name)}" maxlength="50">
    <label class="field-label">品类 *（必选）</label>
    <div class="chip-row" id="d-cats">${catChips || '<span class="muted">请先到"品类管理"添加品类</span>'}</div>
    <label class="field-label">菜品照片</label>
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
      <div class="photo-preview" id="d-preview">${dish && dish.hasPhoto ? '<img src="/api/photo/' + dish.id + '" style="width:100%;height:100%;object-fit:cover;border-radius:20px;">' : '📷'}</div>
      <div style="flex:1;min-width:180px;">
        <input type="file" id="d-photo" accept="image/*" onchange="dishPhotoPreview(this)">
        <div class="muted" style="font-size:0.9rem;margin-top:0.3rem;">支持 JPG / PNG，不选则${dish ? '保留原照片' : '没有照片'}</div>
      </div>
    </div>
    <label class="field-label">细分要求（顾客点餐时可勾选）</label>
    <div style="display:flex;gap:0.5rem;">
      <input type="text" id="d-opt-input" placeholder="例如：加蛋 / 不要葱 / 微辣" maxlength="20" onkeydown="if(event.key==='Enter'){event.preventDefault();dishOptAdd();}">
      <button class="btn btn-blue" style="white-space:nowrap;" onclick="dishOptAdd()">添加</button>
    </div>
    <div class="chip-row" id="d-opts"></div>
    <label class="field-label">时段分类（可多选，或选"全部时段"）</label>
    <div class="chip-row" id="d-slots"></div>
    <hr class="divider">
    <div style="display:flex;gap:0.8rem;justify-content:center;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn btn-big" onclick="dishSave()">💾 保存</button>
    </div>`);

  m._opts = [...d.options];
  m._slots = [...d.slots];
  m._category = d.category || '';
  m._photoFile = null;
  renderDishFormChips();
}

function dishCatPick(btn) {
  const m = modalRoot().querySelector('.modal');
  const catName = btn.dataset.cat;
  // 单选：取消其他，选中当前
  m.querySelectorAll('#d-cats .chip').forEach(c => c.classList.remove('slot-on'));
  btn.classList.add('slot-on');
  m._category = catName;
}

function renderDishFormChips() {
  const m = modalRoot().querySelector('.modal');
  const optBox = m.querySelector('#d-opts');
  optBox.innerHTML = m._opts.length
    ? m._opts.map((o, i) => '<button class="chip chip-static" onclick="dishOptRemove(' + i + ')">' + esc(o) + '<span class="x">✕</span></button>').join('')
    : '<span class="muted" style="font-size:0.95rem;">暂无，可添加"加蛋""不要葱""微辣"等</span>';
  const slotBox = m.querySelector('#d-slots');
  const allOn = m._slots.includes('all');
  slotBox.innerHTML =
    '<button class="chip ' + (allOn ? 'slot-on' : '') + '" onclick="dishSlotToggle(\'all\')">🕐 全部时段</button>' +
    SLOTS.map(s => {
      const on = !allOn && m._slots.includes(s.key);
      return '<button class="chip ' + (on ? 'slot-on' : '') + '" onclick="dishSlotToggle(\'' + s.key + '\')">' + s.emoji + ' ' + s.name + '</button>';
    }).join('');
}

function dishOptAdd() {
  const m = modalRoot().querySelector('.modal');
  const input = m.querySelector('#d-opt-input');
  const v = input.value.trim();
  if (!v) return;
  if (m._opts.includes(v)) return toast('这个要求已经添加过啦～', 'err');
  m._opts.push(v);
  input.value = '';
  renderDishFormChips();
}

function dishOptRemove(i) {
  const m = modalRoot().querySelector('.modal');
  m._opts.splice(i, 1);
  renderDishFormChips();
}

function dishSlotToggle(key) {
  const m = modalRoot().querySelector('.modal');
  if (key === 'all') {
    if (m._slots.includes('all')) { m._slots = []; }
    else { m._slots = ['all']; }
  } else {
    m._slots = m._slots.filter(s => s !== 'all');
    const i = m._slots.indexOf(key);
    if (i >= 0) m._slots.splice(i, 1); else m._slots.push(key);
  }
  renderDishFormChips();
}

function dishPhotoPreview(input) {
  const m = modalRoot().querySelector('.modal');
  const prev = m.querySelector('#d-preview');
  if (input.files && input.files[0]) {
    m._photoFile = input.files[0];
    const reader = new FileReader();
    reader.onload = e => { prev.innerHTML = '<img src="' + e.target.result + '" style="width:100%;height:100%;object-fit:cover;border-radius:20px;">'; };
    reader.readAsDataURL(input.files[0]);
  }
}

async function dishSave() {
  const m = modalRoot().querySelector('.modal');
  const name = m.querySelector('#d-name').value.trim();
  if (!name) return toast('请填写菜品名称～', 'err');
  if (!m._category) return toast('请选择品类～', 'err');
  if (m._slots.length === 0) return toast('请至少选择一个时段～', 'err');
  const fd = new FormData();
  fd.append('name', name);
  fd.append('category', m._category);
  fd.append('options', JSON.stringify(m._opts));
  fd.append('slots', JSON.stringify(m._slots));
  if (m._photoFile) fd.append('photo', m._photoFile);
  try {
    if (state.editingDish) {
      await api('/api/dishes/' + state.editingDish.id, { method: 'PUT', body: fd });
    } else {
      await api('/api/dishes', { method: 'POST', body: fd });
    }
    closeModal();
    toast('保存成功！🎉', 'ok');
    renderChefDishes();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function dishEdit(dish) { dishFormOpen(dish); }

async function dishDelete(id, name) {
  if (!confirm('确定要删除「' + name + '」吗？\n（历史订单仍会保留显示）')) return;
  try {
    await api('/api/dishes/' + id, { method: 'DELETE' });
    toast('已删除 🗑', 'ok');
    renderChefDishes();
  } catch (e) { toast(e.message, 'err'); }
}

/* ---------------- 厨师：订餐列表（二级菜单） ---------------- */

async function renderChefOrders() {
  if (!state.selDate) state.selDate = state.today || (await api('/api/state')).today;
  const date = state.selDate;
  let orderData, changes;
  try {
    [orderData, changes] = await Promise.all([
      api('/api/orders?date=' + date),
      api('/api/changes'),
    ]);
  } catch (e) { return toast(e.message, 'err'); }
  const seen = changes.seen || '2000-01-01 00:00:00';

  const slotCards = SLOTS.map(s => {
    const items = (orderData.slots[s.key] || []);
    const hasNew = items.some(it => it.updatedAt > seen);
    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);

    const dishIcons = items.length === 0
      ? '<span class="muted" style="font-size:1.05rem;">暂无点餐</span>'
      : items.map(it => it.hasPhoto
          ? '<img src="/api/photo/' + it.dishId + '" class="slot-thumb" alt="' + esc(it.name) + '">'
          : '<span class="slot-thumb-emoji">🍽️</span>'
        ).join('');

    return `
      <button class="card slot-summary-card" onclick="chefSlotDetail('${s.key}')">
        <div class="slot-summary-head">
          <span class="slot-emoji">${s.emoji}</span>
          <span class="slot-summary-name">${s.name}</span>
          ${hasNew ? '<span class="new-badge">有更新</span>' : ''}
        </div>
        <div class="slot-summary-body">
          ${items.length === 0
            ? '<span class="muted">还没有人点餐～</span>'
            : '<div class="slot-icon-row">' + dishIcons + '</div>' +
              '<div class="slot-summary-count">共 ' + totalQty + ' 份 · ' + items.length + ' 道菜</div>'}
        </div>
        <div class="slot-summary-arrow">▶</div>
      </button>`;
  }).join('');

  app().innerHTML = `
    <div class="container" style="max-width:720px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('chefHome')">⬅ 返回</button>
          <div class="title">📋 顾客订餐列表</div>
        </div>
      </div>
      <div class="card">
        <div class="date-nav">
          <button class="btn btn-plain btn-sm" onclick="chefOrdersNav(-1)">◀ 前一天</button>
          <input type="date" id="co-date" value="${date}" onchange="chefOrdersSet(this.value)">
          <button class="btn btn-plain btn-sm" onclick="chefOrdersNav(1)">后一天 ▶</button>
          <button class="btn btn-orange btn-sm" onclick="chefOrdersSet(state.today)">📌 今天</button>
        </div>
        <div class="text-center" style="font-size:1.25rem;font-weight:bold;">${dateTitle(date)}</div>
      </div>
      ${slotCards}
      <div class="muted text-center" style="margin-top:0.5rem;font-size:0.95rem;">点击时段卡片查看详细菜品和要求 👆</div>
    </div>`;

  try { await api('/api/changes', { method: 'POST' }); } catch (e) { /* ignore */ }
}

/* 厨师：第二级 —— 时段详情 */
async function renderChefSlotDetail() {
  const date = state.selDate;
  const slotKey = state.selSlot;
  const slot = slotInfo(slotKey);
  let orderData;
  try { orderData = await api('/api/orders?date=' + date); } catch (e) { return toast(e.message, 'err'); }
  const items = orderData.slots[slotKey] || [];

  const inner = items.length === 0
    ? '<div class="empty-hint">这个时段还没有人点餐～</div>'
    : items.map(it => `
        <div class="order-item">
          ${it.hasPhoto ? '<img src="/api/photo/' + it.dishId + '" style="width:56px;height:56px;border-radius:14px;object-fit:cover;flex-shrink:0;">' : ''}
          <div style="flex:1;min-width:0;">
            <div class="o-name">${esc(it.name)} <span class="o-qty">×${it.qty}</span></div>
            ${it.options.length ? '<div class="o-opts">' + it.options.map(o => '<span class="mini-chip">' + esc(o) + '</span>').join('') + '</div>' : ''}
            <div class="o-time">更新于 ${esc(it.updatedAt)}</div>
          </div>
        </div>`).join('');

  app().innerHTML = `
    <div class="container" style="max-width:720px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('chefOrders')">⬅ 返回概览</button>
          <div class="title">${slot.emoji} ${slot.name}详情</div>
        </div>
        <div class="muted" style="font-size:1rem;">${dateTitle(date)}</div>
      </div>
      <div class="card slot-block">
        <div class="slot-head">${slot.emoji} ${slot.name} · 共 ${items.reduce((s,it)=>s+it.qty,0)} 份</div>
        ${inner}
      </div>
    </div>`;
}

function chefSlotDetail(slotKey) {
  state.selSlot = slotKey;
  goto('chefSlotDetail');
}

function chefOrdersNav(n) { state.selDate = addDays(state.selDate, n); renderChefOrders(); }
function chefOrdersSet(d) { if (d) { state.selDate = d; renderChefOrders(); } }

/* ---------------- 顾客：日历 ---------------- */

async function renderCustomerCal() {
  if (!state.today) state.today = (await api('/api/state')).today;
  if (!state.calMonth) state.calMonth = state.today.slice(0, 7);
  const month = state.calMonth;
  let dates = {};
  try { dates = (await api('/api/orders/dates?month=' + month)).dates; } catch (e) { /* ignore */ }

  const [y, m] = month.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const startBlank = firstDay.getDay();

  let cells = '';
  for (let i = 0; i < startBlank; i++) cells += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dstr = month + '-' + String(d).padStart(2, '0');
    const cnt = dates[dstr] || 0;
    const isToday = dstr === state.today;
    cells += `
      <button class="cal-cell ${cnt ? 'has-meal' : ''} ${isToday ? 'today' : ''}" onclick="customerPickDate('${dstr}')">
        <span>${d}</span>
        ${cnt ? '<span class="meal-mark">🍱' + cnt + '</span>' : ''}
      </button>`;
  }

  app().innerHTML = `
    <div class="container" style="max-width:720px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('role')">⬅ 返回</button>
          <div class="title">🍔 我的点餐日历</div>
        </div>
      </div>
      <div class="card">
        <div class="cal-nav">
          <button class="btn btn-plain btn-sm" onclick="calNav(-1)">◀ 上月</button>
          <div class="cal-title">${y}年${m}月</div>
          <button class="btn btn-plain btn-sm" onclick="calNav(1)">下月 ▶</button>
          <button class="btn btn-orange btn-sm" onclick="calGoToday()">📌 今天</button>
        </div>
        <div class="calendar">
          ${WEEKDAYS.map(w => '<div class="cal-week">周' + w + '</div>').join('')}
          ${cells}
        </div>
      </div>
      <div class="card text-center muted" style="font-size:1.05rem;">
        📅 点击日期，即可安排 <b>早餐、午餐、下午茶、晚餐、夜宵</b> 哦～<br>
        黄色格子代表那一天有点过餐 🍱
      </div>
    </div>`;
}

function calNav(n) {
  const [y, m] = state.calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  state.calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderCustomerCal();
}

function calGoToday() {
  state.calMonth = state.today.slice(0, 7);
  renderCustomerCal();
}

function customerPickDate(dstr) {
  state.selDate = dstr;
  goto('customerDay');
}

/* ---------------- 顾客：某天详情 ---------------- */

async function renderCustomerDay() {
  const date = state.selDate;
  let orderData;
  try { orderData = await api('/api/orders?date=' + date); } catch (e) { return toast(e.message, 'err'); }
  state.orderCache[date] = orderData;

  const blocks = SLOTS.map(s => {
    const items = orderData.slots[s.key] || [];
    const inner = items.length === 0
      ? '<div class="empty-hint">还没有安排，点下面按钮去挑选吧～</div>'
      : items.map(it => `
        <div class="order-item">
          ${it.hasPhoto ? '<img src="/api/photo/' + it.dishId + '" style="width:56px;height:56px;border-radius:14px;object-fit:cover;">' : ''}
          <div style="flex:1;min-width:0;">
            <div class="o-name">${esc(it.name)} <span class="o-qty">×${it.qty}</span></div>
            ${it.options.length ? '<div class="o-opts">' + it.options.map(o => '<span class="mini-chip">' + esc(o) + '</span>').join('') + '</div>' : ''}
          </div>
        </div>`).join('');
    return `
      <div class="card slot-block">
        <div class="slot-head">${s.emoji} ${s.name}</div>
        ${inner}
        <div style="margin-top:0.6rem;display:flex;gap:0.6rem;flex-wrap:wrap;">
          <button class="btn ${items.length ? 'btn-orange' : 'btn-green'}" onclick="slotEditStart('${s.key}')">
            ${items.length ? '✏️ 修改' + s.name : '➕ 挑选' + s.name}
          </button>
          <button class="btn btn-purple" onclick="autoMealOpen('${s.key}')">🎲 一键配菜</button>
        </div>
      </div>`;
  }).join('');

  app().innerHTML = `
    <div class="container" style="max-width:720px;">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="goto('customerCal')">⬅ 返回日历</button>
          <div class="title">📅 ${shortTitle(date)}</div>
        </div>
      </div>
      ${blocks}
    </div>`;
}

/* ---------------- 顾客：一键配菜 ---------------- */

function autoMealOpen(slotKey) {
  state.selSlot = slotKey;
  const m = openModal(`
    <h3>🎲 一键配菜</h3>
    <p class="muted" style="font-size:1rem;">从每个品类随机选一道菜，品类不重复～</p>
    <label class="field-label">用餐人数</label>
    <div class="qty-ctrl">
      <button onclick="autoMealQty(-1)">−</button>
      <span class="num" id="am-qty">1</span>
      <button onclick="autoMealQty(1)">＋</button>
    </div>
    <hr class="divider">
    <div id="am-result"></div>
    <div style="display:flex;gap:0.8rem;justify-content:center;margin-top:1rem;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn btn-blue" onclick="autoMealRoll()">🎲 换一批</button>
      <button class="btn btn-big" id="am-confirm" onclick="autoMealConfirm()" style="display:none;">✅ 确认配菜</button>
    </div>`);
  m._qty = 1;
  m._roll = null;
}

function autoMealQty(n) {
  const m = modalRoot().querySelector('.modal');
  m._qty = Math.min(10, Math.max(1, m._qty + n));
  m.querySelector('#am-qty').textContent = m._qty;
}

async function autoMealRoll() {
  const m = modalRoot().querySelector('.modal');
  const qty = m._qty;
  await loadCategories();
  let dishes = [];
  try { dishes = (await api('/api/dishes')).dishes; } catch (e) { return toast(e.message, 'err'); }
  const avail = dishes.filter(d => dishInSlot(d, state.selSlot));
  if (avail.length === 0) {
    m.querySelector('#am-result').innerHTML = '<div class="empty-hint">当前时段没有可选菜品，请先让厨师上架菜品～</div>';
    return;
  }

  // 按品类分组
  const byCategory = {};
  avail.forEach(d => {
    const cat = d.category || '未分类';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(d);
  });

  // 从每个品类随机选一道（品类不重复）
  const picked = [];
  const catNames = Object.keys(byCategory);
  const shuffled = [...catNames].sort(() => Math.random() - 0.5);
  for (const cat of shuffled) {
    const pool = byCategory[cat];
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    picked.push({ ...chosen, qty: qty });
  }

  m._roll = picked;

  // 渲染结果
  const html = picked.map(d => `
    <div class="order-item" style="padding:0.5rem 0;">
      ${d.hasPhoto ? '<img src="/api/photo/' + d.id + '" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0;">' : '<span style="font-size:1.8rem;flex-shrink:0;">' + catEmoji(d.category) + '</span>'}
      <div style="flex:1;min-width:0;">
        <div class="o-name">${esc(d.name)} <span class="o-qty">×${qty}</span></div>
        <span class="mini-chip cat-chip">${catEmoji(d.category)} ${esc(d.category || '未分类')}</span>
      </div>
    </div>`).join('');

  m.querySelector('#am-result').innerHTML = `
    <div class="slot-head">🎲 配菜方案（${picked.length} 道菜 · ${qty} 人份）</div>
    ${html}`;
  m.querySelector('#am-confirm').style.display = '';
}

async function autoMealConfirm() {
  const m = modalRoot().querySelector('.modal');
  if (!m._roll || !m._roll.length) return toast('请先点"换一批"生成方案～', 'err');
  const items = m._roll.map(d => ({ dishId: d.id, options: [], qty: d.qty }));
  try {
    await api('/api/orders', {
      method: 'PUT',
      body: {
        date: state.selDate,
        slot: state.selSlot,
        items: items,
      },
    });
    closeModal();
    toast('配菜成功！开饭啦～🍽️', 'ok');
    // 刷新当天数据
    state.orderCache = {};
    goto('customerDay');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 顾客：时段选餐编辑器 ---------------- */

async function renderSlotEditor() {
  await loadCategories();
  const slot = slotInfo(state.selSlot);
  let dishes = [];
  try { dishes = (await api('/api/dishes')).dishes; } catch (e) { return toast(e.message, 'err'); }
  const avail = dishes.filter(d => dishInSlot(d, state.selSlot));

  // 按品类分组展示菜品
  const byCategory = {};
  avail.forEach(d => {
    const cat = d.category || '未分类';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(d);
  });

  const cartHTML = state.cart.length === 0
    ? '<div class="empty-hint">还没选菜品，快从下面挑一挑吧～</div>'
    : state.cart.map((c, i) => `
      <div class="order-item">
        ${c.hasPhoto ? '<img src="/api/photo/' + c.dishId + '" style="width:56px;height:56px;border-radius:14px;object-fit:cover;">' : ''}
        <div style="flex:1;min-width:0;">
          <div class="o-name">${esc(c.name)} <span class="o-qty">×${c.qty}</span></div>
          ${c.options.length ? '<div class="o-opts">' + c.options.map(o => '<span class="mini-chip">' + esc(o) + '</span>').join('') + '</div>' : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:0.4rem;">
          <button class="btn btn-blue btn-sm" onclick="cartEditOpt(${i})">🎯 改要求</button>
          <button class="btn btn-danger btn-sm" onclick="cartRemove(${i})">✕ 移除</button>
        </div>
      </div>`).join('');

  let dishHTML = '';
  if (avail.length === 0) {
    dishHTML = '<div class="card text-center" style="padding:2.5rem;"><div style="font-size:3rem;">🥺</div><div class="muted">厨师还没有上架' + slot.name + '的菜品哦</div></div>';
  } else {
    for (const [catName, catDishes] of Object.entries(byCategory)) {
      dishHTML += `<div class="cat-section"><div class="cat-section-head">${catEmoji(catName)} ${esc(catName)}</div><div class="dish-grid">`;
      dishHTML += catDishes.map(d => `
        <div class="dish-card" onclick='pickDish(${jsAttr(d)})'>
          ${dishPhotoHTML(d)}
          <div class="dish-name">${esc(d.name)}</div>
          ${d.options.length ? '<div class="mini-chips">' + d.options.map(o => '<span class="mini-chip">' + esc(o) + '</span>').join('') + '</div>' : ''}
        </div>`).join('');
      dishHTML += '</div></div>';
    }
  }

  app().innerHTML = `
    <div class="container">
      <div class="navbar">
        <div class="nav-left">
          <button class="btn btn-plain btn-sm" onclick="slotEditCancel()">⬅ 返回</button>
          <div class="title">${slot.emoji} 挑选${slot.name} · ${shortTitle(state.selDate)}</div>
        </div>
      </div>
      <div class="card">
        <div class="slot-head">🧺 我的餐盘</div>
        ${cartHTML}
      </div>
      <div style="display:flex;gap:0.8rem;justify-content:center;margin:0.8rem 0;flex-wrap:wrap;">
        <button class="btn btn-danger" onclick="slotClear()">🗑 清空本时段</button>
        <button class="btn btn-big" onclick="slotSave()">💾 保存${slot.name}</button>
      </div>
      ${dishHTML}
    </div>`;
}

function slotEditStart(slotKey) {
  state.selSlot = slotKey;
  const cached = state.orderCache[state.selDate];
  state.cart = cached && cached.slots[slotKey]
    ? cached.slots[slotKey].map(it => ({ dishId: it.dishId, name: it.name, hasPhoto: it.hasPhoto, options: [...it.options], qty: it.qty }))
    : [];
  goto('slotEditor');
}

function slotEditCancel() { goto('customerDay'); }

function pickDish(dish) {
  const exist = state.cart.find(c => c.dishId === dish.id);
  if (exist) { exist.qty++; return renderSlotEditor(); }
  const m = openModal(`
    <h3>${dish.hasPhoto ? '' : catEmoji(dish.category) + ' '}${esc(dish.name)}</h3>
    ${dish.hasPhoto ? '<img src="/api/photo/' + dish.id + '" style="width:100%;max-height:240px;object-fit:cover;border-radius:20px;">' : ''}
    <label class="field-label">有什么小要求吗？（可不选）</label>
    <div class="chip-row" id="pick-opts">
      ${dish.options.length
        ? dish.options.map(o => '<button class="chip" data-v="' + esc(o) + '" onclick="this.classList.toggle(\'toggle-on\')">' + esc(o) + '</button>').join('')
        : '<span class="muted">这道菜没有特殊要求选项</span>'}
    </div>
    <label class="field-label">数量</label>
    <div class="qty-ctrl">
      <button onclick="pickQty(-1)">−</button>
      <span class="num" id="pick-qty">1</span>
      <button onclick="pickQty(1)">＋</button>
    </div>
    <hr class="divider">
    <div style="display:flex;gap:0.8rem;justify-content:center;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn btn-big" onclick="pickConfirm(${dish.id}, ${jsAttr(dish.name)}, ${dish.hasPhoto}, ${jsAttr(dish.options)})">🧺 加入餐盘</button>
    </div>`);
  m._qty = 1;
}

function jsAttr(v) {
  return esc(JSON.stringify(v));
}

function pickQty(n) {
  const m = modalRoot().querySelector('.modal');
  m._qty = Math.min(99, Math.max(1, m._qty + n));
  m.querySelector('#pick-qty').textContent = m._qty;
}

function pickConfirm(dishId, name, hasPhoto, allOptions) {
  const m = modalRoot().querySelector('.modal');
  const opts = [...m.querySelectorAll('#pick-opts .chip.toggle-on')].map(c => c.dataset.v);
  state.cart.push({ dishId, name, options: opts, qty: m._qty, hasPhoto, allOptions });
  closeModal();
  toast('已加入餐盘 🧺', 'ok');
  renderSlotEditor();
}

function cartEditOpt(i) {
  const c = state.cart[i];
  const optList = (c.allOptions && c.allOptions.length)
    ? c.allOptions.map(o => '<button class="chip ' + (c.options.includes(o) ? 'toggle-on' : '') + '" data-v="' + esc(o) + '" onclick="this.classList.toggle(\'toggle-on\')">' + esc(o) + '</button>').join('')
    : '';
  const m = openModal(`
    <h3>🎯 修改「${esc(c.name)}」的要求</h3>
    <label class="field-label">勾选需要的要求</label>
    <div class="chip-row" id="edit-opts">
      ${optList || '<input type="text" id="edit-free" placeholder="手动输入要求，例如：微辣" value="' + esc(c.options.join('，')) + '">'}
    </div>
    <label class="field-label">数量</label>
    <div class="qty-ctrl">
      <button onclick="editQty(-1)">−</button>
      <span class="num" id="edit-qty">${c.qty}</span>
      <button onclick="editQty(1)">＋</button>
    </div>
    <hr class="divider">
    <div style="display:flex;gap:0.8rem;justify-content:center;">
      <button class="btn btn-plain" onclick="closeModal()">取消</button>
      <button class="btn" onclick="cartEditConfirm(${i})">✅ 确定</button>
    </div>`);
  m._qty = c.qty;
  m._idx = i;
}

function editQty(n) {
  const m = modalRoot().querySelector('.modal');
  m._qty = Math.min(99, Math.max(1, m._qty + n));
  m.querySelector('#edit-qty').textContent = m._qty;
}

function cartEditConfirm(i) {
  const m = modalRoot().querySelector('.modal');
  const c = state.cart[i];
  const chips = [...m.querySelectorAll('#edit-opts .chip.toggle-on')].map(x => x.dataset.v);
  const free = m.querySelector('#edit-free');
  if (free) {
    c.options = free.value.split(/[，,]/).map(s => s.trim()).filter(Boolean);
  } else {
    c.options = chips;
  }
  c.qty = m._qty;
  closeModal();
  renderSlotEditor();
}

function cartRemove(i) {
  state.cart.splice(i, 1);
  renderSlotEditor();
}

function slotClear() {
  if (!state.cart.length) return;
  if (!confirm('确定清空这个时段的所有餐食吗？')) return;
  state.cart = [];
  renderSlotEditor();
}

async function slotSave() {
  try {
    await api('/api/orders', {
      method: 'PUT',
      body: {
        date: state.selDate,
        slot: state.selSlot,
        items: state.cart.map(c => ({ dishId: c.dishId, options: c.options, qty: c.qty })),
      },
    });
    toast('保存成功！开饭啦～🍽️', 'ok');
    goto('customerDay');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ---------------- 启动 ---------------- */

(async function init() {
  try {
    const s = await api('/api/state');
    state.hasPassword = s.hasPassword;
    state.today = s.today;
  } catch (e) {
    app().innerHTML = '<div class="loading">😵 连接服务失败，请刷新重试</div>';
    return;
  }
  render();
})();
