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
  const feedback3Teaching = {
    timing: (() => {
      const concept = CONCEPTS.find((item) => item.id === "pc-p12-t02");
      if (!concept) return { ok: false, issues: ["missing pc-p12-t02"] };
      const teach = teachingForConcept(concept);
      const issues = [];
      if (!teach.whenToUse.includes("题目让你确认收入")) issues.push("missing whenToUse");
      if (!teach.entryGroups.length) issues.push("missing entryGroups");
      if (!teach.memory.includes("客户边做边受益")) issues.push("memory is still compressed");
      if (!teach.human.includes("先问三句")) issues.push("human explanation is still unclear");
      return { ok: issues.length === 0, issues };
    })(),
    returns: (() => {
      const concept = CONCEPTS.find((item) => item.id === "pc-p12-t03");
      if (!concept) return { ok: false, issues: ["missing pc-p12-t03"] };
      const teach = teachingForConcept(concept);
      const text = teach.entryGroups.flatMap((group) => group.lines.map((line) => [line.account, line.amount, line.why].join(" "))).join(" ");
      const issues = [];
      if (!teach.whenToUse.includes("预计退货")) issues.push("missing whenToUse");
      if (!text.includes("预计负债—应付退货款")) issues.push("missing refund liability");
      if (!text.includes("应收退货成本")) issues.push("missing return cost asset");
      return { ok: issues.length === 0, issues };
    })()
  };
  const chapterBossFailures = SUBJECTS.flatMap((subject) => subject.chapters.map((chapter) => {
    const boss = buildChapterBoss(chapter.id);
    if (!boss) return [subject.id + ":" + chapter.id + ": missing boss"];
    const problems = [];
    if (boss.steps.length !== 3) problems.push("steps=" + boss.steps.length);
    boss.steps.forEach((step) => {
      if (step.options.length !== 4) problems.push("options=" + step.options.length);
      if (new Set(step.options).size !== 4) problems.push("duplicate options");
      if (step.correctIndex < 0 || step.correctIndex > 3) problems.push("bad answer index");
      if (!CONCEPTS.some((concept) => concept.id === step.conceptId)) problems.push("missing concept " + step.conceptId);
    });
    return problems.length ? [subject.id + ":" + chapter.id + ": " + problems.join(", ")] : [];
  })).flat();
  const chapterSummaryFailures = SUBJECTS.flatMap((subject) => subject.chapters.map((chapter) => {
    const summary = chapterLearningSummary(subject.id, chapter.id);
    const problems = [];
    if (summary.conceptCount < 3) problems.push("concepts=" + summary.conceptCount);
    if (summary.mainline.length < 30) problems.push("mainline too short");
    if (summary.confusions.length < 2) problems.push("confusions=" + summary.confusions.length);
    if (summary.entryLine.length < 24) problems.push("entry line too short");
    return problems.length ? [subject.id + ":" + chapter.id + ": " + problems.join(", ")] : [];
  })).flat();
  const motherQuestionFailures = CONCEPTS.flatMap((concept) => {
    const questions = buildConceptChallenge(concept);
    if (questions.length !== 2) return [concept.id + ": questions=" + questions.length];
    const problems = [];
    questions.forEach((question, index) => {
      const answer = questionAnswerIndexes(question);
      if (!question.stem) problems.push("stem");
      if (!Array.isArray(question.options) || !question.options.length) problems.push("options");
      if (!answer.length) problems.push("answer");
      if (answer.some((value) => value < 0 || value >= (question.options || []).length)) problems.push("answer-range");
      if (question.type === "judge" && question.options.length !== 2) problems.push("judge-options");
      if (question.type !== "judge" && question.options.length !== 4) problems.push("choice-options");
      if (!question.why || !question.how || !question.explanation) problems.push("explanation");
      if (!Array.isArray(question.optionFeedback) || question.optionFeedback.length !== question.options.length) problems.push("feedback");
      if (question.stage !== (index === 0 ? "mother" : "variant")) problems.push("stage");
    });
    return problems.length ? [concept.id + ": " + problems.join(", ")] : [];
  });
  const motherSourceCounts = CONCEPTS.reduce((acc, concept) => {
    const question = EXAM_MOTHERS[concept.id]?.mother;
    const key = question?.sourceKind || "(empty)";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
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
      keyConceptFailures,
      feedback3Teaching,
      chapterBossFailures,
      chapterSummaryFailures,
      mothers: {
        cards: Object.keys(EXAM_MOTHERS).length,
        questions: CONCEPTS.length * 2,
        sourceKinds: motherSourceCounts,
        failures: motherQuestionFailures
      }
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
  || !context.__testReport.content.feedback3Teaching.timing.ok
  || !context.__testReport.content.feedback3Teaching.returns.ok
  || context.__testReport.content.chapterBossFailures.length
  || context.__testReport.content.chapterSummaryFailures.length
  || context.__testReport.content.mothers.cards !== 1049
  || context.__testReport.content.mothers.failures.length
) process.exitCode = 1;
