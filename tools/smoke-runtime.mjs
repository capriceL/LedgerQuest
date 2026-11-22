import { readFileSync } from "node:fs";
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
  const keyConceptChecks = [
    { id: "law-e01-ext-05", expected: ["30日内追认", "视为拒绝追认"] },
    { id: "law-e02-r07-01", expected: ["上市之日起1年内不得转让"] },
    { id: "law-e02-ext-20", expected: ["上市交易之日起一年内不得转让"] },
    { id: "law-e04-r01-01", expected: ["买卖不破租赁"] },
    { id: "law-e06-r01-02", expected: ["自到期日起10日内", "出票日起1个月内"] },
    { id: "pc-p06-x02", expected: ["最终控制方原收购形成的商誉"] },
    { id: "pc-p18-y05", expected: ["租赁激励"] },
    { id: "pc-p20-y09", expected: ["部分商誉法", "完全商誉法"] },
    { id: "pc-p20-y18", expected: ["购买日后", "其他综合收益"] },
    { id: "pc-p02-t05", expected: ["max(0"] },
    { id: "pc-p16-y10", expected: ["计入损益", "其他综合收益"] },
    { id: "fc-f06-03", expected: ["营业收入-付现成本", "EBIT×（1-T）+折旧"] }
  ];
  const keyConceptFailures = keyConceptChecks.flatMap(({ id, expected }) => {
    const concept = CONCEPTS.find((item) => item.id === id);
    if (!concept) return [id + ": missing"];
    const text = [concept.plain, concept.howTo, concept.formula, concept.example, concept.trap].join(" ");
    const missing = expected.filter((phrase) => !text.includes(phrase));
    return missing.length ? [id + ": missing " + missing.join(" / ")] : [];
  });
  globalThis.__testReport = {
    subjects: SUBJECTS.map((subject) => ({
      id: subject.id,
      chapters: subject.chapters.length,
      topics: subject.chapters.reduce((sum, chapter) => sum + chapter.topics.length, 0),
      modes: subject.chapters.flatMap((chapter) => chapter.topics).reduce((acc, topic) => {
        acc[topic.question.mode] = (acc[topic.question.mode] || 0) + 1;
        return acc;
      }, {})
    })),
    content: {
      concepts: CONCEPTS.length,
      glossary: GLOSSARY.length,
      keyConceptFailures
    },
    validation: validateContent(SUBJECTS),
    view: view.name,
    appHasContent: document.getElementById("app").innerHTML.length > 100
  };
`, context);
console.log(JSON.stringify(context.__testReport, null, 2));
if (
  !context.__testReport.validation.ok
  || !context.__testReport.appHasContent
  || context.__testReport.content.keyConceptFailures.length
) process.exitCode = 1;
