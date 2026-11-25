'use strict';
/**
 * 正合合同 · 房地产销售合同管理 —— 数据层
 * 基于 Node.js 22 内置 node:sqlite，零外部依赖。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.CONTRACT_DB || path.join(DATA_DIR, 'contracts.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(crypto.scryptSync(String(password), salt, 64).toString('hex')),
      Buffer.from(hash)
    );
  } catch { return false; }
}
function now() { return new Date().toISOString(); }
function iso(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

/* ---------------- Schema ---------------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales' CHECK(role IN ('admin','manager','sales','legal','finance')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  developer TEXT,
  total_units INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'on_sale' CHECK(status IN ('on_sale','pre_sale','delivered')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  building TEXT NOT NULL,
  room_no TEXT NOT NULL,
  floor INTEGER,
  area REAL NOT NULL DEFAULT 0,
  list_price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','locked','subscribed','contracted','filed','blocked')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  id_no TEXT,
  channel TEXT,
  level TEXT DEFAULT 'B' CHECK(level IN ('A','B','C')),
  address TEXT,
  note TEXT,
  owner_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  unit_id INTEGER,
  type TEXT NOT NULL DEFAULT 'sale' CHECK(type IN ('subscription','sale','supplement','parking','other')),
  price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 100,
  amount REAL NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'installment',
  sign_date TEXT,
  due_sign_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','effective','filed','rejected','void')),
  flow TEXT NOT NULL DEFAULT '',
  filed_no TEXT,
  filed_at TEXT,
  owner_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(customer_id) REFERENCES customers(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(unit_id) REFERENCES units(id),
  FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  step TEXT NOT NULL,
  step_label TEXT NOT NULL,
  approver_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('approve','reject')),
  comment TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  term_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  due_date TEXT,
  paid_amount REAL NOT NULL DEFAULT 0,
  received_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'transfer',
  voucher_no TEXT,
  operator_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('rename','exchange','cancel','supplement','price')),
  from_value TEXT,
  to_value TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','done')),
  operator_id INTEGER,
  approver_id INTEGER,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sale',
  version TEXT NOT NULL DEFAULT 'v1.0',
  content TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  contract_id INTEGER,
  owner_id INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_owner ON contracts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_payments_contract ON payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_approvals_contract ON approvals(contract_id);
CREATE INDEX IF NOT EXISTS idx_units_project ON units(project_id);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
`;

/* ---------------- 字典 ---------------- */
const CONTRACT_TYPES = {
  subscription: { label: '认购书', cls: 'cyan' },
  sale: { label: '商品房买卖合同', cls: 'blue' },
  supplement: { label: '补充协议', cls: 'purple' },
  parking: { label: '车位合同', cls: 'orange' },
  other: { label: '其他', cls: 'gray' },
};
const CONTRACT_STATUS = {
  draft: { label: '草稿', cls: 'gray' },
  pending: { label: '审批中', cls: 'orange' },
  approved: { label: '待生效', cls: 'cyan' },
  effective: { label: '已生效', cls: 'blue' },
  filed: { label: '已备案', cls: 'green' },
  rejected: { label: '已驳回', cls: 'red' },
  void: { label: '已解除', cls: 'red' },
};
const UNIT_STATUS = {
  available: { label: '可售', cls: 'green' },
  locked: { label: '已锁定', cls: 'orange' },
  subscribed: { label: '已认购', cls: 'cyan' },
  contracted: { label: '已签约', cls: 'blue' },
  filed: { label: '已备案', cls: 'purple' },
  blocked: { label: '不可售', cls: 'gray' },
};
const APPROVAL_STEPS = [
  { key: 'manager', label: '销售经理', role: 'manager' },
  { key: 'legal', label: '法务审核', role: 'legal' },
  { key: 'finance', label: '财务复核', role: 'finance' },
  { key: 'gm', label: '总经理审批', role: 'admin' },
];
const RISK_CLAUSES = ['无条件付款', '无限连带责任', '无条件退款', '放弃抗辩权', '不可撤销担保'];

