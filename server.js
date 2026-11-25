'use strict';
/**
 * 正合合同 · 房地产销售合同管理系统
 * 零依赖：Node.js 22 内置 http / crypto / fs / path / node:sqlite
 * 启动：node server.js  →  http://localhost:3001
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  db, hashPassword, verifyPassword, audit, now, iso,
  CONTRACT_TYPES, CONTRACT_STATUS, UNIT_STATUS, APPROVAL_STEPS, RISK_CLAUSES,
  flowFor, planFor, DB_PATH,
} = require('./db');

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECRET_PATH = path.join(__dirname, 'data', 'secret');
let SECRET;
if (process.env.CONTRACT_SECRET) SECRET = process.env.CONTRACT_SECRET;
else if (fs.existsSync(SECRET_PATH)) SECRET = fs.readFileSync(SECRET_PATH, 'utf8');
else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, SECRET, { mode: 0o600 });
}

/* ---------------- 基础工具 ---------------- */
function send(res, code, data, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
const ok = (res, data) => send(res, 200, { ok: true, data });
const fail = (res, code, msg) => send(res, code, { ok: false, error: msg });
function body(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 5e6) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function signToken(userId) {
  const payload = Buffer.from(String(userId)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    return Number(Buffer.from(payload, 'base64url').toString());
  } catch { return null; }
}
function currentUser(req) {
  const id = verifyToken(parseCookies(req.headers.cookie).contract_token);
  if (!id) return null;
  const user = db.prepare('SELECT id,username,display_name,role,active FROM users WHERE id=?').get(id);
  return user && user.active ? user : null;
}
const isManager = u => u && (u.role === 'admin' || u.role === 'manager');
const canMaster = u => u && (u.role === 'admin' || u.role === 'manager');
const canFinance = u => u && ['admin', 'manager', 'finance'].includes(u.role);
const canReview = u => u && ['admin', 'manager', 'legal'].includes(u.role);
function scopeClause(user, alias = 'c') {
  if (user.role !== 'sales') return { sql: '', args: [] };
  return { sql: ` AND ${alias}.owner_id=?`, args: [user.id] };
}
const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, rel.replace(/^\/+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, '禁止访问');
  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return fail(res, 404, '页面不存在');
        send(res, 200, html, MIME['.html']);
      });
      return;
    }
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

/* ---------------- 通用 CRUD ---------------- */
const TABLES = {
  projects: {
    fields: ['name', 'city', 'address', 'developer', 'total_units', 'status'],
    required: ['name', 'city'], searchable: ['name', 'city', 'address'], numeric: ['total_units'],
    updated: false, master: true,
  },
  units: {
    fields: ['project_id', 'building', 'room_no', 'floor', 'area', 'list_price', 'status'],
    required: ['project_id', 'building', 'room_no'], searchable: ['building', 'room_no'],
    numeric: ['project_id', 'floor', 'area', 'list_price'], updated: false, master: true,
  },
  customers: {
    fields: ['name', 'phone', 'id_no', 'channel', 'level', 'address', 'note', 'owner_id'],
    required: ['name'], searchable: ['name', 'phone', 'id_no', 'channel', 'note'],
    numeric: ['owner_id'], defaultOwner: true, updated: true,
  },
  templates: {
    fields: ['name', 'type', 'version', 'content', 'status'],
    required: ['name'], searchable: ['name', 'content'], updated: true, master: true,
  },
  tasks: {
    fields: ['title', 'description', 'due_date', 'priority', 'status', 'contract_id', 'owner_id'],
    required: ['title'], searchable: ['title', 'description'], defaultOwner: true,
    numeric: ['contract_id', 'owner_id'], updated: false,
  },
  changes: {
    fields: ['contract_id', 'type', 'from_value', 'to_value', 'reason', 'status'],
    required: ['contract_id', 'type'], searchable: ['reason', 'type'], numeric: ['contract_id'],
    updated: false, readOnly: true,
  },
};

