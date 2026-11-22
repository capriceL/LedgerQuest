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
class Element {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.classList = new ClassList();
    this.style = { setProperty() {} };
    this.dataset = {};
    this.disabled = false;
    this.value = "";
  }
  appendChild() {}
  remove() {}
  focus() {}
  setSelectionRange() {}
  click() {}
  closest() { return null; }
}
const elements = new Map();
const document = {
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => new Element(),
  body: new Element()
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
  Intl,
  Blob: class {},
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FileReader: class {}
});

vm.runInContext(match[1], context, { filename: file });
vm.runInContext(`
  const failures = [];
  const notes = [];
  const assert = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const everyTopic = allTopics();
  assert(SUBJECTS.length === 3, "Expected 3 subjects");
  assert(SUBJECTS.reduce((sum, subject) => sum + subject.chapters.length, 0) === 42, "Expected 42 chapters");
  assert(everyTopic.length >= 80, "Expected at least 80 topics");
  assert(new Set(everyTopic.map(({ topic }) => topic.id)).size === everyTopic.length, "Duplicate topic ids");

  for (const { topic } of everyTopic) {
    const q = topic.question;
    view = {
      ...view,
      name: "level",
      topicId: topic.id,
      selected: null,
      reasonSelected: null,
      numeric: "",
      sortPicked: [],
      sortOrder: makeSortOrder(topic),
      multiSelected: [],
      keywordPicked: [],
      feedback: null,
      attempts: 0,
      assisted: false
    };
    if (q.mode === "number") view.numeric = String(q.answer);
    else if (q.mode === "sort") view.sortPicked = [...q.answer];
    else if (q.mode === "multi") view.multiSelected = [...q.answer];
    else if (q.mode === "keywords") view.keywordPicked = [...q.answer];
    else {
      view.selected = q.answer;
      if (q.mode === "truefalse" && q.reasonOptions.length) view.reasonSelected = q.reasonAnswer;
    }
    assert(isAnswerReady(q), topic.id + ": answer should be ready");
    assert(answerIsCorrect(topic), topic.id + ": correct answer rejected");
    assert(renderAnswerZone(topic).length > 40, topic.id + ": answer UI is empty");
  }

  const sortTopic = everyTopic.find(({ topic }) => topic.question.mode === "sort").topic;
  assert(makeSortOrder(sortTopic).some((value, index) => value !== sortTopic.question.answer[index]), "Sort order is not shuffled");

  const p02 = findChapter("p02").chapter;
  progress.completed = {};
  assert(!isTopicUnlocked(p02.topics[1].id), "Second topic should start locked");
  progress.completed[p02.topics[0].id] = { kind: "clean", attempts: 1, at: null };
  assert(isTopicUnlocked(p02.topics[1].id), "Second topic should unlock after first clear");

  const storageBefore = [SAVE_KEY, LEGACY_SAVE_KEY, CUSTOM_KEY, LEGACY_CUSTOM_KEY]
    .map((key) => [key, localStorage.getItem(key)]);
  const beforeCount = SUBJECTS.length;
  let rejected = false;
  try {
    importContentText(JSON.stringify({
      subjects: [{
        id: "practice",
        chapters: [{
          id: "broken-chapter",
          title: "坏内容",
          topics: [{ id: "broken-topic" }]
        }]
      }]
    }), true);
  } catch (error) {
    rejected = true;
  }
  assert(rejected, "Invalid import should reject");
  assert(SUBJECTS.length === beforeCount, "Invalid import changed in-memory subjects");
  const storageAfter = [SAVE_KEY, LEGACY_SAVE_KEY, CUSTOM_KEY, LEGACY_CUSTOM_KEY]
    .map((key) => [key, localStorage.getItem(key)]);
  assert(JSON.stringify(storageAfter) === JSON.stringify(storageBefore), "Invalid import changed storage");

  let extensionLoaded = false;
  try {
    importContentText(JSON.stringify({
      subjects: [{
        id: "practice",
        chapters: [{
          id: "qa-extension",
          title: "扩展接口测试",
          topics: [{
            id: "qa-extension-t1",
            title: "可扩展知识点",
            short: "新内容可以通过 JSON 接入。",
            plain: "章节、知识点和题目都由内容包驱动，不需要修改渲染逻辑。",
            keywords: ["扩展", "JSON"],
            question: {
              mode: "choice",
              goal: "确认扩展内容可以进入知识库和关卡。",
              prompt: "新增内容包后，知识点是否应能直接出现在游戏中？",
              keywords: ["内容包", "直接出现"],
              translate: "这题只检查扩展接口是否接通。",
              options: ["可以", "不可以"],
              answer: 0,
              hint: "数据驱动。",
              wrongHint: "内容包会合并进现有内容。",
              explain: "合法内容包合并后会直接进入地图、知识库和关卡。"
            }
          }]
        }]
      }]
    }), false);
    extensionLoaded = Boolean(findTopic("qa-extension-t1"));
  } catch (error) {
    notes.push("扩展接口测试导入失败：" + error.message);
  }
  assert(extensionLoaded, "Valid content extension should load without code changes");
  commitContent(normalizeContent(cloneData(BUILTIN_SUBJECTS)));
  assert(!findTopic("qa-extension-t1"), "Non-persistent extension should be removable after test");

  progress = defaultProgress();
  const first = everyTopic[0].topic;
  openTopic(first.id);
  const fq = first.question;
  if (fq.mode === "number") view.numeric = String(fq.answer);
  else if (fq.mode === "sort") view.sortPicked = [...fq.answer];
  else if (fq.mode === "multi") view.multiSelected = [...fq.answer];
  else if (fq.mode === "keywords") view.keywordPicked = [...fq.answer];
  else {
    view.selected = fq.answer;
    if (fq.mode === "truefalse" && fq.reasonOptions.length) view.reasonSelected = fq.reasonAnswer;
  }
  submitAnswer();
  assert(progress.completed[first.id] && progress.completed[first.id].kind === "clean", "First clear kind should be clean");
  assert(progress.completed[first.id].attempts === 1, "First clear attempts should be 1");
  assert(progress.xp === completionXp(first, "clean"), "First clear XP mismatch");

  globalThis.__engineResult = {
    failures,
    notes,
    subjects: SUBJECTS.map((subject) => subject.name),
    chapters: SUBJECTS.reduce((sum, subject) => sum + subject.chapters.length, 0),
    topics: everyTopic.length,
    completedKind: progress.completed[first.id].kind,
    xp: progress.xp
  };
`, context);

console.log(JSON.stringify(context.__engineResult, null, 2));
if (context.__engineResult.failures.length) process.exitCode = 1;
