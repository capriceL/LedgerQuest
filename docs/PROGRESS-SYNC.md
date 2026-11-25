# 学习记录同步

> 当前版本：`v0.7.0`  
> 能力范围：单文件离线版内的手动跨设备迁移  
> 不包含：云账号、服务器实时同步、多人同步

## 1. 为什么需要手动搬运

当前交付是一个本地 HTML 文件，学习进度保存在各设备浏览器的 `localStorage`。不同设备之间没有共享存储，因此离线单文件不能自行把记录推送到另一台设备。

当前采用两条迁移路径：

1. **同步码**：适合发微信、备忘录或聊天窗口，复制后在新设备粘贴。
2. **JSON 备份文件**：适合放网盘、U 盘或作为长期备份。

## 2. 同步码格式

```text
LQ1Z.<8位校验码>.<base64url内容>
LQ1U.<8位校验码>.<base64url内容>
```

- `LQ1Z`：支持 `CompressionStream` 时使用 gzip 压缩。
- `LQ1U`：浏览器不支持压缩时的兼容格式。
- 校验码：对编码内容计算 FNV-1a 32 位摘要，用于发现截断、乱码或复制不完整。
- 导入前会移除同步码中的空白和换行，降低聊天软件自动换行造成的失败率。

载荷结构：

```json
{
  "app": "LedgerQuest",
  "type": "progress-sync",
  "schema": 1,
  "appVersion": "v0.7.0",
  "exportedAt": "ISO 时间",
  "progress": {}
}
```

## 3. 合并规则

- 剧情通关：按 topic id 取并集。
- 概念卡通关：按 concept id 取并集。
- 同一关卡：按 `clean > self_corrected > assisted > guided` 保留更高质量记录。
- 踩坑次数：按 topic id 取较大观察值，避免重复导入导致计数翻倍。
- 靠谱值：取本机、导入和并集重算值中的最大值，不因导入降低。
- 最高连击：取最大值。
- 当前连击：保留本机值，不把另一台设备的连击状态硬套到本机。
- 最近关卡：优先保留本机继续位置；本机没有时使用导入值。
- 重复导入：幂等，不增加通关数、XP 或踩坑计数。

## 4. 失败处理

以下情况在解析阶段直接拒绝，不写入本机进度：

- 空内容或无法识别的前缀。
- 校验码不一致。
- gzip 解压失败或展开后异常过大。
- JSON 无法解析。
- `app` / `type` / `schema` 不匹配。
- `progress` 不是对象。

## 5. 玩家入口

路径：`学习档案 → 记录同步`。

可用操作：

- 生成同步码。
- 复制同步码。
- 下载 JSON 备份。
- 粘贴同步码并合并。
- 从备份文件恢复。
- 合并成功后查看新增剧情关卡、概念卡和踩坑知识点数量。

## 6. 扩展接口

`window.LedgerQuestSync` 暴露：

- `getProgress()`
- `createPayload()`
- `encode()`
- `decode(text)`
- `merge(left, right)`
- `apply(text)`

后续若增加云端传输层，应复用 `merge()` 和 `apply()`，不要另写一套合并逻辑。

## 7. 验收

```powershell
node tools\test-sync.mjs LedgerQuest.html
node tools\edge-smoke.mjs
```

当前证据：

- 最终同步测试：压缩同步码约 450–465 字符，原始码 828 字符，批量码约 5,030 字符，JSON 备份 46,556 字符。
- 双端合并、空导入、重复导入、压缩/未压缩往返、备份 JSON、损坏同步码拒绝均通过。
- Edge 390px 完成真实生成与导入；本机独有记录和远端记录同时保留。
- 封存主文件：4,188,745 bytes；SHA256 `C69B3C70A837B3385EA64FAA24B28C736CF5DB31D4E6B0B2802DA124BD4D4C97`。
- 主文件、`releases/LedgerQuest.html`、`work/standalone-check/LedgerQuest.html`、`work/release-history/LedgerQuest-snapshot-15.html` 哈希一致。

## 8. 多设备方案边界

当前交付把“跨设备同步”分成两层：

1. **离线手动同步（已交付）**：同步码或 JSON 备份文件由用户搬运一次，另一台设备导入后与本机进度合并。它不依赖网络、账号或服务器，符合单文件离线交付约束。
2. **云端自动同步（未纳入当前单文件）**：如果要求“打开就自动同步、无需复制粘贴”，必须有共享存储和身份/同步标识。可选实现包括 Cloudflare Workers + KV、Supabase、Firebase，或自建小型服务；这会引入网络请求、部署、账号或服务可用性问题，不能再称为完全离线单文件。

浏览器自带的账号同步不会同步本游戏的 `localStorage`，所以不能把“登录浏览器账号”当作跨设备同步方案。

后续接云端时应复用 `window.LedgerQuestSync` 的 `merge()` 与 `apply()`，只替换传输层；同时保留当前同步码/备份作为离线兜底。

