import { existsSync, readFileSync } from "node:fs";

const auditFile = "work/syllabus-audit.json";
if (!existsSync(auditFile)) {
  console.error(`缺少覆盖审计文件：${auditFile}，请先运行 node tools/build-syllabus-audit.mjs`);
  process.exit(1);
}

const audit = JSON.parse(readFileSync(auditFile, "utf8"));
const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const concepts = conceptFiles.flatMap((file) => {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : parsed.concepts || [];
});
const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[\s（）()、，,。；;：:·…“”"'【】[\]<>]/g, "")
  .replace(/的规定|规定|及其|有关|相关|基本|主要/g, "");
const problems = [];
const chapterIds = new Set();
const expectedSubjects = { practice: 25, law: 7, finance: 10 };

if (!Array.isArray(audit.chapters) || audit.chapters.length !== 42) {
  problems.push(`官方章节数应为 42，实际为 ${audit.chapters?.length || 0}`);
}

for (const chapter of audit.chapters || []) {
  if (chapterIds.has(chapter.chapterId)) problems.push(`章节 id 重复：${chapter.chapterId}`);
  chapterIds.add(chapter.chapterId);
  if (!chapter.required?.length) problems.push(`${chapter.chapterId} 没有必需知识点`);
  for (const item of chapter.required || []) {
    if (!item.title || !item.ability || !item.outlineRef) {
      problems.push(`${chapter.chapterId} 存在字段不完整的必需知识点：${item.id || "(无 id)"}`);
    }
    if (!item.covered) problems.push(`${chapter.chapterId} 未覆盖：${item.title}`);
    if (item.covered) {
      const matched = (item.matchedConceptIds || [])
        .map((id) => conceptById.get(id))
        .filter(Boolean);
      const labelTerms = [item.title, ...(item.keywords || [])]
        .map(normalize)
        .filter((term) => term.length >= 2);
      const hasLabelMatch = matched.some((concept) => {
        const label = normalize([
          concept.title,
          ...(concept.aliases || []),
          ...(concept.keywords || [])
        ].filter(Boolean).join(" "));
        return labelTerms.some((term) => label.includes(term));
      });
      if (!hasLabelMatch) {
        problems.push(`${chapter.chapterId} 仅正文模糊匹配，标题/别名/关键词未落项：${item.title}`);
      }
    }
  }
}

const chapterConceptIds = new Set(
  (audit.chapters || []).flatMap((chapter) => (
    chapter.required || []
  ).flatMap((item) => item.matchedConceptIds || []))
);
for (const concept of concepts.filter((item) => chapterConceptIds.has(item.id))) {
  for (const field of ["plain", "howTo", "example", "trap"]) {
    if (!String(concept[field] || "").trim()) {
      problems.push(`概念 ${concept.id} 缺少 ${field}，不能作为大纲考点卡`);
    }
  }
}

for (const [subjectId, expected] of Object.entries(expectedSubjects)) {
  const count = (audit.chapters || []).filter((chapter) => chapter.subjectId === subjectId).length;
  if (count !== expected) problems.push(`${subjectId} 章节数应为 ${expected}，实际为 ${count}`);
}

for (const item of audit.crossCutting || []) {
  if (!item.covered) problems.push(`跨章基础口径未覆盖：${item.title}`);
}

for (const pack of audit.packStatus || []) {
  if (!pack.present || !pack.count) problems.push(`概念包缺失或为空：${pack.file}`);
}

if (audit.summary?.duplicateConceptIds) {
  problems.push(`概念 id 重复：${audit.summary.duplicateConceptIds}`);
}
if (audit.summary?.brokenRelatedIds) {
  problems.push(`概念关联断链：${audit.summary.brokenRelatedIds}`);
}
if (audit.summary?.matchedTotal !== audit.summary?.requiredTotal) {
  problems.push(`大纲知识点未全部映射：${audit.summary?.matchedTotal || 0}/${audit.summary?.requiredTotal || 0}`);
}
if (audit.gate?.reviewStatus !== "draft") {
  problems.push("审计文件必须保留 draft 状态，不能把结构覆盖误写成专业核验完成");
}

const maxReported = 80;
if (problems.length) {
  console.error(`SYLLABUS COVERAGE GATE: FAIL (${problems.length} problems)`);
  problems.slice(0, maxReported).forEach((problem) => console.error(`- ${problem}`));
  if (problems.length > maxReported) console.error(`- ...另有 ${problems.length - maxReported} 项`);
  process.exit(1);
}

console.log("SYLLABUS COVERAGE GATE: PASS");
console.log(`Chapters: ${audit.chapters.length}; required: ${audit.summary.requiredTotal}; concepts: ${audit.summary.conceptTotal}`);
console.log("Review status remains draft; professional/source verification is still required.");