function listRecords(res, user, table, query) {
  const cfg = TABLES[table];
  const where = [];
  const args = [];
  if (table === 'customers' || table === 'tasks') {
    const sc = scopeClause(user, '');
    if (sc.sql) { where.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args); }
  }
  if (query.q && cfg.searchable) {
    const like = `%${query.q}%`;
    where.push('(' + cfg.searchable.map(f => `${f} LIKE ?`).join(' OR ') + ')');
    cfg.searchable.forEach(() => args.push(like));
  }
  for (const f of ['status', 'type', 'level', 'project_id', 'customer_id', 'contract_id', 'owner_id', 'priority']) {
    if (query[f] !== undefined && query[f] !== '') { where.push(`${f}=?`); args.push(query[f]); }
  }
  if (query.due === 'today') where.push('date(due_date)=date("now")');
  if (query.due === 'overdue') where.push('due_date < date("now") AND status="pending"');
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const order = { customers: 'updated_at DESC', units: 'project_id, room_no', tasks: 'due_date ASC', changes: 'created_at DESC' }[table] || 'id DESC';
  const rows = db.prepare(`SELECT * FROM ${table}${w} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...args, Math.min(num(query.limit) || 500, 2000), Math.max(num(query.offset), 0));
  const total = db.prepare(`SELECT COUNT(*) n FROM ${table}${w}`).get(...args).n;
  return ok(res, { rows, total });
}
function getRecord(res, user, table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!row) return fail(res, 404, '记录不存在');
  const cfg = TABLES[table];
  if (cfg.defaultOwner && user.role === 'sales' && row.owner_id && row.owner_id !== user.id) return fail(res, 403, '无权访问');
  return ok(res, row);
}
function createRecord(res, user, table, data) {
  const cfg = TABLES[table];
  if (cfg.master && !canMaster(user)) return fail(res, 403, '仅管理员/销售经理可维护基础资料');
  if (cfg.readOnly) return fail(res, 403, '请通过合同变更流程创建');
  for (const f of cfg.required || []) if (!data[f] && data[f] !== 0) return fail(res, 400, `${f} 不能为空`);
  if (cfg.defaultOwner && !data.owner_id) data.owner_id = user.id;
  if (data.owner_id && user.role === 'sales' && Number(data.owner_id) !== user.id) return fail(res, 403, '无权指派他人');
  const fields = [...cfg.fields];
  const values = fields.map(f => {
    let v = data[f];
    if (cfg.numeric && cfg.numeric.includes(f)) v = num(v);
    if (v === '' || v === undefined) v = (cfg.numeric && cfg.numeric.includes(f)) ? 0 : null;
    return v;
  });
  const t = now();
  if (table === 'customers') { fields.push('created_at', 'updated_at'); values.push(t, t); }
  else if (table === 'templates') { fields.push('updated_at'); values.push(t); }
  else { fields.push('created_at'); values.push(t); }
  const r = db.prepare(`INSERT INTO ${table}(${fields.join(',')}) VALUES(${fields.map(() => '?').join(',')})`).run(...values);
  audit(user, 'create', table, `新建 ${data.name || data.title || '#' + r.lastInsertRowid}`);
  return ok(res, { id: Number(r.lastInsertRowid) });
}
function updateRecord(res, user, table, id, data) {
  const cfg = TABLES[table];
  if (cfg.master && !canMaster(user)) return fail(res, 403, '仅管理员/销售经理可维护基础资料');
  if (cfg.readOnly) return fail(res, 403, '变更记录不可直接修改');
  const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!old) return fail(res, 404, '记录不存在');
  if (cfg.defaultOwner && user.role === 'sales' && old.owner_id && old.owner_id !== user.id) return fail(res, 403, '无权修改');
  const sets = [], args = [];
  for (const f of cfg.fields) {
    if (!(f in data)) continue;
    let v = data[f];
    if (cfg.numeric && cfg.numeric.includes(f)) v = num(v);
    if (v === '') v = (cfg.numeric && cfg.numeric.includes(f)) ? 0 : null;
    sets.push(`${f}=?`); args.push(v);
  }
  if (table === 'customers' || table === 'templates') { sets.push('updated_at=?'); args.push(now()); }
  if (!sets.length) return ok(res, { changes: 0 });
  args.push(id);
  const r = db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE id=?`).run(...args);
  audit(user, 'update', table, `更新 ${old.name || old.title || '#' + id}`);
  return ok(res, { changes: r.changes });
}
function deleteRecord(res, user, table, id) {
  const cfg = TABLES[table];
  if (cfg.readOnly || (cfg.master && !canMaster(user))) return fail(res, 403, '无权删除该记录');
  const old = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  if (!old) return fail(res, 404, '记录不存在');
  if (cfg.defaultOwner && user.role === 'sales' && old.owner_id && old.owner_id !== user.id) return fail(res, 403, '无权删除');
  db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  audit(user, 'delete', table, `删除 #${id}`);
  return ok(res, { changes: 1 });
}

/* ---------------- 合同列表 / 详情 ---------------- */
const CONTRACT_SELECT = `SELECT c.*, cu.name customer_name, p.name project_name,
  u.building, u.room_no, u.area, (SELECT COALESCE(SUM(amount),0) FROM payments pay WHERE pay.contract_id=c.id) plan_total,
  (SELECT COALESCE(SUM(paid_amount),0) FROM payments pay WHERE pay.contract_id=c.id) paid_total
  FROM contracts c
  LEFT JOIN customers cu ON cu.id=c.customer_id
  LEFT JOIN projects p ON p.id=c.project_id
  LEFT JOIN units u ON u.id=c.unit_id`;

