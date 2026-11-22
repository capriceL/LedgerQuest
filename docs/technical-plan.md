# LedgerQuest 技术架构与 QA 方案

- 文档版本：1.0
- 审查日期：2026-11-20
- 审查对象：`LedgerQuest.html`
- 文档目的：为三科全科内容扩展、内容包导入导出、进度持久化、移动端体验、测试验收和后续补丁提供统一技术基线
- 本轮约束：只做架构审查和文档，不修改 `LedgerQuest.html` 主文件

---

## 0. 结论摘要

### 0.1 当前实现基线

主文件约 244 KB、4400 行，技术栈为原生 HTML/CSS/JavaScript，没有外部 CSS、JS、字体、图片或 CDN 依赖。内容、样式、状态和渲染均在同一文件内，能够通过浏览器直接打开。

本次静态审查确认的现状：

| 项目 | 当前状态 |
|---|---|
| 科目 | 仅 `practice`（中级会计实务）1 科 |
| 章节 | 25 章 |
| 知识关卡 | 54 个 |
| 题型 | 选择题 48、数字题 5、排序题 1；分录题和判断题 0 |
| 内容入口 | 内嵌 `SUBJECTS`，另有“内容工坊”JSON 导入 |
| 进度存储 | `localStorage` 键 `ledgerquest.progress.v1` |
| 自定义内容 | `localStorage` 键 `ledgerquest.custom-content.v1` |
| 渲染方式 | 事件委托 + 整页 `innerHTML` 重建 |
| 主文件是否满足三科交付 | 否；经济法、财务管理尚未落地 |

### 0.2 最高风险

1. **交付风险（P0）：内容范围严重不足。** 项目承诺 2026 中级会计三科全覆盖，但当前只有实务一科、25 章、54 个知识关卡，且分录题与判断题没有任何实例。按当前状态不能通过“三科全科”验收。
2. **技术风险（P0）：导入不是事务性的，也没有真正的 schema 校验。** 当前代码先修改内存中的 `SUBJECTS`，再写入 `localStorage`；如果存储配额不足、已有自定义内容损坏或写入失败，界面会提示“导入失败”，但内存内容已经被部分修改。
3. **数据一致性风险（P0）：ID 没有全局唯一性约束。** 进度只按 `topic.id` 记录；若不同章节或不同内容包复用同一 topic ID，通关、错题和 XP 会串账。
4. **安全与稳定性风险（P1）：导入字段没有可信边界。** 颜色值被直接拼进 `style` 属性，章节序号等个别字段未转义；恶意或损坏内容包可造成 CSS/HTML 注入、页面结构破坏或脚本异常。
5. **持久化风险（P1）：刷新只恢复进度，不恢复页面位置。** 当前启动总是回到首页；没有 hash 路由、没有进度导出、没有损坏进度迁移策略。直接移动 HTML 文件后，`file://` 下的浏览器本地存储也可能不可沿用。
6. **可访问性风险（P1）：弹窗没有焦点圈定和焦点恢复，答案组没有语义分组，反馈区没有实时播报，移动端大量 10–12 px 文本和偏小触控目标。**

### 0.3 推荐实施顺序

内容生产是最大工作量，应与技术改造并行启动。技术改造按以下依赖顺序推进：

1. 冻结 v2 数据字典、ID 规则和三科章节清单。
2. 引入纯函数内容校验器、内容注册表和索引。
3. 把导入改成“校验 → 预演 → 持久化 → 提交内存”的事务流程。
4. 迁移进度到 v2，补数据清洗、损坏恢复和备份导出。
5. 修复可信渲染边界、CSS 注入、焦点和刷新恢复。
6. 补充三科内容、100% 结构审计和学科人工审校。
7. 用 1000+ 知识点的压测内容和真实手机完成验收。

---

## 1. 数据 Schema 与内容扩展方式

### 1.1 设计原则

1. **UI 与内容分离。** 科目、章节、知识节点、题型和解析都由数据描述；新增普通内容不修改渲染函数。
2. **ID 稳定且全局唯一。** ID 是进度、错题、关联知识点和内容包冲突的主键，发布后不得随标题变化。
3. **节点级原子替换。** 合并时以完整 subject/chapter/topic 节点为单位，不做字段级“半合并”。
4. **向后兼容。** 当前 v1 非正式数据可以被规范化读取；新内容包一律使用 v2 元数据。
5. **有限扩展。** 新增“内容”不需要改 UI；新增“交互题型”必须同时补校验器、渲染器和测试，不能只靠 JSON 宣称支持。

### 1.2 内容包根对象

建议新增统一内容包根结构。正式内嵌内容与用户导入内容使用同一结构、同一校验器。

| 字段 | 类型 | 必填 | 规则与说明 |
|---|---|---:|---|
| `format` | string | 是 | 固定为 `ledgerquest-content-pack` |
| `schemaVersion` | integer | 是 | v2 使用 `2`；主版本不兼容时拒绝导入 |
| `packId` | string | 是 | 稳定包 ID，如 `official-practice-2026`；同包升级不得改 ID |
| `packVersion` | string | 是 | 语义化版本，如 `2.1.0` |
| `revision` | integer | 是 | 单调递增整数；同版本不同内容必须冲突 |
| `title` | string | 是 | 内容包标题 |
| `examYear` | integer | 是 | 当前为 `2026` |
| `publisher` | string | 否 | 官方/校本/个人内容来源 |
| `createdAt` | string | 否 | ISO 8601 时间 |
| `updatedAt` | string | 否 | ISO 8601 时间 |
| `subjects` | Subject[] | 是 | 至少 1 个科目 |

示例：

```json
{
  "format": "ledgerquest-content-pack",
  "schemaVersion": 2,
  "packId": "official-practice-2026",
  "packVersion": "2.0.0",
  "revision": 1,
  "title": "2026 中级会计实务",
  "examYear": 2026,
  "subjects": []
}
```

### 1.3 Subject

```json
{
  "id": "practice",
  "name": "中级会计实务",
  "short": "实务",
  "icon": "📒",
  "accent": "#a9dfbf",
  "accentSoft": "#e9f7ed",
  "desc": "从资产、负债到合并报表，把准则翻译成工作现场。",
  "order": 10,
  "chapters": []
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | string | 是 | 稳定唯一；建议 `practice` / `law` / `finance` |
| `name` | string | 是 | 科目全称 |
| `short` | string | 是 | 导航短名 |
| `icon` | string | 否 | 单个 emoji 或短文本 |
| `accent` | string | 否 | 仅允许 `#RGB` / `#RRGGBB`，不得直接插入 CSS |
| `accentSoft` | string | 否 | 同上 |
| `desc` | string | 否 | 首页说明 |
| `order` | integer | 否 | 科目排序；缺省按包内数组顺序追加 |
| `chapters` | Chapter[] | 是 | 可为空，但空科目标记为“内容建设中” |

### 1.4 Chapter

