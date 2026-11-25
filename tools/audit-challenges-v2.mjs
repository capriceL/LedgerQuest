import { readFileSync, writeFileSync } from "node:fs";

const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const concepts = conceptFiles.flatMap((file) => {
  const parsed = readJSON(file);
  return Array.isArray(parsed) ? parsed : parsed.concepts || [];
});
const cards = readJSON("work/exam-mothers-v1.json").cards || {};
const problems = [];
const stats = {
  concepts: concepts.length,
  cards: Object.keys(cards).length,
  questions: 0,
  byType: {},
  bySource: { mother: {}, variant: {} },
  withEntry: 0
};
const count = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[\s（）()【】\[\]、，,。；;：:|·—\-+/“”"'*]/g, "");
const allClaims = [];
for (const concept of concepts) {
  for (const field of ["formula", "plain", "howTo"]) {
    const claim = normalize(concept[field]);
    if (claim.length >= 16) allClaims.push({ conceptId: concept.id, claim });
  }
}

function auditQuestion(concept, question, slot) {
  const label = `${concept.id} ${slot}`;
  if (!question || typeof question !== "object") {
    problems.push(`${label} 缺失`);
    return;
  }
  stats.questions += 1;
  count(stats.byType, question.type || "(empty)");
  count(stats.bySource[slot], question.sourceKind || "(empty)");
  const options = Array.isArray(question.options) ? question.options.map(String) : [];
  const answers = Array.isArray(question.answer) ? question.answer : [];
  if (!String(question.stem || "").trim()) problems.push(`${label} 缺少题干`);
  if (new Set(options).size !== options.length) problems.push(`${label} 选项重复`);
  if (options.some((option) => !option.trim())) problems.push(`${label} 存在空选项`);
  if (question.type === "judge" && options.length !== 2) problems.push(`${label} 判断题选项数错误`);
  if (question.type !== "judge" && options.length !== 4) problems.push(`${label} 选择题选项数错误`);
  if (!["single", "multi", "judge"].includes(question.type)) problems.push(`${label} 题型非法`);
  if (!answers.length || answers.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) {
    problems.push(`${label} 答案索引非法`);
  }
  if (question.type === "single" && answers.length !== 1) problems.push(`${label} 单选答案不唯一`);
  if (question.type === "multi" && answers.length < 2) problems.push(`${label} 多选答案少于两个`);
  for (const field of ["why", "how", "goal", "trap"]) {
    if (!String(question[field] || "").trim()) problems.push(`${label} 缺少 ${field}`);
  }
  const explanation = String(question.explanation || "");
  if (!explanation.includes("为什么")) problems.push(`${label} 解析缺少“为什么”`);
  if (!["怎么做", "拿什么", "判断口径", "计算口径"].some((word) => explanation.includes(word))) {
    problems.push(`${label} 解析缺少“怎么做/拿什么”`);
  }
  const feedback = Array.isArray(question.optionFeedback) ? question.optionFeedback : [];
  if (feedback.length !== options.length) problems.push(`${label} 选项反馈数量不一致`);
  const correctFeedback = feedback
    .map((item, index) => item?.tag === "正确" ? index : -1)
    .filter((index) => index >= 0);
  if (correctFeedback.join(",") !== [...new Set(answers)].sort((a, b) => a - b).join(",")) {
    problems.push(`${label} 正确反馈与答案不一致`);
  }
  if (String(question.sourceKind || "").startsWith("derived")) {
    for (const [index, option] of options.entries()) {
      if (answers.includes(index)) continue;
      const claim = normalize(option);
      if (claim.length < 16) continue;
      const foreign = allClaims.find((item) => item.conceptId !== concept.id && item.claim === claim);
      if (foreign) problems.push(`${label} 干扰项是 ${foreign.conceptId} 的正确规则`);
    }
  }
}

for (const concept of concepts) {
  const card = cards[concept.id];
  if (!card) {
    problems.push(`${concept.id} 缺少母题卡`);
    continue;
  }
  if (!card.knowledge?.what || !card.knowledge?.why) problems.push(`${concept.id} 知识层不完整`);
  const mother = card.mother || {};
  const variant = card.variant || {};
  auditQuestion(concept, mother, "mother");
  auditQuestion(concept, variant, "variant");
  if (normalize(mother.stem) === normalize(variant.stem)) problems.push(`${concept.id} 母题与变式题干相同`);
  if (mother.id && mother.id === variant.id) problems.push(`${concept.id} 母题与变式题目 ID 相同`);
  const motherSet = new Set((mother.options || []).map(normalize));
  const variantSet = new Set((variant.options || []).map(normalize));
  if (motherSet.size === variantSet.size && [...motherSet].every((value) => variantSet.has(value))) {
    problems.push(`${concept.id} 母题与变式只是换选项顺序`);
  }
  if (Array.isArray(card.knowledge?.entry) && card.knowledge.entry.length) stats.withEntry += 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: problems.length === 0,
  stats,
  problems
};
writeFileSync("work/challenge-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