function listContracts(res, user, query) {
  const where = [];
  const args = [];
  const sc = scopeClause(user, 'c');
  if (sc.sql) { where.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args); }
  if (query.q) {
    where.push(`(c.contract_no LIKE ? OR cu.name LIKE ? OR cu.phone LIKE ? OR p.name LIKE ? OR u.room_no LIKE ?)`);
    const like = `%${query.q}%`;
    for (let i = 0; i < 5; i++) args.push(like);
  }
  for (const f of ['status', 'type', 'project_id', 'customer_id', 'owner_id', 'payment_method']) {
    if (query[f]) { where.push(`c.${f}=?`); args.push(query[f]); }
  }
  if (query.risk === 'discount') where.push('c.discount < 90 AND c.status IN ("draft","pending")');
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`${CONTRACT_SELECT}${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(num(query.limit) || 500, 2000), Math.max(num(query.offset), 0));
  /* 附加当前审批节点，避免前端写死「销售经理」 */
  const doneMap = {};
  for (const a of db.prepare('SELECT contract_id, step FROM approvals').all()) {
    (doneMap[a.contract_id] ||= new Set()).add(a.step);
  }
  const decorated = rows.map(r => {
    const flow = JSON.parse(r.flow || '[]');
    const done = doneMap[r.id] || new Set();
    const next = flow.find(s => !done.has(s));
    return { ...r, next_step: next || null, next_step_label: next ? (APPROVAL_STEPS.find(s => s.key === next)?.label || next) : null };
  });
  const total = db.prepare(`SELECT COUNT(*) n FROM contracts c LEFT JOIN customers cu ON cu.id=c.customer_id LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN units u ON u.id=c.unit_id${w}`).get(...args).n;
  return ok(res, { rows: decorated, total });
}
function getContract(res, user, id) {
  const row = db.prepare(`${CONTRACT_SELECT} WHERE c.id=?`).get(id);
  if (!row) return fail(res, 404, '合同不存在');
  if (user.role === 'sales' && row.owner_id !== user.id) return fail(res, 403, '无权访问该合同');
  const approvals = db.prepare('SELECT a.*, u.display_name approver_name FROM approvals a LEFT JOIN users u ON u.id=a.approver_id WHERE a.contract_id=? ORDER BY a.id').all(id);
  const payments = db.prepare('SELECT * FROM payments WHERE contract_id=? ORDER BY term_no').all(id);
  const receipts = db.prepare('SELECT r.* FROM receipts r JOIN payments p ON p.id=r.payment_id WHERE p.contract_id=? ORDER BY r.id DESC').all(id);
  const changes = db.prepare('SELECT ch.*, u.display_name operator_name FROM changes ch LEFT JOIN users u ON u.id=ch.operator_id WHERE ch.contract_id=? ORDER BY ch.id DESC').all(id);
  const logs = db.prepare("SELECT * FROM audit_logs WHERE target='contracts' AND detail LIKE ? ORDER BY id DESC LIMIT 30").all('%#' + id + '%');
  return ok(res, { ...row, approvals, payments, receipts, changes, logs });
}
function checkContractAccess(user, row) {
  return !(user.role === 'sales' && row.owner_id !== user.id);
}

/* ---------------- 统计 ---------------- */
/* 当前用户真正可处理的待审批数：按合同的下一节点角色判断，管理员可处理任意节点 */
function myPendingCount(user) {
  if (user.role === 'sales') return 0;
  const rows = db.prepare("SELECT id, flow FROM contracts WHERE status='pending'").all();
  const doneMap = {};
  for (const a of db.prepare('SELECT contract_id, step FROM approvals').all()) {
    (doneMap[a.contract_id] ||= new Set()).add(a.step);
  }
  let n = 0;
  for (const row of rows) {
    const flow = JSON.parse(row.flow || '[]');
    const done = doneMap[row.id] || new Set();
    const next = flow.find(s => !done.has(s));
    if (next && (user.role === 'admin' || APPROVAL_STEPS.find(s => s.key === next)?.role === user.role)) n++;
  }
  return n;
}
function statsOverview(user) {
  const sc = scopeClause(user, 'c');
  const w = sc.sql ? ' WHERE 1=1' + sc.sql : '';
  const args = sc.args;
  const contracts = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) amt,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN status='filed' THEN 1 ELSE 0 END) filed,
    SUM(CASE WHEN status='effective' THEN 1 ELSE 0 END) effective
    FROM contracts c${w}`).get(...args);
  /* 签约金额只统计已通过审批/已生效/已备案的合同，剔除草稿、驳回、已解除 */
  const signedWhere = w ? `${w} AND c.status IN ('approved','effective','filed')` : " WHERE c.status IN ('approved','effective','filed')";
  const signed = db.prepare(`SELECT COALESCE(SUM(amount),0) amt FROM contracts c${signedWhere}`).get(...args).amt;
  const received = db.prepare(`SELECT COALESCE(SUM(r.amount),0) amt FROM receipts r JOIN contracts c ON c.id=(SELECT contract_id FROM payments WHERE id=r.payment_id)${w}`).get(...args).amt;
  const plan = db.prepare(`SELECT COALESCE(SUM(p.amount),0) amt FROM payments p JOIN contracts c ON c.id=p.contract_id${w}`).get(...args).amt;
  const monthWhere = sc.sql ? `${w} AND r.created_at >= date('now','start of month')` : " WHERE r.created_at >= date('now','start of month')";
  const monthReceived = db.prepare(`SELECT COALESCE(SUM(r.amount),0) amt FROM receipts r
    JOIN payments p ON p.id=r.payment_id JOIN contracts c ON c.id=p.contract_id${monthWhere}`).get(...args).amt;
  const monthCount = db.prepare(`SELECT COUNT(*) n FROM receipts r
    JOIN payments p ON p.id=r.payment_id JOIN contracts c ON c.id=p.contract_id${monthWhere}`).get(...args).n;
  const units = db.prepare(`SELECT
    SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) available,
    SUM(CASE WHEN status='filed' THEN 1 ELSE 0 END) filed,
    COUNT(*) total FROM units`).get();
  const alerts = buildAlerts(user);
  return {
    contractCount: contracts.n, contractAmount: Math.round(contracts.amt),
    signedAmount: Math.round(signed),
    pending: contracts.pending || 0, myPending: myPendingCount(user),
    filed: contracts.filed || 0, effective: contracts.effective || 0,
    received: Math.round(received), plan: Math.round(plan),
    monthReceived: Math.round(monthReceived), monthReceiptCount: monthCount,
    collectionRate: plan ? Math.round(received / plan * 100) : 0,
    unitsAvailable: units.available || 0, unitsFiled: units.filed || 0, unitsTotal: units.total,
    alerts: alerts.length, highAlerts: alerts.filter(a => a.level === 'high').length,
  };
}
function statsStages(user) {
  const sc = scopeClause(user, 'c');
  const where = sc.sql ? ' WHERE 1=1' + sc.sql : '';
  const rows = db.prepare(`SELECT c.status stage, COUNT(*) cnt, COALESCE(SUM(c.amount),0) amt FROM contracts c${where} GROUP BY c.status`).all(...sc.args);
  const map = Object.fromEntries(rows.map(r => [r.stage, r]));
  return Object.entries(CONTRACT_STATUS).map(([k, v]) => ({
    stage: k, label: v.label, count: map[k] ? map[k].cnt : 0, amount: map[k] ? map[k].amt : 0,
  }));
}
function statsTrend(user) {
  const sc = scopeClause(user, 'c');
  const where = sc.sql || '';
  return db.prepare(`SELECT substr(c.sign_date,1,7) ym, COUNT(*) cnt, COALESCE(SUM(c.amount),0) amt
    FROM contracts c WHERE c.sign_date IS NOT NULL${where}
    GROUP BY ym ORDER BY ym DESC LIMIT 6`).all(...sc.args).reverse();
}
function statsProjects(user) {
  const sc = scopeClause(user, 'c');
  return db.prepare(`SELECT p.id, p.name, p.city, p.status,
    (SELECT COUNT(*) FROM units u WHERE u.project_id=p.id) unit_total,
    (SELECT COUNT(*) FROM units u WHERE u.project_id=p.id AND u.status='available') unit_available,
    COUNT(c.id) contracts, COALESCE(SUM(c.amount),0) amount,
    COALESCE(SUM(c.paid_total),0) paid
    FROM projects p LEFT JOIN (
      SELECT c.*, (SELECT COALESCE(SUM(pay.paid_amount),0) FROM payments pay WHERE pay.contract_id=c.id) paid_total
      FROM contracts c WHERE 1=1${sc.sql}
    ) c ON c.project_id=p.id
    GROUP BY p.id ORDER BY amount DESC`).all(...sc.args);
}
function statsSales(user) {
  if (user.role === 'sales') return [];
  return db.prepare(`SELECT u.id, u.display_name, u.role, COUNT(c.id) cnt,
    COALESCE(SUM(c.amount),0) amount, COALESCE(SUM(c.paid_total),0) received
    FROM users u LEFT JOIN (
      SELECT c.*, (SELECT COALESCE(SUM(pay.paid_amount),0) FROM payments pay WHERE pay.contract_id=c.id) paid_total
      FROM contracts c
    ) c ON c.owner_id=u.id
    WHERE u.active=1 GROUP BY u.id ORDER BY amount DESC`).all();
}
function buildAlerts(user) {
  const sc = scopeClause(user, 'c');
  const suffix = sc.sql || '';
  const plain = user.role === 'sales' ? ' AND owner_id=?' : '';
  const args = sc.args;
  const out = [];
  const overdue = db.prepare(`SELECT c.id, c.contract_no, p.name term, p.due_date, p.amount-p.paid_amount gap
    FROM payments p JOIN contracts c ON c.id=p.contract_id
    WHERE p.due_date < date('now') AND p.paid_amount < p.amount AND c.status NOT IN ('void','draft','rejected')${suffix}
    ORDER BY p.due_date LIMIT 50`).all(...args);
  overdue.forEach(x => out.push({ level: 'high', type: '回款逾期', title: `${x.contract_no} ${x.term} 逾期未收`, detail: `应收 ¥${Math.round(x.gap).toLocaleString('zh-CN')} · 到期 ${x.due_date}`, contract_id: x.id }));
  const filing = db.prepare(`SELECT id, contract_no, sign_date FROM contracts c
    WHERE status='effective' AND sign_date < date('now','-30 day') AND filed_no IS NULL${suffix}`).all(...args);
  filing.forEach(x => out.push({ level: 'high', type: '备案超期', title: `${x.contract_no} 生效超 30 天未备案`, detail: `签约日 ${x.sign_date}，请尽快提交网签备案`, contract_id: x.id }));
  const sign = db.prepare(`SELECT id, contract_no, due_sign_date FROM contracts c
    WHERE type='subscription' AND status='effective' AND due_sign_date < date('now')${suffix}`).all(...args);
  sign.forEach(x => out.push({ level: 'medium', type: '转签超期', title: `${x.contract_no} 认购后未按期转签`, detail: `约定签约日 ${x.due_sign_date}`, contract_id: x.id }));
  const pending = db.prepare(`SELECT id, contract_no, created_at FROM contracts c WHERE status='pending' AND created_at < date('now','-2 day')${suffix}`).all(...args);
  pending.forEach(x => out.push({ level: 'medium', type: '审批滞留', title: `${x.contract_no} 审批超过 2 天`, detail: '请审批人及时处理', contract_id: x.id }));
  const discount = db.prepare(`SELECT id, contract_no, discount FROM contracts c
    WHERE discount < 90 AND status IN ('draft','pending')${suffix}`).all(...args);
  discount.forEach(x => out.push({ level: 'medium', type: '价格风险', title: `${x.contract_no} 折扣 ${x.discount}% 低于授权线`, detail: '需总经理特批并留痕', contract_id: x.id }));
  for (const clause of RISK_CLAUSES) {
    const rows = db.prepare(`SELECT id, contract_no FROM contracts c WHERE note LIKE ? AND status NOT IN ('void','rejected')${suffix}`).all('%' + clause + '%', ...args);
    rows.forEach(x => out.push({ level: 'high', type: '条款风险', title: `${x.contract_no} 含高风险条款`, detail: `命中「${clause}」，建议法务复核`, contract_id: x.id }));
  }
  const soon = db.prepare(`SELECT p.id, c.contract_no, p.due_date FROM payments p JOIN contracts c ON c.id=p.contract_id
    WHERE p.due_date >= date('now') AND p.due_date <= date('now','+7 day') AND p.paid_amount < p.amount
    AND c.status NOT IN ('void','draft','rejected')${suffix}`).all(...args);
  soon.forEach(x => out.push({ level: 'low', type: '回款临期', title: `${x.contract_no} 回款 7 日内到期`, detail: `到期 ${x.due_date}`, contract_id: x.id }));
  return out.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.level] - ({ high: 0, medium: 1, low: 2 })[b.level]);
}

