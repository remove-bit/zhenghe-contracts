# 正合合同 · 变更说明

> 变更日期：2026-11-25
> 版本：v1.1.0（基于首版 v1.0.0 / `3a42223`）
> 适用对象：前端 / 后端开发、测试、实施人员
> 关联提交：`860624e`、`892c186`、`d860bba`、`2e94ea0`

---

## 一、变更背景

首版交付后，在实际查看工作台时陆续发现三类问题：

1. **界面显示问题**：统计卡金额过长撑破容器；侧边栏折叠按钮只露出半个圆。
2. **交互缺失**：工作台各统计区块只能看不能点，无法快速定位到明细数据。
3. **数据口径问题**：多个统计数字含义与标签不符，同一合同在预警列表重复刷屏，销售角色访问工作台直接 500。

本次变更集中解决以上问题，共 4 次提交，涉及 4 个文件。

---

## 二、变更内容概览

| 分类 | 变更项 | 影响范围 |
|---|---|---|
| 界面修复 | 统计卡金额溢出 | 工作台、统计报表 |
| 界面修复 | 侧边栏折叠按钮半露 | 全局布局 |
| 交互增强 | 工作台四类区块可点击钻取 | 工作台 |
| 交互增强 | 全部统计卡支持穿透到明细 | 工作台、统计报表、回款管理 |
| 数据口径 | 待我审批按角色计算 | 工作台、侧边栏角标 |
| 数据口径 | 签约金额只算有效合同 | 工作台、统计报表 |
| 数据口径 | 本月回款与累计回款分离 | 工作台 |
| 数据口径 | 风险预警按合同聚合 | 工作台、风险预警页 |
| 数据口径 | 审批中心显示真实审批节点 | 审批中心 |
| Bug 修复 | 销售角色 SQL 拼接异常 | 工作台、风险预警、趋势图 |

---

## 三、详细变更说明

### 3.1 统计卡金额溢出修复（`860624e`）

**问题**：原栅格 `minmax(200px,1fr)` 下，卡片减去内边距和 46px 图标后仅剩约 40px 文字区，`¥58,077,800` 使用 26px 粗体会溢出到相邻卡片。

**改动**：

| 文件 | 位置 | 变更 |
|---|---|---|
| `public/style.css` | `.stats-grid` | 最小列宽 `200px` → `210px` |
| `public/style.css` | `.stat-card` | 图标 `46px` → `40px`，padding `20px` → `16px`，新增 `min-width:0` |
| `public/style.css` | `.stat-value` | 固定 `26px` → `clamp(16px,1.5vw,24px)`，新增 `white-space:nowrap`、`letter-spacing:-.4px` |
| `public/style.css` | 新增 `.stat-body` | `min-width:0;flex:1`，防止 flex 子项撑破容器 |
| `public/app.js` | `statCard()` | 文字部分用 `.stat-body` 包裹 |

**效果**：1104px 视口下 6 张卡排为 4+2 两行，金额完整显示；宽屏自动排成一行并放大字号。

---

### 3.2 工作台区块钻取（`892c186`）

四个区块的条目全部支持点击穿透：

| 区块 | 点击目标 | 落点 |
|---|---|---|
| 合同状态分布 | 任意状态行 | 合同台账，预置 `status` 筛选 |
| 风险与待办提醒 | 任意预警 | 合同详情弹窗；回款类落「回款计划」页，审批滞留落「审批流程」页 |
| 逾期回款 TOP | 任意表格行 | 合同详情「回款计划」页 |
| 我的待办 | 任意任务 | 关联合同详情；无关联则跳任务列表 |

**实现要点**：

- `public/app.js` 新增 `openContractDetail(id, tab = 'info')` 的 `tab` 参数，弹窗初始化后自动激活对应标签页。
- 模板为每个条目添加 `data-status` / `data-alert-contract` / `data-pay-contract` / `data-task-contract` 属性。
- `「完成」`按钮绑定中调用 `e.stopPropagation()`，避免误触发整行钻取。
- `public/style.css` 新增 `.clickable-row` 悬停高亮与 `.task-row` 布局。

---

### 3.3 统计卡与报表条目穿透（`d860bba`）

**统一机制**：

```js
const statCard = (color, ico, label, value, sub, go, filter) => ...
function bindGoto(el) { /* 解析 data-filter 写入 STATE.filters[view] 再 navigate */ }
```

`statCard()` 新增 `go`（目标视图）和 `filter`（预置筛选）两个参数，输出 `data-goto` / `data-filter` 属性；`bindGoto()` 统一处理，确保进入目标页时筛选条件已生效。

