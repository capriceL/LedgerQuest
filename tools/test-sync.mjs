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
    this.files = [];
  }
  appendChild() {}
  remove() {}
  focus() {}
  select() {}
  setAttribute() {}
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
  Blob,
  Response,
  CompressionStream,
  DecompressionStream,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
  FileReader: class {}
});

vm.runInContext(match[1], context, { filename: file });

const result = await vm.runInContext(`
  (async () => {
    const failures = [];
    const notes = [];
    const assert = (condition, message) => {
      if (!condition) failures.push(message);
    };
    const topics = allTopics();
    const first = topics[0];
    const second = topics[1];
    const concepts = CONCEPTS.slice(0, 3);

    const left = defaultProgress();
    left.completed[first.topic.id] = { kind: "clean", attempts: 1, at: "2026-11-20T08:00:00.000Z" };
    left.conceptClears[concepts[0].id] = { attempts: 1, at: "2026-11-20T08:05:00.000Z" };
    left.wrong[first.topic.id] = 2;
    left.xp = 24;
    left.streak = 3;
    left.bestStreak = 3;
    left.totalCorrect = 4;
    left.totalWrong = 2;
    left.last = {
      subjectId: first.subject.id,
      chapterId: first.chapter.id,
      topicId: first.topic.id
    };

    const right = defaultProgress();
    right.completed[first.topic.id] = { kind: "guided", attempts: 3, at: "2026-11-21T08:00:00.000Z" };
    right.completed[second.topic.id] = { kind: "self_corrected", attempts: 2, at: "2026-11-21T08:05:00.000Z" };
    right.conceptClears[concepts[1].id] = { attempts: 2, at: "2026-11-21T08:10:00.000Z" };
    right.wrong[first.topic.id] = 4;
    right.wrong[second.topic.id] = 1;
    right.xp = 31;
    right.streak = 8;
    right.bestStreak = 9;
    right.totalCorrect = 5;
    right.totalWrong = 5;
    right.last = {
      subjectId: second.subject.id,
      chapterId: second.chapter.id,
      topicId: second.topic.id
    };

    const mergedResult = mergeProgress(left, right);
    const merged = mergedResult.progress;
    assert(Object.keys(merged.completed).length === 2, "Merged completion records should be a union");
    assert(merged.completed[first.topic.id].kind === "clean", "Best completion quality should win");
    assert(merged.completed[second.topic.id].kind === "self_corrected", "Incoming completion should be preserved");
    assert(Object.keys(merged.conceptClears).length === 2, "Concept clears should be merged");
    assert(merged.wrong[first.topic.id] === 4, "Wrong-answer count should keep the larger observed value");
    assert(merged.wrong[second.topic.id] === 1, "Distinct wrong-answer topic should be preserved");
    assert(merged.totalWrong >= 5, "Total wrong count should not lose merged records");
    assert(merged.streak === 3, "Current streak should stay local to this device");
    assert(merged.bestStreak === 9, "Best streak should keep the maximum");
    assert(merged.last.topicId === first.topic.id, "Existing local continue target should be preserved");
    assert(merged.xp >= Math.max(left.xp, right.xp), "Merged XP should not decrease");
    assert(mergedResult.summary.addedCompleted === 1, "Merge summary should count new story clears");
    assert(mergedResult.summary.addedConceptClears === 1, "Merge summary should count new concept clears");

    const idempotent = mergeProgress(merged, right).progress;
    assert(Object.keys(idempotent.completed).length === 2, "Repeated merge must not duplicate story clears");
    assert(Object.keys(idempotent.conceptClears).length === 2, "Repeated merge must not duplicate concept clears");
    assert(idempotent.totalWrong === merged.totalWrong, "Repeated merge must not inflate wrong counts");
    assert(idempotent.xp === merged.xp, "Repeated merge must not inflate XP");

    const emptyMerge = mergeProgress(merged, defaultProgress());
    assert(emptyMerge.summary.addedCompleted === 0, "Empty import should not add story clears");
    assert(emptyMerge.summary.addedConceptClears === 0, "Empty import should not add concept clears");
    assert(emptyMerge.progress.totalWrong === merged.totalWrong, "Empty import should not change wrong totals");
    assert(emptyMerge.progress.xp === merged.xp, "Empty import should not change XP");

    const compressedCode = await buildProgressSyncCode(merged);
    const compressedRoundTrip = await parseProgressSyncText(compressedCode);
    assert(compressedCode.startsWith("LQ1Z."), "Compression-capable runtime should emit a compressed sync code");
    assert(Object.keys(compressedRoundTrip.completed).length === 2, "Compressed code lost story clears");
    assert(Object.keys(compressedRoundTrip.conceptClears).length === 2, "Compressed code lost concept clears");
    assert(compressedRoundTrip.wrong[first.topic.id] === 4, "Compressed code lost wrong-answer counts");

    const rawCode = await buildProgressSyncCode(merged, { compress: false });
    const rawRoundTrip = await parseProgressSyncText(rawCode);
    assert(rawCode.startsWith("LQ1U."), "Uncompressed fallback should use the raw code prefix");
    assert(Object.keys(rawRoundTrip.completed).length === 2, "Uncompressed code lost story clears");

    const backupText = buildProgressBackupText(merged);
    const backupRoundTrip = await parseProgressSyncText(backupText);
    assert(Object.keys(backupRoundTrip.conceptClears).length === 2, "Backup JSON lost concept clears");

    const bulk = defaultProgress();
    topics.forEach(({ topic }) => {
      bulk.completed[topic.id] = { kind: "clean", attempts: 1, at: null };
    });
    CONCEPTS.forEach((concept) => {
      bulk.conceptClears[concept.id] = { attempts: 1, at: null };
    });
    const bulkCode = await buildProgressSyncCode(bulk);
    const bulkBackup = JSON.stringify(bulk);
    assert(bulkCode.length < bulkBackup.length, "Compressed sync code should be smaller than raw progress JSON");

    progress = merged;
    saveProgress();
    const beforeFailure = localStorage.getItem(SAVE_KEY);
    let invalidRejected = false;
    try {
      await applyProgressSyncText("not-a-sync-code");
    } catch (error) {
      invalidRejected = true;
    }
    assert(invalidRejected, "Invalid sync text should be rejected");
    assert(localStorage.getItem(SAVE_KEY) === beforeFailure, "Invalid sync text must not change saved progress");

    const lastCharacter = compressedCode.slice(-1);
    const tamperedCode = compressedCode.slice(0, -1) + (lastCharacter === "A" ? "B" : "A");
    let tamperedRejected = false;
    try {
      await parseProgressSyncText(tamperedCode);
    } catch (error) {
      tamperedRejected = true;
    }
    assert(tamperedRejected, "Tampered sync code should fail checksum validation");

    let wrongTypeRejected = false;
    try {
      await parseProgressSyncText(JSON.stringify({
        app: "LedgerQuest",
        type: "progress-sync",
        schema: 1,
        progress: []
      }));
    } catch (error) {
      wrongTypeRejected = true;
    }
    assert(wrongTypeRejected, "Invalid progress payload should be rejected");

    assert(typeof window.LedgerQuestSync?.encode === "function", "Public sync extension interface is missing");
    assert(typeof window.LedgerQuestSync?.merge === "function", "Public merge extension interface is missing");

    return {
      failures,
      notes,
      compressedCodeLength: compressedCode.length,
      rawCodeLength: rawCode.length,
      bulkCodeLength: bulkCode.length,
      bulkBackupLength: bulkBackup.length,
      mergedCompleted: Object.keys(merged.completed).length,
      mergedConceptClears: Object.keys(merged.conceptClears).length,
      mergedTotalWrong: merged.totalWrong,
      mergedXp: merged.xp
    };
  })()
`, context);

console.log(JSON.stringify(result, null, 2));
if (result.failures.length) process.exitCode = 1;
