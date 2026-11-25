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
const data = JSON.parse(vm.runInContext(
  "JSON.stringify({ concepts: CONCEPTS, subjects: SUBJECTS, glossary: GLOSSARY, teaching: CONCEPT_TEACHING, chapterEntries: CHAPTER_ENTRIES })",
  context
));
const localizeDisplayText = vm.runInContext("localizeDisplayText", context);

const sources = [];
const push = (kind, id, field, value, options = {}) => {
  if (typeof value === "string" && value.trim()) {
    const displayValue = localizeDisplayText(value, {
      field: options.field || field.split(/[.\[]/).pop()
    });
    sources.push({
      kind,
      id,
      field,
      value: displayValue,
      rawValue: value,
      searchMetadata: Boolean(options.searchMetadata)
    });
  }
};
const pushArray = (kind, id, field, values, options = {}) => {
  (Array.isArray(values) ? values : []).forEach((value, index) => {
    push(kind, id, `${field}[${index}]`, value, options);
  });
};
const pushObjectStrings = (kind, id, field, value, predicate = () => true, context = {}) => {
  if (typeof value === "string") {
    if (predicate(context.field || field)) push(kind, id, field, value, context);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      pushObjectStrings(kind, id, `${field}[${index}]`, item, predicate, context);
    });
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, item]) => {
    pushObjectStrings(kind, id, `${field}.${key}`, item, predicate, {
      field: key,
      searchMetadata: Boolean(context.searchMetadata)
    });
  });
};

data.concepts.forEach((concept) => {
  ["title", "kind", "plain", "howTo", "formula", "example", "trap"].forEach((field) => {
    push("concept", concept.id, field, concept[field], { field });
  });
  ["aliases", "keywords"].forEach((field) => pushArray("concept", concept.id, field, concept[field], {
    searchMetadata: true
  }));
  const notes = Array.isArray(concept.examNotes) ? concept.examNotes : concept.courseNotes;
  (Array.isArray(notes) ? notes : []).forEach((note, index) => {
    const prefix = Array.isArray(concept.examNotes) ? "examNotes" : "courseNotes";
    push("exam-note", concept.id, `${prefix}[${index}].label`, note.label, { field: "label" });
    push("exam-note", concept.id, `${prefix}[${index}].text`, note.text, { field: "text" });
  });
});

const teachingField = (field) => !/numbers|formula|entryTitle/.test(field);
Object.entries(data.teaching || {}).forEach(([id, value]) => {
  pushObjectStrings("teaching", id, "teaching", value, teachingField);
});
Object.entries(data.chapterEntries || {}).forEach(([id, value]) => {
  pushObjectStrings("chapter-entry", id, "chapterEntry", value, () => true);
});

data.subjects.forEach((subject) => {
  push("subject", subject.id, "name", subject.name);
  push("subject", subject.id, "desc", subject.desc);
  subject.chapters.forEach((chapter) => {
    ["title", "subtitle", "outro"].forEach((field) => {
      push("chapter", `${subject.id}/${chapter.id}`, field, chapter[field]);
    });
    pushObjectStrings("chapter", `${subject.id}/${chapter.id}`, "story", chapter.story);
    chapter.topics.forEach((topic) => {
      ["title", "tag", "hook", "short", "plain", "formula", "example"].forEach((field) => {
        push("topic", topic.id, field, topic[field]);
      });
      ["keywords", "steps", "traps"].forEach((field) => pushArray("topic", topic.id, field, topic[field]));
      (Array.isArray(topic.entry) ? topic.entry : []).forEach((line, index) => {
        ["side", "account", "amount"].forEach((field) => {
          push("topic-entry", topic.id, `entry[${index}].${field}`, line[field]);
        });
      });
      if (topic.question) {
        [
          "goal", "prompt", "keywords", "translate", "options", "hint",
          "wrongHint", "explain", "items", "tokens", "reasonOptions",
          "reasonAnswer", "entry"
        ].forEach((field) => {
          const value = topic.question[field];
          pushObjectStrings("topic-question", topic.id, `question.${field}`, value);
        });
      }
    });
  });
});

const glossaryLabels = [];
data.glossary.forEach((term) => {
  [term.term, term.full, ...(term.aliases || [])].forEach((label) => {
    if (/[A-Za-z]/.test(String(label || ""))) glossaryLabels.push(String(label));
  });
});

const tokenPattern = /[A-Za-z]+(?:[A-Za-z0-9&+./'’/-]*[A-Za-z0-9])?/g;
const tokens = new Map();
const englishSources = [];
sources.forEach((entry) => {
  const matches = [...entry.value.matchAll(tokenPattern)];
  if (!matches.length) return;
  englishSources.push({ ...entry, tokens: [...new Set(matches.map((item) => item[0]))] });
  matches.forEach((item) => {
    const token = item[0];
    const before = entry.value.slice(Math.max(0, item.index - 18), item.index);
    const after = entry.value.slice(item.index + token.length, item.index + token.length + 18);
    const fieldName = entry.field.split(/[.\[]/).pop();
    const formulaField = /formula|numbers/i.test(fieldName);
    const parenthesized = /[（(][^（）()]*$/.test(before) && /^[^（）()]*[）)]/.test(after);
    const rating = /^(AAA|AA|A\+?|BBB)$/i.test(token) && /评级/.test(before + after);
    const symbolOnly = token.length <= 1 || /^\d+$/.test(token);
    const paymentTerm = token.toLowerCase() === "n/30" && /10天内付款减2%/.test(after);
    const explained = formulaField || parenthesized || rating || symbolOnly || paymentTerm;
    const start = Math.max(0, item.index - 28);
    const end = Math.min(entry.value.length, item.index + token.length + 28);
    if (!tokens.has(token)) tokens.set(token, { token, count: 0, bareCount: 0, contexts: [] });
    const record = tokens.get(token);
    record.count += 1;
    if (!explained) record.bareCount += 1;
    if (record.contexts.length < 4) {
      record.contexts.push({
        kind: entry.kind,
        id: entry.id,
        field: entry.field,
        text: entry.value.slice(start, end).replace(/\s+/g, " "),
        explained
      });
    }
  });
});

const tokenRows = [...tokens.values()]
  .map((item) => ({
    ...item,
    glossaryExact: glossaryLabels.some((label) => label.toLowerCase() === item.token.toLowerCase()),
    glossaryContains: glossaryLabels.some((label) => label.toLowerCase().includes(item.token.toLowerCase()))
  }))
  .sort((left, right) => right.count - left.count || left.token.localeCompare(right.token));

const report = {
  generatedAt: new Date().toISOString(),
  sources: sources.length,
  englishSources: englishSources.length,
  uniqueTokens: tokenRows.length,
  glossaryLabels: glossaryLabels.length,
  tokens: tokenRows
};
writeFileSync("work/english-audit.json", `${JSON.stringify(report, null, 2)}\n`);

const likelyBare = tokenRows.filter((item) => item.bareCount > 0);
console.log(JSON.stringify({
  ok: likelyBare.length === 0,
  sources: report.sources,
  englishSources: report.englishSources,
  uniqueTokens: report.uniqueTokens,
  glossaryLabels: report.glossaryLabels,
  likelyBare: likelyBare.slice(0, 100).map(({ token, count, bareCount, contexts }) => ({
    token,
    count,
    bareCount,
    sample: contexts.find((item) => !item.explained)?.text || contexts[0]?.text
  }))
}, null, 2));

if (likelyBare.length) process.exitCode = 1;