**跳转映射**：

| 页面 | 卡片 | 目标 |
|---|---|---|
| 工作台 | 合同总数 / 签约金额 | 合同台账（全部） |
| 工作台 | 待我审批 | 审批中心 |
| 工作台 | 本月回款 | 回款管理 |
| 工作台 | 风险预警 | 风险预警页 |
| 工作台 | 可售房源 | 房源销控，预置 `status=available` |
| 统计报表 | 4 张统计卡 | 台账 / 审批 / 回款 / 风险页 |
| 回款管理 | 4 张 KPI 卡 | 按 `paid` / `overdue` 等状态筛选回款列表 |
| 统计报表 | 状态分布行、团队业绩条 | 台账按 `status` / `owner_id` 筛选 |

新增 `.clickable-card` 样式：悬停时蓝色描边 + 阴影 + 上浮 1px。

---

### 3.4 数据口径修正（`2e94ea0`）

#### 3.4.1 待我审批按角色计算

**问题**：原 `statsOverview.pending` 取全系统 `status='pending'` 合同数，对所有角色都显示 3。

**改动**：`server.js` 新增 `myPendingCount(user)`：

- 遍历审批中合同，读取 `flow` 与 `approvals` 计算**下一审批节点**；
- 若节点角色等于当前用户角色，或当前用户为 `admin`（超管可处理任意节点），则计入；
- `sales` 角色无审批权限，直接返回 0。

`statsOverview` 新增返回字段 `myPending`；工作台卡片与 `updateBadges()` 改用该字段。`pending` 字段保留，供报表页「审批中」指标使用。

**验证结果**：

| 角色 | pending（全量） | myPending |
|---|---|---|
| admin | 3 | 3 |
| manager | 3 | 0 |
| legal | 3 | 3 |
| finance | 3 | 0 |
| sales | 1 | 0 |

#### 3.4.2 签约金额只算有效合同

**问题**：原 `contractAmount = SUM(amount)` 包含草稿、驳回、已解除合同。

**改动**：`statsOverview` 新增 `signedAmount`，条件为 `status IN ('approved','effective','filed')`。工作台与报表页的「签约金额」卡片改用该字段。

**数据变化**：`¥58,077,800` → **`¥28,190,900`**（交叉校验：有效合同金额之和一致）。

#### 3.4.3 本月回款与累计回款分离

**问题**：种子数据中 11 笔回款的 `created_at` 全为同一天，导致「本月回款」与「已收」永远同额；副标题的 42% 实际是累计回款率，口径不匹配。

**改动**：

- `db.js` 种子逻辑：回款日期按 `no % 3` 分布到上月 / 本月，同时同步 `payments.received_at`。
- `statsOverview` 新增 `monthReceiptCount`（本月回款笔数）。
- 前端副标题改为 `本月 N 笔 · 累计回款率 X%`。

**数据变化**：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 本月回款 | ¥22,585,680 | **¥14,124,340（7 笔）** |
| 累计回款 | ¥22,585,680 | ¥22,585,680（不变） |
| 上月回款 | ¥0 | ¥8,461,340（4 笔） |

#### 3.4.4 风险预警按合同聚合

**问题**：HT-2026-0003 一份合同同时命中条款风险、审批滞留、价格风险、回款临期 4 条，在列表重复刷屏。

**改动**：`public/app.js` 新增 `groupAlerts(alerts)`：

- 以 `contract_id` 为 key 分组；
- 组内取最高风险等级作为展示等级，累积 `count` 与 `types` 列表；
- 返回按「等级 → 该项数」排序的数组。

工作台首页与风险预警页均改用聚合结果，同合同多风险显示为「等 N 项」并列出风险类型；角标仍显示原始预警项数（13 项），风险页标题注明「13 项预警 · 涉及 7 份合同」。

#### 3.4.5 审批中心显示真实节点

**问题**：`renderApprovals()` 中当前节点列写死为「销售经理」。

**改动**：

- `server.js` 的 `listContracts()` 新增 `next_step`、`next_step_label` 两个返回字段，按 `flow` 中第一个未完成的 `approvals.step` 计算；
- 前端改用 `next_step_label` 渲染，节点样式映射 `{manager:blue, legal:purple, finance:orange, gm:red}`；
- 当前 3 份待审批合同均正确显示「法务审核」。

---

### 3.5 Bug 修复：销售角色 SQL 异常（`2e94ea0`）

**问题**：`statsTrend()` 与 `buildAlerts()` 中使用：

```js
' AND' + sc.sql.replace(/^ AND /, '')
```

