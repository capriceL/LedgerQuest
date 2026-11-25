# LedgerQuest v0.7.0 发布说明

> 发布日期：2026-11-25  
> 主题：知识先行、母题迁移、变式巩固  
> 正式文件名：`LedgerQuest.html`（版本号只在界面内）

## 1. 本版完成内容

反馈 4 提出的核心问题是“应该教怎么做题”，而不是继续增加阅读文字。本版把每张知识卡改成完整的学习闭环：

```text
先懂知识 → 柚柚示范拆母题 → 独立做母题 → 双解析 → 换条件做变式 → 通关复盘
```

### 知识层

- 人话解释、关键词、题目要你做什么、取数/判断口径。
- 柚柚示范步骤。
- 本题专属分录或判断口径。
- 数字例子与易错边界。

### 母题层

- 1,049 张卡各一道母题。
- 课程练习 387、课程例题 19、剧情题 93、知识点派生 550。
- 支持单选、多选、判断。
- 多选可撤选，少选会明确提示漏选。

### 解析层

- 答对同时显示“为什么成立”“怎么下手”。
- 完整解析折叠，不挤占首屏。
- 答错只提示本题易错方向，可无限重试。

### 迁移层

- 1,049 张卡各一道本卡变式。
- 变式不借用同章其他卡规则。
- 母题与变式不能只是选项换序。
- 变式通过后记录知识卡通关。

## 2. 内容规模

| 项目 | 数量 |
| --- | ---: |
| 知识卡 | 1,049 |
| 母题 | 1,049 |
| 变式 | 1,049 |
| 母题 + 变式 | 2,098 |
| 单选 | 1,879 |
| 多选 | 127 |
| 判断 | 92 |
| 课程原子 | 1,257 |
| 剧情章节 / 节点 | 42 / 108 |
| 知识章节 | 45 |
| 官方大纲 | 449/449 |
| 经济法扩展 | 283/283 |
| 实务与财管扩展 | 987/987 |

知识覆盖分母与 v0.6.2 相同；本版改变的是知识卡的练习方式，不删减课程、大纲或概念内容。

## 3. 封存与校验

主文件：

- 路径：仓库根目录 `LedgerQuest.html`
- 界面版本：`v0.7.0`
- 大小：9,938,944 bytes
- SHA256：`8D54F0141FC1FADA8488CD46E07E25D2AC422FCD0435516A5CB636F49472B814`
- 外部依赖：0

四份同哈希副本：

- `LedgerQuest.html`
- `releases\LedgerQuest.html`
- `work\release-history\LedgerQuest-snapshot-16.html`
- `work\standalone-check\LedgerQuest.html`

## 4. 验证结果

### 静态与运行时

- `check-html.mjs`：语法通过，外部依赖 0。
- `smoke-runtime.mjs`：1,049 卡 / 2,098 题，`validation.ok=true`。
- `test-engine.mjs`：42 章 / 108 节点，`failures=[]`。
- `test-sync.mjs`：`failures=[]`。

### 内容与教学

- `audit-concepts.mjs`：1,049 卡，0 error / 0 warning。
- `audit-teaching.mjs`：1,049 卡，0 error / 0 warning。
- `audit-challenges.mjs`：2,098 题，`problems=[]`。
- `audit-exam-mothers.mjs`：1,049 张母题卡，`issues=[]`。
- `audit-formulas-v3.mjs`：98 项，0 error。
- `audit-copy-integrity.mjs`：`ok=true`。
- `audit-english.mjs`：`likelyBare=[]`。

### 课程与覆盖

- `audit-learning-quality.py`：三科 0 error / 0 warning。
- `audit-atom-note-alignment.py`：1,257 原子，missing 0 / low 0 / duplicateGroups 0。
- 三科 `validate-course-content-v2.py`：missingCoverage 0，problems 为空。
- visible-note、diversity、rigor、law-note、semantics 门禁均 0 issue。
- 官方大纲 449/449；经济法扩展 283/283；实务与财管扩展 987/987。

### 真实浏览器

- Edge 390px / 1440px：`failures=[]`。
- 1,049/1,049 张卡示范步骤不少于两步。
- 知识页不提前显示选项。
- 单选、多选、判断三条路径均通过。
- 多选撤选、少选提示、选齐后双解析通过。
- 通关复盘和知识卡通关记录通过。

## 5. 发布与分发

- 离线主文件仍是唯一内容母版。
- 在线 H5 从同一母版派生，不单独维护正文。
- GitHub Pages：`https://capricel.github.io/LedgerQuest/`
- GitHub Release：`https://github.com/capriceL/LedgerQuest/releases/tag/v0.7.0`
- 公开脱敏 HTML：9,903,848 bytes，SHA256 `E6DAAD6B9475F10FED7E32877E969DB20971531570B4AD36F14D9F94950A2194`
- GitHub Pages、GitHub Release 与离线包共用同一版本；完整仓库 ZIP 与校验值随 Release 资产发布。
- 第三方在线平台上传播上传包，正式分享链接需平台账号发布；未生成前不得写成已上线。

## 6. 学习记录边界

- 学习进度默认保存在当前浏览器 `localStorage`。
- 离线文件、GitHub Pages 和豆包 / 妙搭属于不同浏览器来源，记录不会自动互通。
- 跨设备使用“学习档案 → 记录同步”的同步码或 JSON 备份合并。
- 在线打开、账号登录均不等同于自动云同步。

## 7. 专业边界

- 自动审计、课程资料对齐和浏览器回归通过，不代表出版社教材逐字审定、最新法规结论或外部专业教师签字。
- 正式备考仍应以 2026 官方教材、考试大纲和最新法规为准。
