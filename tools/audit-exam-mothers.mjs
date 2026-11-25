import { existsSync, readFileSync, writeFileSync } from "node:fs";

const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const mothersFile = "work/exam-mothers-v1.json";
const reportFile = "work/exam-mothers-audit.json";

const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const concepts = conceptFiles.flatMap((file) => {
  const parsed = readJSON(file);
  return Array.isArray(parsed) ? parsed : parsed.concepts || [];
});
if (!existsSync(mothersFile)) throw new Error(`缺少母题库：${mothersFile}`);
const payload = readJSON(mothersFile);
const cards = payload.cards && typeof payload.cards === "object" ? payload.cards : {};
const byId = new Map(concepts.map((concept) => [concept.id, concept]));
const normalizeText = (value) => String(value || "")
  .toLowerCase()
  .replace(/[\s（）()【】\[\]、，,。；;：:|·—\-+/“”"'*]/g, "");
const ruleCorpus = new Map();
for (const concept of concepts) {
  const claims = [concept.formula, concept.plain, concept.howTo]
    .map(normalizeText)
    .filter((value) => value.length >= 16);
  ruleCorpus.set(concept.id, claims);
}
const allRuleClaims = [];
for (const [conceptId, claims] of ruleCorpus) {
  for (const claim of claims) allRuleClaims.push({ conceptId, claim });
}

const issues = [];
const warnings = [];
const sourceKinds = new Set([
  "course-exercise",
  "course-example",
  "story-question",
  "derived",
  "derived-boundary",
  "derived-fallback",
  "derived-guaranteed"
]);
const metaPatterns = [
  /题干里最该/,
  /把这段人话/,
  /卷角/,
  /最容易设置的错误说法/,
  /下面哪一句.*贴在/,
  /看到《/
];
const corruptPatterns = [
  /参考答案/,
  /【答案】/,
  /【解析】/,
  /本题答案/,
  /答案：/
];

const stats = {
  cards: Object.keys(cards).length,
  concepts: concepts.length,
  bySubject: {},
  bySource: { mother: {}, variant: {} },
  types: { mother: {}, variant: {} },
  optionCounts: {},
  withEntry: 0,
  withDetailedKnowledge: 0
};

function addCount(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}

function auditQuestion(conceptId, label, question, slot) {
  if (!question || typeof question !== "object") {
    issues.push(`${conceptId} ${slot} 缺失`);
    return;
  }
  const stem = String(question.stem || "").trim();
  if (stem.length < 8) issues.push(`${conceptId} ${slot} 题干过短`);
  if (metaPatterns.some((pattern) => pattern.test(stem))) {
    issues.push(`${conceptId} ${slot} 仍是关键词/猜卡名题型`);
  }
  const options = Array.isArray(question.options)
    ? question.options.map((item) => String(item || "").trim())
    : [];
  if (options.length < 2) issues.push(`${conceptId} ${slot} 选项少于 2 个`);
  if (new Set(options).size !== options.length) {
    issues.push(`${conceptId} ${slot} 存在重复选项`);
  }
  if (options.some((option) => !option)) issues.push(`${conceptId} ${slot} 存在空选项`);
  if (options.some((option) => corruptPatterns.some((pattern) => pattern.test(option)))) {
    issues.push(`${conceptId} ${slot} 选项混入答案/解析`);
  }
  const type = question.type;
  if (!["single", "multi", "judge"].includes(type)) {
    issues.push(`${conceptId} ${slot} 题型非法：${type}`);
  } else if (type === "judge" && options.length !== 2) {
    issues.push(`${conceptId} ${slot} 判断题不是 2 个选项`);
  } else if (type !== "judge" && options.length !== 4) {
    issues.push(`${conceptId} ${slot} 选择题不是 4 个选项：${options.length}`);
  }
  const answer = Array.isArray(question.answer) ? [...new Set(question.answer)] : [];
  if (!answer.length) issues.push(`${conceptId} ${slot} 没有答案`);
  if (answer.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) {
    issues.push(`${conceptId} ${slot} 答案索引越界`);
  }
  if (type === "single" && answer.length !== 1) {
    issues.push(`${conceptId} ${slot} 单选题答案不唯一`);
  }
  if (type === "multi" && answer.length < 2) {
    issues.push(`${conceptId} ${slot} 多选题只有一个答案`);
  }
  if (type === "judge" && answer.length !== 1) {
    issues.push(`${conceptId} ${slot} 判断题答案不唯一`);
  }
  const explanation = String(question.explanation || "").trim();
  if (!explanation.includes("为什么")) issues.push(`${conceptId} ${slot} 解析缺少“为什么”`);
  if (!["怎么做", "拿什么", "判断口径", "计算口径"].some((word) => explanation.includes(word))) {
    issues.push(`${conceptId} ${slot} 解析缺少“怎么做/拿什么”`);
  }
  for (const field of ["why", "how", "trap", "goal"]) {
    if (!String(question[field] || "").trim()) {
      issues.push(`${conceptId} ${slot} 缺少 ${field}`);
    }
  }
  const feedback = Array.isArray(question.optionFeedback) ? question.optionFeedback : [];
  if (feedback.length !== options.length) {
    issues.push(`${conceptId} ${slot} 选项反馈数量不匹配`);
  }
  const correctFeedback = feedback
    .map((item, index) => item?.tag === "正确" ? index : -1)
    .filter((index) => index >= 0);
  if (correctFeedback.join(",") !== answer.join(",")) {
    issues.push(`${conceptId} ${slot} 正确反馈与答案索引不一致`);
  }
  if (feedback.some((item) => String(item?.tag || "").includes("相邻考点"))) {
    issues.push(`${conceptId} ${slot} 仍借用了其他考点的正确规则`);
  }
  const sourceKind = question.sourceKind;
  if (!sourceKinds.has(sourceKind)) {
    issues.push(`${conceptId} ${slot} 题源标识非法：${sourceKind}`);
  }
  if (String(sourceKind || "").startsWith("derived")) {
    for (const [index, option] of options.entries()) {
      if (answer.includes(index)) continue;
      const normalizedOption = normalizeText(option);
      if (normalizedOption.length < 16) continue;
      const foreign = allRuleClaims.find(({ conceptId: otherId, claim }) => (
        otherId !== conceptId
        && claim === normalizedOption
      ));
      if (foreign) {
        issues.push(`${conceptId} ${slot} 干扰项盗用了 ${foreign.conceptId} 的正确规则`);
      }
    }
  }
  addCount(stats.bySource[slot === "母题" ? "mother" : "variant"], sourceKind || "(空)");
  addCount(stats.types[slot === "母题" ? "mother" : "variant"], type || "(空)");
  addCount(stats.optionCounts, String(options.length));
}

for (const concept of concepts) {
  const id = concept.id;
  const card = cards[id];
  if (!card) {
    issues.push(`${id} 没有母题卡`);
    continue;
  }
  addCount(stats.bySubject, concept.subjectId || "(空)");
  if (card.conceptId !== id) issues.push(`${id} conceptId 不一致`);
  if (card.title !== concept.title) issues.push(`${id} 标题不一致`);
  const knowledge = card.knowledge || {};
  for (const field of ["what", "why", "ask", "numbers", "boundary", "example"]) {
    if (!String(knowledge[field] || "").trim()) {
      issues.push(`${id} 知识层缺少 ${field}`);
    }
  }
  if (knowledge.what.length < 20) issues.push(`${id} 人话解释过短`);
  if (knowledge.why.length < 12) issues.push(`${id} 为什么这样做过短`);
  if (Array.isArray(knowledge.entry) && knowledge.entry.length) {
    stats.withEntry += 1;
  }
  const walk = card.walkthrough || {};
  for (const field of ["goal", "rule", "answer", "why", "how"]) {
    if (!String(walk[field] || "").trim()) {
      issues.push(`${id} 示范层缺少 ${field}`);
    }
  }
  if (!Array.isArray(walk.keywords) || !walk.keywords.length) {
    issues.push(`${id} 示范层缺少关键词`);
  }
  stats.withDetailedKnowledge += 1;
  auditQuestion(id, concept.title, card.mother, "母题");
  auditQuestion(id, concept.title, card.variant, "变式");
  if (card.mother?.stem === card.variant?.stem) {
    issues.push(`${id} 母题与变式题干相同`);
  }
  if (normalizeText(card.mother?.stem) === normalizeText(card.variant?.stem)) {
    issues.push(`${id} 母题与变式题干去除标点后仍相同`);
  }
  if (card.mother?.id && card.mother.id === card.variant?.id) {
    issues.push(`${id} 母题与变式使用了同一个题目 ID`);
  }
  const motherOptions = new Set(
    (card.mother?.options || []).map(normalizeText)
  );
  const variantOptions = new Set(
    (card.variant?.options || []).map(normalizeText)
  );
  if (
    motherOptions.size === variantOptions.size
    && [...motherOptions].every((option) => variantOptions.has(option))
  ) {
    issues.push(`${id} 母题与变式只是同一组选项换顺序`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: issues.length === 0,
  stats,
  issues,
  warnings
};

writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