/* 计算某合同需要的审批步骤 */
function flowFor(amount) {
  return Number(amount) >= 3000000
    ? APPROVAL_STEPS.map(s => s.key)
    : APPROVAL_STEPS.filter(s => s.key !== 'gm').map(s => s.key);
}

/* 根据付款方式生成回款计划 */
function planFor(method, amount, signDate) {
  const d = signDate || iso(0);
  const base = new Date(d + 'T00:00:00Z');
  const plus = n => new Date(base.getTime() + n * 86400000).toISOString().slice(0, 10);
  const a = Number(amount) || 0;
  if (method === 'lump') return [{ term_no: 1, name: '一次性付款', amount: a, due_date: plus(7) }];
  if (method === 'mortgage') return [
    { term_no: 1, name: '首付款（30%）', amount: Math.round(a * 0.3), due_date: plus(7) },
    { term_no: 2, name: '按揭放款（70%）', amount: a - Math.round(a * 0.3), due_date: plus(45) },
  ];
  return [
    { term_no: 1, name: '首期款（40%）', amount: Math.round(a * 0.4), due_date: plus(7) },
    { term_no: 2, name: '二期款（30%）', amount: Math.round(a * 0.3), due_date: plus(90) },
    { term_no: 3, name: '尾款（30%）', amount: a - Math.round(a * 0.4) - Math.round(a * 0.3), due_date: plus(180) },
  ];
}

