import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const file = process.argv[2] || "LedgerQuest.html";
const html = readFileSync(file, "utf8");
const match = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("No inline script found.");

class ElementStub {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.classList = { add() {}, remove() {} };
    this.value = "";
    this.disabled = false;
    this.dataset = {};
  }
  focus() {}
  setSelectionRange() {}
  click() {}
  closest() { return null; }
  remove() {}
}

const elements = new Map();
const getElement = (id) => {
  if (!elements.has(id)) elements.set(id, new ElementStub());
  return elements.get(id);
};
const storage = new Map();
const context = vm.createContext({
  console,
  document: {
    getElementById: getElement,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => new ElementStub(),
    body: new ElementStub()
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  },
  window: { scrollTo: () => {}, location: { reload: () => {} } },
  setTimeout,
  clearTimeout,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  Set,
  Map,
  Blob: class {},
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FileReader: class {},
  Intl
});

vm.runInContext(match[1], context, { filename: file });
vm.runInContext(`
  globalThis.__qualityRows = CONCEPTS.map((concept) => {
    const teach = teachingForConcept(concept);
    const lines = teach.entryGroups?.length
      ? teach.entryGroups.flatMap((group) => group.lines || [])
      : teach.entry || [];
    return {
      id: concept.id,
      subjectId: concept.subjectId,
      chapterId: concept.chapterId,
      chapterTitle: concept.chapterTitle,
      title: concept.title,
      kind: concept.kind,
      plain: concept.plain,
      human: teach.human,
      analogy: teach.analogy || "",
      ask: teach.ask,
      numbers: teach.numbers,
      example: teach.example,
      memory: teach.memory,
      entry: lines.map((line) => ({
        side: line.side,
        account: line.account,
        amount: line.amount,
        why: journalLineReason(line)
      })),
      entryNote: teach.entryNote,
      entryGroups: teach.entryGroups || [],
      entryScope: teach.entryScope,
      hasEntry: teach.hasEntry,
      hasOverride: Boolean(CONCEPT_TEACHING[concept.id])
    };
  });
`, context);

const rows = context.__qualityRows;
const genericReasonPatterns = [
  /^资产增加[，。]?$/,
  /^资产减少[，。]?$/,
  /资产增加，或/,
  /资产减少、转出/,
  /履行义务或偿还负债/,
  /本期成本、费用或损失增加/,
  /确认本期收入或收益增加/,
  /减少所有者权益/,
  /增加所有者权益/
];
const entryLikeKind = /分录|账务|处理流程|后续计量|初始计量|计量属性|合并报表|会计处理|特殊租赁|确认条件/;
const textbookPatterns = [
  /^企业应当/,
  /应当按照/,
  /满足下列条件/,
  /是指/,
  /包括：/,
  /下列各项中/,
  /本题中/
];
const genericHumanPatterns = [
  /^题目出现「/,
  /^看到.*就想到/,
  /^这张卡主要考/,
  /^先判断口径/
];
const englishNarrative = /\b(?:probable|possible|underlying|disability|gains|losses|other|spot rate|vs)\b/i;
const densePatterns = [
  /按.*规定/,
  /应当/,
  /予以/,
  /分别/,
  /采用/,
  /属于/,
  /符合/,
  /确认.*计量/,
  /计入.*(?:损益|成本|资产)/,
  /在.*时/,
  /以及/,
  /其中/
];

