import "./audit-challenges-v2.mjs";
process.exit(process.exitCode || 0);
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const files = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededShuffle(items, seedText) {
  const result = [...items];
  let seed = hashText(seedText);
  for (let index = result.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const swapIndex = seed % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

const uniqueStrings = (items) => (
  [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))]
);

const concepts = files.flatMap((file) => {
  if (!existsSync(file)) throw new Error(`缺少概念包：${file}`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const list = Array.isArray(parsed) ? parsed : parsed.concepts;
  if (!Array.isArray(list) || !list.length) throw new Error(`${file} 没有概念数组`);
  return list;
});

const byId = new Map(concepts.map((concept) => [concept.id, concept]));
const problems = [];
const stats = {
  concepts: concepts.length,
  generatedQuestions: 0,
  twoStep: 0,
  threeStep: 0,
  fourOptionQuestions: 0,
  minOptions: Infinity,
  maxOptions: 0
};

function peersFor(concept) {
  const sameChapter = concepts.filter((item) => (
    item.id !== concept.id
    && item.subjectId === concept.subjectId
    && item.chapterId === concept.chapterId
  ));
  if (sameChapter.length >= 3) return sameChapter;
  const extra = concepts.filter((item) => (
    item.id !== concept.id
    && item.subjectId === concept.subjectId
    && !sameChapter.some((peer) => peer.id === item.id)
  ));
  return [...sameChapter, ...extra];
}

function questionsFor(concept) {
  const peers = peersFor(concept);
  const keywords = uniqueStrings(concept.keywords).filter((word) => word.length >= 2);
  const correctKeyword = keywords[0] || concept.title;
  const peerKeywords = uniqueStrings(peers.flatMap((peer) => peer.keywords || []))
    .filter((word) => word !== correctKeyword && !keywords.includes(word));
  const keywordOptions = seededShuffle(
    [correctKeyword, ...seededShuffle(peerKeywords, `${concept.id}:keywords`).slice(0, 3)],
    `${concept.id}:keyword-options`
  );
  const titlePeers = peers
    .filter((peer) => (
      peer.title !== concept.title
      && !peer.title.includes(concept.title)
      && !concept.title.includes(peer.title)
    ))
    .map((peer) => peer.title);
  const titleOptions = seededShuffle(
    [concept.title, ...seededShuffle(uniqueStrings(titlePeers), `${concept.id}:titles`).slice(0, 3)],
    `${concept.id}:title-options`
  );
  const questions = [
    { kind: "keyword", options: keywordOptions, answer: keywordOptions.indexOf(correctKeyword) },
    { kind: "title", options: titleOptions, answer: titleOptions.indexOf(concept.title) }
  ];
  if (concept.trap) {
    const peerTraps = uniqueStrings(peers.map((peer) => peer.trap))
      .filter((text) => text !== concept.trap);
    const trapOptions = seededShuffle(
      [concept.trap, ...seededShuffle(peerTraps, `${concept.id}:traps`).slice(0, 3)],
      `${concept.id}:trap-options`
    );
    if (trapOptions.length < 2) trapOptions.push("只背结论，不看适用条件");
    questions.push({
      kind: "trap",
      options: trapOptions,
      answer: trapOptions.indexOf(concept.trap)
    });
  }
  return questions;
}

for (const concept of concepts) {
  const label = concept.id || concept.title || "(无标识)";
  for (const field of ["id", "title", "plain", "howTo", "keywords", "trap", "example"]) {
    const value = concept[field];
    if (!value || (Array.isArray(value) && !value.length)) {
      problems.push(`${label} 缺少 ${field}，无法形成完整学习闭环`);
    }
  }
  const questions = questionsFor(concept);
  stats.generatedQuestions += questions.length;
  stats[questions.length >= 3 ? "threeStep" : "twoStep"] += 1;
  if (questions.length < 3) problems.push(`${label} 微闯关不足三步`);
  for (const [index, question] of questions.entries()) {
    const options = uniqueStrings(question.options);
    stats.minOptions = Math.min(stats.minOptions, options.length);
    stats.maxOptions = Math.max(stats.maxOptions, options.length);
    if (options.length === 4) stats.fourOptionQuestions += 1;
    if (options.length !== 4) problems.push(`${label} 第 ${index + 1} 题有效选项不是 4 个，而是 ${options.length} 个`);
    if (question.answer < 0) problems.push(`${label} 第 ${index + 1} 题找不到正确答案`);
    if (new Set(question.options).size !== question.options.length) {
      problems.push(`${label} 第 ${index + 1} 题存在重复选项`);
    }
    if (question.options.some((option) => !String(option || "").trim())) {
      problems.push(`${label} 第 ${index + 1} 题存在空选项`);
    }
    if ([...byId.keys()].length === 0) problems.push("概念索引为空");
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: problems.length === 0,
  stats: {
    ...stats,
    minOptions: Number.isFinite(stats.minOptions) ? stats.minOptions : 0
  },
  problems
};

writeFileSync("work/challenge-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