/* ---------------- 演示数据 ---------------- */
function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) return;

  const mkUser = db.prepare('INSERT INTO users(username,password_hash,salt,display_name,role,active,created_at) VALUES(?,?,?,?,?,1,?)');
  const accounts = [
    ['admin', 'admin123', '系统管理员', 'admin'],
    ['manager', 'manager123', '销售经理', 'manager'],
    ['sales', 'sales123', '置业顾问小王', 'sales'],
    ['lily', 'lily123', '置业顾问小李', 'sales'],
    ['legal', 'legal123', '法务审核员', 'legal'],
    ['finance', 'finance123', '财务专员', 'finance'],
  ];
  for (const [u, p, name, role] of accounts) {
    const { salt, hash } = hashPassword(p);
    mkUser.run(u, hash, salt, name, role, now());
  }
  const uid = u => db.prepare('SELECT id FROM users WHERE username=?').get(u).id;
  const adminId = uid('admin'), managerId = uid('manager'), salesId = uid('sales');
  const lilyId = uid('lily'), legalId = uid('legal'), financeId = uid('finance');

  const mkProject = db.prepare('INSERT INTO projects(name,city,address,developer,total_units,status,created_at) VALUES(?,?,?,?,?,?,?)');
  const projects = [
    ['锦绣山河', '杭州', '杭州市西湖区文一西路 88 号', '正合置业有限公司', 360, 'on_sale'],
    ['云栖公馆', '上海', '上海市闵行区申长路 366 号', '正合置业有限公司', 240, 'on_sale'],
    ['学府壹号', '成都', '成都市高新区天府大道 999 号', '正合地产（成都）有限公司', 420, 'pre_sale'],
    ['滨海壹号', '深圳', '深圳市南山区滨海大道 2001 号', '正合地产（深圳）有限公司', 300, 'on_sale'],
  ];
  const pids = [];
  for (const p of projects) { const r = mkProject.run(...p, iso(-300)); pids.push(Number(r.lastInsertRowid)); }

  const mkUnit = db.prepare('INSERT INTO units(project_id,building,room_no,floor,area,list_price,status,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const units = [];
  const areas = [89, 108, 127, 143];
  for (let p = 0; p < pids.length; p++) {
    for (let i = 0; i < 6; i++) {
      const area = areas[i % areas.length];
      const price = Math.round((28000 + p * 9000 + i * 1200 + 5) * area / 100) * 100;
      const r = mkUnit.run(pids[p], `${i < 3 ? 1 : 2} 栋`, `${i < 3 ? 1 : 2} 单元 ${(i % 3) + 1}0${i + 1} 室`,
        (i % 3) + 2, area, price, 'available', iso(-250));
      units.push(Number(r.lastInsertRowid));
    }
  }

  const mkCustomer = db.prepare('INSERT INTO customers(name,phone,id_no,channel,level,address,note,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const customers = [
    ['张伟', '13800138001', '330106199001011234', '自然到访', 'A', '杭州市西湖区', '改善型需求，决策链清晰', salesId],
    ['李娜', '13800138002', '310101198803025678', '渠道推荐', 'A', '上海市闵行区', '全款客户，关注交付时间', managerId],
    ['王强', '13800138003', '510107198512034567', '老带新', 'B', '成都市高新区', '首套刚需', salesId],
    ['陈静', '13800138004', '440305199203044321', '线上留电', 'B', '深圳市南山区', '需要按揭方案', lilyId],
    ['刘洋', '13800138005', '330108197807056789', '自然到访', 'A', '杭州市滨江区', '企业主，关注学区', salesId],
    ['赵敏', '13800138006', '510108199005067890', '渠道推荐', 'B', '成都市武侯区', '二次置业', managerId],
    ['孙磊', '13800138007', '440306198611078765', '线上留电', 'C', '深圳市宝安区', '预算待确认', lilyId],
    ['周芳', '13800138008', '310112199409089876', '自然到访', 'B', '上海市徐汇区', '关注车位配比', salesId],
    ['吴昊', '13800138009', '510100198204039876', '老带新', 'A', '成都市锦江区', '一次性付款', lilyId],
    ['郑雯', '13800138010', '440300199307065432', '渠道推荐', 'B', '深圳市福田区', '需要尽快网签', salesId],
  ];
  const cids = [];
  for (const c of customers) { const r = mkCustomer.run(...c, iso(-60), iso(-3)); cids.push(Number(r.lastInsertRowid)); }

  const mkContract = db.prepare(`INSERT INTO contracts
    (contract_no,customer_id,project_id,unit_id,type,price,discount,amount,payment_method,sign_date,due_sign_date,status,flow,filed_no,filed_at,owner_id,note,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const mkApproval = db.prepare('INSERT INTO approvals(contract_id,step,step_label,approver_id,action,comment,created_at) VALUES(?,?,?,?,?,?,?)');
  const mkPayment = db.prepare('INSERT INTO payments(contract_id,term_no,name,amount,due_date,paid_amount,received_at,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const mkReceipt = db.prepare('INSERT INTO receipts(payment_id,amount,method,voucher_no,operator_id,note,created_at) VALUES(?,?,?,?,?,?,?)');

  const seeds = [
    // [序号, 客户索引, 项目索引, 房源索引, 类型, 折扣, 付款方式, 签约日, 状态, 备案号, 负责人, 备注]
    [1, 0, 0, 0, 'sale', 96, 'mortgage', iso(-70), 'filed', '备案-2026-HZ-10231', salesId, '已网签备案，按揭资料已提交'],
    [2, 1, 1, 6, 'subscription', 98, 'lump', iso(-18), 'effective', '', managerId, '认购书已签，约定 5 日内转正式合同'],
    [3, 2, 2, 12, 'sale', 88, 'mortgage', '', 'pending', '', salesId, '特批 88 折，需总经理审批；条款含「无条件付款」待法务确认'],
    [4, 3, 3, 18, 'sale', 95, 'installment', '', 'draft', '', lilyId, '分期方案待客户确认'],
    [5, 4, 0, 1, 'sale', 97, 'lump', iso(-48), 'effective', '', salesId, '生效 48 天未提交备案，需催办'],
    [6, 5, 2, 13, 'sale', 96, 'mortgage', '', 'pending', '', managerId, '法务审核中'],
    [7, 0, 0, 0, 'supplement', 100, 'lump', iso(-40), 'filed', '备案-2026-HZ-10231-B1', salesId, '面积补差补充协议'],
    [8, 6, 0, null, 'parking', 100, 'lump', iso(-12), 'effective', '', lilyId, '车位使用权转让'],
    [9, 7, 1, 7, 'sale', 97, 'lump', iso(-30), 'void', '', salesId, '客户申请退房，已解除备案并释放房源'],
    [10, 8, 2, 14, 'sale', 99, 'lump', iso(-25), 'filed', '备案-2026-CD-20887', lilyId, '全款已付清'],
    [11, 9, 3, 19, 'subscription', 98, 'mortgage', iso(-12), 'effective', '', salesId, '认购已超期，客户尚未转签'],
    [12, 1, 1, 8, 'sale', 96, 'mortgage', iso(-8), 'approved', '', managerId, '审批完成，待双方签章生效'],
    [13, 3, 3, 20, 'sale', 92, 'installment', '', 'rejected', '', lilyId, '折扣超限被驳回，需重新提交'],
    [14, 5, 2, 15, 'sale', 85, 'mortgage', '', 'pending', '', managerId, '特批 85 折，总经理审批中'],
  ];
  const contractIds = [];
  const stepMeta = Object.fromEntries(APPROVAL_STEPS.map(s => [s.key, s]));
  const approver = { manager: managerId, legal: legalId, finance: financeId, gm: adminId };

  for (const s of seeds) {
    const [no, ci, pi, ui, type, discount, method, signDate, status, filedNo, ownerId, note] = s;
    const unit = ui == null ? null : units[ui];
    const basePrice = unit ? db.prepare('SELECT list_price FROM units WHERE id=?').get(unit).list_price : 280000;
    const price = type === 'parking' ? 180000 : Math.round(basePrice);
    const amount = Math.round(price * discount / 100 / 100) * 100;
    const flow = flowFor(amount);
    const t = now();
    const r = mkContract.run(`HT-2026-${String(no).padStart(4, '0')}`, cids[ci], pids[pi], unit, type, price,
      discount, amount, method, signDate || null, signDate ? iso(0) : iso(35), status, JSON.stringify(flow),
      filedNo || null, filedNo ? iso(-5) : null, ownerId, note, iso(-45), t);
    const id = Number(r.lastInsertRowid);
    contractIds.push(id);

    const approvedCount = { filed: flow.length, effective: flow.length, approved: flow.length, void: flow.length, pending: status === 'pending' ? 1 : 0, rejected: 1, draft: 0 }[status] || 0;
    flow.forEach((step, i) => {
      const meta = stepMeta[step];
      let action = null;
      if (i < approvedCount) action = 'approve';
      else if (status === 'rejected' && i === 1) action = 'reject';
      if (!action) return;
      mkApproval.run(id, step, meta.label, approver[step], action,
        action === 'approve' ? '同意' : '折扣超出授权，请调整后重提', iso(-10 + i));
    });

    if (status !== 'draft') {
      const plan = planFor(method, amount, signDate || iso(-2));
      plan.forEach((p, i) => {
        let paid = 0;
        if (status === 'filed') paid = p.amount;
        else if (status === 'void') paid = i === 0 ? Math.round(p.amount * 0.5) : 0;
        else if (i === 0) paid = no % 3 === 0 ? 0 : Math.round(p.amount * (no % 2 ? 1 : 0.4));
        /* 回款日期分布到不同月份，避免「本月回款」与「累计回款」永远同额 */
        const receiptDate = no % 3 === 0 ? iso(-38) : iso(-3);
        const pr = mkPayment.run(id, p.term_no, p.name, p.amount, p.due_date, paid,
          paid >= p.amount ? receiptDate : null, iso(-40));
        if (paid > 0) mkReceipt.run(Number(pr.lastInsertRowid), paid, 'transfer', `凭证-${no}-${i + 1}`, financeId, '银行转账', receiptDate);
      });
    }
    if (unit) {
      const unitStatus = status === 'filed' ? 'filed' : status === 'effective' || status === 'approved' ? 'contracted'
        : status === 'pending' ? 'subscribed' : status === 'void' ? 'available' : status === 'draft' ? 'locked' : 'available';
      db.prepare('UPDATE units SET status=? WHERE id=?').run(unitStatus, unit);
    }
  }

  const mkChange = db.prepare('INSERT INTO changes(contract_id,type,from_value,to_value,reason,status,operator_id,approver_id,decided_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
  mkChange.run(contractIds[0], 'rename', '张伟', '张伟、王芳', '增加共有人', 'done', salesId, legalId, iso(-20), iso(-25));
  mkChange.run(contractIds[4], 'exchange', '1 栋 1 单元 102 室', '2 栋 2 单元 202 室', '客户申请换房', 'pending', salesId, null, null, iso(-2));
  mkChange.run(contractIds[8], 'cancel',HTNumber(contractIds[8]), '已解除', '客户资金周转困难', 'done', salesId, managerId, iso(-28), iso(-30));

  function HTNumber(id) { return db.prepare('SELECT contract_no FROM contracts WHERE id=?').get(id).contract_no; }

  const mkTemplate = db.prepare('INSERT INTO templates(name,type,version,content,status,updated_at) VALUES(?,?,?,?,?,?)');
  mkTemplate.run('商品房买卖合同（预售）示范文本', 'sale', 'v3.2',
    '第一条 当事人信息\n第二条 商品房基本情况\n第三条 价款与付款方式\n第四条 交付条件与期限\n第五条 面积差异处理\n第六条 违约责任\n第七条 争议解决', 'active', iso(-10));
  mkTemplate.run('商品房认购书', 'subscription', 'v2.1',
    '认购房源、定金金额、签约期限、定金罚则、客户信息确认。认购后 5 日内需转签正式买卖合同。', 'active', iso(-15));
  mkTemplate.run('补充协议（面积补差）', 'supplement', 'v1.4',
    '依据实测面积与合同约定面积差异，据实结算房款差额；双方确认无其他争议。', 'active', iso(-20));
  mkTemplate.run('车位使用权转让协议', 'parking', 'v1.0',
    '车位位置、使用期限、价款、交付时间、物业管理责任。', 'active', iso(-30));
  mkTemplate.run('旧版合同（含高风险条款）', 'sale', 'v1.0',
    '买受人应无条件付款，并承担无限连带责任，放弃抗辩权。', 'archived', iso(-200));

  const mkTask = db.prepare('INSERT INTO tasks(title,description,due_date,priority,status,contract_id,owner_id,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?)');
  const tasks = [
    ['催办 HT-2026-0005 网签备案', '合同生效已超 30 天，联系客户提交备案资料', iso(1), 'high', 'pending', contractIds[4], salesId],
    ['HT-2026-0003 特批折扣复核', '88 折低于授权底线，补齐特批手续', iso(2), 'high', 'pending', contractIds[2], managerId],
    ['HT-2026-0011 认购转签提醒', '认购已超期，确认客户是否继续购买', iso(-1), 'high', 'pending', contractIds[10], salesId],
    ['HT-2026-0006 法务条款审核', '核对补充协议条款与示范文本一致性', iso(3), 'medium', 'pending', contractIds[5], legalId],
    ['HT-2026-0010 按揭放款跟踪', '与银行确认放款进度', iso(6), 'medium', 'pending', contractIds[9], financeId],
    ['HT-2026-0014 总经理审批', '85 折特批需总经理确认', iso(1), 'high', 'pending', contractIds[13], adminId],
    ['整理本月签约台账', '导出合同明细并核对备案状态', iso(5), 'low', 'pending', null, managerId],
    ['HT-2026-0001 合同归档', '扫描签字页并归入项目档案', iso(-4), 'low', 'done', contractIds[0], salesId],
  ];
  for (const [title, description, due_date, priority, status, contract_id, owner_id] of tasks) {
    mkTask.run(title, description, due_date, priority, status, contract_id, owner_id, iso(-7), status === 'done' ? now() : null);
  }
}

function init() { db.exec(SCHEMA); }
init();
seed();

function audit(user, action, target, detail) {
  try {
    db.prepare('INSERT INTO audit_logs(user_id,username,action,target,detail,created_at) VALUES(?,?,?,?,?,?)')
      .run(user ? user.id : null, user ? user.username : 'system', action, target,
        detail ? String(detail).slice(0, 500) : '', now());
  } catch (e) { console.error('audit failed:', e.message); }
}

module.exports = {
  db, hashPassword, verifyPassword, audit, now, iso,
  CONTRACT_TYPES, CONTRACT_STATUS, UNIT_STATUS, APPROVAL_STEPS, RISK_CLAUSES,
  flowFor, planFor, DB_PATH,
};
