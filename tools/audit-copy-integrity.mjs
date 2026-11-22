import { existsSync, readFileSync, writeFileSync } from "node:fs";

const files = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json",
  "work/concept-teaching-v1.json",
  "work/content-practice-v1.json",
  "work/content-law-manual-v1.json",
  "work/content-finance-v1.json"
];

const nestedHanAnnotation = /([\p{Script=Han}]{2,30})（\1（/gu;
const nestedAsciiAnnotation = /([A-Za-z][A-Za-z0-9&+./'’/-]{1,30})（\1（/gu;
const tripleOpen = /（（（/g;
const tripleClose = /）））/g;
const clauseBeforePeriod = /[；，、：]\s*。/g;
const repeatedPunctuation = /[。，、；：]{2,}/g;
const knownCopyDefects = [
  ["关键不就是", "疑似“关键不是指标……”错字"],
  ["不即", "疑似“不仅/不及”等错字"],
  ["即然", "应为“既然”"],
  ["帐户", "会计规范用字应为“账户”"],
  ["帐面", "会计规范用字应为“账面”"],
  ["坏帐", "会计规范用字应为“坏账”"],
  ["摊消", "应为“摊销”"]
];

const findings = [];
const seen = new Set();

function addFinding(file, path, code, text, sample) {
  const key = `${file}\u0000${path}\u0000${code}\u0000${sample}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ file, path, code, text, sample });
}

function inspect(file, path, value) {
  if (typeof value === "string") {
    for (const pattern of [
      nestedHanAnnotation,
      nestedAsciiAnnotation,
      tripleOpen,
      tripleClose,
      clauseBeforePeriod,
      repeatedPunctuation
    ]) {
      pattern.lastIndex = 0;
      const match = pattern.exec(value);
      if (!match) continue;
      const start = Math.max(0, match.index - 36);
      const end = Math.min(value.length, match.index + match[0].length + 36);
      const code = pattern === clauseBeforePeriod
        ? "clause_before_period"
        : pattern === repeatedPunctuation
          ? "repeated_punctuation"
          : "nested_duplicate_annotation";
      addFinding(file, path, code, value, value.slice(start, end));
    }
    for (const [phrase, message] of knownCopyDefects) {
      if (!value.includes(phrase)) continue;
      const index = value.indexOf(phrase);
      const start = Math.max(0, index - 36);
      const end = Math.min(value.length, index + phrase.length + 36);
      addFinding(file, path, "known_copy_defect", value, `${message}：${value.slice(start, end)}`);
    }
    if ((value.match(/（/g) || []).length !== (value.match(/）/g) || []).length) {
      addFinding(file, path, "unbalanced_cn_parentheses", value, value.slice(0, 140));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(file, `${path}[${index}]`, item));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    inspect(file, path ? `${path}.${key}` : key, item);
  }
}

for (const file of files) {
  if (!existsSync(file)) continue;
  inspect(file, "", JSON.parse(readFileSync(file, "utf8")));
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: findings.length === 0,
  files: files.filter((file) => existsSync(file)),
  findings
};
writeFileSync("work/copy-integrity-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: report.ok,
  files: report.files.length,
  findings: findings.slice(0, 80)
}, null, 2));
if (!report.ok) process.exitCode = 1;