const suspiciousHuman = [];
const denseHuman = [];
const emptyEntry = [];
const explainedNoEntry = [];
const genericReasons = [];
const englishTerms = [];
const numericBalance = [];
const genericEntryNotePatterns = [
  /这张卡主要考判断口径/,
  /先按题干业务找对应科目/,
  /通常不单独编一笔分录/,
  /本科目不考会计分录/
];
for (const row of rows) {
  const human = String(row.human || "").trim();
  const humanIssues = [];
  if (human.length < 18) humanIssues.push(`过短(${human.length})`);
  if (human.length > 150) humanIssues.push(`过长(${human.length})`);
  if (human === row.title) humanIssues.push("重复标题");
  if (textbookPatterns.some((pattern) => pattern.test(human))) humanIssues.push("教材腔");
  if (genericHumanPatterns.some((pattern) => pattern.test(human))) humanIssues.push("模板腔");
  if (humanIssues.length) {
    suspiciousHuman.push({
      id: row.id,
      chapter: `${row.chapterId} ${row.chapterTitle}`,
      title: row.title,
      issues: humanIssues,
      human
    });
  }
  const denseHits = densePatterns.filter((pattern) => pattern.test(human));
  const conversational = /说白了|做题时|先看|记住|别|相当于/.test(human);
  if (denseHits.length >= (conversational ? 4 : 2)) {
    denseHuman.push({
      id: row.id,
      chapter: `${row.chapterId} ${row.chapterTitle}`,
      title: row.title,
      hits: denseHits.map((pattern) => pattern.source),
      human
    });
  }
  if (row.subjectId === "practice" && entryLikeKind.test(row.kind || "") && !row.hasEntry) {
    const note = String(row.entryNote || "").trim();
    const hasSpecificNote = note.length >= 36 && !genericEntryNotePatterns.some((pattern) => pattern.test(note));
    const item = {
      id: row.id,
      chapter: `${row.chapterId} ${row.chapterTitle}`,
      title: row.title,
      kind: row.kind,
      entryNote: row.entryNote
    };
    if (hasSpecificNote) explainedNoEntry.push(item);
    else emptyEntry.push(item);
  }
  for (const line of row.entry) {
    if (genericReasonPatterns.some((pattern) => pattern.test(String(line.why || "")))) {
      genericReasons.push({ id: row.id, account: line.account, side: line.side, why: line.why });
    }
  }
  const narrative = [row.human, row.analogy, row.ask, row.numbers, row.example, row.memory, row.entryNote].join(" ");
  if (englishNarrative.test(narrative)) {
    englishTerms.push({
      id: row.id,
      title: row.title,
      terms: narrative.match(/\b(?:probable|possible|underlying|disability|gains|losses|other|spot rate|vs)\b/gi)
    });
  }
  for (const entryGroup of row.entryGroups) {
    const numericLines = entryGroup.lines
      .map((line) => ({ ...line, numeric: parseJournalAmount(line.amount) }))
      .filter((line) => line.numeric !== null);
    if (!numericLines.length || numericLines.length !== entryGroup.lines.length) continue;
    if (!numericLines.some((line) => line.side === "借") || !numericLines.some((line) => line.side === "贷")) continue;
    const debit = numericLines
      .filter((line) => line.side === "借")
      .reduce((sum, line) => sum + line.numeric, 0);
    const credit = numericLines
      .filter((line) => line.side === "贷")
      .reduce((sum, line) => sum + line.numeric, 0);
    if (Math.abs(debit - credit) > 0.001) {
      numericBalance.push({
        id: row.id,
        title: row.title,
        group: entryGroup.title,
        debit,
        credit,
        difference: Number((debit - credit).toFixed(2))
      });
    }
  }
}

function parseJournalAmount(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

const byChapter = new Map();
for (const row of rows.filter((item) => item.subjectId === "practice")) {
  const key = `${row.chapterId} ${row.chapterTitle}`;
  const stat = byChapter.get(key) || { concepts: 0, entries: 0, entryLike: 0 };
  stat.concepts += 1;
  if (row.hasEntry) stat.entries += 1;
  if (entryLikeKind.test(row.kind || "")) stat.entryLike += 1;
  byChapter.set(key, stat);
}

const duplicates = (field) => {
  const grouped = new Map();
  for (const row of rows) {
    const text = String(row[field] || "").trim();
    if (!text) continue;
    if (!grouped.has(text)) grouped.set(text, []);
    grouped.get(text).push(`${row.id}:${row.title}`);
  }
  return [...grouped.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([text, items]) => ({ text, count: items.length, items }))
    .sort((left, right) => right.count - left.count);
};

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    concepts: rows.length,
    entryCards: rows.filter((row) => row.hasEntry).length,
    suspiciousHuman: suspiciousHuman.length,
    denseHuman: denseHuman.length,
    emptyEntryLike: emptyEntry.length,
    explainedNoEntry: explainedNoEntry.length,
    genericReasons: genericReasons.length,
    englishNarrative: englishTerms.length,
    numericImbalance: numericBalance.length,
    duplicateHumans: duplicates("human").length,
    duplicateAsks: duplicates("ask").length,
    duplicateNumbers: duplicates("numbers").length
  },
  practiceChapters: [...byChapter.entries()].map(([chapter, stat]) => ({ chapter, ...stat })),
  suspiciousHuman,
  denseHuman,
  emptyEntryLike: emptyEntry,
  explainedNoEntry,
  genericReasons,
  englishTerms,
  numericBalance,
  duplicateHumans: duplicates("human").slice(0, 50),
  duplicateAsks: duplicates("ask").slice(0, 50),
  duplicateNumbers: duplicates("numbers").slice(0, 50)
};

writeFileSync("work/teaching-quality-report.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  totals: report.totals,
  practiceChapters: report.practiceChapters,
  suspiciousHumanSamples: suspiciousHuman.slice(0, 40),
  denseHumanSamples: denseHuman.slice(0, 120),
  emptyEntrySamples: emptyEntry.slice(0, 40),
  explainedNoEntrySamples: explainedNoEntry.slice(0, 40),
  genericReasons,
  englishTerms,
  numericBalance,
  duplicateHumans: duplicates("human").slice(0, 20),
  duplicateAsks: duplicates("ask").slice(0, 20),
  duplicateNumbers: duplicates("numbers").slice(0, 20)
}, null, 2));
if (
  suspiciousHuman.length
  || denseHuman.length
  || emptyEntry.length
  || genericReasons.length
  || englishTerms.length
  || numericBalance.length
  || duplicates("human").length
  || duplicates("ask").length
) process.exitCode = 1;
