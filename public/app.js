'use strict';
/* 正合合同 前端单页应用 —— 原生 JS，零依赖 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '¥' + Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
const dateStr = s => s ? String(s).slice(0, 10) : '-';
const today = () => new Date().toISOString().slice(0, 10);
const isManager = () => ['admin', 'manager'].includes(STATE.user?.role);
const canMaster = () => ['admin', 'manager'].includes(STATE.user?.role);
const canFinance = () => ['admin', 'manager', 'finance'].includes(STATE.user?.role);
const canReview = () => ['admin', 'manager', 'legal'].includes(STATE.user?.role);

const STATE = { user: null, view: 'dashboard', users: [], customers: [], projects: [], units: [], filters: {} };
const VIEW_TITLES = {
  dashboard: '数据概览', tasks: '待办任务', contracts: '合同台账', approvals: '审批中心',
  changes: '变更管理', payments: '回款管理', units: '房源销控', customers: '购房客户',
  projects: '项目管理', templates: '合同模板', risks: '风险预警', reports: '统计报表',
  users: '用户管理', audit: '操作日志', database: '数据库管理',
};
const CTYPE = {
  subscription: { label: '认购书', cls: 'cyan' }, sale: { label: '商品房买卖合同', cls: 'blue' },
  supplement: { label: '补充协议', cls: 'purple' }, parking: { label: '车位合同', cls: 'orange' }, other: { label: '其他', cls: 'gray' },
};
const CSTATUS = {
  draft: { label: '草稿', cls: 'gray' }, pending: { label: '审批中', cls: 'orange' },
  approved: { label: '待生效', cls: 'cyan' }, effective: { label: '已生效', cls: 'blue' },
  filed: { label: '已备案', cls: 'green' }, rejected: { label: '已驳回', cls: 'red' }, void: { label: '已解除', cls: 'red' },
};
const USTATUS = {
  available: { label: '可售', cls: 'green' }, locked: { label: '已锁定', cls: 'orange' },
  subscribed: { label: '已认购', cls: 'cyan' }, contracted: { label: '已签约', cls: 'blue' },
  filed: { label: '已备案', cls: 'purple' }, blocked: { label: '不可售', cls: 'gray' },
};
const PAY_METHOD = { lump: '一次性付款', mortgage: '商业按揭', installment: '分期付款' };
const CHANGE_TYPE = { rename: '更名/增减名', exchange: '换房', cancel: '退房解除', supplement: '补充协议', price: '价格变更' };
const PRIORITY = { high: { label: '高', cls: 'red' }, medium: { label: '中', cls: 'orange' }, low: { label: '低', cls: 'gray' } };
const RECEIVE_METHOD = { transfer: '银行转账', cash: '现金', pos: 'POS 刷卡', online: '线上支付', mortgage: '按揭放款' };
const FLOW_STEPS = {
  manager: { label: '销售经理', role: 'manager' }, legal: { label: '法务审核', role: 'legal' },
  finance: { label: '财务复核', role: 'finance' }, gm: { label: '总经理审批', role: 'admin' },
};
const ROLE_LABEL = { admin: '系统管理员', manager: '销售经理', sales: '置业顾问', legal: '法务', finance: '财务' };

/* ---------------- API ---------------- */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  let json;
  try { json = await res.json(); } catch { throw new Error('服务返回异常'); }
  if (!res.ok || !json.ok) {
    if (res.status === 401 && STATE.user) showLogin();
    throw new Error(json.error || '请求失败');
  }
  return json.data;
}
const get = p => api(p);
const post = (p, b) => api(p, { method: 'POST', body: b || {} });
const put = (p, b) => api(p, { method: 'PUT', body: b });
const del = p => api(p, { method: 'DELETE' });

/* ---------------- 通用 UI ---------------- */
function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span><span>${esc(msg)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 2800);
}
function modal({ title, body, foot, size = '' }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal ${size}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close">&times;</button></div>
    <div class="modal-body">${body}</div>
    ${foot !== null ? `<div class="modal-foot">${foot || '<button class="btn btn-ghost modal-cancel">取消</button>'}</div>` : ''}
  </div></div>`;
  const close = () => { root.innerHTML = ''; };
  $('.modal-close', root).onclick = close;
  const cancel = $('.modal-cancel', root);
  if (cancel) cancel.onclick = close;
  $('.modal-overlay', root).onclick = e => { if (e.target === $('.modal-overlay', root)) close(); };
  return { el: root, close };
}
function confirmBox(msg, onOk) {
  const m = modal({ title: '确认操作', body: `<p style="font-size:14px;line-height:1.7">${esc(msg)}</p>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-danger" id="confirm-ok">确认</button>` });
  $('#confirm-ok', m.el).onclick = () => { m.close(); onOk(); };
}
function field(label, name, value = '', opts = {}) {
  const { type = 'text', required = false, placeholder = '', options = [], rows = 3, attrs = '' } = opts;
  let input;
  if (type === 'select') {
    input = `<select name="${name}" ${attrs}>${options.map(o => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'textarea') {
    input = `<textarea name="${name}" rows="${rows}" placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea>`;
  } else {
    input = `<input type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>`;
  }
  return `<div class="field"><label>${esc(label)}${required ? ' <span style="color:#dc2626">*</span>' : ''}</label>${input}</div>`;
}
const formData = form => Object.fromEntries(new FormData(form).entries());
const tag = (map, key) => { const x = map[key] || { label: key || '-', cls: 'gray' }; return `<span class="tag ${x.cls}">${esc(x.label)}</span>`; };
const customerName = id => (STATE.customers.find(x => x.id === id)?.name) || '-';
const projectName = id => (STATE.projects.find(x => x.id === id)?.name) || '-';
const unitLabel = id => { const u = STATE.units.find(x => x.id === id); return u ? `${u.building} ${u.room_no}` : '-'; };
const userName = id => (STATE.users.find(x => x.id === id)?.display_name) || (id ? '#' + id : '-');
const statCard = (color, ico, label, value, sub) => `<div class="card stat-card"><div class="stat-icon ${color}">${ico}</div>
  <div class="stat-body"><div class="stat-label">${esc(label)}</div><div class="stat-value">${value}</div><div class="stat-sub">${esc(sub)}</div></div></div>`;
function detailItem(label, value) { return `<div class="detail-item"><label>${esc(label)}</label><div>${value || '-'}</div></div>`; }

/* ---------------- 登录 / 启动 ---------------- */
function showLogin(msg) {
  STATE.user = null;
  $('#app').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  if (msg) $('#login-error').textContent = msg;
}
async function initLogin() {
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#login-btn'); btn.disabled = true; btn.textContent = '登录中...';
    $('#login-error').textContent = '';
    try {
      STATE.user = await post('/login', { username: $('#login-user').value, password: $('#login-pass').value });
      await enterApp();
    } catch (err) { $('#login-error').textContent = err.message; }
    finally { btn.disabled = false; btn.textContent = '登 录'; }
  });
}
async function loadBase() {
  const [customers, projects, units] = await Promise.all([
    get('/customers?limit=2000'), get('/projects?limit=2000'), get('/units?limit=2000'),
  ]);
  STATE.customers = customers.rows;
  STATE.projects = projects.rows;
  STATE.units = units.rows;
  if (canReview() || ['finance', 'sales'].includes(STATE.user.role)) {
    try { STATE.users = await get('/users'); } catch { STATE.users = []; }
  }
}
async function enterApp() {
  $('#login-view').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = STATE.user.display_name;
  $('#user-role').textContent = ROLE_LABEL[STATE.user.role] || STATE.user.role;
  $('#avatar').textContent = (STATE.user.display_name || 'U').slice(0, 1);
  $$('.admin-only').forEach(el => el.style.display = STATE.user.role === 'admin' ? '' : 'none');
  $$('.manager-only').forEach(el => el.style.display = isManager() ? '' : 'none');
  await loadBase();
  const hash = (location.hash || '').replace('#', '');
  if (hash && VIEW_TITLES[hash]) STATE.view = hash;
  navigate(STATE.view);
}
function setupNav() {
  $$('.nav-item').forEach(item => item.onclick = () => navigate(item.dataset.view));
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#sidebar-toggle').onclick = () => $('#sidebar').classList.toggle('collapsed');
  $('#logout-btn').onclick = async () => { try { await post('/logout'); } catch {} showLogin(); };
  $('#refresh-btn').onclick = () => render();
}
function navigate(view) {
  STATE.view = view;
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  $$('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  $('#page-title').textContent = VIEW_TITLES[view] || view;
  render();
}
async function updateBadges() {
  try {
    const s = await get('/stats/overview');
    $('#task-badge').textContent = '';
    $('#approval-badge').textContent = s.pending || '';
    $('#risk-badge').textContent = s.alerts || '';
  } catch {}
}
async function render() {
  const el = $('#content');
  el.innerHTML = '<div class="empty">加载中...</div>';
  try {
    switch (STATE.view) {
      case 'dashboard': await renderDashboard(el); break;
      case 'tasks': await renderTasks(el); break;
      case 'contracts': await renderContracts(el); break;
      case 'approvals': await renderApprovals(el); break;
      case 'changes': await renderChanges(el); break;
      case 'payments': await renderPayments(el); break;
      case 'units': await renderUnits(el); break;
      case 'customers': await renderCustomers(el); break;
      case 'projects': await renderProjects(el); break;
      case 'templates': await renderTemplates(el); break;
      case 'risks': await renderRisks(el); break;
      case 'reports': await renderReports(el); break;
      case 'users': await renderUsers(el); break;
      case 'audit': await renderAudit(el); break;
      case 'database': await renderDatabase(el); break;
      default: el.innerHTML = '<div class="empty">页面不存在</div>';
    }
    await updateBadges();
  } catch (err) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">⚠</div><p>${esc(err.message)}</p></div>`;
  }
}

