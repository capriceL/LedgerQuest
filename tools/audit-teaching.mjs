import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const file = process.argv[2] || "LedgerQuest.html";
const html = readFileSync(file, "utf8");
const match = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("No inline script found.");

class ClassList {
  add() {}
  remove() {}
}

class ElementStub {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.classList = new ClassList();
    this.value = "";
    this.disabled = false;
    this.dataset = {};
  }
  focus() {}
  setSelectionRange() {}
  click() {}
  closest() { return null; }
}

const elements = new Map();
const getElement = (id) => {
  if (!elements.has(id)) elements.set(id, new ElementStub());
  return elements.get(id);
};
const document = {
  getElementById: getElement,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => new ElementStub(),
  body: new ElementStub()
};
const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
const context = vm.createContext({
  console,
  document,
  localStorage,
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
  globalThis.__teachingAudit = CONCEPTS.map((concept) => {
    const teach = teachingForConcept(concept);
    return {
      id: concept.id,
      subjectId: concept.subjectId,
      chapterId: concept.chapterId,
      chapterTitle: concept.chapterTitle,
      title: concept.title,
      kind: concept.kind,
      human: teach.human,
      humanLength: teach.human.length,
      analogy: teach.analogy,
      ask: teach.ask,
      numbers: teach.numbers,
      memory: teach.memory,
      example: teach.example,
      entryNote: teach.entryNote,
      entryScope: teach.entryScope,
      entries: teach.entry.map((line) => ({
        side: line.side,
        account: line.account,
        amount: line.amount,
        reason: journalLineReason(line)
      }))
    };
  });
`, context);

const records = context.__teachingAudit;
const errors = [];
const warnings = [];
const explainedNoEntry = [];
const entryLikeKind = /分录|账务|处理流程|后续计量|初始计量|计量属性|合并报表|会计处理|特殊租赁|确认条件/;
const genericEntryNotePatterns = [
  /这张卡主要考判断口径/,
  /先按题干业务找对应科目/,
  /通常不单独编一笔分录/,
  /本科目不考会计分录/
];
const textbookMarkers = [
  "先别背定义",
  "真要算，就按这句下手",
  "最容易翻车的地方：",
  "满足下列条件",
  "是指",
  "企业应当",
  "包括："
];
const practice = records.filter((item) => item.subjectId === "practice");
const practiceChapters = new Set(practice.map((item) => `${item.chapterId}:${item.chapterTitle}`));
const entryChapters = new Set(
  practice
    .filter((item) => item.entries.length)
    .map((item) => `${item.chapterId}:${item.chapterTitle}`)
);

for (const item of records) {
  const human = String(item.human || "").trim();
  if (!human) errors.push(`${item.id} 人话为空`);
  if (human.length < 12) errors.push(`${item.id} 人话过短：${human.length} 字`);
  if (human.length > 160) errors.push(`${item.id} 人话过长：${human.length} 字`);
  if (human === item.title) errors.push(`${item.id} 人话只是在重复标题`);
  for (const marker of textbookMarkers) {
    if (human.includes(marker)) errors.push(`${item.id} 人话仍含教材腔或旧模板：${marker}`);
  }
  if (/\n{2,}/.test(human)) warnings.push(`${item.id} 人话存在多余空行`);
  if (!String(item.ask || "").trim()) errors.push(`${item.id} 缺少题干识别口径`);
  if (!String(item.numbers || "").trim()) errors.push(`${item.id} 缺少数字/判断口径`);
  for (const field of ["human", "analogy", "example", "ask", "numbers", "memory"]) {
    if (String(item[field] || "").includes(`【${item.title}】`)) {
      errors.push(`${item.id} ${field} 残留重复卡名标签：【${item.title}】`);
    }
  }
  if (item.subjectId === "practice") {
    if (!item.entries.length) {
      const note = String(item.entryNote || "").trim();
      const hasSpecificNote = note.length >= 36 && !genericEntryNotePatterns.some((pattern) => pattern.test(note));
      if (hasSpecificNote) {
        if (entryLikeKind.test(item.kind || "")) explainedNoEntry.push(item.id);
      } else if (entryLikeKind.test(item.kind || "")) {
        errors.push(`${item.id} 分录型实务卡既没有分录，也没有专属判断说明`);
      }
    }
    for (const line of item.entries) {
      if (!["借", "贷"].includes(line.side)) errors.push(`${item.id} 分录方向异常：${line.side}`);
      if (!String(line.account || "").trim()) errors.push(`${item.id} 分录缺少科目`);
      if (!String(line.amount || "").trim()) errors.push(`${item.id} 分录缺少金额口径`);
      if (!String(line.reason || "").trim()) errors.push(`${item.id} 分录缺少“为什么这么记”`);
    }
  }
}

for (const chapter of practiceChapters) {
  if (!entryChapters.has(chapter)) errors.push(`实务章节缺少分录入口：${chapter}`);
}

const bySubject = {};
for (const subject of ["practice", "law", "finance"]) {
  const items = records.filter((item) => item.subjectId === subject);
  const lengths = items.map((item) => item.humanLength);
  bySubject[subject] = {
    concepts: items.length,
    avgHumanLength: Math.round(lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length)),
    maxHumanLength: Math.max(0, ...lengths),
    withEntry: items.filter((item) => item.entries.length).length,
    explainedNoEntry: items.filter((item) => {
      const note = String(item.entryNote || "").trim();
      return !item.entries.length && note.length >= 36 && !genericEntryNotePatterns.some((pattern) => pattern.test(note));
    }).length,
    cardSpecific: items.filter((item) => item.entryScope === "card").length,
    chapterLevel: items.filter((item) => item.entryScope === "chapter").length
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: errors.length === 0,
  totals: {
    concepts: records.length,
    practiceConcepts: practice.length,
    practiceChapters: practiceChapters.size,
    practiceChaptersWithEntry: entryChapters.size,
    cardSpecificEntries: records.filter((item) => item.entryScope === "card").length,
    explainedNoEntry: explainedNoEntry.length,
    chapterLevelEntries: records.filter((item) => item.entryScope === "chapter").length
  },
  bySubject,
  errors,
  warnings
};

writeFileSync("work/teaching-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
