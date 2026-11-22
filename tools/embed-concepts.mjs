import { existsSync, readFileSync, writeFileSync } from "node:fs";

const htmlFile = "LedgerQuest.html";
const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const glossaryFile = "work/glossary-v1.json";
const syllabusFile = "work/syllabus-audit.json";
const teachingFile = "work/concept-teaching-v1.json";

const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const readConcepts = (file) => {
  if (!existsSync(file)) throw new Error(`缺少概念包：${file}`);
  const parsed = readJSON(file);
  const concepts = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.concepts) ? parsed.concepts : null;
  if (!concepts || !concepts.length) throw new Error(`${file} 没有 concepts 数组`);
  return concepts;
};

const concepts = conceptFiles.flatMap(readConcepts);
const glossaryRaw = readJSON(glossaryFile);
const glossary = Array.isArray(glossaryRaw) ? glossaryRaw : glossaryRaw && Array.isArray(glossaryRaw.terms) ? glossaryRaw.terms : [];
if (!glossary.length) throw new Error(`${glossaryFile} 没有 terms 数组`);
if (!existsSync(syllabusFile)) throw new Error(`缺少官方大纲审计文件：${syllabusFile}`);
const syllabusAudit = readJSON(syllabusFile);
const syllabusMeta = {
  version: syllabusAudit.version,
  requiredTotal: syllabusAudit.summary?.requiredTotal || 0,
  matchedTotal: syllabusAudit.summary?.matchedTotal || 0,
  coveragePercent: syllabusAudit.summary?.coveragePercent || 0,
  chapters: (syllabusAudit.chapters || []).map((chapter) => ({
    subjectId: chapter.subjectId,
    chapterId: chapter.chapterId,
    chapterTitle: chapter.chapterTitle,
    requiredCount: chapter.requiredCount,
    matchedCount: chapter.matchedCount,
    status: chapter.status
  }))
};
const conceptIds = new Set();
const required = ["id", "subjectId", "chapterId", "chapterTitle", "title", "plain", "howTo"];
for (const concept of concepts) {
  for (const field of required) {
    if (!String(concept[field] || "").trim()) throw new Error(`概念 ${concept.id || "(无 id)"} 缺少 ${field}`);
  }
  if (conceptIds.has(concept.id)) throw new Error(`概念 id 重复：${concept.id}`);
  conceptIds.add(concept.id);
}

const syllabusRefsByConcept = new Map();
for (const chapter of syllabusAudit.chapters || []) {
  for (const item of chapter.required || []) {
    for (const conceptId of item.matchedConceptIds || []) {
      if (!conceptIds.has(conceptId)) continue;
      if (!syllabusRefsByConcept.has(conceptId)) syllabusRefsByConcept.set(conceptId, []);
      syllabusRefsByConcept.get(conceptId).push({
        itemId: item.id,
        outlineRef: item.outlineRef,
        title: item.title,
        ability: item.ability,
        section: item.section,
        chapterId: chapter.chapterId
      });
    }
  }
}
const enrichedConcepts = concepts.map((concept) => ({
  ...concept,
  syllabusRefs: syllabusRefsByConcept.get(concept.id) || []
}));

const teaching = existsSync(teachingFile) ? readJSON(teachingFile) : { cards: {}, chapterEntries: {} };
const teachingCards = teaching.cards && typeof teaching.cards === "object" ? teaching.cards : {};
const chapterEntries = teaching.chapterEntries && typeof teaching.chapterEntries === "object"
  ? teaching.chapterEntries
  : {};
for (const conceptId of Object.keys(teachingCards)) {
  if (!conceptIds.has(conceptId)) throw new Error(`讲义卡引用了不存在的概念：${conceptId}`);
}

const termIds = new Set();
for (const term of glossary) {
  for (const field of ["id", "term", "full", "zh", "plain"]) {
    if (!String(term[field] || "").trim()) throw new Error(`术语 ${term.id || "(无 id)"} 缺少 ${field}`);
  }
  if (termIds.has(term.id)) throw new Error(`术语 id 重复：${term.id}`);
  termIds.add(term.id);
}

const safeJSON = (value) => JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
let html = readFileSync(htmlFile, "utf8");
if (!html.includes("/* @@CONCEPT_CONTENT_START@@ */") || !html.includes("/* @@CONCEPT_CONTENT_END@@ */")) {
  throw new Error("主文件缺少概念库嵌入标记");
}
html = html.replace(
  /\/\* @@CONCEPT_CONTENT_START@@ \*\/[\s\S]*?\/\* @@CONCEPT_CONTENT_END@@ \*\//,
  `/* @@CONCEPT_CONTENT_START@@ */\n    CONCEPTS.push(...${safeJSON(enrichedConcepts)});\n    GLOSSARY.push(...${safeJSON(glossary)});\n    Object.assign(CONCEPT_TEACHING, ${safeJSON(teachingCards)});\n    Object.assign(CHAPTER_ENTRIES, ${safeJSON(chapterEntries)});\n    SYLLABUS_META = ${safeJSON(syllabusMeta)};\n    /* @@CONCEPT_CONTENT_END@@ */`
);

writeFileSync(htmlFile, html, "utf8");
const chapters = new Set(concepts.map((item) => `${item.subjectId}:${item.chapterId}`));
const linkedItems = [...syllabusRefsByConcept.values()].reduce((sum, refs) => sum + refs.length, 0);
console.log(`Embedded ${concepts.length} concepts across ${chapters.size} chapters, ${glossary.length} glossary terms, ${Object.keys(teachingCards).length} teaching overrides, ${Object.keys(chapterEntries).length} chapter entry guides and ${linkedItems} syllabus links, ${Buffer.byteLength(html, "utf8")} bytes.`);
