import { existsSync, readFileSync, writeFileSync } from "node:fs";

const htmlFile = "LedgerQuest.html";
const practiceFile = "work/content-practice-v1.json";
const extraFiles = ["work/content-law-manual-v1.json", "work/content-finance-v1.json"];

const readPack = (file) => {
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!parsed || !Array.isArray(parsed.subjects)) throw new Error(`${file} is not a content pack`);
  return parsed.subjects;
};

const practice = readPack(practiceFile);
if (!practice || practice.length !== 1 || practice[0].id !== "practice") {
  throw new Error("Practice pack must contain exactly the practice subject.");
}
const extras = extraFiles.flatMap((file) => readPack(file) || []);
const all = [...practice, ...extras];
const seenTopics = new Set();
for (const subject of all) {
  for (const chapter of subject.chapters || []) {
    for (const topic of chapter.topics || []) {
      if (seenTopics.has(topic.id)) throw new Error(`Duplicate topic id: ${topic.id}`);
      seenTopics.add(topic.id);
    }
  }
}

const safeJSON = (value) => JSON.stringify(value, null, 2).replace(/<\/script/gi, "<\\/script");
let html = readFileSync(htmlFile, "utf8");
html = html.replace(
  /\/\* @@PRACTICE_CONTENT_START@@ \*\/[\s\S]*?\/\* @@PRACTICE_CONTENT_END@@ \*\//,
  `/* @@PRACTICE_CONTENT_START@@ */\n    SUBJECTS.push(...${safeJSON(practice)});\n    /* @@PRACTICE_CONTENT_END@@ */`
);
html = html.replace(
  /\/\* @@CONTENT_INSERT_START@@ \*\/[\s\S]*?\/\* @@CONTENT_INSERT_END@@ \*\//,
  `/* @@CONTENT_INSERT_START@@ */\n    ${extras.length ? `SUBJECTS.push(...${safeJSON(extras)});` : "/* Extra content packs: none */"}\n    /* @@CONTENT_INSERT_END@@ */`
);
writeFileSync(htmlFile, html, "utf8");
console.log(`Embedded ${all.length} subjects, ${seenTopics.size} topics, ${Buffer.byteLength(html, "utf8")} bytes.`);