`scopeClause()` 返回的是 ` AND c.owner_id=?`，`replace` 去掉前缀后得到 `c.owner_id=?`，再拼上 `' AND'` 变成 ` ANDc.owner_id=?`（缺空格），导致销售角色请求 `/api/stats/overview` 返回 500 `near "ANDc": syntax error`。

**改动**：两处均改为 `const where/suffix = sc.sql || ''`（`sc.sql` 本身已含前导空格）。

**验证**：五个角色统计接口全部返回 200，销售角色可见自身数据（合同 1 份、预警 5 项、签约金额 ¥13,893,300）。

---

### 3.6 侧边栏折叠按钮视觉修复（`2e94ea0`）

**问题**：按钮原 `position:absolute; right:-11px`，位于侧栏边界外，只露出半个白色圆形。

**改动**：

- `public/style.css`：改为侧栏内嵌 `right:8px; top:86px`，深色半透明底 + 浅色箭头，新增 hover 态。
- `public/app.js`：`setupNav()` 中抽出 `toggleSidebar()`，折叠时切换箭头 `‹` / `›`，顶栏菜单按钮与侧栏按钮共用。

---

## 四、数据迁移说明

本次变更包含**一次演示库数据迁移**，已对当前 `data/contracts.db` 执行：

```sql
UPDATE payments SET received_at = date(received_at, '-38 day')
  WHERE received_at IS NOT NULL AND id IN (SELECT payment_id FROM receipts WHERE id % 3 = 1);
UPDATE receipts SET created_at = date(created_at, '-38 day') WHERE id % 3 = 1;
```

**影响**：约 1/3 的回款流水从 11 月移到 10 月，用于让「本月 / 累计回款」呈现不同数值。业务含义无变化，仅演示数据分布调整。

**新建环境**：`db.js` 种子逻辑已同步修改，无需额外迁移。已有生产库如需同样效果，请按上述 SQL 自行评估执行。

---

## 五、接口变更

| 接口 | 变更类型 | 说明 |
|---|---|---|
| `GET /api/stats/overview` | 新增字段 | `signedAmount`、`myPending`、`monthReceiptCount` |
| `GET /api/contracts` | 新增字段 | 每行增加 `next_step`、`next_step_label` |

**兼容性**：均为新增字段，原字段（`pending`、`contractAmount` 等）保留，旧调用方不受影响。

---

## 六、验证结果

- **语法检查**：`db.js`、`server.js`、`public/app.js` 全部通过 `node --check`。
- **统计接口**：五个演示角色（admin / manager / legal / finance / sales）全部返回 200，口径符合预期（见 3.4.1 表格）。
- **审批节点**：3 份待审批合同均返回 `next_step_label = 法务审核`，与后端权限逻辑一致。
- **金额交叉校验**：`signedAmount = 28,190,900` 与有效合同金额手工汇总一致。
- **回款分布**：10 月 4 笔 ¥8,461,340 / 11 月 7 笔 ¥14,124,340，合计与累计回款 ¥22,585,680 一致。
- **全链路回归**：此前已验证的「创建 → 审批 → 备案 → 收款 → 变更 → 解除」流程未受影响。

---

## 七、部署与注意事项

1. 服务为常驻 Node 进程，改完 `server.js` / `db.js` **必须重启**才能生效；纯前端文件（`public/*`）刷新浏览器即可，建议 `Ctrl+F5` 强制刷新。
2. 启动命令：`node server.js`（零 npm 依赖，需 Node.js 22+ 以使用内置 `node:sqlite`）。
3. 回滚：直接回退到提交 `3a42223`；若已执行第四节的数据迁移，需同步还原回款日期。
4. 本次未改动数据库表结构，仅调整字段值与新增 API 返回字段，回滚风险低。

---

## 八、涉及文件与提交记录

| 提交 | 说明 |
|---|---|
| `860624e` | fix: 统计卡金额过长溢出容器 |
| `892c186` | feat: 工作台卡片条目支持钻取到合同详情 |
| `d860bba` | feat: 统计卡片与报表条目支持穿透到明细页 |
| `2e94ea0` | fix: 统一统计口径与预警聚合，修复销售角色查询异常 |

| 文件 | 改动内容 |
|---|---|
| `server.js` | 统计口径、`myPendingCount`、审批节点字段、SQL 空格修复 |
| `db.js` | 回款种子日期分布 |
| `public/app.js` | 钻取与穿透交互、`groupAlerts`、标签页定位、折叠按钮 |
| `public/style.css` | 统计卡响应式、可点击态、折叠按钮样式 |

---

**文档结束**
