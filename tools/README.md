# 工具说明

核心脚本只依赖 Node.js；Python 审计脚本只使用标准库。

## 嵌入产品数据

```powershell
node tools\embed-content.mjs
node tools\embed-concepts.mjs
```

两条命令分别把剧情内容与知识库数据重新嵌入 `LedgerQuest.html`。

## 核心校验

```powershell
node tools\check-html.mjs LedgerQuest.html
node tools\smoke-runtime.mjs LedgerQuest.html
node tools\test-engine.mjs LedgerQuest.html
node tools\test-sync.mjs LedgerQuest.html
```

内容审计：

```powershell
node tools\audit-concepts.mjs
node tools\audit-challenges.mjs
node tools\audit-teaching.mjs LedgerQuest.html
node tools\audit-formulas-v3.mjs
node tools\audit-copy-integrity.mjs
node tools\audit-english.mjs
python tools\audit-learning-quality.py
```

真实浏览器回归脚本 `edge-smoke.mjs` 需要本机安装 Microsoft Edge。