/* ---------------- CSV ---------------- */
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvOf(rows, headers) {
  return '\uFEFF' + headers.join(',') + '\n' + rows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n');
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;
  const query = Object.fromEntries(url.searchParams);

  if (pathname === '/api/login' && method === 'POST') {
    const { username, password } = await body(req);
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
    if (!user || !user.active || !verifyPassword(password || '', user.salt, user.password_hash)) {
      audit(null, 'login_fail', 'auth', username);
      return fail(res, 401, '用户名或密码错误');
    }
    res.setHeader('Set-Cookie', `contract_token=${signToken(user.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
    audit(user, 'login', 'auth', '登录成功');
    return ok(res, { id: user.id, username: user.username, display_name: user.display_name, role: user.role });
  }

  const user = currentUser(req);
  if (!user) return fail(res, 401, '请先登录');
  if (pathname === '/api/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', 'contract_token=; Path=/; HttpOnly; Max-Age=0');
    return ok(res, {});
  }
  if (pathname === '/api/me') return ok(res, user);

  /* 用户管理 */
  if (pathname.startsWith('/api/users')) {
    if (user.role !== 'admin') return fail(res, 403, '仅管理员可管理用户');
    if (pathname === '/api/users' && method === 'GET') {
      return ok(res, db.prepare('SELECT id,username,display_name,role,active,created_at FROM users ORDER BY id').all());
    }
    if (pathname === '/api/users' && method === 'POST') {
      const d = await body(req);
      if (!d.username || !d.password) return fail(res, 400, '用户名和密码必填');
      if (db.prepare('SELECT id FROM users WHERE username=?').get(d.username)) return fail(res, 400, '用户名已存在');
      const role = APPROVAL_STEPS.concat([{ role: 'sales' }]).some(s => s.role === d.role) ? d.role : 'sales';
      const { salt, hash } = hashPassword(d.password);
      const r = db.prepare('INSERT INTO users(username,password_hash,salt,display_name,role,active,created_at) VALUES(?,?,?,?,?,1,?)')
        .run(d.username, hash, salt, d.display_name || d.username, role, now());
      audit(user, 'create', 'users', '新建用户 ' + d.username);
      return ok(res, { id: Number(r.lastInsertRowid) });
    }
    const um = pathname.match(/^\/api\/users\/(\d+)$/);
    if (um) {
      const id = Number(um[1]);
      if (method === 'PUT') {
        const d = await body(req);
        const sets = [], args = [];
        for (const f of ['display_name', 'role', 'active']) {
          if (f in d) { sets.push(`${f}=?`); args.push(f === 'active' ? (d[f] ? 1 : 0) : d[f]); }
        }
        if (d.password) {
          const { salt, hash } = hashPassword(d.password);
          sets.push('password_hash=?', 'salt=?'); args.push(hash, salt);
        }
        if (sets.length) { args.push(id); db.prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...args); }
        audit(user, 'update', 'users', '更新用户 #' + id);
        return ok(res, {});
      }
      if (method === 'DELETE') {
        if (id === user.id) return fail(res, 400, '不能删除自己');
        db.prepare('DELETE FROM users WHERE id=?').run(id);
        audit(user, 'delete', 'users', '删除用户 #' + id);
        return ok(res, {});
      }
    }
  }

  /* 统计 */
  if (pathname === '/api/stats/overview') return ok(res, statsOverview(user));
  if (pathname === '/api/stats/stages') return ok(res, statsStages(user));
  if (pathname === '/api/stats/trend') return ok(res, statsTrend(user));
  if (pathname === '/api/stats/projects') return ok(res, statsProjects(user));
  if (pathname === '/api/stats/sales') return ok(res, statsSales(user));
  if (pathname === '/api/stats/alerts') return ok(res, buildAlerts(user));

  /* 审计日志 */
  if (pathname === '/api/audit' && isManager(user)) {
    return ok(res, db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all());
  }

  /* ---------- 合同 ---------- */
  if (pathname === '/api/contracts') {
    if (method === 'GET') return listContracts(res, user, query);
    if (method === 'POST') {
      const d = await body(req);
      if (!d.customer_id || !d.project_id) return fail(res, 400, '购房客户与项目必填');
      if (!d.amount && d.amount !== 0) return fail(res, 400, '合同金额必填');
      const next = db.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM contracts').get().n;
      const contractNo = `HT-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`;
      const ownerId = d.owner_id && isManager(user) ? d.owner_id : user.id;
      const amount = num(d.amount);
      const t = now();
      const r = db.prepare(`INSERT INTO contracts(contract_no,customer_id,project_id,unit_id,type,price,discount,amount,
        payment_method,sign_date,due_sign_date,status,flow,owner_id,note,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?)`).run(
        contractNo, num(d.customer_id), num(d.project_id), num(d.unit_id) || null,
        CONTRACT_TYPES[d.type] ? d.type : 'sale', num(d.price) || amount, num(d.discount) || 100, amount,
        d.payment_method || 'installment', d.sign_date || null, d.due_sign_date || null,
        JSON.stringify(flowFor(amount)), ownerId, d.note || '', t, t);
      const id = Number(r.lastInsertRowid);
      for (const p of planFor(d.payment_method || 'installment', amount, d.sign_date)) {
        db.prepare('INSERT INTO payments(contract_id,term_no,name,amount,due_date,paid_amount,created_at) VALUES(?,?,?,?,?,0,?)')
          .run(id, p.term_no, p.name, p.amount, p.due_date, t);
      }
      if (d.unit_id) db.prepare("UPDATE units SET status='locked' WHERE id=? AND status='available'").run(num(d.unit_id));
      audit(user, 'create', 'contracts', `新建 ${contractNo}`);
      return ok(res, { id, contract_no: contractNo });
    }
  }
  const cm = pathname.match(/^\/api\/contracts\/(\d+)(?:\/(\w+))?$/);
  if (cm) {
    const id = Number(cm[1]);
    const action = cm[2];
    const row = db.prepare('SELECT * FROM contracts WHERE id=?').get(id);
    if (!row) return fail(res, 404, '合同不存在');
    if (!checkContractAccess(user, row)) return fail(res, 403, '无权操作该合同');

    if (!action && method === 'GET') return getContract(res, user, id);
    if (!action && method === 'PUT') {
      if (['filed', 'void'].includes(row.status) && !isManager(user)) return fail(res, 400, '已备案/已解除合同不可修改');
      const d = await body(req);
      const fields = ['customer_id', 'project_id', 'unit_id', 'type', 'price', 'discount', 'amount', 'payment_method', 'sign_date', 'due_sign_date', 'note'];
      const sets = [], args = [];
      for (const f of fields) if (f in d) { sets.push(`${f}=?`); args.push(['customer_id', 'project_id', 'unit_id', 'price', 'discount', 'amount'].includes(f) ? num(d[f]) : d[f]); }
      if (isManager(user) && 'owner_id' in d) { sets.push('owner_id=?'); args.push(num(d.owner_id)); }
      if (!sets.length) return ok(res, { changes: 0 });
      sets.push('updated_at=?'); args.push(now(), id);
      db.prepare(`UPDATE contracts SET ${sets.join(',')} WHERE id=?`).run(...args);
      audit(user, 'update', 'contracts', `更新 ${row.contract_no}`);
      return ok(res, { changes: 1 });
    }
    if (!action && method === 'DELETE') {
      if (!['draft', 'rejected'].includes(row.status)) return fail(res, 400, '仅草稿或已驳回的合同可删除');
      db.prepare('DELETE FROM contracts WHERE id=?').run(id);
      if (row.unit_id) db.prepare("UPDATE units SET status='available' WHERE id=?").run(row.unit_id);
      audit(user, 'delete', 'contracts', `删除 ${row.contract_no}`);
      return ok(res, { changes: 1 });
    }

    if (action === 'submit' && method === 'POST') {
      if (!['draft', 'rejected'].includes(row.status)) return fail(res, 400, '当前状态不可提交审批');
      const flow = flowFor(row.amount);
      db.prepare("DELETE FROM approvals WHERE contract_id=?").run(id);
      db.prepare("UPDATE contracts SET status='pending',flow=?,due_sign_date=COALESCE(due_sign_date,?),updated_at=? WHERE id=?")
        .run(JSON.stringify(flow), iso(35), now(), id);
      if (row.unit_id) db.prepare("UPDATE units SET status='subscribed' WHERE id=?").run(row.unit_id);
      audit(user, 'submit', 'contracts', `${row.contract_no} 提交审批`);
      return ok(res, { flow });
    }
    if (action === 'approve' && method === 'POST') {
      if (row.status !== 'pending') return fail(res, 400, '合同不在审批中');
      const d = await body(req);
      const flow = JSON.parse(row.flow || '[]');
      const done = db.prepare('SELECT step FROM approvals WHERE contract_id=?').all(id).map(a => a.step);
      const stepKey = flow.find(s => !done.includes(s));
      if (!stepKey) return fail(res, 400, '审批流程已结束');
      const meta = APPROVAL_STEPS.find(s => s.key === stepKey);
      if (user.role !== 'admin' && user.role !== meta.role) return fail(res, 403, `当前节点需「${meta.label}」处理`);
      const act = d.action === 'reject' ? 'reject' : 'approve';
      db.prepare('INSERT INTO approvals(contract_id,step,step_label,approver_id,action,comment,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, stepKey, meta.label, user.id, act, d.comment || (act === 'approve' ? '同意' : ''), now());
      let status = 'pending';
      if (act === 'reject') status = 'rejected';
      else if (flow.every(s => [...done, stepKey].includes(s))) status = 'approved';
      db.prepare('UPDATE contracts SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
      if (row.unit_id && status === 'rejected') db.prepare("UPDATE units SET status='available' WHERE id=?").run(row.unit_id);
      if (row.unit_id && status === 'approved') db.prepare("UPDATE units SET status='contracted' WHERE id=?").run(row.unit_id);
      audit(user, act === 'reject' ? 'reject' : 'approve', 'contracts', `${row.contract_no} ${meta.label}${act === 'reject' ? '驳回' : '通过'}`);
      return ok(res, { status });
    }
    if (action === 'activate' && method === 'POST') {
      if (row.status !== 'approved') return fail(res, 400, '仅审批通过的合同可生效');
      const d = await body(req);
      db.prepare("UPDATE contracts SET status='effective',sign_date=COALESCE(sign_date,?),updated_at=? WHERE id=?").run(d.sign_date || iso(0), now(), id);
      if (row.unit_id) db.prepare("UPDATE units SET status='contracted' WHERE id=?").run(row.unit_id);
      audit(user, 'activate', 'contracts', `${row.contract_no} 双方签章生效`);
      return ok(res, { status: 'effective' });
    }
    if (action === 'file' && method === 'POST') {
      if (!['effective', 'approved'].includes(row.status)) return fail(res, 400, '仅已生效合同可提交备案');
      const d = await body(req);
      const filedNo = String(d.filed_no || '').trim();
      if (!filedNo) return fail(res, 400, '请填写备案编号');
      db.prepare("UPDATE contracts SET status='filed',filed_no=?,filed_at=?,updated_at=? WHERE id=?").run(filedNo, d.filed_at || iso(0), now(), id);
      if (row.unit_id) db.prepare("UPDATE units SET status='filed' WHERE id=?").run(row.unit_id);
      audit(user, 'file', 'contracts', `${row.contract_no} 网签备案 ${filedNo}`);
      return ok(res, { status: 'filed' });
    }
    if (action === 'void' && method === 'POST') {
      if (['draft', 'void'].includes(row.status)) return fail(res, 400, '当前状态无需解除');
      if (!isManager(user) && user.role !== 'legal') return fail(res, 403, '无权解除合同');
      const d = await body(req);
      if (!d.reason) return fail(res, 400, '请填写解除原因');
      db.prepare("INSERT INTO changes(contract_id,type,from_value,to_value,reason,status,operator_id,approver_id,decided_at,created_at) VALUES(?,'cancel',?,'已解除',?,'done',?,?,?,?)")
        .run(id, row.contract_no, d.reason, user.id, user.id, now(), now());
      db.prepare("UPDATE contracts SET status='void',updated_at=? WHERE id=?").run(now(), id);
      if (row.unit_id) db.prepare("UPDATE units SET status='available' WHERE id=?").run(row.unit_id);
      audit(user, 'void', 'contracts', `${row.contract_no} 解除：${d.reason}`);
      return ok(res, { status: 'void' });
    }
    if (action === 'change' && method === 'POST') {
      const d = await body(req);
      if (!['rename', 'exchange', 'supplement', 'price'].includes(d.type)) return fail(res, 400, '不支持的变更类型');
      if (!d.to_value) return fail(res, 400, '请填写变更后内容');
      db.prepare('INSERT INTO changes(contract_id,type,from_value,to_value,reason,status,operator_id,created_at) VALUES(?,?,?,?,?,"pending",?,?)')
        .run(id, d.type, d.from_value || '', d.to_value, d.reason || '', user.id, now());
      audit(user, 'change_request', 'contracts', `${row.contract_no} 申请${d.type}变更`);
      return ok(res, {});
    }
    if (action === 'payments' && method === 'POST') {
      const d = await body(req);
      if (!d.name || !d.amount) return fail(res, 400, '期次名称与金额必填');
      const no = db.prepare('SELECT COALESCE(MAX(term_no),0)+1 n FROM payments WHERE contract_id=?').get(id).n;
      db.prepare('INSERT INTO payments(contract_id,term_no,name,amount,due_date,paid_amount,created_at) VALUES(?,?,?,?,?,0,?)')
        .run(id, no, d.name, num(d.amount), d.due_date || null, now());
      audit(user, 'create', 'payments', `${row.contract_no} 新增回款期次 ${d.name}`);
      return ok(res, {});
    }
    if (action === 'regenerate' && method === 'POST') {
      if (user.role === 'sales') return fail(res, 403, '无权重置回款计划');
      const paid = db.prepare('SELECT COALESCE(SUM(paid_amount),0) n FROM payments WHERE contract_id=?').get(id).n;
      if (paid > 0) return fail(res, 400, '已有实际回款，不能重置计划');
      db.prepare('DELETE FROM payments WHERE contract_id=?').run(id);
      for (const p of planFor(row.payment_method, row.amount, row.sign_date || iso(0))) {
        db.prepare('INSERT INTO payments(contract_id,term_no,name,amount,due_date,paid_amount,created_at) VALUES(?,?,?,?,?,0,?)')
          .run(id, p.term_no, p.name, p.amount, p.due_date, now());
      }
      audit(user, 'update', 'payments', `${row.contract_no} 重置回款计划`);
      return ok(res, {});
    }
  }

  /* 变更审核 */
  const chm = pathname.match(/^\/api\/changes\/(\d+)\/review$/);
  if (chm && method === 'POST') {
    if (!canReview(user)) return fail(res, 403, '仅管理员/销售经理/法务可审核变更');
    const id = Number(chm[1]);
    const ch = db.prepare('SELECT * FROM changes WHERE id=?').get(id);
    if (!ch) return fail(res, 404, '变更记录不存在');
    if (ch.status !== 'pending') return fail(res, 400, '该变更已处理');
    const d = await body(req);
    if (d.action === 'reject') {
      db.prepare("UPDATE changes SET status='rejected',approver_id=?,decided_at=? WHERE id=?").run(user.id, now(), id);
      audit(user, 'reject', 'changes', `驳回变更 #${id}`);
      return ok(res, { status: 'rejected' });
    }
    const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(ch.contract_id);
    if (ch.type === 'rename') {
      db.prepare('UPDATE customers SET name=?,updated_at=? WHERE id=?').run(ch.to_value, now(), contract.customer_id);
    } else if (ch.type === 'exchange') {
      const newUnitId = num(d.unit_id || ch.to_value);
      const newUnit = db.prepare('SELECT * FROM units WHERE id=?').get(newUnitId);
      if (!newUnit) return fail(res, 400, '目标房源不存在');
      if (contract.unit_id) db.prepare("UPDATE units SET status='available' WHERE id=?").run(contract.unit_id);
      db.prepare('UPDATE contracts SET unit_id=?,updated_at=? WHERE id=?').run(newUnitId, now(), contract.id);
      const us = contract.status === 'filed' ? 'filed' : 'contracted';
      db.prepare('UPDATE units SET status=? WHERE id=?').run(us, newUnitId);
      db.prepare('UPDATE changes SET to_value=? WHERE id=?').run(`${newUnit.building} ${newUnit.room_no}`, id);
    } else if (ch.type === 'price') {
      db.prepare('UPDATE contracts SET amount=?,updated_at=? WHERE id=?').run(num(ch.to_value), now(), contract.id);
    } else if (ch.type === 'cancel') {
      db.prepare("UPDATE contracts SET status='void',updated_at=? WHERE id=?").run(now(), contract.id);
      if (contract.unit_id) db.prepare("UPDATE units SET status='available' WHERE id=?").run(contract.unit_id);
    }
    db.prepare("UPDATE changes SET status='done',approver_id=?,decided_at=? WHERE id=?").run(user.id, now(), id);
    audit(user, 'approve', 'changes', `执行${ch.type}变更 #${id}`);
    return ok(res, { status: 'done' });
  }

  /* 回款 */
  if (pathname === '/api/payments') {
    if (method === 'GET') {
      const where = [];
      const args = [];
      if (query.contract_id) { where.push('p.contract_id=?'); args.push(query.contract_id); }
      const sc = scopeClause(user, 'c');
      if (sc.sql) { where.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args); }
      const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
      let rows = db.prepare(`SELECT p.*, c.contract_no, cu.name customer_name, pr.name project_name,
        (SELECT COALESCE(SUM(r.amount),0) FROM receipts r WHERE r.payment_id=p.id) received
        FROM payments p JOIN contracts c ON c.id=p.contract_id
        LEFT JOIN customers cu ON cu.id=c.customer_id LEFT JOIN projects pr ON pr.id=c.project_id${w}
        ORDER BY p.due_date ASC LIMIT 1000`).all(...args);
      rows = rows.map(r => ({ ...r, status: r.paid_amount >= r.amount ? 'paid' : r.paid_amount > 0 ? 'partial' : r.due_date && r.due_date < iso(0) ? 'overdue' : 'pending' }));
      if (query.status) rows = rows.filter(r => r.status === query.status);
      if (query.project_id) rows = rows.filter(r => r.project_id === Number(query.project_id));
      return ok(res, { rows, total: rows.length });
    }
  }
  const pm = pathname.match(/^\/api\/payments\/(\d+)(?:\/(\w+))?$/);
  if (pm) {
    const id = Number(pm[1]);
    const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
    if (!p) return fail(res, 404, '回款期次不存在');
    const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(p.contract_id);
    if (!checkContractAccess(user, contract)) return fail(res, 403, '无权操作');
    if (pm[2] === 'receive' && method === 'POST') {
      if (!canFinance(user)) return fail(res, 403, '仅财务/经理/管理员可登记回款');
      const d = await body(req);
      const amt = num(d.amount);
      if (amt <= 0) return fail(res, 400, '回款金额必须大于 0');
      const rest = num(p.amount) - num(p.paid_amount);
      if (amt > rest + 0.01) return fail(res, 400, `超出应收余额 ¥${Math.round(rest)}`);
      const newPaid = num(p.paid_amount) + amt;
      db.prepare('UPDATE payments SET paid_amount=?,received_at=? WHERE id=?').run(newPaid, iso(0), id);
      db.prepare('INSERT INTO receipts(payment_id,amount,method,voucher_no,operator_id,note,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, amt, d.method || 'transfer', d.voucher_no || '', user.id, d.note || '', now());
      audit(user, 'receive', 'payments', `${contract.contract_no} 收款 ¥${Math.round(amt)}`);
      return ok(res, { paid_amount: newPaid });
    }
    if (!pm[2] && method === 'PUT') {
      if (p.paid_amount > 0) return fail(res, 400, '已有回款，不能修改应收金额');
      const d = await body(req);
      const sets = [], args = [];
      for (const f of ['name', 'amount', 'due_date']) if (f in d) { sets.push(`${f}=?`); args.push(f === 'amount' ? num(d.amount) : d[f]); }
      if (!sets.length) return ok(res, {});
      args.push(id);
      db.prepare(`UPDATE payments SET ${sets.join(',')} WHERE id=?`).run(...args);
      audit(user, 'update', 'payments', `调整 ${contract.contract_no} 回款计划 #${id}`);
      return ok(res, {});
    }
    if (!pm[2] && method === 'DELETE') {
      if (p.paid_amount > 0) return fail(res, 400, '已有回款，不能删除期次');
      db.prepare('DELETE FROM payments WHERE id=?').run(id);
      audit(user, 'delete', 'payments', `删除回款期次 #${id}`);
      return ok(res, {});
    }
  }
  if (pathname === '/api/receipts' && method === 'GET') {
    const where = [];
    const args = [];
    if (query.contract_id) { where.push('p.contract_id=?'); args.push(query.contract_id); }
    const sc = scopeClause(user, 'c');
    if (sc.sql) { where.push(sc.sql.replace(/^ AND /, '')); args.push(...sc.args); }
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    return ok(res, db.prepare(`SELECT r.*, p.name term, c.contract_no FROM receipts r
      JOIN payments p ON p.id=r.payment_id JOIN contracts c ON c.id=p.contract_id${w}
      ORDER BY r.id DESC LIMIT 500`).all(...args));
  }

  /* 导出 CSV */
  const exp = pathname.match(/^\/api\/export\/(\w+)$/);
  if (exp && method === 'GET') {
    const table = exp[1];
    const map = {
      contracts: ['contract_no', 'customer_name', 'project_name', 'room_no', 'type', 'amount', 'discount', 'payment_method', 'status', 'filed_no', 'sign_date', 'owner_id'],
      customers: ['name', 'phone', 'id_no', 'channel', 'level', 'address', 'note'],
      payments: ['contract_no', 'customer_name', 'term_no', 'name', 'amount', 'due_date', 'paid_amount'],
      units: ['project_id', 'building', 'room_no', 'area', 'list_price', 'status'],
    };
    if (!map[table]) return fail(res, 404, '不支持导出该表');
    const rows = table === 'contracts'
      ? db.prepare(`${CONTRACT_SELECT} ORDER BY c.id DESC`).all()
      : table === 'payments'
        ? db.prepare('SELECT p.*, c.contract_no, cu.name customer_name FROM payments p JOIN contracts c ON c.id=p.contract_id LEFT JOIN customers cu ON cu.id=c.customer_id ORDER BY p.id DESC').all()
        : db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
    const headers = map[table];
    const labeled = headers.map(h => ({ table, field: h }));
    const labelMap = { contract_no: '合同编号', customer_name: '购房人', project_name: '项目', room_no: '房号', type: '合同类型', amount: '合同金额', discount: '折扣(%)', payment_method: '付款方式', status: '状态', filed_no: '备案编号', sign_date: '签约日期', owner_id: '负责人ID', name: '名称/期次', phone: '电话', id_no: '身份证号', channel: '来源', level: '级别', address: '地址', note: '备注', term_no: '期次', due_date: '到期日', paid_amount: '已收金额', project_id: '项目ID', building: '楼栋', area: '面积', list_price: '面价' };
    const outHeaders = headers.map(h => labelMap[h] || h);
    res.setHeader('Content-Disposition', `attachment; filename="zhenghe-contracts-${table}-${iso(0)}.csv"`);
    return send(res, 200, '\uFEFF' + outHeaders.join(',') + '\n' + rows.map(r => headers.map(h => csvEscape(r[h])).join(',')).join('\n'), 'text/csv; charset=utf-8');
  }

  /* 数据库管理（仅管理员） */
  if (pathname.startsWith('/api/db/')) {
    if (user.role !== 'admin') return fail(res, 403, '仅管理员可访问数据库管理');
    if (pathname === '/api/db/tables' && method === 'GET') {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
      return ok(res, tables.map(t => ({ name: t.name, rows: db.prepare(`SELECT COUNT(*) n FROM "${t.name}"`).get().n })));
    }
    const tm = pathname.match(/^\/api\/db\/table\/(\w+)$/);
    if (tm && method === 'GET') {
      const table = tm[1];
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return fail(res, 404, '表不存在');
      const rows = db.prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`).all(Math.min(num(query.limit) || 100, 1000), Math.max(num(query.offset), 0)).map(r => {
        const o = { ...r };
        if (table === 'users') { delete o.password_hash; delete o.salt; }
        return o;
      });
      const columns = rows.length ? Object.keys(rows[0]) : db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
      return ok(res, { columns, rows, total: db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n });
    }
    if (pathname === '/api/db/query' && method === 'POST') {
      const d = await body(req);
      const sql = String(d.sql || '').trim().replace(/;+\s*$/, '');
      if (!/^(select|with)\b/i.test(sql) && !/^pragma\s+table_info\b/i.test(sql)) return fail(res, 400, '仅支持只读查询');
      if (/\b(insert|update|delete|drop|alter|create|attach|detach|replace|vacuum|reindex|writable_schema)\b/i.test(sql)) return fail(res, 400, '检测到写操作，已拒绝');
      try {
        const t0 = Date.now();
        const rows = db.prepare(sql).all().slice(0, 1000);
        audit(user, 'sql_query', 'db', sql.slice(0, 200));
        return ok(res, { columns: rows.length ? Object.keys(rows[0]) : [], rows, elapsed: Date.now() - t0, truncated: rows.length >= 1000 });
      } catch (e) { return fail(res, 400, 'SQL 执行失败: ' + e.message); }
    }
    if (pathname === '/api/db/export' && method === 'GET') {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const buf = fs.readFileSync(DB_PATH);
      audit(user, 'export_db', 'db', '导出整库');
      res.setHeader('Content-Disposition', `attachment; filename="zhenghe-contracts-${iso(0)}.db"`);
      return send(res, 200, buf, 'application/octet-stream');
    }
    if (pathname === '/api/db/backup' && method === 'POST') {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const dir = path.join(__dirname, 'data', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = `zhenghe-contracts-${now().replace(/[:T]/g, '-').slice(0, 19)}.db`;
      fs.copyFileSync(DB_PATH, path.join(dir, file));
      audit(user, 'backup', 'db', '备份 ' + file);
      return ok(res, { file, bytes: fs.statSync(path.join(dir, file)).size });
    }
  }

  /* 通用 CRUD 兜底 */
  const gm = pathname.match(/^\/api\/(\w+)(?:\/(\d+))?$/);
  if (gm && TABLES[gm[1]]) {
    const table = gm[1];
    const id = gm[2] ? Number(gm[2]) : null;
    if (method === 'GET') return id ? getRecord(res, user, table, id) : listRecords(res, user, table, query);
    if (method === 'POST' && !id) return createRecord(res, user, table, await body(req));
    if (method === 'PUT' && id) return updateRecord(res, user, table, id, await body(req));
    if (method === 'DELETE' && id) return deleteRecord(res, user, table, id);
  }
  return fail(res, 404, '接口不存在');
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, '不支持的方法');
    return serveStatic(res, url.pathname);
  } catch (e) {
    console.error('[ERROR]', e);
    if (!res.headersSent) return fail(res, 500, '服务器内部错误: ' + e.message);
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('\n  ╔═══════════════════════════════════════════╗');
    console.log('  ║        正合合同 · 房地产销售合同管理        ║');
    console.log('  ╚═══════════════════════════════════════════╝');
    console.log(`  ✦ 访问地址:  http://localhost:${PORT}`);
    console.log('  ✦ 默认账号:  admin / admin123');
    console.log('  ✦ 其他账号:  manager / manager123, sales / sales123');
    console.log('  ✦ 流程账号:  legal / legal123, finance / finance123');
    console.log('  ✦ 数据库:    ' + DB_PATH);
    console.log('  ✦ 按 Ctrl+C 停止\n');
  });
}
module.exports = { server };