/* ---------------- 工作台 ---------------- */
async function renderDashboard(el) {
  const [s, stages, alerts, payments, tasks] = await Promise.all([
    get('/stats/overview'), get('/stats/stages'), get('/stats/alerts'),
    get('/payments?status=overdue'), get('/tasks?status=pending&limit=5'),
  ]);
  const max = Math.max(1, ...stages.map(x => x.count));
  el.innerHTML = `
    <div class="page-head"><div><h2>你好，${esc(STATE.user.display_name)} 👋</h2>
      <p>销售合同经营概览 · ${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p></div>
      <div class="head-actions"><button class="btn btn-primary" id="quick-contract">+ 新建合同</button>
        <button class="btn btn-ghost" id="quick-alert">查看风险</button></div></div>
    <div class="stats-grid">
      ${statCard('blue', '▤', '合同总数', s.contractCount, `已备案 ${s.filed} 份`)}
      ${statCard('purple', '¥', '签约金额', money(s.contractAmount), `已收 ${money(s.received)}`)}
      ${statCard('orange', '◈', '待我审批', s.pending, '审批中心处理')}
      ${statCard('green', '✓', '本月回款', money(s.monthReceived), `回款率 ${s.collectionRate}%`)}
      ${statCard('red', '!', '风险预警', s.alerts, `高风险 ${s.highAlerts} 项`)}
      ${statCard('cyan', '⌂', '可售房源', s.unitsAvailable, `共 ${s.unitsTotal} 套`)}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>合同状态分布</h3><a class="link-btn" data-goto="contracts">合同台账 →</a></div>
        <div class="card-body"><div class="chart-rows">${stages.filter(x => x.count).map(x => `
          <div class="chart-row"><span>${x.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(5, x.count / max * 100)}%"></div></div>
            <span style="text-align:right">${x.count} 份</span></div>`).join('')}</div></div></div>
      <div class="card"><div class="card-header"><h3>风险与待办提醒</h3><a class="link-btn" data-goto="risks">全部预警 →</a></div>
        <div class="card-body">${alerts.length ? alerts.slice(0, 6).map(a => `
          <div class="alert-item"><span class="alert-dot ${a.level}"></span><div><div class="alert-title">${esc(a.title)}</div>
            <div class="alert-detail">${esc(a.type)} · ${esc(a.detail)}</div></div></div>`).join('')
          : '<div class="empty"><div class="empty-ico">✓</div><p>暂无风险预警</p></div>'}</div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>逾期回款 TOP</h3><a class="link-btn" data-goto="payments">回款管理 →</a></div>
        <div class="card-body">${payments.rows.length ? `<div class="table-wrap"><table><thead><tr><th>合同</th><th>期次</th><th>应收</th><th>到期</th></tr></thead><tbody>
          ${payments.rows.slice(0, 5).map(p => `<tr><td class="cell-main">${esc(p.contract_no)}</td><td>${esc(p.name)}</td>
            <td class="money">${money(p.amount - p.paid_amount)}</td><td>${dateStr(p.due_date)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">暂无逾期回款</div>'}</div></div>
      <div class="card"><div class="card-header"><h3>我的待办</h3><a class="link-btn" data-goto="tasks">全部任务 →</a></div>
        <div class="card-body">${tasks.rows.length ? tasks.rows.map(t => `
          <div style="display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--border)">
            <span class="tag ${PRIORITY[t.priority].cls}">${PRIORITY[t.priority].label}</span>
            <div style="flex:1"><div style="font-weight:600;font-size:13px">${esc(t.title)}</div>
              <div style="font-size:11px;color:var(--text-soft)">${dateStr(t.due_date)} · ${esc(userName(t.owner_id))}</div></div>
            <button class="link-btn" data-done-task="${t.id}">完成</button></div>`).join('') : '<div class="empty">暂无待办</div>'}</div></div>
    </div>`;
  $('#quick-contract', el).onclick = () => openContractForm();
  $('#quick-alert', el).onclick = () => navigate('risks');
  $$('[data-goto]', el).forEach(a => a.onclick = () => navigate(a.dataset.goto));
  $$('[data-done-task]', el).forEach(b => b.onclick = async () => {
    try { await put('/tasks/' + b.dataset.doneTask, { status: 'done', completed_at: new Date().toISOString() }); toast('任务已完成'); render(); }
    catch (e) { toast(e.message, 'error'); }
  });
}

/* ---------------- 合同台账 ---------------- */
async function renderContracts(el) {
  const q = STATE.filters.contracts || {};
  const params = new URLSearchParams({ limit: '1000' });
  ['q', 'status', 'type', 'project_id', 'owner_id'].forEach(k => { if (q[k]) params.set(k, q[k]); });
  if (q.risk === 'discount') params.set('risk', 'discount');
  const data = await get('/contracts?' + params);
  el.innerHTML = `
    <div class="page-head"><div><h2>合同台账</h2><p>共 ${data.total} 份合同 · 认购 → 审批 → 签约 → 备案 → 回款全链路留痕</p></div>
      <div class="head-actions"><button class="btn btn-ghost" id="export-contracts">⇩ 导出 CSV</button>
        <button class="btn btn-primary" id="add-contract">+ 新建合同</button></div></div>
    <div class="card"><div class="card-body" style="padding-bottom:0"><div class="toolbar">
      <div class="search-box"><input id="contract-search" placeholder="搜索合同号 / 客户 / 项目 / 房号" value="${esc(q.q || '')}"></div>
      <select class="filter" id="contract-status"><option value="">全部状态</option>${Object.entries(CSTATUS).map(([v, o]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <select class="filter" id="contract-type"><option value="">全部类型</option>${Object.entries(CTYPE).map(([v, o]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <select class="filter" id="contract-project"><option value="">全部项目</option>${STATE.projects.map(p => `<option value="${p.id}" ${String(q.project_id) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select class="filter" id="contract-risk"><option value="">全部风险</option><option value="discount" ${q.risk === 'discount' ? 'selected' : ''}>折扣低于 90%</option></select>
    </div></div>
    <div class="table-wrap"><table><thead><tr><th>合同编号</th><th>购房客户</th><th>项目 / 房号</th><th>类型</th><th>金额</th><th>折扣</th><th>回款</th><th>状态</th><th>备案号</th><th>操作</th></tr></thead><tbody>
      ${data.rows.length ? data.rows.map(c => {
        const rate = c.plan_total ? Math.round(c.paid_total / c.plan_total * 100) : 0;
        return `<tr><td><div class="cell-main">${esc(c.contract_no)}</div><div class="cell-sub">签约 ${dateStr(c.sign_date)}</div></td>
          <td>${esc(c.customer_name || '-')}</td><td><div>${esc(c.project_name || '-')}</div><div class="cell-sub">${esc(unitLabel(c.unit_id))}</div></td>
          <td>${tag(CTYPE, c.type)}</td><td class="money">${money(c.amount)}</td>
          <td>${Number(c.discount) < 90 ? `<span class="tag red">${c.discount}%</span>` : `${c.discount}%`}</td>
          <td style="min-width:100px">${money(c.paid_total)}<div class="progress"><i style="width:${rate}%"></i></div><div class="cell-sub">${rate}%</div></td>
          <td>${tag(CSTATUS, c.status)}</td><td>${esc(c.filed_no || '-')}</td>
          <td><div class="row-actions"><button class="link-btn" data-detail="${c.id}">详情</button>
            ${['draft', 'rejected'].includes(c.status) ? `<button class="link-btn" data-edit="${c.id}">编辑</button>` : ''}
            ${['draft', 'rejected'].includes(c.status) ? `<button class="link-btn danger" data-del="${c.id}">删除</button>` : ''}</div></td></tr>`;
      }).join('') : `<tr><td colspan="10"><div class="empty"><div class="empty-ico">▤</div><p>暂无合同</p></div></td></tr>`}
    </tbody></table></div></div>`;
  const search = $('#contract-search', el);
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { STATE.filters.contracts = { ...q, q: search.value }; renderContracts(el); }, 350); };
  $('#contract-status', el).onchange = e => { STATE.filters.contracts = { ...q, status: e.target.value }; renderContracts(el); };
  $('#contract-type', el).onchange = e => { STATE.filters.contracts = { ...q, type: e.target.value }; renderContracts(el); };
  $('#contract-project', el).onchange = e => { STATE.filters.contracts = { ...q, project_id: e.target.value }; renderContracts(el); };
  $('#contract-risk', el).onchange = e => { STATE.filters.contracts = { ...q, risk: e.target.value }; renderContracts(el); };
  $('#add-contract', el).onclick = () => openContractForm();
  $('#export-contracts', el).onclick = () => { window.location.href = '/api/export/contracts'; };
  $$('[data-detail]', el).forEach(b => b.onclick = () => openContractDetail(Number(b.dataset.detail)));
  $$('[data-edit]', el).forEach(b => b.onclick = () => openContractForm(Number(b.dataset.edit)));
  $$('[data-del]', el).forEach(b => b.onclick = () => confirmBox('确定删除该合同？关联的回款计划也会一并删除。', async () => {
    try { await del('/contracts/' + b.dataset.del); toast('已删除'); await loadBase(); render(); } catch (e) { toast(e.message, 'error'); }
  }));
}

function openContractForm(id) {
  let c = {};
  const ownerOpts = isManager() ? STATE.users.map(u => [u.id, u.display_name]) : [[STATE.user.id, STATE.user.display_name]];
  const unitOpts = [['', '暂无关联房源'], ...STATE.units.filter(u => u.status === 'available' || u.id === c.unit_id)
    .map(u => [u.id, `${projectName(u.project_id)} · ${u.building} ${u.room_no} · ${u.area}㎡`])];
  const m = modal({
    title: id ? '编辑合同' : '新建合同', size: 'modal-lg',
    body: `<form id="contract-form">
      <div class="form-row">${field('购房客户', 'customer_id', '', { type: 'select', required: true, options: [['', '请选择客户'], ...STATE.customers.map(x => [x.id, x.name + '（' + (x.phone || '') + '）'])] })}
        ${field('项目', 'project_id', '', { type: 'select', required: true, options: [['', '请选择项目'], ...STATE.projects.map(p => [p.id, p.name])] })}</div>
      <div class="form-row">${field('关联房源', 'unit_id', '', { type: 'select', options: unitOpts })}
        ${field('合同类型', 'type', 'sale', { type: 'select', options: Object.entries(CTYPE).map(([v, o]) => [v, o.label]) })}</div>
      <div class="form-row">${field('面价（元）', 'price', '0', { type: 'number', attrs: 'min="0" step="100"' })}
        ${field('折扣（%）', 'discount', '100', { type: 'number', attrs: 'min="1" max="100" step="1"' })}</div>
      <div class="form-row">${field('成交金额（元）', 'amount', '0', { type: 'number', attrs: 'min="0" step="100"' })}
        ${field('付款方式', 'payment_method', 'mortgage', { type: 'select', options: Object.entries(PAY_METHOD).map(([v, l]) => [v, l]) })}</div>
      <div class="form-row">${field('签约日期', 'sign_date', '', { type: 'date' })}
        ${field('约定签约截止日', 'due_sign_date', '', { type: 'date' })}</div>
      <div class="form-row">${field('负责人', 'owner_id', STATE.user.id, { type: 'select', options: ownerOpts })}
        ${field('状态', 'status_hint', '草稿（提交后进入审批）', { attrs: 'disabled' })}</div>
      ${field('备注 / 条款说明', 'note', '', { type: 'textarea', rows: 3, placeholder: '如：特批折扣需说明原因；避免填写「无条件付款」等高风险条款' })}
      <div class="notice info">提示：新建合同会自动生成合同编号与回款计划；提交审批时按金额自动路由「销售经理 → 法务 → 财务（→ 总经理）」。</div>
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-contract">保存</button>`,
  });
  if (id) get('/contracts/' + id).then(d => {
    c = d;
    $$('input,select,textarea', $('#contract-form', m.el)).forEach(e2 => {
      if (e2.name === 'status_hint') { e2.value = CSTATUS[d.status]?.label || d.status; return; }
      e2.value = d[e2.name] == null ? '' : d[e2.name];
    });
  });
  const calc = () => {
    const f = $('#contract-form', m.el);
    const price = Number(f.price.value || 0), discount = Number(f.discount.value || 100);
    f.amount.value = Math.round(price * discount / 100 / 100) * 100;
  };
  $('#contract-form', m.el).addEventListener('input', e => { if (['price', 'discount'].includes(e.target.name)) calc(); });
  $('#save-contract', m.el).onclick = async () => {
    const d = formData($('#contract-form', m.el));
    delete d.status_hint;
    ['customer_id', 'project_id', 'unit_id', 'price', 'discount', 'amount', 'owner_id'].forEach(k => d[k] = Number(d[k]) || (k === 'unit_id' ? null : 0));
    if (!d.unit_id) delete d.unit_id;
    try {
      if (id) await put('/contracts/' + id, d); else await post('/contracts', d);
      m.close(); toast(id ? '合同已更新' : '合同已创建，请提交审批'); await loadBase(); render();
    } catch (e) { toast(e.message, 'error'); }
  };
}

async function openContractDetail(id) {
  const c = await get('/contracts/' + id);
  const flow = JSON.parse(c.flow || '[]');
  const approvalMap = Object.fromEntries(c.approvals.map(a => [a.step, a]));
  const stepHtml = flow.map((s, i) => {
    const a = approvalMap[s];
    const cls = a ? (a.action === 'reject' ? 'rejected' : 'done') : (c.status === 'pending' ? 'active' : '');
    const mark = a ? (a.action === 'reject' ? '✕' : '✓') : (i + 1);
    return `${i ? '<span class="step-sep"></span>' : ''}<span class="step ${cls}"><i>${mark}</i>${FLOW_STEPS[s]?.label || s}</span>`;
  }).join('');
  const nextStep = flow.find(s => !approvalMap[s]);
  const canApproveNow = c.status === 'pending' && nextStep && (STATE.user.role === 'admin' || STATE.user.role === FLOW_STEPS[nextStep]?.role);
  const rate = c.plan_total ? Math.round(c.paid_total / c.plan_total * 100) : 0;
  const m = modal({
    title: `合同详情 · ${c.contract_no}`, size: 'modal-lg',
    body: `<div class="tabs">
        <div class="tab active" data-tab="info">基本信息</div>
        <div class="tab" data-tab="flow">审批流程 (${c.approvals.length})</div>
        <div class="tab" data-tab="pay">回款计划 (${c.payments.length})</div>
        <div class="tab" data-tab="change">变更记录 (${c.changes.length})</div>
      </div>
      <div id="tab-info" class="tab-pane">
        <div class="kpi-strip">
          <div class="card kpi"><div class="k-label">合同金额</div><div class="k-value">${money(c.amount)}</div></div>
          <div class="card kpi"><div class="k-label">已回款</div><div class="k-value">${money(c.paid_total)}</div></div>
          <div class="card kpi"><div class="k-label">回款进度</div><div class="k-value">${rate}%</div></div>
          <div class="card kpi"><div class="k-label">合同状态</div><div class="k-value" style="font-size:16px">${tag(CSTATUS, c.status)}</div></div>
        </div>
        <div class="detail-grid">
          ${detailItem('合同编号', esc(c.contract_no))}${detailItem('合同类型', tag(CTYPE, c.type))}
          ${detailItem('购房客户', esc(c.customer_name))}${detailItem('联系电话', esc(customersPhone(c.customer_id)))}
          ${detailItem('项目', esc(c.project_name))}${detailItem('房号', esc(unitLabel(c.unit_id)))}
          ${detailItem('面价', money(c.price))}${detailItem('折扣', c.discount + '%')}
          ${detailItem('付款方式', esc(PAY_METHOD[c.payment_method] || '-'))}${detailItem('签约日期', dateStr(c.sign_date))}
          ${detailItem('约定签约截止', dateStr(c.due_sign_date))}${detailItem('备案编号', esc(c.filed_no || '-'))}
          ${detailItem('备案日期', dateStr(c.filed_at))}${detailItem('负责人', esc(userName(c.owner_id)))}
        </div>
        ${c.note ? `<div class="notice ${/无条件付款|无限连带责任|放弃抗辩权/.test(c.note) ? 'error' : 'info'}" style="margin-top:16px"><b>备注 / 条款：</b>${esc(c.note)}</div>` : ''}
        <div class="detail-section"><h4>操作提示</h4>
          <div class="notice info">状态流转：草稿 → 提交审批 → 审批通过(待生效) → 双方签章生效 → 网签备案。退房/换房请走「变更管理」，退房后房源自动释放。</div>
        </div>
      </div>
      <div id="tab-flow" class="tab-pane hidden">
        <div class="stepper">${stepHtml || '<span class="empty">未配置审批流程</span>'}</div>
        ${c.approvals.length ? `<div class="timeline" style="margin-top:18px">${c.approvals.map(a => `
          <div class="timeline-item"><div class="t-title">${esc(a.step_label)} · ${a.action === 'approve' ? '通过' : '驳回'}</div>
            <div class="t-meta">${esc(a.approver_name || userName(a.approver_id))} · ${dateStr(a.created_at)}</div>
            ${a.comment ? `<div class="t-content">${esc(a.comment)}</div>` : ''}</div>`).join('')}</div>` : '<div class="empty">暂无审批记录</div>'}
      </div>
      <div id="tab-pay" class="tab-pane hidden">
        ${c.payments.length ? c.payments.map(p => {
          const pct = Math.round(p.paid_amount / p.amount * 100);
          const overdue = p.paid_amount < p.amount && p.due_date && p.due_date < today();
          return `<div class="term-row"><div style="flex:1"><div class="term-name">${esc(p.name)} ${overdue ? '<span class="tag red">逾期</span>' : pct >= 100 ? '<span class="tag green">已收清</span>' : ''}</div>
            <div class="term-meta">应收 ${money(p.amount)} · 已收 ${money(p.paid_amount)} · 到期 ${dateStr(p.due_date)}</div>
            <div class="progress ${pct >= 100 ? 'green' : ''}"><i style="width:${pct}%"></i></div></div>
            ${canFinance() && pct < 100 ? `<button class="btn btn-primary btn-sm" data-receive="${p.id}" data-rest="${p.amount - p.paid_amount}" data-term="${esc(p.name)}">登记回款</button>` : ''}
            ${!p.paid_amount && isManager() ? `<button class="link-btn danger" data-del-pay="${p.id}">删除</button>` : ''}</div>`;
        }).join('') : '<div class="empty">暂无回款计划</div>'}
        ${c.receipts.length ? `<div class="detail-section"><h4>收款流水</h4><div class="table-wrap"><table><thead><tr><th>期次</th><th>金额</th><th>方式</th><th>凭证号</th><th>日期</th></tr></thead><tbody>
          ${c.receipts.map(r => `<tr><td>${esc(r.term)}</td><td class="money">${money(r.amount)}</td><td>${esc(RECEIVE_METHOD[r.method] || r.method)}</td><td>${esc(r.voucher_no || '-')}</td><td>${dateStr(r.created_at)}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
        ${isManager() ? `<div class="flow-actions"><button class="btn btn-ghost btn-sm" id="add-pay">+ 增加回款期次</button>
          <button class="btn btn-ghost btn-sm" id="reset-pay">按付款方式重置计划</button></div>` : ''}
      </div>
      <div id="tab-change" class="tab-pane hidden">
        ${c.changes.length ? c.changes.map(ch => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <b>${esc(CHANGE_TYPE[ch.type] || ch.type)}</b> ${tag({ pending: { label: '待审核', cls: 'orange' }, approved: { label: '已通过', cls: 'blue' }, rejected: { label: '已驳回', cls: 'red' }, done: { label: '已完成', cls: 'green' } }, ch.status)}
          <div style="font-size:12px;color:var(--text-soft);margin-top:4px">${esc(ch.from_value || '-')} → ${esc(ch.to_value || '-')} · ${esc(ch.reason || '')} · ${dateStr(ch.created_at)}</div></div>`).join('') : '<div class="empty">暂无变更记录</div>'}
      </div>`,
    foot: `<button class="btn btn-ghost modal-cancel">关闭</button>
      ${['draft', 'rejected'].includes(c.status) ? `<button class="btn btn-primary" id="dc-submit">提交审批</button>` : ''}
      ${canApproveNow ? `<button class="btn btn-primary" id="dc-approve">通过</button><button class="btn btn-danger" id="dc-reject">驳回</button>` : ''}
      ${c.status === 'approved' ? `<button class="btn btn-primary" id="dc-activate">双方签章生效</button>` : ''}
      ${['effective', 'approved'].includes(c.status) ? `<button class="btn btn-primary" id="dc-file">网签备案</button>` : ''}
      ${!['draft', 'void'].includes(c.status) && (isManager() || STATE.user.role === 'legal') ? `<button class="btn btn-danger" id="dc-void">解除合同</button>` : ''}
      ${!['filed', 'void'].includes(c.status) ? `<button class="btn btn-ghost" id="dc-change">申请变更</button>` : ''}`,
  });
  $$('.tab', m.el).forEach(t => t.onclick = () => {
    $$('.tab', m.el).forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $$('.tab-pane', m.el).forEach(p => p.classList.add('hidden'));
    $('#tab-' + t.dataset.tab, m.el).classList.remove('hidden');
  });
  const refresh = async () => { m.close(); await loadBase(); render(); };
  const simpleAction = (btn, action, payload, msg) => {
    const b = $(btn, m.el);
    if (!b) return;
    b.onclick = async () => {
      try { await post(`/contracts/${id}/${action}`, payload || {}); toast(msg); await refresh(); }
      catch (e) { toast(e.message, 'error'); }
    };
  };
  simpleAction('#dc-submit', 'submit', {}, '已提交审批');
  simpleAction('#dc-activate', 'activate', { sign_date: today() }, '合同已生效');
  $('#dc-approve', m.el)?.addEventListener('click', () => openApprovalBox(id, 'approve'));
  $('#dc-reject', m.el)?.addEventListener('click', () => openApprovalBox(id, 'reject'));
  $('#dc-file', m.el)?.addEventListener('click', () => openFileBox(id));
  $('#dc-void', m.el)?.addEventListener('click', () => openVoidBox(id));
  $('#dc-change', m.el)?.addEventListener('click', () => openChangeBox(id));
  $$('[data-receive]', m.el).forEach(b => b.onclick = () => openReceiveBox(Number(b.dataset.receive), c.contract_no, Number(b.dataset.rest), b.dataset.term));
  $$('[data-del-pay]', m.el).forEach(b => b.onclick = () => confirmBox('删除该回款期次？', async () => {
    try { await del('/payments/' + b.dataset.delPay); toast('已删除'); await openContractDetail(id); render(); } catch (e) { toast(e.message, 'error'); }
  }));
  const addPay = $('#add-pay', m.el);
  if (addPay) addPay.onclick = () => openPaymentForm(id);
  const resetPay = $('#reset-pay', m.el);
  if (resetPay) resetPay.onclick = () => confirmBox('重置将清空未收款的回款计划，确定继续？', async () => {
    try { await post(`/contracts/${id}/regenerate`); toast('已重置'); await openContractDetail(id); render(); } catch (e) { toast(e.message, 'error'); }
  });
}
function customersPhone(id) { return STATE.customers.find(c => c.id === id)?.phone || '-'; }

function openApprovalBox(id, action) {
  const m = modal({
    title: action === 'approve' ? '审批通过' : '驳回合同',
    body: field('审批意见', 'comment', '', { type: 'textarea', placeholder: action === 'approve' ? '可填写审批意见（选填）' : '请说明驳回原因' }),
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn ${action === 'approve' ? 'primary' : 'danger'}" id="do-approval">确认${action === 'approve' ? '通过' : '驳回'}</button>`,
  });
  $('#do-approval', m.el).onclick = async () => {
    const comment = $('textarea', m.el).value.trim();
    if (action === 'reject' && !comment) return toast('请填写驳回原因', 'error');
    try {
      await post(`/contracts/${id}/approve`, { action, comment });
      m.close(); toast(action === 'approve' ? '审批通过' : '已驳回'); await loadBase(); render();
    } catch (e) { toast(e.message, 'error'); }
  };
}
function openFileBox(id) {
  const m = modal({
    title: '网签备案登记',
    body: `<div class="notice info">备案后房源状态自动更新为「已备案」，并在楼盘表标记已售。请填写住建/房管系统生成的备案编码。</div>
      <div class="form-row" style="margin-top:14px">${field('备案编号', 'filed_no', `备案-${new Date().getFullYear()}-`, { required: true })}
      ${field('备案日期', 'filed_at', today(), { type: 'date' })}</div>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="do-file">确认备案</button>`,
  });
  $('#do-file', m.el).onclick = async () => {
    const filedNo = $('input[name="filed_no"]', m.el).value.trim();
    const filedAt = $('input[name="filed_at"]', m.el).value;
    if (!filedNo || filedNo.endsWith('-')) return toast('请填写完整备案编号', 'error');
    try { await post(`/contracts/${id}/file`, { filed_no: filedNo, filed_at: filedAt }); m.close(); toast('备案成功'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
function openVoidBox(id) {
  const m = modal({
    title: '解除合同 / 退房',
    body: `<div class="notice warn">解除后合同状态变为「已解除」，关联房源自动恢复为「可售」，并生成一条变更记录留痕。</div>
      <div style="margin-top:14px">${field('解除原因', 'reason', '', { type: 'textarea', required: true, placeholder: '如：客户资金周转困难，双方协商一致退房' })}</div>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-danger" id="do-void">确认解除</button>`,
  });
  $('#do-void', m.el).onclick = async () => {
    const reason = $('textarea', m.el).value.trim();
    if (!reason) return toast('请填写解除原因', 'error');
    try { await post(`/contracts/${id}/void`, { reason }); m.close(); toast('合同已解除，房源已释放'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
function openChangeBox(id) {
  const units = STATE.units.filter(u => u.status === 'available');
  const m = modal({
    title: '申请合同变更',
    body: `<form id="change-form">
      ${field('变更类型', 'type', 'rename', { type: 'select', options: Object.entries(CHANGE_TYPE).filter(([k]) => k !== 'cancel').map(([v, l]) => [v, l]) })}
      ${field('变更前', 'from_value', '', { placeholder: '如：原购房人姓名 / 原房号' })}
      ${field('变更后', 'to_value', '', { required: true, placeholder: '换房请填写目标房源 ID；价格变更请填写新金额' })}
      ${units.length ? `<div class="notice info">可换房源：${units.slice(0, 6).map(u => `${u.id} - ${projectName(u.project_id)} ${u.building}${u.room_no}`).join('；')}</div>` : ''}
      ${field('变更原因', 'reason', '', { type: 'textarea', required: true })}
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="do-change">提交审核</button>`,
  });
  $('#do-change', m.el).onclick = async () => {
    const d = formData($('#change-form', m.el));
    if (!d.to_value || !d.reason) return toast('请填写变更内容和原因', 'error');
    try { await post(`/contracts/${id}/change`, d); m.close(); toast('变更申请已提交'); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
function openPaymentForm(contractId) {
  const m = modal({
    title: '增加回款期次',
    body: `<form id="pay-form">${field('期次名称', 'name', '', { required: true, placeholder: '如：尾款（10%）' })}
      ${field('应收金额', 'amount', '0', { type: 'number', attrs: 'min="0"' })}
      ${field('到期日期', 'due_date', '', { type: 'date' })}</form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="do-pay">保存</button>`,
  });
  $('#do-pay', m.el).onclick = async () => {
    const d = formData($('#pay-form', m.el));
    d.amount = Number(d.amount) || 0;
    if (!d.name || !d.amount) return toast('请填写名称和金额', 'error');
    try { await post(`/contracts/${contractId}/payments`, d); m.close(); toast('已增加期次'); await openContractDetail(contractId); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
function openReceiveBox(paymentId, contractNo, rest, term) {
  const m = modal({
    title: '登记回款 · ' + contractNo,
    body: `<div class="notice info">${esc(term)} · 应收余额 ${money(rest)}</div><form id="receive-form" style="margin-top:14px">
      <div class="form-row">${field('本次收款金额', 'amount', Math.round(rest), { type: 'number', required: true, attrs: `min="0.01" max="${rest}"` })}
        ${field('收款方式', 'method', 'transfer', { type: 'select', options: Object.entries(RECEIVE_METHOD).map(([v, l]) => [v, l]) })}</div>
      ${field('凭证号', 'voucher_no', '', { placeholder: '如：银行回单编号' })}
      ${field('备注', 'note', '', { type: 'textarea', rows: 2 })}</form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="do-receive">确认收款</button>`,
  });
  $('#do-receive', m.el).onclick = async () => {
    const d = formData($('#receive-form', m.el));
    d.amount = Number(d.amount);
    try { await post(`/payments/${paymentId}/receive`, d); m.close(); toast('回款已登记'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- 审批中心 ---------------- */
async function renderApprovals(el) {
  const data = await get('/contracts?status=pending&limit=1000');
  el.innerHTML = `
    <div class="page-head"><div><h2>审批中心</h2><p>共 ${data.total} 份合同待审批 · 按金额自动路由审批节点</p></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>合同编号</th><th>客户 / 项目</th><th>金额</th><th>折扣</th><th>提交时间</th><th>当前节点</th><th>操作</th></tr></thead><tbody>
      ${data.rows.length ? data.rows.map(c => {
        const flow = JSON.parse(c.flow || '[]');
        return `<tr><td class="cell-main">${esc(c.contract_no)}</td><td><div>${esc(c.customer_name)}</div><div class="cell-sub">${esc(c.project_name)}</div></td>
          <td class="money">${money(c.amount)}</td><td>${Number(c.discount) < 90 ? `<span class="tag red">${c.discount}%</span>` : `${c.discount}%`}</td>
          <td>${dateStr(c.created_at)}</td><td>${tag({ green: { label: '销售经理', cls: 'blue' }, cyan: { label: '法务', cls: 'purple' }, orange: { label: '财务', cls: 'orange' } }, flow[0] ? 'green' : '')} <span style="font-size:12px;color:var(--text-soft)">按流程逐节点处理</span></td>
          <td><div class="row-actions"><button class="link-btn" data-detail="${c.id}">查看流程</button>
            ${canReview() || canFinance() ? `<button class="link-btn" data-approve="${c.id}">处理审批</button>` : ''}</div></td></tr>`;
      }).join('') : `<tr><td colspan="7"><div class="empty"><div class="empty-ico">✓</div><p>暂无待审批合同</p></div></td></tr>`}
    </tbody></table></div></div>`;
  $$('[data-detail]', el).forEach(b => b.onclick = () => openContractDetail(Number(b.dataset.detail)));
  $$('[data-approve]', el).forEach(b => b.onclick = async () => {
    const c = (await get('/contracts?status=pending&limit=1000')).rows.find(x => x.id === Number(b.dataset.approve));
    const detail = await get('/contracts/' + c.id);
    const flow = JSON.parse(detail.flow || '[]');
    const done = detail.approvals.map(a => a.step);
    const next = flow.find(s => !done.includes(s));
    if (!next) return toast('该合同审批流程已结束', 'error');
    if (STATE.user.role !== 'admin' && STATE.user.role !== FLOW_STEPS[next]?.role) {
      return toast(`当前节点需「${FLOW_STEPS[next]?.label}」处理`, 'error');
    }
    openApprovalBox(c.id, 'approve');
  });
}

/* ---------------- 变更管理 ---------------- */
async function renderChanges(el) {
  const data = await get('/changes?limit=1000');
  el.innerHTML = `
    <div class="page-head"><div><h2>变更管理</h2><p>共 ${data.total} 条变更记录 · 更名 / 换房 / 退房均需审批留痕</p></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>合同</th><th>变更类型</th><th>变更前</th><th>变更后</th><th>原因</th><th>状态</th><th>申请人</th><th>申请时间</th><th>操作</th></tr></thead><tbody>
      ${data.rows.length ? data.rows.map(ch => `<tr><td class="cell-main">${esc(ch.contract_no || ('合同 #' + ch.contract_id))}</td>
        <td>${esc(CHANGE_TYPE[ch.type] || ch.type)}</td><td>${esc(ch.from_value || '-')}</td><td>${esc(ch.to_value || '-')}</td>
        <td>${esc(ch.reason || '-')}</td><td>${tag({ pending: { label: '待审核', cls: 'orange' }, approved: { label: '已通过', cls: 'blue' }, rejected: { label: '已驳回', cls: 'red' }, done: { label: '已完成', cls: 'green' } }, ch.status)}</td>
        <td>${esc(userName(ch.operator_id))}</td><td>${dateStr(ch.created_at)}</td>
        <td>${ch.status === 'pending' && canReview() ? `<button class="link-btn" data-review="${ch.id}">审核</button>` : '-'}</td></tr>`).join('')
        : `<tr><td colspan="9"><div class="empty"><div class="empty-ico">⇄</div><p>暂无变更记录</p></div></td></tr>`}
    </tbody></table></div></div>`;
  $$('[data-review]', el).forEach(b => b.onclick = () => {
    const ch = data.rows.find(x => x.id === Number(b.dataset.review));
    const m = modal({
      title: `审核变更 · ${CHANGE_TYPE[ch.type]}`,
      body: `<div class="notice info">${esc(ch.from_value || '-')} → ${esc(ch.to_value || '-')}<br>原因：${esc(ch.reason || '-')}</div>
        ${ch.type === 'exchange' ? field('目标房源 ID', 'unit_id', '', { required: true, placeholder: '请输入可售房源 ID' }) : ''}
        ${field('审核意见', 'comment', '', { type: 'textarea' })}`,
      foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-danger" id="change-reject">驳回</button><button class="btn btn-primary" id="change-approve">通过并执行</button>`,
    });
    $('#change-approve', m.el).onclick = async () => {
      const unitId = $('input[name="unit_id"]', m.el)?.value;
      if (ch.type === 'exchange' && !unitId) return toast('请填写目标房源 ID', 'error');
      try { await post(`/changes/${ch.id}/review`, { action: 'approve', unit_id: Number(unitId) || null }); m.close(); toast('变更已执行'); await loadBase(); render(); }
      catch (e) { toast(e.message, 'error'); }
    };
    $('#change-reject', m.el).onclick = async () => {
      try { await post(`/changes/${ch.id}/review`, { action: 'reject' }); m.close(); toast('已驳回'); render(); }
      catch (e) { toast(e.message, 'error'); }
    };
  });
}

/* ---------------- 回款管理 ---------------- */
async function renderPayments(el) {
  const q = STATE.filters.payments || {};
  const params = new URLSearchParams({ limit: '1000' });
  if (q.status) params.set('status', q.status);
  const data = await get('/payments?' + params);
  const plan = data.rows.reduce((s, p) => s + p.amount, 0);
  const paid = data.rows.reduce((s, p) => s + p.paid_amount, 0);
  const overdue = data.rows.filter(p => p.status === 'overdue').reduce((s, p) => s + p.amount - p.paid_amount, 0);
  el.innerHTML = `
    <div class="page-head"><div><h2>回款管理</h2><p>共 ${data.total} 个回款期次 · 应收 ${money(plan)} · 已收 ${money(paid)}</p></div>
      <div class="head-actions"><button class="btn btn-ghost" id="export-payments">⇩ 导出 CSV</button></div></div>
    <div class="kpi-strip">
      <div class="card kpi"><div class="k-label">应收总额</div><div class="k-value">${money(plan)}</div></div>
      <div class="card kpi"><div class="k-label">已收总额</div><div class="k-value" style="color:var(--success)">${money(paid)}</div></div>
      <div class="card kpi"><div class="k-label">待收余额</div><div class="k-value">${money(plan - paid)}</div></div>
      <div class="card kpi"><div class="k-label">逾期金额</div><div class="k-value" style="color:var(--danger)">${money(overdue)}</div></div>
    </div>
    <div class="card"><div class="card-body" style="padding-bottom:0"><div class="toolbar">
      <select class="filter" id="pay-status"><option value="">全部状态</option>${Object.entries({ paid: '已收清', partial: '部分收款', pending: '待回款', overdue: '已逾期' }).map(([v, l]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div></div>
    <div class="table-wrap"><table><thead><tr><th>合同编号</th><th>购房客户</th><th>期次</th><th>应收</th><th>已收</th><th>到期日</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${data.rows.length ? data.rows.map(p => {
        const pct = Math.round(p.paid_amount / p.amount * 100);
        return `<tr><td class="cell-main">${esc(p.contract_no)}</td><td>${esc(p.customer_name || '-')}</td>
          <td>${esc(p.name)}</td><td class="money">${money(p.amount)}</td><td class="money">${money(p.paid_amount)}</td>
          <td>${dateStr(p.due_date)}</td><td>${tag({ paid: { label: '已收清', cls: 'green' }, partial: { label: '部分收款', cls: 'blue' }, pending: { label: '待回款', cls: 'gray' }, overdue: { label: '已逾期', cls: 'red' } }, p.status)}</td>
          <td><div class="row-actions">${canFinance() && p.status !== 'paid' ? `<button class="link-btn" data-receive="${p.id}" data-rest="${p.amount - p.paid_amount}" data-term="${esc(p.name)}" data-contract="${esc(p.contract_no)}">登记回款</button>` : ''}
            <button class="link-btn" data-contract-detail="${p.contract_id}">合同详情</button></div></td></tr>`;
      }).join('') : `<tr><td colspan="8"><div class="empty"><div class="empty-ico">¥</div><p>暂无回款计划</p></div></td></tr>`}
    </tbody></table></div></div>`;
  $('#pay-status', el).onchange = e => { STATE.filters.payments = { status: e.target.value }; renderPayments(el); };
  $('#export-payments', el).onclick = () => { window.location.href = '/api/export/payments'; };
  $$('[data-receive]', el).forEach(b => b.onclick = () => openReceiveBox(Number(b.dataset.receive), b.dataset.contract, Number(b.dataset.rest), b.dataset.term));
  $$('[data-contract-detail]', el).forEach(b => b.onclick = () => openContractDetail(Number(b.dataset.contractDetail)));
}

/* ---------------- 房源销控 ---------------- */
async function renderUnits(el) {
  const q = STATE.filters.units || {};
  const params = new URLSearchParams({ limit: '2000' });
  if (q.project_id) params.set('project_id', q.project_id);
  if (q.status) params.set('status', q.status);
  const data = await get('/units?' + params);
  const counts = Object.keys(USTATUS).map(k => ({ k, n: data.rows.filter(u => u.status === k).length }));
  el.innerHTML = `
    <div class="page-head"><div><h2>房源销控</h2><p>共 ${data.total} 套房源 · 状态随合同审批、备案、解除自动联动</p></div>
      ${canMaster() ? `<div class="head-actions"><button class="btn btn-primary" id="add-unit">+ 新增房源</button></div>` : ''}</div>
    <div class="card"><div class="card-body" style="padding-bottom:0"><div class="toolbar">
      <select class="filter" id="unit-project"><option value="">全部项目</option>${STATE.projects.map(p => `<option value="${p.id}" ${String(q.project_id) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <select class="filter" id="unit-status"><option value="">全部状态</option>${Object.entries(USTATUS).map(([v, o]) => `<option value="${v}" ${q.status === v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      <span style="font-size:12px;color:var(--text-soft)">${counts.map(c => `${USTATUS[c.k].label} ${c.n}`).join(' · ')}</span>
    </div></div>
    <div class="card-body"><div class="unit-grid">${data.rows.length ? data.rows.map(u => `
      <div class="unit-card ${u.status}" data-unit="${u.id}">
        <div class="u-room">${esc(u.building)} ${esc(u.room_no)}</div>
        <div class="u-meta">${esc(projectName(u.project_id))}<br>${u.area} ㎡ · ${u.floor} 层</div>
        <div class="u-price">${money(u.list_price)}</div>
        <div style="margin-top:8px">${tag(USTATUS, u.status)}</div>
      </div>`).join('') : '<div class="empty">暂无房源</div>'}</div></div></div>`;
  $('#unit-project', el).onchange = e => { STATE.filters.units = { ...q, project_id: e.target.value }; renderUnits(el); };
  $('#unit-status', el).onchange = e => { STATE.filters.units = { ...q, status: e.target.value }; renderUnits(el); };
  $('#add-unit', el)?.addEventListener('click', () => openUnitForm());
  $$('[data-unit]', el).forEach(card => card.onclick = () => { if (canMaster()) openUnitForm(Number(card.dataset.unit)); });
}
function openUnitForm(id) {
  const u = id ? STATE.units.find(x => x.id === id) : null;
  const m = modal({
    title: u ? '编辑房源' : '新增房源',
    body: `<form id="unit-form">
      <div class="form-row">${field('项目', 'project_id', u?.project_id || '', { type: 'select', required: true, options: [['', '请选择'], ...STATE.projects.map(p => [p.id, p.name])] })}
        ${field('楼栋', 'building', u?.building || '', { required: true })}</div>
      <div class="form-row">${field('房号', 'room_no', u?.room_no || '', { required: true })}
        ${field('楼层', 'floor', u?.floor || '', { type: 'number' })}</div>
      <div class="form-row">${field('建筑面积（㎡）', 'area', u?.area || '', { type: 'number', attrs: 'step="0.01"' })}
        ${field('面价（元）', 'list_price', u?.list_price || '', { type: 'number', attrs: 'step="100"' })}</div>
      ${field('状态', 'status', u?.status || 'available', { type: 'select', options: Object.entries(USTATUS).map(([v, o]) => [v, o.label]) })}
      <div class="notice info">房源状态通常由合同流程自动更新；手动修改仅用于销控初始化或异常修正。</div>
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-unit">保存</button>`,
  });
  $('#save-unit', m.el).onclick = async () => {
    const d = formData($('#unit-form', m.el));
    ['project_id', 'floor', 'area', 'list_price'].forEach(k => d[k] = Number(d[k]) || 0);
    try {
      if (id) await put('/units/' + id, d); else await post('/units', d);
      m.close(); toast('已保存'); await loadBase(); render();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- 客户 / 项目 ---------------- */
async function renderCustomers(el) {
  const q = STATE.filters.customers || {};
  const params = new URLSearchParams({ limit: '2000' });
  if (q.q) params.set('q', q.q);
  const data = await get('/customers?' + params);
  let rows = data.rows;
  if (q.level) rows = rows.filter(c => c.level === q.level);
  el.innerHTML = `
    <div class="page-head"><div><h2>购房客户</h2><p>共 ${data.total} 位客户 · 合同与回款均关联客户档案</p></div>
      ${isManager() ? `<div class="head-actions"><button class="btn btn-ghost" id="export-customers">⇩ 导出 CSV</button></div>` : ''}
      <div class="head-actions"><button class="btn btn-primary" id="add-customer">+ 新增客户</button></div></div>
    <div class="card"><div class="card-body" style="padding-bottom:0"><div class="toolbar">
      <div class="search-box"><input id="customer-search" placeholder="搜索姓名 / 电话 / 证件号 / 来源" value="${esc(q.q || '')}"></div>
      <select class="filter" id="customer-level"><option value="">全部级别</option>${['A', 'B', 'C'].map(l => `<option ${q.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div></div>
    <div class="table-wrap"><table><thead><tr><th>客户</th><th>电话</th><th>证件号</th><th>来源</th><th>级别</th><th>地址</th><th>负责人</th><th>操作</th></tr></thead><tbody>
      ${rows.length ? rows.map(c => `<tr><td class="cell-main">${esc(c.name)}<div class="cell-sub">${esc(c.note || '')}</div></td>
        <td>${esc(c.phone || '-')}</td><td>${esc(c.id_no || '-')}</td><td>${esc(c.channel || '-')}</td>
        <td><span class="tag ${c.level === 'A' ? 'red' : c.level === 'B' ? 'orange' : 'gray'}">${c.level || 'B'}</span></td>
        <td>${esc(c.address || '-')}</td><td>${esc(userName(c.owner_id))}</td>
        <td><div class="row-actions"><button class="link-btn" data-edit-customer="${c.id}">编辑</button>
          <button class="link-btn danger" data-del-customer="${c.id}">删除</button></div></td></tr>`).join('')
        : `<tr><td colspan="8"><div class="empty"><div class="empty-ico">◧</div><p>暂无客户</p></div></td></tr>`}
    </tbody></table></div></div>`;
  const search = $('#customer-search', el);
  let timer;
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { STATE.filters.customers = { ...q, q: search.value }; renderCustomers(el); }, 350); };
  $('#customer-level', el).onchange = e => { STATE.filters.customers = { ...q, level: e.target.value }; renderCustomers(el); };
  $('#add-customer', el).onclick = () => openCustomerForm();
  $('#export-customers', el)?.addEventListener('click', () => { window.location.href = '/api/export/customers'; });
  $$('[data-edit-customer]', el).forEach(b => b.onclick = () => openCustomerForm(Number(b.dataset.editCustomer)));
  $$('[data-del-customer]', el).forEach(b => b.onclick = () => confirmBox('删除客户？该客户关联的合同不会被删除。', async () => {
    try { await del('/customers/' + b.dataset.delCustomer); toast('已删除'); await loadBase(); render(); } catch (e) { toast(e.message, 'error'); }
  }));
}
function openCustomerForm(id) {
  const c = id ? STATE.customers.find(x => x.id === id) : null;
  const ownerOpts = isManager() ? STATE.users.map(u => [u.id, u.display_name]) : [[STATE.user.id, STATE.user.display_name]];
  const m = modal({
    title: id ? '编辑客户' : '新增客户',
    body: `<form id="customer-form">
      <div class="form-row">${field('客户姓名', 'name', c?.name || '', { required: true })}${field('电话', 'phone', c?.phone || '')}</div>
      <div class="form-row">${field('身份证 / 证件号', 'id_no', c?.id_no || '')}
        ${field('客户级别', 'level', c?.level || 'B', { type: 'select', options: [['A', 'A - 重点'], ['B', 'B - 普通'], ['C', 'C - 潜在']] })}</div>
      <div class="form-row">${field('来源渠道', 'channel', c?.channel || '', { type: 'select', options: ['自然到访', '渠道推荐', '老带新', '线上留电', '其他'] })}
        ${field('负责人', 'owner_id', c?.owner_id || STATE.user.id, { type: 'select', options: ownerOpts })}</div>
      ${field('联系地址', 'address', c?.address || '')}
      ${field('备注', 'note', c?.note || '', { type: 'textarea' })}
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-customer">保存</button>`,
  });
  $('#save-customer', m.el).onclick = async () => {
    const d = formData($('#customer-form', m.el));
    d.owner_id = Number(d.owner_id);
    try { if (id) await put('/customers/' + id, d); else await post('/customers', d); m.close(); toast('已保存'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
async function renderProjects(el) {
  const data = await get('/projects?limit=1000');
  const stats = await get('/stats/projects');
  el.innerHTML = `
    <div class="page-head"><div><h2>项目管理</h2><p>共 ${data.total} 个项目 · 集团—项目两级数据视角</p></div>
      ${canMaster() ? `<div class="head-actions"><button class="btn btn-primary" id="add-project">+ 新增项目</button></div>` : ''}</div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>项目</th><th>城市</th><th>地址</th><th>状态</th><th>房源</th><th>可售</th><th>合同数</th><th>签约金额</th><th>操作</th></tr></thead><tbody>
      ${data.rows.map(p => {
        const st = stats.find(x => x.id === p.id) || {};
        return `<tr><td class="cell-main">${esc(p.name)}</td><td>${esc(p.city)}</td><td>${esc(p.address || '-')}</td>
          <td>${tag({ on_sale: { label: '在售', cls: 'green' }, pre_sale: { label: '预售', cls: 'blue' }, delivered: { label: '已交付', cls: 'gray' } }, p.status)}</td>
          <td>${st.unit_total || 0}</td><td>${st.unit_available || 0}</td><td>${st.contracts || 0}</td><td class="money">${money(st.amount)}</td>
          <td>${canMaster() ? `<button class="link-btn" data-edit-project="${p.id}">编辑</button>` : '-'}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
  $('#add-project', el)?.addEventListener('click', () => openProjectForm());
  $$('[data-edit-project]', el).forEach(b => b.onclick = () => openProjectForm(Number(b.dataset.editProject)));
}
function openProjectForm(id) {
  const p = id ? STATE.projects.find(x => x.id === id) : null;
  const m = modal({
    title: id ? '编辑项目' : '新增项目',
    body: `<form id="project-form">
      <div class="form-row">${field('项目名称', 'name', p?.name || '', { required: true })}${field('城市', 'city', p?.city || '', { required: true })}</div>
      ${field('地址', 'address', p?.address || '')}
      <div class="form-row">${field('开发商', 'developer', p?.developer || '')}
        ${field('状态', 'status', p?.status || 'on_sale', { type: 'select', options: [['on_sale', '在售'], ['pre_sale', '预售'], ['delivered', '已交付']] })}</div>
      ${field('规划总套数', 'total_units', p?.total_units || 0, { type: 'number' })}
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-project">保存</button>`,
  });
  $('#save-project', m.el).onclick = async () => {
    const d = formData($('#project-form', m.el));
    d.total_units = Number(d.total_units) || 0;
    try { if (id) await put('/projects/' + id, d); else await post('/projects', d); m.close(); toast('已保存'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- 模板 / 风险 / 报表 ---------------- */
async function renderTemplates(el) {
  const data = await get('/templates?limit=1000');
  el.innerHTML = `
    <div class="page-head"><div><h2>合同模板</h2><p>共 ${data.total} 个模板 · 统一范本与条款口径，降低文本风险</p></div>
      ${canMaster() ? `<div class="head-actions"><button class="btn btn-primary" id="add-template">+ 新增模板</button></div>` : ''}</div>
    <div class="grid-2">${data.rows.map(t => `
      <div class="card"><div class="card-header"><div><h3>${esc(t.name)}</h3>
        <div style="font-size:11px;color:var(--text-soft);margin-top:3px">${esc(CTYPE[t.type]?.label || t.type)} · ${esc(t.version)}</div></div>
        ${tag({ active: { label: '启用中', cls: 'green' }, draft: { label: '草稿', cls: 'orange' }, archived: { label: '已归档', cls: 'gray' } }, t.status)}</div>
        <div class="card-body"><div style="font-size:12px;color:var(--text-mid);white-space:pre-wrap;line-height:1.8;max-height:150px;overflow:auto">${esc(t.content || '-')}</div>
          ${canMaster() ? `<div style="margin-top:12px"><button class="link-btn" data-edit-template="${t.id}">编辑</button></div>` : ''}</div></div>`).join('')}</div>`;
  $('#add-template', el)?.addEventListener('click', () => openTemplateForm());
  $$('[data-edit-template]', el).forEach(b => b.onclick = () => openTemplateForm(Number(b.dataset.editTemplate), data.rows.find(x => x.id === Number(b.dataset.editTemplate))));
}
function openTemplateForm(id, t) {
  const m = modal({
    title: id ? '编辑模板' : '新增模板',
    body: `<form id="template-form">
      <div class="form-row">${field('模板名称', 'name', t?.name || '', { required: true })}
        ${field('合同类型', 'type', t?.type || 'sale', { type: 'select', options: Object.entries(CTYPE).map(([v, o]) => [v, o.label]) })}</div>
      <div class="form-row">${field('版本', 'version', t?.version || 'v1.0')}
        ${field('状态', 'status', t?.status || 'active', { type: 'select', options: [['active', '启用中'], ['draft', '草稿'], ['archived', '已归档']] })}</div>
      ${field('条款内容', 'content', t?.content || '', { type: 'textarea', rows: 10 })}
      <div class="notice warn">系统会扫描「无条件付款、无限连带责任」等表述并在风险预警中提示。</div>
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-template">保存</button>`,
  });
  $('#save-template', m.el).onclick = async () => {
    const d = formData($('#template-form', m.el));
    try { if (id) await put('/templates/' + id, d); else await post('/templates', d); m.close(); toast('已保存'); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
async function renderRisks(el) {
  const alerts = await get('/stats/alerts');
  const groups = { high: [], medium: [], low: [] };
  alerts.forEach(a => groups[a.level].push(a));
  el.innerHTML = `
    <div class="page-head"><div><h2>风险预警</h2><p>共 ${alerts.length} 项预警 · 规则覆盖回款逾期、备案超期、转签超期、审批滞留、折扣与条款风险</p></div></div>
    ${['high', 'medium', 'low'].map(level => {
      const list = groups[level];
      if (!list.length) return '';
      const label = { high: '高风险', medium: '中风险', low: '提醒' }[level];
      const color = { high: 'red', medium: 'orange', low: 'blue' }[level];
      return `<div class="card" style="margin-bottom:18px"><div class="card-header"><h3><span class="tag ${color}">${label}</span> ${list.length} 项</h3></div>
        <div class="card-body">${list.map(a => `<div class="alert-item"><span class="alert-dot ${level}"></span>
          <div style="flex:1"><div class="alert-title">${esc(a.title)}</div><div class="alert-detail">${esc(a.type)} · ${esc(a.detail)}</div></div>
          <button class="link-btn" data-risk-contract="${a.contract_id}">查看合同</button></div>`).join('')}</div></div>`;
    }).join('') || '<div class="card"><div class="empty"><div class="empty-ico">✓</div><p>当前没有风险预警，业务运转良好</p></div></div>'}`;
  $$('[data-risk-contract]', el).forEach(b => b.onclick = () => openContractDetail(Number(b.dataset.riskContract)));
}
async function renderReports(el) {
  const [s, stages, trend, projects, sales] = await Promise.all([
    get('/stats/overview'), get('/stats/stages'), get('/stats/trend'), get('/stats/projects'), get('/stats/sales'),
  ]);
  const maxTrend = Math.max(1, ...trend.map(t => t.cnt));
  const maxSale = Math.max(1, ...sales.map(x => x.amount));
  el.innerHTML = `
    <div class="page-head"><div><h2>统计报表</h2><p>签约、回款、房源去化与团队业绩一屏掌握</p></div>
      <button class="btn btn-ghost" id="print-report">🖨 打印报表</button></div>
    <div class="stats-grid">
      ${statCard('blue', '▤', '签约金额', money(s.contractAmount), `${s.contractCount} 份合同`)}
      ${statCard('green', '¥', '累计回款', money(s.received), `回款率 ${s.collectionRate}%`)}
      ${statCard('orange', '◈', '审批中', s.pending, '待处理')}
      ${statCard('red', '!', '风险预警', s.alerts, `高风险 ${s.highAlerts}`)}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-header"><h3>签约趋势（近 6 月）</h3></div><div class="card-body">
        ${trend.length ? `<div class="bar-chart">${trend.map(t => `<div class="bar-col"><div class="bar-value">${t.cnt}</div>
          <div class="bar" style="height:${t.cnt / maxTrend * 100}%"></div><div class="bar-label">${t.ym}</div></div>`).join('')}</div>` : '<div class="empty">暂无签约数据</div>'}
      </div></div>
      <div class="card"><div class="card-header"><h3>合同状态分布</h3></div><div class="card-body"><div class="chart-rows">
        ${stages.map(x => `<div class="chart-row"><span>${x.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, x.count / Math.max(1, ...stages.map(y => y.count)) * 100)}%"></div></div><span style="text-align:right">${x.count} 份</span></div>`).join('')}
      </div></div></div>
    </div>
    <div class="card" style="margin-bottom:18px"><div class="card-header"><h3>项目货值与去化</h3></div>
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>城市</th><th>房源总数</th><th>可售</th><th>去化率</th><th>合同数</th><th>签约金额</th></tr></thead><tbody>
        ${projects.map(p => `<tr><td class="cell-main">${esc(p.name)}</td><td>${esc(p.city)}</td><td>${p.unit_total}</td><td>${p.unit_available}</td>
          <td>${p.unit_total ? Math.round((p.unit_total - p.unit_available) / p.unit_total * 100) : 0}%</td><td>${p.contracts}</td><td class="money">${money(p.amount)}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><div class="card-header"><h3>团队业绩</h3></div><div class="card-body">
      ${sales.length ? sales.map(x => `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px">
        <span><b>${esc(x.display_name)}</b> <span class="tag gray">${esc(ROLE_LABEL[x.role] || x.role)}</span></span><span class="money">${money(x.amount)}</span></div>
        <div class="progress"><i style="width:${x.amount / maxSale * 100}%"></i></div>
        <div style="font-size:11px;color:var(--text-soft);margin-top:4px">成交 ${x.cnt} 份 · 回款 ${money(x.received)}</div></div>`).join('') : '<div class="empty">暂无团队业绩数据</div>'}
    </div></div>`;
  $('#print-report', el).onclick = () => window.print();
}

/* ---------------- 任务 / 用户 / 日志 / 数据库 ---------------- */
async function renderTasks(el) {
  const q = STATE.filters.tasks || {};
  const params = new URLSearchParams({ limit: '1000' });
  if (q.status) params.set('status', q.status);
  if (q.due) params.set('due', q.due);
  const data = await get('/tasks?' + params);
  el.innerHTML = `
    <div class="page-head"><div><h2>待办任务</h2><p>共 ${data.total} 项任务 · 合同节点催办与审批提醒</p></div>
      <div class="head-actions"><button class="btn btn-primary" id="add-task">+ 新建任务</button></div></div>
    <div class="card"><div class="card-body" style="padding-bottom:0"><div class="toolbar">
      <select class="filter" id="task-status"><option value="">全部状态</option><option value="pending" ${q.status === 'pending' ? 'selected' : ''}>待办</option><option value="done" ${q.status === 'done' ? 'selected' : ''}>已完成</option></select>
      <select class="filter" id="task-due"><option value="">全部时间</option><option value="today" ${q.due === 'today' ? 'selected' : ''}>今天到期</option><option value="overdue" ${q.due === 'overdue' ? 'selected' : ''}>已逾期</option></select>
    </div></div>
    <div class="table-wrap"><table><thead><tr><th style="width:36px"></th><th>任务</th><th>关联合同</th><th>优先级</th><th>截止日期</th><th>负责人</th><th>状态</th></tr></thead><tbody>
      ${data.rows.length ? data.rows.map(t => `<tr><td><input type="checkbox" data-check-task="${t.id}" ${t.status === 'done' ? 'checked' : ''} style="width:auto"></td>
        <td><div class="cell-main" style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--text-soft)' : ''}">${esc(t.title)}</div>
          <div class="cell-sub">${esc(t.description || '')}</div></td>
        <td>${t.contract_id ? `<button class="link-btn" data-task-contract="${t.contract_id}">#${t.contract_id}</button>` : '-'}</td>
        <td>${tag(PRIORITY, t.priority)}</td>
        <td>${dateStr(t.due_date)} ${t.status === 'pending' && t.due_date && t.due_date < today() ? '<span class="tag red">逾期</span>' : ''}</td>
        <td>${esc(userName(t.owner_id))}</td><td>${tag({ pending: { label: '待办', cls: 'orange' }, done: { label: '已完成', cls: 'green' } }, t.status)}</td></tr>`).join('')
        : `<tr><td colspan="7"><div class="empty"><div class="empty-ico">✓</div><p>暂无任务</p></div></td></tr>`}
    </tbody></table></div></div>`;
  $('#task-status', el).onchange = e => { STATE.filters.tasks = { ...q, status: e.target.value }; renderTasks(el); };
  $('#task-due', el).onchange = e => { STATE.filters.tasks = { ...q, due: e.target.value }; renderTasks(el); };
  $('#add-task', el).onclick = () => openTaskForm();
  $$('[data-check-task]', el).forEach(c => c.onchange = async () => {
    const done = c.checked;
    try { await put('/tasks/' + c.dataset.checkTask, { status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null }); toast(done ? '任务已完成' : '任务已恢复'); render(); }
    catch (e) { toast(e.message, 'error'); }
  });
  $$('[data-task-contract]', el).forEach(b => b.onclick = () => openContractDetail(Number(b.dataset.taskContract)));
}
function openTaskForm() {
  const ownerOpts = isManager() ? STATE.users.map(u => [u.id, u.display_name]) : [[STATE.user.id, STATE.user.display_name]];
  const m = modal({
    title: '新建任务',
    body: `<form id="task-form">${field('任务标题', 'title', '', { required: true })}
      ${field('描述', 'description', '', { type: 'textarea', rows: 2 })}
      <div class="form-row">${field('截止日期', 'due_date', today(), { type: 'date' })}
        ${field('优先级', 'priority', 'medium', { type: 'select', options: [['high', '高'], ['medium', '中'], ['low', '低']] })}</div>
      <div class="form-row">${field('关联合同 ID', 'contract_id', '', { type: 'number', placeholder: '选填' })}
        ${field('负责人', 'owner_id', STATE.user.id, { type: 'select', options: ownerOpts })}</div>
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-task">保存</button>`,
  });
  $('#save-task', m.el).onclick = async () => {
    const d = formData($('#task-form', m.el));
    d.contract_id = Number(d.contract_id) || null; d.owner_id = Number(d.owner_id);
    try { await post('/tasks', d); m.close(); toast('任务已创建'); render(); } catch (e) { toast(e.message, 'error'); }
  };
}
async function renderUsers(el) {
  if (STATE.user.role !== 'admin') return;
  const users = await get('/users');
  el.innerHTML = `
    <div class="page-head"><div><h2>用户管理</h2><p>共 ${users.length} 个账号 · 五级角色对应合同审批与数据权限</p></div>
      <div class="head-actions"><button class="btn btn-primary" id="add-user">+ 新增用户</button></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
      ${users.map(u => `<tr><td class="cell-main">${esc(u.username)}</td><td>${esc(u.display_name)}</td>
        <td><span class="tag ${u.role === 'admin' ? 'purple' : u.role === 'manager' ? 'blue' : 'gray'}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
        <td>${u.active ? '<span class="tag green">启用</span>' : '<span class="tag red">停用</span>'}</td><td>${dateStr(u.created_at)}</td>
        <td><button class="link-btn" data-edit-user="${u.id}">编辑</button>
          ${u.id !== STATE.user.id ? `<button class="link-btn danger" data-del-user="${u.id}">删除</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>
    <div style="margin-top:16px;padding:14px 18px;background:#fff;border-radius:10px;border:1px solid var(--border);font-size:12px;color:var(--text-mid)">
      <b>权限说明：</b>管理员可管理全部；销售经理可查看全部并审批/管理主数据；置业顾问仅看自己负责的合同；法务负责条款与变更审核；财务负责回款登记；金额 ≥ 300 万自动增加总经理审批节点。
    </div>`;
  $('#add-user', el).onclick = () => openUserForm();
  $$('[data-edit-user]', el).forEach(b => b.onclick = () => openUserForm(Number(b.dataset.editUser), users.find(u => u.id === Number(b.dataset.editUser))));
  $$('[data-del-user]', el).forEach(b => b.onclick = () => confirmBox('确定删除该用户？', async () => {
    try { await del('/users/' + b.dataset.delUser); toast('已删除'); await loadBase(); render(); } catch (e) { toast(e.message, 'error'); }
  }));
}
function openUserForm(id, u) {
  const m = modal({
    title: id ? '编辑用户' : '新增用户',
    body: `<form id="user-form">
      <div class="form-row">${field('用户名', 'username', u?.username || '', { required: true, attrs: u ? 'disabled' : '' })}
        ${field('显示名称', 'display_name', u?.display_name || '', { required: true })}</div>
      ${field('密码', 'password', '', { type: 'password', placeholder: u ? '留空表示不修改' : '请输入密码', required: !u })}
      <div class="form-row">${field('角色', 'role', u?.role || 'sales', { type: 'select', options: Object.entries(ROLE_LABEL).map(([v, l]) => [v, l]) })}
        ${field('状态', 'active', u ? String(u.active) : '1', { type: 'select', options: [['1', '启用'], ['0', '停用']] })}</div>
    </form>`,
    foot: `<button class="btn btn-ghost modal-cancel">取消</button><button class="btn btn-primary" id="save-user">保存</button>`,
  });
  $('#save-user', m.el).onclick = async () => {
    const d = formData($('#user-form', m.el));
    d.active = d.active === '1';
    try { if (id) await put('/users/' + id, d); else await post('/users', d); m.close(); toast('已保存'); await loadBase(); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
}
async function renderAudit(el) {
  if (!isManager()) return;
  const logs = await get('/audit');
  el.innerHTML = `
    <div class="page-head"><div><h2>操作日志</h2><p>最近 ${logs.length} 条操作 · 审批、回款、变更全流程留痕</p></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th></tr></thead><tbody>
      ${logs.length ? logs.map(l => `<tr><td>${dateStr(l.created_at)}</td><td>${esc(l.username || '-')}</td>
        <td><span class="tag gray">${esc(l.action)}</span></td><td>${esc(l.target || '-')}</td><td>${esc(l.detail || '-')}</td></tr>`).join('')
        : `<tr><td colspan="5"><div class="empty">暂无日志</div></td></tr>`}
    </tbody></table></div></div>`;
}
const TABLE_LABELS = {
  users: '用户账号', projects: '项目', units: '房源', customers: '购房客户', contracts: '合同',
  approvals: '审批记录', payments: '回款计划', receipts: '收款流水', changes: '变更记录',
  templates: '合同模板', tasks: '待办任务', audit_logs: '操作日志',
};
async function renderDatabase(el) {
  if (STATE.user.role !== 'admin') return;
  const tables = await get('/db/tables');
  const active = STATE.filters.dbTable || 'contracts';
  const view = await get(`/db/table/${active}?limit=100`);
  el.innerHTML = `
    <div class="page-head"><div><h2>数据库管理</h2><p>查看底层数据、执行只读查询、导出与备份 · 仅管理员可用</p></div>
      <div class="head-actions"><button class="btn btn-ghost" id="db-export">⇩ 导出整库</button>
        <button class="btn btn-primary" id="db-backup">▣ 一键备份</button></div></div>
    <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start">
      <div class="card"><div class="card-header"><h3>数据表</h3><span style="font-size:11px;color:var(--text-soft)">${tables.length} 张</span></div>
        <div class="card-body" style="padding:8px">${tables.map(t => `<div class="db-table-item ${t.name === active ? 'active' : ''}" data-table="${esc(t.name)}">
          <span>${esc(TABLE_LABELS[t.name] || t.name)}</span><span class="db-table-count">${t.rows}</span></div>`).join('')}</div></div>
      <div>
        <div class="card" style="margin-bottom:18px"><div class="card-header"><h3>只读 SQL 查询</h3>
          <span style="font-size:11px;color:var(--text-soft)">仅允许 SELECT / WITH / PRAGMA table_info</span></div>
          <div class="card-body"><div style="display:flex;gap:8px"><textarea id="sql-input" rows="2" style="flex:1;font-family:monospace">SELECT * FROM ${esc(active)} LIMIT 20</textarea>
            <button class="btn btn-primary" id="run-sql" style="align-self:stretch">执行</button></div><div id="sql-result"></div></div></div>
        <div class="card"><div class="card-header"><h3>${esc(TABLE_LABELS[active] || active)} · 数据浏览</h3>
          <span style="font-size:12px;color:var(--text-soft)">共 ${view.total} 行</span></div>
          <div class="table-wrap"><table><thead><tr>${view.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
            ${view.rows.length ? view.rows.map(r => `<tr>${view.columns.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')
              : `<tr><td colspan="${view.columns.length || 1}"><div class="empty">暂无数据</div></td></tr>`}
          </tbody></table></div></div>
      </div>
    </div>`;
  $$('.db-table-item', el).forEach(item => item.onclick = () => { STATE.filters.dbTable = item.dataset.table; renderDatabase(el); });
  $('#run-sql', el).onclick = async () => {
    const sql = $('#sql-input', el).value.trim();
    const box = $('#sql-result', el);
    box.innerHTML = '<div style="padding:12px;color:var(--text-soft);font-size:12px">执行中...</div>';
    try {
      const r = await post('/db/query', { sql });
      box.innerHTML = `<div style="margin-top:12px;padding:10px 12px;background:var(--success-light);border-radius:6px;font-size:12px;color:var(--success)">✓ 返回 ${r.rows.length} 行 · 耗时 ${r.elapsed}ms</div>
        ${r.rows.length ? `<div class="table-wrap" style="margin-top:10px;max-height:320px;overflow:auto"><table><thead><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
          ${r.rows.map(row => `<tr>${r.columns.map(c => `<td>${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}`;
    } catch (e) {
      box.innerHTML = `<div style="margin-top:12px;padding:10px 12px;background:var(--danger-light);border-radius:6px;font-size:12px;color:var(--danger)">✕ ${esc(e.message)}</div>`;
    }
  };
  $('#db-export', el).onclick = () => { window.location.href = '/api/db/export'; toast('整库导出已开始'); };
  $('#db-backup', el).onclick = async () => {
    try { const r = await post('/db/backup'); toast('备份成功：' + r.file + '（' + (r.bytes / 1024).toFixed(0) + ' KB）'); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  setupNav();
  await initLogin();
  try {
    STATE.user = await get('/me');
    await enterApp();
  } catch { showLogin(); }
})();