```json
{
  "id": "p02",
  "no": 2,
  "order": 20,
  "title": "存货",
  "subtitle": "每一件货，都要有一个说得清的身价。",
  "icon": "📦",
  "accent": "#a9dfbf",
  "accentSoft": "#e9f7ed",
  "story": {
    "npc": "王姐",
    "line": "柚柚，先别急着按计算器。把题目里的关键词圈出来。"
  },
  "outro": "这一章先收工，柚柚把新学到的判断方法写进了小本本。",
  "topics": []
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | string | 是 | 全局唯一且稳定 |
| `no` | integer | 否 | 教材/展示序号；只用于显示，不参与排序 |
| `order` | integer | 否 | 章节实际排序 |
| `title` | string | 是 | 章节名 |
| `subtitle` | string | 否 | 一句话说明 |
| `icon` | string | 否 | 章节图标 |
| `accent` | string | 否 | 颜色格式校验 |
| `accentSoft` | string | 否 | 颜色格式校验 |
| `story` | object | 否 | `{ npc, line }` |
| `outro` | string | 否 | 章节结束文案 |
| `topics` | Topic[] | 是 | 知识节点，可为空但不可用于正式发布 |

### 1.5 Topic（知识节点）

当前代码把“知识点”称为 `topic`，每个 topic 对应一个关卡。建议保留该名称，以减少改动。

```json
{
  "id": "p02-t1",
  "title": "存货初始计量",
  "tag": "实务 · 存货",
  "keywords": ["采购成本", "合理损耗", "入库前"],
  "hook": "仓库来了批货，王姐先问：哪些钱该进存货成本？",
  "short": "入库前、使存货达到目前场所和状态所发生的合理支出，通常进入存货成本。",
  "plain": "用大白话解释该知识点，允许换行。",
  "steps": ["先判断支出发生在入库前还是入库后", "再判断是否使存货达到当前场所和状态"],
  "formula": "存货采购成本 = 购买价款 + 相关税费 + 运输费 + 装卸费 + 其他可归属费用",
  "example": "可选例题。",
  "traps": ["非正常损耗通常不计入存货成本。"],
  "tip": "可选：侧栏王姐提示。",
  "related": ["p02-t2"],
  "entry": [
    { "side": "借", "account": "原材料", "amount": "100 000" },
    { "side": "贷", "account": "银行存款", "amount": "100 000" }
  ],
  "question": {}
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `id` | string | 是 | **全局唯一**；进度主键 |
| `title` | string | 是 | 知识节点标题 |
| `tag` | string | 否 | 面包屑标签 |
| `keywords` | string[] | 是 | 至少 1 个；去重、非空 |
| `hook` | string | 否 | 剧情角色台词 |
| `short` | string | 是 | 一句话摘要 |
| `plain` | string | 是 | 大白话详解 |
| `steps` | string[] | 否 | 判断/计算步骤 |
| `formula` | string | 否 | 公式或判断口径 |
| `example` | string | 否 | 例题/反例 |
| `traps` | string[] | 否 | 易错点 |
| `tip` | string | 否 | 侧栏提示 |
| `related` | string[] | 否 | 其他 topic ID；提交后必须可解析 |
| `entry` | JournalLine[] | 否 | 正确分录示例 |
| `question` | Question | 是 | 至少一道可答题 |

`JournalLine`：

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `side` | string | 是 | 仅 `借` 或 `贷` |
| `account` | string | 是 | 非空科目名 |
| `amount` | string/number | 是 | 展示金额；建议同时保存数值用于借贷平衡校验 |

### 1.6 Question 公共字段

```json
{
  "mode": "choice",
  "goal": "判断哪项支出应计入存货成本。",
  "prompt": "题干。",
  "keywords": ["入库前", "合理损耗"],
  "translate": "把题干翻译成大白话。",
  "hint": "第一次答错后的方向提示。",
  "wrongHint": "指出具体易错方向。",
  "explain": "答对后的通俗解析。",
  "xp": 18
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---:|---|
| `mode` | enum | 是 | `choice` / `number` / `journal` / `sort` / `truefalse` |
| `goal` | string | 是 | 本关要做什么 |
| `prompt` | string | 是 | 题干 |
| `keywords` | string[] | 是 | 题干高亮与提示词 |
| `translate` | string | 是 | 人话翻译 |
| `hint` | string | 是 | 首错提示 |
| `wrongHint` | string | 是 | 具体易错点 |
| `explain` | string | 是 | 正确答案解析 |
| `xp` | number | 否 | 非负有限数，默认 18 |

### 1.7 各题型专属字段

#### choice

```json
{
  "mode": "choice",
  "options": ["计入存货成本", "计入管理费用", "计入销售费用", "计入营业外支出"],
  "answer": 0
}
```

- `options`：2–8 个非空字符串。
- `answer`：整数，必须满足 `0 <= answer < options.length`。

#### truefalse

```json
{
  "mode": "truefalse",
  "options": ["正确", "错误"],
  "answer": 0
}
```

- 为减少引擎分叉，沿用索引答案；`0` 表示正确，`1` 表示错误。
- 若省略 options，规范化时补为 `["正确", "错误"]`。

#### number

```json
{
  "mode": "number",
  "answer": 850000,
  "unit": "元",
  "tolerance": 0.01
}
```

- `answer`：有限数值。
- `tolerance`：有限非负数，默认 `0.01`；不得为 `NaN` 或无穷。
- 输入解析统一：去除首尾空格、千分位逗号；不接受空串、`Infinity`、十六进制或非数字后缀。

#### journal

```json
{
  "mode": "journal",
  "options": [
    [
      { "side": "借", "account": "原材料", "amount": "100 000" },
      { "side": "贷", "account": "银行存款", "amount": "100 000" }
    ],
    [
      { "side": "借", "account": "管理费用", "amount": "100 000" },
      { "side": "贷", "account": "银行存款", "amount": "100 000" }
    ]
  ],
  "answer": 0,
  "entry": [
    { "side": "借", "account": "原材料", "amount": "100 000" },
    { "side": "贷", "account": "银行存款", "amount": "100 000" }
  ]
}
```

- `options`：至少 2 组分录；每组至少 2 行。
- `answer`：整数索引。
- 每组借贷合计若能解析为数值，应满足平衡；否则给 warning，要求人工复核。
- `entry` 可选；答对反馈优先使用题目分录，再回退到 topic 分录。

#### sort

```json
{
  "mode": "sort",
  "items": ["识别履约义务", "确定交易价格", "分摊交易价格", "履行时确认收入"],
  "answer": [0, 1, 2, 3]
}
```

- `items`：2–12 个非空字符串。
- `answer`：必须是 `0..items.length-1` 的完整排列，不允许重复或缺失。
- 当前引擎使用“原数组索引的排列”表示答案，继续保持兼容。

### 1.8 哪些变化可以“不改 UI 新增”

可以只改内容：

- 新增科目、章节、知识节点、题目、解析、分录、关键词、关联知识点。
- 在同一题型内新增 choice / number / journal / sort / truefalse 题目。
- 调整章节顺序、标题、颜色、图标、剧情文案。
- 通过内容包更新已有节点。

必须改代码：

- 新增一种题型，例如多选、连线、拖拽填空、计算分步评分。
- 新增答题计分规则、错题间隔复习、搜索维度或学习路径。
- 改变“通关”定义、进度表结构或 XP 规则。

这条边界必须写入内容制作规范，避免把“数据结构可扩展”误解为“任何交互都能只靠 JSON 生成”。

### 1.9 内容进入单文件的三条路径

#### 路径 A：官方内容在构建时内嵌

建议维护源文件 `content/official-practice-2026.json`、`content/official-law-2026.json`、`content/official-finance-2026.json`，发布时由构建脚本把它们内嵌到主文件的只读内容区。

当前主文件已有 `/* @@CONTENT_INSERT@@ */`，可以演进为：

```html
<script type="application/json" id="ledgerquest-builtin-packs">
[
  { "format": "ledgerquest-content-pack", "schemaVersion": 2, "packId": "official-practice-2026", "subjects": [] },
  { "format": "ledgerquest-content-pack", "schemaVersion": 2, "packId": "official-law-2026", "subjects": [] },
  { "format": "ledgerquest-content-pack", "schemaVersion": 2, "packId": "official-finance-2026", "subjects": [] }
]
</script>
```

应用启动时用 `JSON.parse(document.getElementById(...).textContent)` 读取，再走统一校验器。相比直接 `SUBJECTS.push({...})`，这种方式的优势是：

- 数据区不执行代码。
- 内容可被同一套 schema 校验。
- 导出/导入格式与官方内容一致。
- 内容源文件可独立审校、diff 和统计。

如果不希望引入构建步骤，也可以保留 JavaScript 对象数组，但仍应通过 `BUILTIN_PACKS` 注册，不要继续向一个可变全局数组零散 `push`。

#### 路径 B：用户在运行时导入

用户通过文本或文件导入 v2 内容包。导入包先进入校验器和候选注册表，确认后才成为可渲染内容。

#### 路径 C：开发者临时插入

开发阶段可以用 `CONTENT_INSERT` 注入，但发布前必须转为正式包元数据，并由校验器产出零错误报告。

### 1.10 内容注册表

建议把“包”和“合并后的内容视图”分开：

```js
contentRegistry = {
  packs: [
    {
      packId: "official-practice-2026",
      packVersion: "2.0.0",
      revision: 1,
      source: "builtin",       // builtin | imported
      enabled: true,
      hash: "fnv1a-...",
      data: { /* validated pack */ }
    }
  ],
  subjects: [],               // 由 enabled packs 合并得到
  index: {
    subjectById: Map,
    chapterById: Map,
    topicById: Map,
    topicsInOrder: []
  }
}
```

渲染器只读 `contentRegistry.subjects` 和索引，不再直接修改 `SUBJECTS`。进度清理、统计、搜索都使用 `topicById`，避免每次全量三层遍历。

---

## 2. JSON 内容包导入 / 导出、版本、校验、冲突与本地存储

### 2.1 当前实现的问题

现有 `mergeContentPack()` 位于 `LedgerQuest.html:4210` 附近，主要问题如下：

1. 只检查 `subjects` 是否为非空数组，没有字段级校验。
2. 在写入 `localStorage` 之前就已修改 `SUBJECTS`。
3. 如果 `CUSTOM_KEY` 中的旧 JSON 已损坏，`JSON.parse` 在合并之后抛错，界面报告失败，但内存已被改动。
4. 如果 `localStorage.setItem` 因配额或隐私模式失败，同样会出现“界面失败、内存已变”的状态。
5. 导入包重复追加到数组；同一包重复导入会不断占用存储。
6. 没有内容包版本、revision、hash、来源和冲突提示。
7. 已存在的 subject/chapter 元数据不会被更新；topic 则整体覆盖。合并语义不一致。
8. 没有引用完整性检查，`related` 可以指向不存在的知识点。
9. 没有大小、深度、字符串长度和数量上限，超大 JSON 可冻结页面。
10. UI 文案声称“导入失败不会改动现有内容”，但实现不满足该承诺。

### 2.2 导入流水线

导入必须遵循以下顺序，任何一步失败都不能改变当前已生效内容：

```text
读取输入
  → 去除 BOM / 检查 UTF-8 和大小
  → JSON.parse
  → schema 结构校验
  → 规范化默认值
  → 构建 candidate 内容注册表
  → 全局 ID / 引用 / 题型完整性校验
  → 计算 diff（新增、更新、冲突、无效）
  → 用户确认合并策略
  → 持久化候选包和索引
  → 原子提交内存注册表
  → 重建索引并渲染
```

推荐函数边界：

```js
function parsePack(text) {}
function validatePackShape(raw) {}
function normalizePack(pack) {}
function buildCandidateRegistry(currentPacks, incomingPack) {}
function diffRegistry(currentRegistry, candidateRegistry) {}
function persistPackTransaction(record) {}
function commitContent(candidateRegistry) {}
function importContentPack(text, options) {}
```

`validatePackShape` 不读写 DOM、不读写存储、不修改参数，便于在浏览器控制台和自动测试脚本中复用。

### 2.3 校验分级

#### 致命错误：整包拒绝

- JSON 语法错误。
- `format` 不符。
- `schemaVersion` 缺失或主版本不支持。
- `subjects` 不是数组或为空。
- ID 缺失、格式非法或重复。
- 必填文本为空。
- 题型未知。
- 选择题答案越界。
- 数字题答案不是有限数值。
- 排序题答案不是完整排列。
- 引用 ID 指向不存在节点。
- 尝试修改内置官方包但没有显式覆盖权限。

#### 警告：允许导入但必须展示

- 科目/章节无 topic。
- topic 无关键词、无分录、无例题。
- 借贷金额可解析但不平衡。
- 关联的“易混知识”缺失。
- 内容文本过长但未超硬上限。
- 同包版本没有变化但 hash 不同。

#### 统计信息：导入前预览

```text
新增：1 个科目、8 个章节、126 个知识点
更新：2 个章节、14 个知识点
冲突：3 个 topic ID
警告：11 条
预计本地占用：860 KB
```

### 2.4 版本规则

三个版本号职责必须分开：

| 版本 | 示例 | 作用 |
|---|---|---|
| `schemaVersion` | `2` | 数据结构兼容性；主版本变化时旧应用拒绝导入 |
| `packVersion` | `2.1.0` | 内容业务版本，给人看 |
| `revision` | `17` | 冲突检测和排序的决定性依据 |

规则：

1. 同 `packId` 的新 revision 可以升级同包节点。
2. 相同 revision 且内容 hash 相同：视为重复导入，不写存储，不报错。
3. 相同 revision 但内容 hash 不同：冲突，要求作者提升 revision。
4. 较低 revision：拒绝覆盖并提示“本地版本更新”。
5. 不同 `packId` 却声明相同 subject/chapter/topic ID：冲突，默认保留本地版本。
6. 内置官方包默认只读。需要修正官方内容时，应发布新官方包，而不是让任意用户包覆盖。

`hash` 不需要密码学强度，只用于快速判断两个对象是否一致。可以对确定性序列化后的字符串使用 FNV-1a 32/64 位，也可用同步简版 hash；不必为此引入外部库。

### 2.5 冲突与合并策略

#### 合并粒度

以 topic 为最小原子单位：

- 同一个 topic：整体替换，不做字段级 merge。
- 新 topic：插入对应 chapter。
- 新 chapter：插入对应 subject。
- 新 subject：插入科目列表。
- 同一 subject/chapter 的展示元数据：仅允许同一 `packId` 的新 revision 更新。

#### 策略矩阵

| 场景 | 默认行为 | 可选行为 |
|---|---|---|
| 新 ID | 合并 | — |
| 同 packId，revision 更高 | 更新 | 保留本地、取消 |
| 同 packId，revision 相同，hash 相同 | 无操作 | — |
| 同 packId，revision 相同，hash 不同 | 冲突 | 由作者升 revision 后重试 |
| 不同 packId，同 ID | 冲突 | 保留本地、显式覆盖（高风险） |
| 官方包 ID | 只读 | 只能通过正式版本更新 |
| 内容删除 | 默认不删除 | 后续通过显式 tombstone/替换包实现 |

初期不建议支持任意删除。删除会影响 `related` 引用和进度；如果确需删除，建议使用独立的“替换官方包”流程，或定义 `tombstones: [{ entityType, id, packId, revision }]`，并在校验后一起提交。

#### 顺序

- 新增科目/章节使用 `order`，缺省时追加到末尾。
- 不要依赖对象属性顺序或数组 splice 位置的隐式语义。
- 对同 `order` 使用 `id` 升序作为稳定排序兜底。

### 2.6 事务性持久化

`localStorage` 没有跨键事务，因此推荐“先持久化候选包，再提交内存”；应用启动时通过索引和扫描恢复。

建议键：

```text
ledgerquest.progress.v2
ledgerquest.content.index.v2
ledgerquest.content.pack.v2.<packId>
```

导入步骤：

1. 对 incoming pack 完成全部校验。
2. 计算候选内容和新索引。
3. 先写入包键 `ledgerquest.content.pack.v2.<packId>`，`setItem` 单键写入是原子的。
4. 再更新索引键。若索引写入失败，启动时扫描所有 `ledgerquest.content.pack.v2.*` 键进行核对恢复。
5. 所有持久化成功后，才把内存 `contentRegistry` 替换为 candidate。
6. 若任何持久化失败，保持旧内存内容，并提示“未导入；请导出/清理存储后重试”。

对于更新的包，可以先把候选写到临时键 `ledgerquest.content.pack.v2.<packId>.pending`，读回验证后再写正式键并删除临时键。这样避免写入过程中留下半截 JSON。

### 2.7 本地存储策略

建议把内置内容和用户内容分开：

- **内置内容不写入 localStorage。** 它们已经包含在 HTML 中，重复保存只会浪费配额。
- `ledgerquest.progress.v2`：只存进度、设置和最后位置，目标小于 128 KB。
- `ledgerquest.content.pack.v2.<packId>`：每个用户导入包一个键，覆盖更新，不再追加重复数组。
- `ledgerquest.content.index.v2`：包元数据索引，目标小于 64 KB。

容量建议：

| 数据 | 建议上限 | 超限处理 |
|---|---:|---|
| 单个导入包 | 2 MB | 拒绝并提示拆分 |
| 用户内容总量 | 3.5 MB | 拒绝新包，提供导出和清理 |
| 进度对象 | 128 KB | 压缩/迁移；提示导出 |
| JSON 嵌套深度 | 12 层 | 拒绝 |
| 单个文本字段 | 20,000 字符 | 拒绝或截断为错误 |
| 单个包 topic 数 | 5,000 | 拒绝并提示拆分 |

如果未来确实需要导入超过 localStorage 容量的官方扩展包，可增加 IndexedDB 适配器；但必须保留“导出文件是最终备份”的定位，并测试 `file://` 下浏览器是否允许 IndexedDB。不要假设所有浏览器对本地文件页面都提供同样的存储能力。

### 2.8 导入失败处理

必须保证：

1. 解析失败：不写内存、不写存储。
2. schema 校验失败：不写内存、不写存储，显示前 5 条错误及字段路径。
3. 持久化失败：不提交内存，保留旧内容。
4. 单个已存包损坏：隔离该包，其他包和内置内容继续可用；提示用户导出备份或清理该包。
5. 导入后引用损坏：整包拒绝；若来自旧包合并，则标记候选无效。
6. 用户取消冲突确认：无任何变化。
7. `FileReader` 触发 `error` / `abort`：显示明确错误，不能静默无响应。

错误对象建议：

```js
{
  code: "PACK_TOPIC_ID_DUPLICATE",
  path: "subjects[0].chapters[2].topics[5].id",
  message: "topic ID 与已有内容冲突",
  severity: "error"
}
```

不要只把 `error.message` 直接拼进 toast；应转义并提供可展开的详细面板。

### 2.9 导出

建议至少提供两种导出：

#### 只导出用户内容包

- 文件：`ledgerquest-content-YYYYMMDD.json`
- 内容：`{ format, schemaVersion, packs: [...] }`
- 用途：迁移、分享、备份用户自制内容。

#### 导出完整学习备份

- 文件：`ledgerquest-backup-YYYYMMDD.json`
- 内容：进度 v2 + 设置 + 用户内容包 + 应用/内容版本
- 用途：换设备、移动 HTML 文件、清理浏览器存储前备份。

导出前必须先通过当前内容校验器，确保导出的不是损坏数据。题目的 `answer` 可以导出，因为这是离线单机游戏，不属于服务端防作弊场景。

### 2.10 导入 UI 的最低要求

- 导入前显示包名、版本、科目/章节/topic 数量、存储占用。
- 有冲突时显示列表，不得直接覆盖。
- 成功后显示“新增/更新/跳过”统计。
- 失败时保留原内容，并提供“查看详情”而不是只有 2.8 秒 toast。
- 文件名和输入框内容不作为可信元数据。

---

## 3. localStorage 进度结构、状态机与渲染流程

### 3.1 当前 v1 进度

当前结构：

```js
{
  completed: { "p01-t1": true },
  wrong: { "p01-t2": 3 },
  xp: 0,
  streak: 0,
  bestStreak: 0,
  totalCorrect: 0,
  totalWrong: 0,
  last: { subjectId, chapterId, topicId }
}
```

问题：

- 没有内部 `schemaVersion`，只能靠键名判断。
- `loadProgress()` 使用 `Object.assign(base, saved)`，未校验类型；损坏数据可让 XP、连击变成字符串或 `NaN`。
- `completed`、`wrong` 只检查 truthy，不检查是否为普通对象。
- 没有首次通关时间、最后访问时间、答题次数和复习次数。
- 重做已完成关卡会继续增加 `totalCorrect` 和连击，但不会重复加 XP，统计口径不稳定。
- 没有复习模式、错题上限、内容删除后的孤儿进度策略。
- 刷新丢失当前页面与答题上下文，只能手动点“继续学习”。

### 3.2 建议 v2 进度

```json
{
  "format": "ledgerquest-progress",
  "schemaVersion": 2,
  "updatedAt": "2026-11-20T10:00:00.000Z",
  "profile": {
    "xp": 320,
    "streak": 4,
    "bestStreak": 9,
    "totalCorrect": 31,
    "totalWrong": 7,
    "completedCount": 22
  },
  "topics": {
    "p01-t1": {
      "seen": true,
      "completed": true,
      "firstCompletedAt": "2026-11-20T09:10:00.000Z",
      "lastSeenAt": "2026-11-20T09:10:00.000Z",
      "correctCount": 1,
      "wrongCount": 2,
      "firstTryCorrect": true,
      "lastResult": "correct"
    }
  },
  "lastLocation": {
    "subjectId": "practice",
    "chapterId": "p01",
    "topicId": "p01-t1",
    "updatedAt": "2026-11-20T10:00:00.000Z"
  },
  "settings": {
    "librarySubject": "all"
  }
}
```

字段说明：

| 字段 | 规则 |
|---|---|
| `format` | 固定 `ledgerquest-progress` |
| `schemaVersion` | 当前 `2` |
| `profile.xp` | 非负整数；只增不减，重置进度例外 |
| `profile.streak` | 非负整数；每次错误归零，首次提交正确才递增 |
| `profile.bestStreak` | 非负整数，始终不小于 `streak` |
| `profile.totalCorrect` | 每次正确提交 +1；重做是否计入需在验收中明确 |
| `profile.totalWrong` | 每次错误提交 +1 |
| `topics.<id>.completed` | 首次通关后为 true |
| `topics.<id>.wrongCount` | 用于“值得回看的坑” |
| `firstTryCorrect` | 首次进入且第一次提交正确 |
| `lastLocation` | 仅保存位置，不保存选择/输入等瞬时答案 |

建议在 v2 中把“首次通关”和“复习正确”分开统计：

```js
profile.firstClears
profile.reviewCorrect
profile.reviewWrong
```

这样 XP 仍只给首次通关，连击可以按“本轮新关卡首次提交”计算，重做不会污染学习进度。

### 3.3 v1 → v2 迁移

迁移规则：

1. 先读取 v1，但不要立即删除。
2. 校验 v1 是否为普通对象；对每个数值做有限数和非负清洗。
3. 遍历 `completed`，生成 `topics[id].completed = true`。
4. 遍历 `wrong`，生成 `topics[id].wrongCount`。
5. `firstCompletedAt` 迁移时置为 `null` 或迁移时间，不能伪造历史。
6. `last` 迁移为 `lastLocation`；若引用的内容已不存在，置空。
7. 写入 v2 后读回校验；成功后再写迁移标记 `ledgerquest.progress.migrated.v2 = "1"`。
8. v1 可保留一个版本周期，便于回滚；不要连续每次启动重复迁移。

如果 v2 损坏但 v1 尚在：

- 优先尝试从 v1 重建；
- 同时把损坏的 v2 以 `ledgerquest.progress.v2.corrupt.<timestamp>` 保存，便于诊断；
- UI 明确提示“部分进度已恢复，建议导出备份”。

### 3.4 状态机

#### 应用级状态

| 状态 | 进入条件 | 可选动作 | 退出 |
|---|---|---|---|
| `boot` | 页面加载 | 读取内置包、读取存储、迁移 | `ready` / `degraded` / `fatal` |
| `ready` | 内容与进度有效 | 导航、答题、导入 | 任意页面 |
| `degraded` | 存储不可用或部分包损坏 | 只读学习、导出可用、清除损坏包 | `ready` / `fatal` |
| `fatal` | 内置内容校验失败或框架异常 | 显示错误详情/重新载入 | — |

不能因为 localStorage 不可用就让整个游戏白屏。学习流程应能继续，只是无法持久化。

#### 关卡级状态

| 当前状态 | 事件 | 下一状态 | 副作用 |
|---|---|---|---|
| `answering` | 选项/输入变化 | `answering` | 仅更新临时表单状态 |
| `answering` | 提交且答案不完整 | `answering` | 不记错、不扣连击 |
| `answering` | 提交正确 | `correct` | 首次通关加 XP、保存进度、播放反馈 |
| `answering` | 提交错误 | `wrong` | 错题 +1、连击归零、保存进度 |
| `wrong` | 再试一次 | `answering` | 清空本次选择，保留 `/attempts` |
| `wrong` | 看详解 | `wrong` | 只开弹窗，不改变答题状态 |
| `correct` | 下一关 | 新关卡 `answering` | 更新 lastLocation |
| `correct` | 回地图 | `map` | 保存 lastLocation 或清理 |

关键约束：

- 只有 `answering` 可提交。
- `correct` 是终态，重复点击提交必须幂等，不得重复增加 XP。
- 错误提交只记录一次；重试前不能重复触发同一事件。
- 切换 topic 时必须重置表单和 feedback。
- 重做已完成 topic 进入 `review` 标记；可以复习，但不应重复加 XP。

建议的 UI 状态对象与业务状态分离：

```js
ui = {
  route: "level",
  modal: null,
  form: {
    topicId: "p01-t1",
    phase: "answering",
    selected: null,
    numeric: "",
    sortPicked: [],
    attempts: 0,
    showTranslate: false
  }
}
```

### 3.5 渲染流程

推荐单向下行：

```text
事件
  → 状态事务（不改 DOM）
  → 必要时持久化
  → render()
  → 选择一个屏幕 + 可选 modal
  → 更新可访问性焦点/播报
```

渲染函数保持分层：

```js
render()
  ├─ renderTopbar()
  ├─ renderRoute()
  │   ├─ renderHome()
  │   ├─ renderMap()
  │   ├─ renderLevel()
  │   ├─ renderLibrary()
  │   └─ renderProgress()
  └─ renderModal()
```

当前结构已经接近该模式，可以渐进改造，不必引入框架。

#### 当前可确认的渲染/状态问题

1. `setView()` 在赋值后才比较 `next.name !== view.name`，条件永远不成立，因此其中的滚动逻辑实际无效。`startChapter()` 和 `openTopic()` 各自手动滚动，掩盖了该问题。
2. 知识库搜索每次输入都整页 `innerHTML` 重建，再由代码恢复焦点和光标；当前 54 个 topic 可接受，三科全量后会明显卡顿。
3. 数字输入只切换按钮 disabled，不重绘，这是合理优化；其他选择项重绘整页，规模扩大后需要局部更新。
4. modal 只设置 `role="dialog"` 和 `aria-modal`，没有焦点圈定、初始焦点和关闭后恢复。
5. 反馈区没有 `role="status"` / `aria-live`；键盘和读屏用户可能不知道答对或答错。

### 3.6 刷新恢复

目标是“进度不丢、位置可回、瞬时答案不假装保存”。

建议：

- 用 `location.hash` 表示路由，避免依赖 History API 在 `file://` 下的差异：

```text
#/home
#/map/practice
#/library
#/progress
#/level/p01-t1
```

- `openTopic`、`startChapter`、导航时写入 hash。
- 启动时解析 hash；若 topic 存在且可访问，恢复到该关卡；否则回首页并显示提示。
- 只恢复“关卡位置”，不恢复上次选项、输入框内容、错误提示和正确反馈。
- 当前 `lastLocation` 只作为“继续学习”的兜底，不应覆盖用户明确打开的 hash 路由。
- 页面隐藏/卸载前无需强行保存；所有关键业务事件已经立即保存。

验收标准：

- 在地图刷新：回到当前科目地图。
- 在关卡刷新：回到同一 topic，答题状态重置，之前已通关/错题计数保留。
- 答错后立即刷新：错题次数不丢，反馈卡可消失。
- 答对后立即刷新：通关和 XP 不丢，下一关按钮可按位置重新出现。

---

## 4. 移动端、性能、可访问性、错误处理与离线约束

### 4.1 移动端

现有 CSS 已有 1040 / 820 / 560 px 三档响应式规则，方向正确。需重点验证和补齐：

1. **触控目标。** 当前多处按钮高度为 33–39 px，低于常用的 44×44 px 目标；重要操作按钮建议至少 44 px。
2. **输入区字号。** 搜索框和数字输入如果小于 16 px，iOS Safari 聚焦时可能自动放大页面，破坏布局。
3. **顶部栏高度。** 820 px 以下会变成三行 sticky 顶栏，需在 320 px 宽和横屏下验证是否遮挡内容。
4. **横向溢出。** 分录表格、长金额、长 URL 式文本和无空格英文需要 `overflow-wrap:anywhere` 或局部横向滚动，不能让整页横向滚动。
5. **安全区。** 增加 `env(safe-area-inset-bottom)` 适配刘海屏底部，尤其 toast 和固定操作区。
6. **modal。** 当前移动端使用底部弹层，但长详解和内容工坊可能超出 90vh；要保证内部滚动、关闭按钮始终可达。
7. **hover 不是必需路径。** 所有 hover 信息都必须在触控下仍有等价表达。
8. **横屏。** 地图、关卡侧栏和弹窗在 740×360 等高度下不能把提交按钮挤出屏幕。

设备矩阵最低要求：

| 宽度 | 场景 |
|---:|---|
| 320 px | 最小窄屏/旧手机 |
| 360 / 375 px | Android 常见宽、iPhone SE/13 mini |
| 390 / 414 px | 主流 iPhone |
| 768 px | 平板竖屏 |
| 1024 / 1440 px | 桌面 |
| 740×360 | 手机横屏 |

### 4.2 性能

当前 244 KB 单文件、54 个 topic，启动和交互成本都还低。扩展到三科后，必须设预算，不能假设内容永远只有几十条。

建议预算：

| 指标 | 目标 |
|---|---:|
| 主 HTML 初始体积 | ≤ 5 MB，超过必须拆发布包或压缩内容 |
| 冷启动可交互 | 中端手机 ≤ 2 s |
| 普通操作反馈 | ≤ 100 ms |
| 搜索输入到结果更新 | ≤ 150 ms（120 ms debounce 后） |
| 导入 2 MB 内容校验 | ≤ 1 s；超时需显示处理中 |
| 进度保存 | ≤ 20 ms |
| 内存 | 常见手机 ≤ 150 MB |

主要优化：

1. 建立 `topicById` / `chapterById` / `subjectById` 索引，避免 `allTopics()`、`findTopic()` 在每次渲染中三层遍历。
2. 缓存科目/章节统计；内容不变时不重复计算。
3. 知识库搜索使用 100–150 ms debounce；结果区局部更新，不重建顶栏和整页。
4. 长列表达到 300+ 结果时使用分页或窗口化，不一次插入全部 DOM。
5. 导入时先显示 loading，分块校验或 `requestIdleCallback` 处理非关键统计；但 schema 校验本身应保持同步、可预测。
6. 只保存变化的数据，避免每次答题都 `JSON.stringify` 全部内容包。
7. 发布版可压缩 HTML 中的空白，但保留可读源文件和 source map 式注释。
8. 禁止在渲染路径中反复创建大正则、重复排序和重复 `JSON.parse`。

### 4.3 可访问性

已有优点：

- 页面语言为 `zh-CN`。
- 主要操作使用原生 button，键盘可达。
- 有 `:focus-visible` 样式。
- 有 `prefers-reduced-motion`。
- 主导航有 `aria-label`，品牌按钮和帮助按钮有标签。
- toast 有 `role="status"` 和 `aria-live="polite"`。
- 弹窗有 `role="dialog"` 和 `aria-modal`。

需要补齐：

1. **modal 焦点管理。** 打开时焦点移到关闭按钮或标题，Tab 在弹窗内循环，关闭后回到触发按钮。
2. **答案组语义。** 选项列表建议使用 `role="radiogroup"` + `aria-labelledby`，或保持按钮但补 `aria-pressed`；排序题的顺序号需要 `aria-label` 说明。
3. **反馈播报。** 正确/错误反馈区加 `role="status"` / `aria-live="polite"`，但不要把整块详解重复播报。
4. **进度条。** 当前 div 进度条没有 `role="progressbar"`、`aria-valuemin/max/now`。
5. **小字号与对比度。** 大量 10–12 px 文本对低视力用户不友好；正文建议 ≥ 14 px，辅助信息 ≥ 12 px，并检查 muted 色对比度。
6. **触控目标。** 至少 44×44 px；图标按钮如关闭、帮助、筛选需要足够命中区。
7. **文件上传。** 视觉隐藏 input 后，`:focus-visible` 应显示在 label 或容器上，确保键盘用户知道焦点位置。
8. **装饰性 emoji。** 纯装饰图标加 `aria-hidden="true"`，有语义的图标提供文本替代。
9. **错误。** 输入错误和导入错误不能只靠颜色；提供文本说明和字段定位。
10. **缩放。** 200% 浏览器缩放和 320 px 宽度下不能出现内容截断或水平滚动。

### 4.4 错误处理与降级

建议统一错误域：

```js
const ErrorCode = {
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  STORAGE_QUOTA: "STORAGE_QUOTA",
  PROGRESS_CORRUPT: "PROGRESS_CORRUPT",
  CONTENT_CORRUPT: "CONTENT_CORRUPT",
  PACK_PARSE: "PACK_PARSE",
  PACK_SCHEMA: "PACK_SCHEMA",
  PACK_CONFLICT: "PACK_CONFLICT",
  PACK_TOO_LARGE: "PACK_TOO_LARGE",
  CONTENT_REFERENCE: "CONTENT_REFERENCE",
  UNKNOWN_QUESTION_MODE: "UNKNOWN_QUESTION_MODE"
}
```

降级策略：

| 故障 | 用户体验 | 数据处理 |
|---|---|---|
| localStorage 读取失败 | 可继续学习，顶栏提示“进度不会保存” | 不覆盖旧数据 |
| localStorage 写入失败 | 明确提示并建议导出备份 | 内存可继续，下次启动可能丢失 |
| 单个自定义包损坏 | 其他内容正常，提示包名 | 隔离该包，不删除 |
| 内置包损坏 | 显示安全模式/错误页 | 阻止渲染错误内容，提示重新获取文件 |
| 进度对象损坏 | 尽量从 v1 或备份恢复 | 保留 corrupt 副本 |
| 导入失败 | 显示错误摘要和字段路径 | 原内容不变 |
| 未知题型 | 包整体拒绝 | 避免渲染成空题 |
| 找不到 topic | 回地图并提示 | 清理局部 UI 状态，不清进度 |

必须移除或修正“导入失败不会改动现有内容”与实现不一致的问题。在补丁落地前，UI 不应做该承诺。

### 4.5 离线约束

当前设计天然适合离线：

- 无外部 CSS/JS/字体/图片/CDN。
- 无 `fetch`、无模块导入、无远程接口。
- 字体使用系统字体回退。
- 内容与逻辑全部在单个 HTML 中。

需要保持的约束：

1. 不引入外部图标库、字体、图片、埋点或 CDN。
2. 不用 `fetch` 读取本地 JSON 作为主内容路径；浏览器直接打开文件时会遇到跨域限制。
3. 内容包导入通过 `<input type=file>` 和 `FileReader`，不依赖服务器。
4. 所有导出通过 Blob 下载。
5. 不依赖 Service Worker；直接打开文件也应可用。
6. 浏览器存储只是缓存，**文件导出才是可迁移备份**。

`file://` 下的重要现实约束：

- 不同浏览器对本地文件页面的 `localStorage` origin 处理不一致。
- 移动 HTML 文件到新路径后，原进度可能读不到。
- 隐私模式、清理站点数据、浏览器策略可能禁用存储。
- 因此必须提供进度备份导出/导入，并在 UI 中明确“建议定期导出”。

### 4.6 内容安全边界

导入内容应视为不可信输入，即使它来自用户自己选择的文件。

必须遵守：

1. 所有插入 HTML 的文本先 `esc()`；不拼接未转义的用户字段。
2. 颜色只接受 `#RGB` / `#RRGGBB`，通过白名单正则后再插入 `style`。
3. ID 只接受字母、数字、点、下划线和连字符，禁止引号、尖括号和空白。
4. 不执行导入内容中的任何函数、HTML、SVG 或脚本。
5. 拒绝 `__proto__`、`prototype`、`constructor` 等危险键作为业务字段。
6. 限制字符串长度、数组长度、嵌套深度和总包大小。
7. 记录所有错误路径，便于定位到 `subjects[0].chapters[2].topics[5]`。
8. 建议增加 CSP meta，至少限制外部网络和远程资源：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none';">
```

需要实际测试 CSP 对 `file://` 和当前内联脚本/样式的兼容性；如果不兼容，优先完成输出转义和白名单，而不是盲目上线严格 CSP。

---

## 5. 测试清单

### 5.1 内容正确性审计

内容正确性不能只靠程序判断，必须有“结构自动审计 + 学科人工审校”两道门。

#### 自动审计

每个内容包发布前必须 100% 通过：

- 三科科目 ID 分别为稳定值，名称与 2026 教材口径一致。
- 章节清单覆盖项目确认的 2026 考试大纲；缺章、重复章、错序章为 error。
- 所有 subject/chapter/topic ID 全局唯一且格式合法。
- 每个 topic 至少 1 题，题目 mode 在支持列表中。
- 所有 choice/journal 答案索引在范围内。
- 所有 number 答案为有限数，tolerance 合法。
- 所有 sort 答案为完整排列。
- 所有 `related` 可解析，且不指向自身。
- 所有分录 side ∈ {借, 贷}，account 非空。
- 可解析金额的借贷合计平衡。
- 题干、解析、关键词、技巧、分录、易错点齐全。
- 同一题目选项不重复；同一关键词不重复。
- 内容包 revision 单调递增，同包 hash 与 revision 一致。
- 内容包大小、数量、文字长度在预算内。

#### 人工审校

建议建立知识点追踪表：

| 字段 | 说明 |
|---|---|
| 科目 | 实务/经济法/财务管理 |
| 教材章节 | 2026 教材章节号 |
| 知识点 ID | 稳定 ID |
| 考点描述 | 本关考什么 |
| 正确答案依据 | 准则/法条/公式出处 |
| 解析复核人 | 第一审校 |
| 交叉复核人 | 第二审校或抽样复核 |
| 风险等级 | 高/中/低 |
| 状态 | 待写/待审/通过/需修订 |

人工审校重点：

- 会计准则口径、税法/经济法表述是否属于 2026 考试范围。
- 计算题单位、时点、税率、折现率、残值、折旧方法是否一致。
- 分录科目、方向、金额是否与题干和答案一致。
- 解析是否只解释正确项，是否指出所有高频干扰项。
- “关键词”是否真能帮助识别考点，而不是复述题干。
- 易混知识点是否正确互链，例如会计与财管的资金时间价值、经济法中的合同与会计收入确认边界。

发布门：

- P0/P1 高风险知识点 100% 双人复核。
- 其余知识点 100% 一审，至少 30% 抽检二审。
- 自动审计 0 error。
- 所有 warning 有明确处置记录。

### 5.2 Schema 与边界测试

| ID | 场景 | 预期 |
|---|---|---|
| S-01 | 空对象导入 | 拒绝，指出缺 `format`/`schemaVersion`/`subjects` |
| S-02 | `subjects: []` | 拒绝 |
| S-03 | 未知 schema 主版本 `99` | 拒绝并提示应用版本过旧 |
| S-04 | subject ID 重复 | 拒绝，指出两个路径 |
| S-05 | chapter ID 重复 | 拒绝 |
| S-06 | topic ID 跨科重复 | 拒绝；防止进度串账 |
| S-07 | ID 含引号/尖括号/空白 | 拒绝 |
| S-08 | choice 无 options | 拒绝 |
| S-09 | choice answer=-1 或超出长度 | 拒绝 |
| S-10 | number answer 为 `"abc"`/NaN/Infinity | 拒绝 |
| S-11 | tolerance 为负数/NaN | 拒绝 |
| S-12 | sort answer 缺项、重复、越界 | 拒绝 |
| S-13 | journal side 非借/贷 | 拒绝 |
| S-14 | journal 选项不足 2 行 | 拒绝 |
| S-15 | related 指向不存在 topic | 拒绝 |
| S-16 | topic 标题为空但其他字段齐全 | 拒绝 |
| S-17 | 超长字符串/超深嵌套/超大包 | 拒绝并提示上限 |
| S-18 | 含 `__proto__` 等危险键 | 拒绝或剥离并 warning |

### 5.3 导入 / 导出 / 冲突测试

| ID | 场景 | 预期 |
|---|---|---|
| I-01 | 合法新包导入 | 预览统计正确；科目、章节、题目出现 |
| I-02 | 同包更高 revision 导入 | 更新对应节点；进度保留 |
| I-03 | 同包同 revision 同 hash | 提示已安装；不重复写存储 |
| I-04 | 同包同 revision 不同 hash | 冲突；不修改内容 |
| I-05 | 不同 packId 复用 topic ID | 冲突；默认保留本地 |
| I-06 | 导入中 localStorage 配额不足 | 内存不变；旧内容仍可玩；提示导出/清理 |
| I-07 | 旧自定义内容键损坏 | 损坏包被隔离，其他包和内置内容可用 |
| I-08 | JSON 末尾多余逗号 | 解析错误；无副作用 |
| I-09 | UTF-8 BOM 文件 | 自动去 BOM 后正常导入 |
| I-10 | 非 UTF-8 文件 | 明确编码错误；无副作用 |
| I-11 | 导入时点击取消/关闭 | 无任何修改 |
| I-12 | 导出后清空自定义内容再导入 | 数据完整还原 |
| I-13 | 导出完整备份后清空浏览器站点数据再导入 | 进度、设置、自定义内容还原 |
| I-14 | 重复导入同一包 10 次 | 存储不线性增长，结果幂等 |
| I-15 | 导入过程中刷新页面 | 不出现半包；启动能识别 pending/正式包 |
| I-16 | FileReader error/abort | 明确错误，UI 不卡 loading |

### 5.4 进度与刷新恢复测试

| ID | 场景 | 预期 |
|---|---|---|
| P-01 | 全新浏览器第一次打开 | 无报错，使用默认进度 |
| P-02 | 首次答对 | 完成标记、XP、totalCorrect、streak 正确 |
| P-03 | 答错后重试答对 | wrongCount 保留，XP 不重复；连击规则符合说明 |
| P-04 | 已完成关卡再次答对 | 不加 XP；复习统计按定义更新 |
| P-05 | 连续快速点击提交 | XP/通关只增加一次 |
| P-06 | 关卡页面刷新 | 回到同一 topic；瞬时答案清空；历史进度保留 |
| P-07 | 答错后立即刷新 | wrongCount 已保存；反馈卡可消失 |
| P-08 | 答对后立即刷新 | completed/XP 已保存；继续按钮可用 |
| P-09 | v1 进度自动迁移 | 通关和错题可读，v1 保留，不重复迁移 |
| P-10 | v2 损坏但 v1 正常 | 从 v1 重建；损坏副本保留 |
| P-11 | localStorage 完全禁用 | 可学习，明确显示“不保存”；不崩溃 |
| P-12 | 内容包更新删除 topic | 旧进度成为孤儿但不影响其他统计；有清理策略 |
| P-13 | 多标签页同时答题 | 最后写入可预测；不出现 XP 明显重复 |
| P-14 | 重置进度 | 只清进度和 lastLocation，不清用户内容包 |

### 5.5 UI、移动端与可访问性测试

| ID | 场景 | 预期 |
|---|---|---|
| U-01 | 320/360/375/390/414/768 px | 无整页横向滚动，主要按钮可见 |
| U-02 | 手机横屏 740×360 | 提交、下一关、关闭按钮可达 |
| U-03 | 200% 缩放 | 文本不截断，弹窗可滚动 |
| U-04 | 键盘 Tab | 所有交互元素可达，焦点顺序合理 |
| U-05 | modal 打开/关闭 | 焦点进入、圈定、关闭后返回触发按钮 |
| U-06 | Esc 关闭 modal | 正常关闭，不误触 backdrop |
| U-07 | 读屏答题 | 选项组、已选状态、正确/错误反馈可感知 |
| U-08 | 排序题读屏 | 能知道每项已选顺序，能取消 |
| U-09 | 减少动态效果 | confetti、滚动、过渡基本关闭 |
| U-10 | 高对比/深色系统设置 | 文本仍清晰；不出现透明层叠导致不可读 |
| U-11 | 无 hover 的触控设备 | 所有信息可点击/可见 |
| U-12 | 搜索输入中文/长英文 | 光标不跳，结果正确，输入不卡顿 |

### 5.6 离线、性能与安全测试

| ID | 场景 | 预期 |
|---|---|---|
| O-01 | 断开网络直接双击打开 | 全流程可用 |
| O-02 | DevTools Network 检查 | 0 个外部请求 |
| O-03 | 把 HTML 移到新路径再打开 | 应用可用；若进度不可见，有备份导入路径 |
| O-04 | 禁用 localStorage | 可学习，UI 明确降级 |
| O-05 | 1000+ topic 假数据 | 启动、地图、搜索、知识库达到预算 |
| O-06 | 300 个搜索结果 | 搜索输入和滚动无明显掉帧 |
| O-07 | 2 MB 合法内容包 | 导入有 loading，校验和提交在预算内 |
| O-08 | 内容包字段含 `<img onerror>` / `<script>` | 仅显示为文本，不执行 |
| O-09 | 颜色字段含 `red;...` 或引号 | 导入拒绝，不进入 style |
| O-10 | 金额/章节号含 `<svg onload>` | 作为文本显示或拒绝，不执行 |
| O-11 | 连续刷新 50 次 | 无重复迁移、无存储膨胀、无内存警告 |
| O-12 | 控制台检查 | 无未捕获异常、无持续警告 |

### 5.7 回归发布门

发布前必须全部满足：

1. 自动内容审计 0 error。
2. 三科均有科目卡、章节地图和可进入关卡。
3. 所有已声明支持的题型至少各有一个真实用例和边界测试。
4. 导入失败、配额失败、损坏包、刷新恢复四类故障均有通过记录。
5. 主流程无未捕获异常。
6. 320 px 和 390 px 真机通过。
7. 断网打开无外部请求。
8. 导出备份能在一份全新浏览器状态中还原。
9. 所有 P0/P1 风险关闭，或由项目经理书面接受。

---

## 6. 当前代码的具体风险、补丁建议和实施顺序

### 6.1 风险清单

| 编号 | 优先级 | 风险 | 证据/位置 | 影响 | 建议 |
|---|---|---|---|---|---|
| R-01 | P0 | 只有实务一科 | `LedgerQuest.html:1605` 起仅一个 `SUBJECTS.push` | 三科验收不通过 | 优先建立三科内容包与生产计划 |
| R-02 | P0 | 导入非事务性 | `mergeContentPack` / `importContentText`，约 `4210–4256` | 失败提示与实际状态不一致，可能半更新 | 候选注册表 + 持久化后提交 |
| R-03 | P0 | 无 schema 校验 | 导入只检查 `subjects` 数组 | 空题、坏答案、未知题型导致页面不可用 | 统一 validator，error 即整包拒绝 |
| R-04 | P0 | ID 不校验全局唯一 | 进度按 `topic.id` 单键存储 | 通关、错题、XP 串账 | 全局唯一约束 + 索引 |
| R-05 | P1 | 颜色值直接拼 style | `subjectTheme` / `chapterTheme`，约 `3378–3384` | CSS/属性注入，页面异常 | 颜色白名单 |
| R-06 | P1 | 个别字段未统一转义 | 例如章节序号和主题值 | 恶意内容包可破坏 DOM | 全模板审计；数据进入 HTML 前统一 `esc` |
| R-07 | P1 | 进度未校验和迁移 | `loadProgress`，约 `3163–3177` | 损坏存储导致 NaN、统计异常 | 进度 v2 + 清洗 + v1 迁移 |
| R-08 | P1 | 存储失败仅 console.warn | `saveProgress`，约 `3179–3185` | 用户以为已保存，实际丢失 | 用户可见降级提示 + 备份导出 |
| R-09 | P1 | 刷新回首页 | 初始化固定 `view.name = "home"` | 长内容学习体验差 | hash 路由 + lastLocation 恢复 |
| R-10 | P1 | 弹窗无焦点管理 | `modalShell`，约 `3949–3960` | 键盘/读屏用户迷失 | 焦点圈定、初始焦点、恢复 |
| R-11 | P1 | 移动端小字号/小触控目标 | 多处 10–12 px、33–39 px 按钮 | 阅读和误触风险 | 目标尺寸与字号规范 |
| R-12 | P2 | 导出包含全部内置内容 | `export-content`，约 `4345–4347` | 文件大、无法区分用户包 | 用户包/完整备份分两种 |
| R-13 | P2 | 自定义内容重复追加 | `saved.push(parsed)` | 存储线性膨胀 | 按 `packId` 覆盖 |
| R-14 | P2 | 搜索整页重建 | `renderLibrary` + input 监听 | 全量内容后卡顿 | debounce + 局部更新 |
| R-15 | P2 | 重复遍历全内容 | `allTopics` / `findTopic` / 统计 | 规模扩大后 O(N) 叠加 | 注册表索引和统计缓存 |
| R-16 | P2 | `setView` 滚动判断无效 | `4090–4093` | 逻辑隐性失效 | 先保存旧 route 再比较 |
| R-17 | P2 | 题型覆盖声称大于实际 | 当前 journal/truefalse 无内容 | 未测路径上线风险 | 每题型至少 1 个样例和边界测试 |
| R-18 | P2 | 无内容审计工具 | 仅靠人工阅读 | 错答案、断引用、重复 ID 难发现 | 独立 validator CLI/浏览器控制台脚本 |
| R-19 | P3 | 导出 URL revoke 仅 1 秒 | `downloadFile`，约 `4259–4267` | 极慢设备可能下载失败 | 延迟释放或 `afterprint`/更长超时 |
| R-20 | P3 | 无 `<noscript>` | body 开头 | 禁用 JS 时白屏 | 增加说明性 noscript |

### 6.2 建议补丁 1：内容 validator 和注册表

**目标：** 在 UI 之前建立可信数据边界。

建议新增纯函数区：

```js
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function validateAndNormalizePack(raw, context) {
  const errors = [];
  const warnings = [];
  const pack = normalizePack(raw);

  // 1. root fields
  // 2. subject/chapter/topic shape
  // 3. IDs global uniqueness
  // 4. mode-specific answer rules
  // 5. related reference rules
  // 6. size/depth/color limits

  return {
    ok: errors.length === 0,
    pack,
    errors,
    warnings
  };
}
```

建议的错误对象带 `path` 和 `code`，便于 UI 和测试断言。

补丁验收：

- 任意坏包不进入 `contentRegistry.subjects`。
- 所有错误可定位到字段路径。
- validator 不依赖 DOM，可在浏览器控制台运行。
- 当前 54 个 topic 在迁移后 0 error。

### 6.3 建议补丁 2：事务导入与版本化存储

把 `mergeContentPack` 改成纯候选构建：

```js
function buildCandidateRegistry(current, incomingPack, strategy) {
  const candidate = cloneRegistry(current);
  const conflicts = [];

  // 只在 candidate 上合并
  // 返回 { candidate, diff, conflicts }
  return { candidate, diff, conflicts };
}

function importContentPack(text, options) {
  const parsed = parsePack(text);
  const validated = validateAndNormalizePack(parsed);
  if (!validated.ok) throw new ContentError(validated.errors);

  const plan = buildCandidateRegistry(
    contentRegistry,
    validated.pack,
    options.conflictStrategy
  );
  if (plan.conflicts.length && !options.resolveConflicts) {
    return { needsConfirmation: true, plan };
  }

  persistPackTransaction(validated.pack); // 失败则直接抛出，内存不变
  commitCandidate(plan.candidate);         // 持久化成功后才替换内存
  render();
}
```

补丁验收：

- 在开发者工具中让 `localStorage.setItem` 抛错，内存内容与 UI 均保持原状。
- 重复导入同一包 10 次，内容不重复、索引不膨胀。
- 导入失败后退出弹窗，原有内容仍可继续答题。

### 6.4 建议补丁 3：修复可信渲染边界

优先处理：

1. `subjectTheme()` / `chapterTheme()` 只接受 `COLOR_RE`。
2. 所有插入模板的字符串统一经 `esc()`，包括 `chapter.no`、`progress.xp` 等当前看似“应该安全”的字段。
3. 数字在进入渲染前用 `Number.isFinite` 清洗；不要只依赖 `Number(...)`。
4. 对金额、科目、选项使用文本渲染，不把内容当 HTML。
5. 如果未来需要富文本，使用受限子集或显式 sanitizer；当前不需要 Markdown/HTML 内容。

示例：

```js
function safeColor(value, fallback) {
  return COLOR_RE.test(String(value || "")) ? value : fallback;
}

function subjectTheme(subject) {
  const accent = safeColor(subject.accent, "#bfe9cf");
  const soft = safeColor(subject.accentSoft, "#edf8ee");
  return `--accent:${accent};--accent-soft:${soft};--subject-color:${accent};`;
}
```

补丁验收：

- 导入 `accent: "red\" onmouseover=\"..."` 被拒绝或回退。
- 导入 `<img src=x onerror=...>` 作为标题只显示文本。
- DevTools 中看不到内容注入产生的额外属性或事件。

### 6.5 建议补丁 4：进度 v2、迁移与备份

新增：

```js
const PROGRESS_KEY_V2 = "ledgerquest.progress.v2";
const PROGRESS_KEY_V1 = "ledgerquest.progress.v1";

function migrateProgressV1ToV2(v1) {}
function normalizeProgressV2(saved) {}
function loadProgressV2() {}
function saveProgressV2() {}
function exportBackup() {}
function importBackup(text) {}
```

补丁验收：

- v1 自动迁移。
- 输入 `xp: "abc"`、`completed: []` 等坏字段时清洗为合法默认值。
- v2 损坏时保留 corrupt 副本，并尝试 v1。
- 进度导出后可在全新浏览器状态恢复。

### 6.6 建议补丁 5：hash 路由、刷新恢复和焦点

新增：

```js
function parseHashRoute(hash) {}
function writeHashRoute(route) {}
function restoreRouteFromHash() {}
function focusModal() {}
function restoreFocusAfterModal() {}
```

需要修正 `setView`：

```js
function setView(next) {
  const previousName = view.name;
  view = Object.assign({}, view, next);
  if (next.name && next.name !== previousName) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
```

补丁验收：

- 关卡 URL 可直接分享并在打开时恢复。
- 刷新回到原 topic。
- modal 打开/关闭焦点不丢失。
- Esc 和 backdrop 行为不冲突。

### 6.7 建议补丁 6：性能与搜索

在内容提交时一次性建索引：

```js
function buildContentIndex(subjects) {
  const topicById = new Map();
  const chapterById = new Map();
  const subjectById = new Map();
  // 填入并缓存统计
  return { topicById, chapterById, subjectById, orderedTopics, stats };
}
```

搜索输入：

```js
const onSearchInput = debounce((value) => {
  view.search = value;
  renderLibraryResultsOnly();
}, 120);
```

补丁验收：

- 1000 topic 下搜索不重建顶栏。
- 输入法组合输入（`compositionstart/end`）期间不打断。
- 搜索中文、英文、关键词、题干均可命中。

### 6.8 建议补丁 7：内容生产工具

新增独立内容源和建议脚本（不进入运行时依赖）：

```text
content/
  manifest.json
  official-practice-2026.json
  official-law-2026.json
  official-finance-2026.json
tools/
  validate-content.mjs
  build-single-file.mjs
  audit-report.mjs
docs/
  technical-plan.md
  content-style-guide.md
```

工具职责：

- 校验 schema、ID、答案、引用、分录平衡。
- 输出按科目/章节/topic 的覆盖率报告。
- 生成三科包和发布版 HTML。
- 不把工具依赖带入最终 HTML。

如果项目坚持零构建流程，至少要把 validator 内嵌为可调用函数，并在发布前用浏览器控制台或临时脚本执行一次；不能只靠人工目测。

### 6.9 建议实施顺序

#### 阶段 0：冻结基线

产出：

- 三科 2026 章节清单。
- v2 schema 和 ID 命名规范。
- 内容写作模板：题干、关键词、人话翻译、解析、易错点、分录、例题。
- 明确 3 个科目的 `subject.id`、章节 `order`、题型范围。

验收：内容作者可以在不改 UI 代码的情况下新增一个完整章节。

#### 阶段 1：数据边界先落地

顺序：

1. validator + normalizer。
2. 候选注册表 + 索引。
3. 事务导入。
4. 用户包/完整备份两种导出。

原因：先阻止坏数据进入系统，再做内容扩容，避免在错误基础上批量导入。

#### 阶段 2：进度与恢复

1. 进度 v2。
2. v1 迁移和清洗。
3. 存储失败可见降级。
4. hash 路由和刷新恢复。

验收：刷新、坏存储、移动文件、换设备都有明确路径。

#### 阶段 3：可信渲染与移动/无障碍

1. 颜色白名单和全模板转义。
2. modal 焦点管理。
3. 反馈播报、progressbar、答案组语义。
4. 字号、触控目标、安全区和横屏。

#### 阶段 4：内容生产与审计

这是项目最大工作量，应与阶段 1–3 并行：

- 实务补齐现有 25 章的缺题、缺详解和分录。
- 经济法、财务管理建立完整科目包。
- 每科按 2026 章节清单逐项对照。
- 高风险题双人复核，分录逐笔核对。

#### 阶段 5：规模与发布验收

1. 1000+ topic 压测。
2. 2 MB 内容包导入压测。
3. 320/390 px 真机。
4. 断网和移动文件测试。
5. 自动审计、导出恢复、全流程回归。

### 6.10 最小可行补丁集

如果下一轮只能做一组改动，建议按以下最小集合：

1. **校验器 + 整包拒绝**，避免坏内容进入渲染。
2. **事务导入 + 按 packId 存储**，修复“提示失败但已改动”的问题。
3. **颜色白名单 + 所有模板字段转义**，关掉注入面。
4. **进度 v2 读取清洗 + v1 迁移**，避免坏存储导致统计异常。
5. **进度/内容备份导出**，解决 `file://` 存储不可迁移的核心风险。

完成这 5 项后再做批量内容导入和视觉扩展，风险最低。

---

## 7. 待确认的技术约束

以下项会直接影响 schema 和验收，建议项目经理在后续补充：

1. 2026 三科章节清单以哪一版教材/大纲为准，是否有官方章节对照表。
2. 三科目标 topic 总量范围（例如 300 / 800 / 1500），决定性能和存储策略。
3. 用户内容包最大允许体积，是否允许导入第三方题库。
4. 是否要求跨设备同步；如果不要求，备份文件即可。
5. 支持浏览器范围，尤其是 iOS Safari、Android Chrome、桌面 Edge/Chrome。
6. 经济法与财务管理是否复用当前题型，还是需要多选、连线、法条匹配等新交互。
7. 已通关关卡的重做是否计入连击、正确率和错题统计。
8. 是否需要“错题本单独刷题”和“章节随机组卷”，这会改变进度和题目索引结构。
9. 内容错误的上线责任人和复核流程。
10. 最终单文件体积上限和是否允许发布时压缩。

---

## 8. 架构验收结论

当前框架方向正确：单文件、零外部依赖、数据驱动、事件委托和响应式布局已经具备继续扩展的基础。真正阻碍交付的不是 HTML/CSS 框架，而是：

1. 三科内容尚未落地；
2. 内容导入没有可信边界和事务保证；
3. 进度与存储缺少版本化、恢复和备份；
4. 全量内容下的渲染、移动端和可访问性尚未验证。

建议先完成 v2 schema、validator、事务导入和进度迁移，再批量导入三科内容，最后做规模压测与无障碍验收。这样可以在不推倒现有 UI 的前提下，把当前单文件原型升级为可交付的离线学习应用。
