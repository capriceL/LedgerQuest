# LedgerQuest

网页版中级会计知识闯关游戏。单文件、离线可运行，使用原生 HTML/CSS/JavaScript，无外部脚本、字体、图片或 CDN 依赖。

## 快速开始

直接打开根目录的 `LedgerQuest.html`，无需安装依赖或启动服务器。

在线入口：

- GitHub Pages：`https://capricel.github.io/LedgerQuest/`
- 在线页面与离线主文件来自同一内容母版。

## 仓库结构

```text
/
├─ LedgerQuest.html              主交付文件
├─ CHANGELOG.md                  版本更新记录
├─ VERSION                       当前版本号
├─ requirements.txt              Python 工具依赖
├─ docs/                         技术、交互、同步与架构说明
├─ tools/                        构建、审计与回归脚本
├─ work/                         产品运行和构建所需数据
├─ history/snapshots/            历史版本 HTML 快照
└─ releases/                     发布副本、完整压缩包与校验值
```

## 开发与校验

核心 Node 脚本不依赖 npm 包：

```powershell
node tools\check-html.mjs LedgerQuest.html
node tools\smoke-runtime.mjs LedgerQuest.html
node tools\test-engine.mjs LedgerQuest.html
node tools\test-sync.mjs LedgerQuest.html
```

Python 审计工具需要安装依赖：

```powershell
python -m pip install -r requirements.txt
python tools\audit-learning-quality.py
```

真实浏览器回归脚本 `tools\edge-smoke.mjs` 需要本机安装 Microsoft Edge。

## 数据说明

`work/` 只包含产品运行、构建和审计所需的 JSON 数据，包括概念卡、剧情关卡、术语、教学字段和官方大纲映射。仓库不包含任何外部资料、用户材料或来源归档。

## 版本与发布

- 当前版本：`0.6.2`
- 版本记录：`CHANGELOG.md`
- 历史版本：`history/snapshots/`
- 完整分享包：`releases/LedgerQuest-v0.6.2.zip`
- 发布文件校验：`releases/SHA256SUMS.txt`

## v0.6.2 重点

- 关卡知识卡默认展开，先看知识再作答。
- 分录说明“什么时候用”，本题专属分录优先，整章通用分录折叠。
- 每章剧情结束生成章节总结与三步综合会签，答错可重试。
- 单文件保持零外部依赖；离线、在线和完整仓库包同源发布。

## 边界

- 自动化和内容审计不能替代教材逐字核对、最新法规核验或外部专业审校。
- 学习进度默认保存在当前浏览器的 `localStorage`，不提供实时云端同步。
- 跨设备迁移使用学习档案中的同步码或 JSON 备份手动合并。

## 版权

本项目未授予开源许可证。代码和原创产品内容的权利归项目作者所有；第三方教材、法规和商标权利归各自权利人所有。
