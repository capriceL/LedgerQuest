import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const edgeCandidates = [
  process.env.EDGE_PATH,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
  "/usr/bin/microsoft-edge",
  "/usr/bin/microsoft-edge-stable",
  "/usr/bin/google-chrome"
].filter(Boolean);
const edge = edgeCandidates.find((candidate) => existsSync(candidate));
if (!edge) {
  throw new Error("未找到 Chromium 浏览器；请通过 EDGE_PATH 指定可执行文件。");
}
const port = 9333;
const profile = path.join(process.cwd(), "work", "edge-cdp-profile");
const pageUrl = pathToFileURL(path.resolve("LedgerQuest.html")).href;
mkdirSync(profile, { recursive: true });

const child = spawn(edge, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

const waitForTarget = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find((item) => item.type === "page");
      if (target) return target;
    } catch {}
    await sleep(150);
  }
  throw new Error("Edge debugging target did not start.");
};

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const call = (method, params = {}) => new Promise((resolve, reject) => {
  const messageId = ++id;
  pending.set(messageId, { resolve, reject });
  socket.send(JSON.stringify({ id: messageId, method, params }));
});

const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
};

const metrics = (width, height) => call("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: width < 600
});

const screenshot = async (path) => {
  const result = await call("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  writeFileSync(path, Buffer.from(result.data, "base64"));
};

const navigate = async () => {
  await call("Page.navigate", { url: pageUrl });
  await sleep(700);
};

const results = {};
try {
  await call("Page.enable");
  await call("Runtime.enable");

  await metrics(390, 844);
  await navigate();
  results.mobile = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    subjects: [...document.querySelectorAll(".subject-card h3")].map((node) => node.textContent),
    heroArt: document.querySelector(".avatar-hero .yoyo-emoji")?.textContent === "🧑🏻‍💼",
    errorPage: Boolean(document.querySelector(".empty-state b")?.textContent.includes("校验"))
  }))()`);
  await screenshot("work/edge-home-mobile.png");
  await evaluate("localStorage.clear()");

  await metrics(1440, 1100);
  await navigate();
  results.desktop = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    subjects: [...document.querySelectorAll(".subject-card h3")].map((node) => node.textContent),
    topicCount: document.querySelector(".hero-stats")?.textContent,
    errorPage: Boolean(document.querySelector(".empty-state b")?.textContent.includes("校验"))
  }))()`);
  await screenshot("work/edge-home-desktop.png");

  await evaluate(`document.querySelector('[data-action="open-help"]').click()`);
  results.help = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    version: /^v\\d+\\.\\d+\\.\\d+(?:-rc\\.\\d+)?$/.test(APP_VERSION)
      && document.body.textContent.includes(APP_VERSION),
    filePolicyHidden: !document.body.textContent.includes("交付文件统一使用同一文件名")
  }))()`);
  await screenshot("work/edge-help-desktop.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`document.querySelector('[data-action="nav-progress"]').click()`);
  results.progress = await evaluate(`(() => ({
    title: document.querySelector(".page-head h1")?.textContent,
    version: /^v\\d+\\.\\d+\\.\\d+(?:-rc\\.\\d+)?$/.test(APP_VERSION)
      && Boolean(document.querySelector(".progress-panel")?.textContent.includes(APP_VERSION)),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
  }))()`);
  await screenshot("work/edge-progress-desktop.png");
  await evaluate(`document.querySelector('[data-action="home"]').click()`);

  await evaluate(`document.querySelector('[data-action="continue"]').click()`);
  results.level = await evaluate(`(() => ({
    title: document.querySelector(".topic-heading h2")?.textContent,
    hasTranslate: Boolean(document.querySelector(".translate-box")),
    keywordCount: document.querySelectorAll(".level-teach .chip").length,
    hasTeach: Boolean(document.querySelector(".level-teach .teach-human")),
    teachText: document.querySelector(".level-teach .teach-human")?.textContent.trim() || "",
    teachBeforeTask: Boolean(
      document.querySelector(".level-teach")?.getBoundingClientRect().bottom
      <= document.querySelector(".task-card")?.getBoundingClientRect().top + 2
    ),
    submitDisabled: document.querySelector('[data-action="submit-answer"]')?.disabled,
    answerOptions: document.querySelectorAll(".answer-zone .option-btn").length,
    playerArt: document.querySelector(".mini-avatar.player .yoyo-emoji")?.textContent === "🧑🏻‍💼"
  }))()`);
  await screenshot("work/edge-level-desktop.png");

  await evaluate(`document.querySelector(".answer-zone .option-btn").click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.firstCorrect = await evaluate(`(() => ({
    correct: Boolean(document.querySelector(".feedback.correct")),
    hasHuman: Boolean(document.querySelector(".feedback.correct .feedback-human")),
    hasQuestionGoal: document.body.textContent.includes("题目刚才在问什么"),
    badge: document.querySelector(".completion-badge")?.textContent,
    next: document.querySelector('[data-action="next-topic"]')?.textContent.trim()
  }))()`);

  await evaluate(`document.querySelector('[data-action="next-topic"]').click()`);
  results.secondTitle = await evaluate(`document.querySelector(".topic-heading h2")?.textContent`);
  await evaluate(`document.querySelector(".answer-zone .option-btn").click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.firstWrong = await evaluate(`(() => ({
    wrong: Boolean(document.querySelector(".feedback.wrong")),
    breakdown: Boolean(document.querySelector(".feedback.wrong.breakdown"))
  }))()`);
  await evaluate(`document.querySelector('[data-action="retry"]').click()`);
  await evaluate(`document.querySelector(".answer-zone .option-btn").click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.secondWrong = await evaluate(`(() => ({
    breakdown: Boolean(document.querySelector(".feedback.wrong.breakdown")),
    steps: document.querySelectorAll(".mini-steps li").length
  }))()`);

  await evaluate(`document.querySelector('[data-action="retry"]').click()`);
  await evaluate(`document.querySelectorAll(".answer-zone .option-btn")[2].click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.selfCorrected = await evaluate(`document.querySelector(".completion-badge")?.textContent`);

  await evaluate(`document.querySelector('[data-action="open-detail"]').click()`);
  results.detail = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasPlain: document.body.textContent.includes("先懂知识 · 再动笔"),
    hasHuman: Boolean(document.querySelector(".modal .teach-human")),
    hasNumbers: document.body.textContent.includes("拿什么数字"),
    hasQuestion: document.body.textContent.includes("题目要你做什么"),
    hasSource: document.body.textContent.includes("出处 / 核对"),
    questionAfterTeaching: (() => {
      const details = [...document.querySelectorAll(".modal details")];
      const question = details.find((node) => node.textContent.includes("本关原题"));
      const human = document.querySelector(".modal .teach-human");
      return Boolean(question && human && human.getBoundingClientRect().top < question.getBoundingClientRect().top);
    })()
  }))()`);
  await screenshot("work/edge-detail-desktop.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`document.querySelector('[data-action="nav-library"]').click()`);
  results.library = await evaluate(`(() => ({
    concepts: CONCEPTS.length,
    glossary: GLOSSARY.length,
    syllabusMatched: SYLLABUS_META?.matchedTotal,
    syllabusRequired: SYLLABUS_META?.requiredTotal,
    tabs: document.querySelectorAll(".library-mode-tab").length,
    groups: document.querySelectorAll(".concept-group").length,
    cards: document.querySelectorAll(".concept-row").length,
    hasChapterCatalog: Boolean(document.querySelector(".chapter-catalog")),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
  }))()`);
  await screenshot("work/edge-library-desktop.png");

  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "会计信息质量要求";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.conceptSearch = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent),
    resultBar: document.querySelector(".concept-result-bar")?.textContent.replace(/\\s+/g, " ").trim()
  }))()`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll(".concept-row")]
      .find((node) => node.querySelector("h3")?.textContent.trim() === "会计信息质量要求");
    row?.click();
  })()`);
  results.conceptModal = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasPlain: document.body.textContent.includes("先懂再做题 · 人话版"),
    hasHuman: Boolean(document.querySelector(".modal .teach-human")),
    hasExample: document.body.textContent.includes("数字小例子") || document.body.textContent.includes("拿什么数字来算"),
    legacyEnglishButton: Boolean(document.querySelector('[data-action="open-concept-english"]')),
    legacyEnglishBlock: document.body.textContent.includes("English / 行业叫法"),
    hasSyllabusRefs: document.body.textContent.includes("考试范围索引")
  }))()`);
  await screenshot("work/edge-concept-detail.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "金融资产三分类";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll(".concept-row")]
      .find((node) => node.querySelector("h3")?.textContent.includes("金融资产三分类"));
    row.click();
  })()`);
  results.conceptTermDisplay = await evaluate(`(() => {
    const text = document.querySelector(".modal")?.textContent.replace(/\\s+/g, " ") || "";
    return {
      title: document.querySelector(".modal-head h2")?.textContent,
      hasSppiPhrase: text.includes("合同现金流仅含本息（SPPI）"),
      hasFvociPhrase: text.includes("以公允价值计量且其变动计入其他综合收益（FVOCI）"),
      hasFvtplPhrase: text.includes("以公允价值计量且其变动计入当期损益（FVTPL）"),
      legacyTermLinks: document.querySelectorAll('.modal .term-link, .modal [data-action="open-term"]').length,
      legacyEnglishBlock: text.includes("English / 行业叫法")
    };
  })()`);
  await screenshot("work/edge-concept-terms.png");
  await metrics(390, 844);
  results.conceptTermDisplayMobile = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    modalScrollWidth: document.querySelector(".modal")?.scrollWidth,
    modalWidth: document.querySelector(".modal")?.clientWidth
  }))()`);
  await screenshot("work/edge-concept-terms-mobile.png");
  await metrics(1440, 1100);
  await evaluate(`document.querySelector(".modal-close").click()`);

  results.localizationAudit = await evaluate(`(() => {
    const records = [];
    const push = (field, context, value) => {
      if (typeof value === "string" && value.trim()) records.push({ field, context, value });
    };
    const pushMany = (field, context, values) => {
      (Array.isArray(values) ? values : []).forEach((value) => push(field, context, value));
    };
    CONCEPTS.forEach((concept) => {
      const context = { subjectId: concept.subjectId, conceptId: concept.id };
      ["title", "kind", "plain", "howTo", "formula", "example", "trap"].forEach((field) => {
        push(field, context, concept[field]);
      });
      pushMany("aliases", context, concept.aliases);
      pushMany("keywords", context, concept.keywords);
    });
    SUBJECTS.forEach((subject) => {
      const subjectContext = { subjectId: subject.id };
      ["name", "short", "desc"].forEach((field) => push(field, subjectContext, subject[field]));
      subject.chapters.forEach((chapter) => {
        const chapterContext = { ...subjectContext, chapterId: chapter.id };
        ["title", "subtitle", "outro"].forEach((field) => push(field, chapterContext, chapter[field]));
        if (chapter.story) Object.values(chapter.story).forEach((value) => push("story", chapterContext, value));
        chapter.topics.forEach((topic) => {
          const topicContext = { ...chapterContext, topicId: topic.id };
          ["title", "tag", "hook", "short", "plain", "formula", "example", "tip"].forEach((field) => {
            push(field, topicContext, topic[field]);
          });
          ["keywords", "steps", "traps"].forEach((field) => pushMany(field, topicContext, topic[field]));
          const question = topic.question || {};
          ["goal", "prompt", "translate", "hint", "wrongHint", "explain"].forEach((field) => {
            push(field, topicContext, question[field]);
          });
          ["keywords", "options", "items", "tokens", "reasonOptions"].forEach((field) => {
            pushMany(field, topicContext, question[field]);
          });
        });
      });
    });

    const surfaces = [];
    const seen = new Set();
    GLOSSARY.forEach((term) => {
      [term.term, term.full, ...(Array.isArray(term.aliases) ? term.aliases : [])].forEach((surface) => {
        const value = String(surface || "").trim();
        const key = value.toLowerCase();
        if (value.length < 2 || !/[A-Za-z]/.test(value) || seen.has(key)) return;
        seen.add(key);
        surfaces.push(value);
      });
    });
    surfaces.sort((left, right) => right.length - left.length);

    const bad = [];
    records.forEach(({ field, context, value }) => {
      if (field === "formula") return;
      if (field === "aliases" && !/[\u3400-\u9fff]/.test(value)) return;
      const shown = localizeDisplayText(value, { ...context, field });
      const lower = shown.toLowerCase();
      for (const surface of surfaces) {
        const needle = surface.toLowerCase();
        let from = 0;
        while (from < lower.length) {
          const index = lower.indexOf(needle, from);
          if (index < 0) break;
          const previous = shown[index - 1] || "";
          const next = shown[index + surface.length] || "";
          const boundary = !/[A-Za-z0-9]/.test(previous) && !/[A-Za-z0-9]/.test(next);
          const before = shown.slice(0, index);
          const openParenthesis = before.lastIndexOf("（");
          const closeParenthesis = before.lastIndexOf("）");
          const nextClose = shown.indexOf("）", index + surface.length);
          const insideChineseParentheses = openParenthesis > closeParenthesis
            && nextClose >= 0
            && /[\u3400-\u9fff]/.test(shown.slice(Math.max(0, openParenthesis - 16), openParenthesis));
          if (boundary && previous !== "（" && previous !== "(" && !insideChineseParentheses) {
            bad.push({
              field,
              id: context.conceptId || context.topicId || context.chapterId || context.subjectId,
              surface,
              sample: shown.slice(Math.max(0, index - 24), index + surface.length + 24)
            });
            break;
          }
          from = index + Math.max(1, needle.length);
        }
      }
    });

    const formulaTermMisses = [];
    const requiredFormulaTerms = ["SPPI", "FVOCI", "FVTPL"];
    records.filter((record) => record.field === "formula").forEach(({ context, value }) => {
      const shown = localizeDisplayText(value, { ...context, field: "formula" });
      requiredFormulaTerms.forEach((term) => {
        if (value.includes(term) && !shown.includes("（" + term + "）")) {
          formulaTermMisses.push({ id: context.conceptId || context.topicId, term });
        }
      });
    });

    return {
      records: records.length,
      surfaces: surfaces.length,
      badCount: bad.length,
      bad: bad.slice(0, 12),
      formulaTermMissCount: formulaTermMisses.length,
      formulaTermMisses: formulaTermMisses.slice(0, 12)
    };
  })()`);

  results.challengeAudit = await evaluate(`(() => {
    const bad = [];
    for (const concept of CONCEPTS) {
      const questions = buildConceptChallenge(concept);
      if (questions.length < 3 || questions.some((question) => (
        question.options.length !== 4
        || question.answer < 0
        || question.options.some((option) => !String(option || "").trim())
      ))) {
        bad.push(concept.id);
      }
    }
    return { concepts: CONCEPTS.length, bad: bad.slice(0, 10), badCount: bad.length };
  })()`);

  await evaluate(`document.querySelector('[data-action="reset-concept-filters"]').click()`);
  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "票据无因性";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await evaluate(`document.querySelector(".concept-row").click()`);
  results.challengeSource = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasButton: Boolean(document.querySelector('[data-action="start-concept-challenge"]'))
  }))()`);
  await evaluate(`document.querySelector('[data-action="start-concept-challenge"]').click()`);
  results.challengeStart = await evaluate(`(() => ({
    title: document.querySelector(".challenge-concept h3")?.textContent,
    progress: document.querySelector(".challenge-top")?.textContent.replace(/\\s+/g, " ").trim(),
    keywordCheat: document.querySelector(".challenge-cheat")?.textContent.replace(/\\s+/g, " ").trim(),
    goal: document.querySelector(".challenge-question p")?.textContent.trim(),
    options: document.querySelectorAll(".challenge-question + .option-list .option-btn").length,
    submitDisabled: document.querySelector('[data-action="challenge-submit"]')?.disabled
  }))()`);
  await metrics(390, 844);
  results.mobileChallenge = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    modalWidth: document.querySelector(".modal")?.getBoundingClientRect().width,
    cheatColumns: getComputedStyle(document.querySelector(".challenge-cheat")).gridTemplateColumns
  }))()`);
  await screenshot("work/edge-challenge-mobile.png");
  await metrics(1440, 1100);
  await evaluate(`(() => {
    const answer = view.challenge.questions[view.challenge.step].answer;
    const wrong = [...document.querySelectorAll(".challenge-question + .option-list .option-btn")]
      .find((node, index) => index !== answer);
    wrong.click();
    document.querySelector('[data-action="challenge-submit"]').click();
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 650));
  results.challengeWrong = await evaluate(`(() => ({
    wrong: Boolean(document.querySelector(".challenge-question ~ .feedback.wrong")),
    retry: Boolean(document.querySelector('[data-action="challenge-retry"]')),
    hint: document.querySelector(".feedback.wrong .explain-box")?.textContent.trim(),
    feedbackTop: document.querySelector(".feedback.wrong")?.getBoundingClientRect().top,
    feedbackBottom: document.querySelector(".feedback.wrong")?.getBoundingClientRect().bottom,
    actionsPosition: getComputedStyle(document.querySelector(".challenge-actions")).position,
    actionsBottom: document.querySelector(".challenge-actions")?.getBoundingClientRect().bottom,
    viewport: innerHeight
  }))()`);
  await screenshot("work/edge-challenge-wrong.png");
  await evaluate(`document.querySelector('[data-action="challenge-retry"]').click()`);
  await evaluate(`(() => {
    while (!view.challenge.done) {
      const state = view.challenge;
      const question = state.questions[state.step];
      document.querySelectorAll(".challenge-question + .option-list .option-btn")[question.answer].click();
      document.querySelector('[data-action="challenge-submit"]').click();
      if (!view.challenge.done) document.querySelector('[data-action="challenge-next"]').click();
    }
  })()`);
  results.challengeComplete = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem("ledgerquest.progress.v2") || "{}");
    return {
      done: Boolean(document.querySelector(".challenge-complete")),
      title: document.querySelector(".challenge-complete h3")?.textContent,
      seal: document.querySelector(".challenge-seal")?.textContent.replace(/\\s+/g, ""),
      hasExample: Boolean(document.querySelector(".modal .example-box")),
      cleared: Boolean(saved.conceptClears?.["law-e06-ext-01"]),
      nextButton: document.querySelector('[data-action="challenge-next-concept"]')?.textContent.trim(),
      message: document.querySelector(".challenge-complete p")?.textContent.trim()
    };
  })()`);
  await screenshot("work/edge-challenge-complete.png");

  await metrics(390, 844);
  results.mobileChallengeComplete = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    modalWidth: document.querySelector(".modal")?.getBoundingClientRect().width,
    seal: document.querySelector(".challenge-seal")?.getBoundingClientRect().width,
    actions: [...document.querySelectorAll(".challenge-actions button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: button.textContent.trim(),
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        visible: rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1
      };
    })
  }))()`);
  await screenshot("work/edge-challenge-complete-mobile.png");
  await metrics(1440, 1100);
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`(() => {
    document.querySelector('[data-action="reset-concept-filters"]').click();
    const subject = document.querySelector("#library-filter");
    subject.value = "practice";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const chapter = document.querySelector("#library-chapter-filter");
    chapter.value = "p02";
    chapter.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  results.chapterFilter = await evaluate(`(() => ({
    groups: document.querySelectorAll(".concept-group").length,
    heading: document.querySelector(".concept-group-head h2")?.textContent,
    cards: document.querySelectorAll(".concept-row").length,
    expectedCards: CONCEPTS.filter((concept) => concept.subjectId === "practice" && concept.chapterId === "p02").length,
    hasMap: Boolean(document.querySelector(".chapter-map")),
    hasMapEntry: Boolean(document.querySelector(".chapter-map .teaching-entry")),
    mapText: document.querySelector(".chapter-map")?.textContent.replace(/\\s+/g, " ").trim() || ""
  }))()`);

  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "毛利率法";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.practiceNewCard = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  await evaluate(`(() => {
    document.querySelector('[data-action="reset-concept-filters"]').click();
    const subject = document.querySelector("#library-filter");
    subject.value = "practice";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector("#concept-search");
    input.value = "内部研究开发支出的账务处理";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.researchAccountingSearch = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "发生日的会计处理";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.foreignCurrencyDateSearch = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);

  await evaluate(`(() => {
    document.querySelector('[data-action="reset-concept-filters"]').click();
    const subject = document.querySelector("#library-filter");
    subject.value = "practice";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const chapter = document.querySelector("#library-chapter-filter");
    chapter.value = "p12";
    chapter.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  results.incomeChapterMap = await evaluate(`(() => ({
    expected: CONCEPTS.filter((concept) => concept.subjectId === "practice" && concept.chapterId === "p12").length,
    shown: document.querySelectorAll(".concept-row").length,
    hasFiveStep: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("五步法")),
    hasTiming: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("时段法与时点法")),
    hasFinancing: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("重大融资成分")),
    hasReturn: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("销售退回")),
    hasAllocation: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("交易价格分摊")),
    hasResidual: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("客户未行使的权利")),
    hasVariable: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("可变对价")),
    hasContractCost: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("合同取得成本")),
    hasWarranty: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("质量保证")),
    hasPrincipalAgent: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("主要责任人与代理人")),
    hasLicense: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("知识产权许可")),
    hasRepurchase: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("售后回购")),
    hasInitialFee: [...document.querySelectorAll(".concept-row h3")].some((node) => node.textContent.includes("无需退回的初始费")),
    hasEntry: Boolean(document.querySelector(".chapter-map .teaching-entry")),
    mapText: document.querySelector(".chapter-map")?.textContent.replace(/\\s+/g, " ").trim() || ""
  }))()`);
  await screenshot("work/edge-income-map.png");

  await evaluate(`(() => {
    const reset = document.querySelector('[data-action="reset-concept-filters"]');
    if (reset) reset.click();
    const subject = document.querySelector("#library-filter");
    subject.value = "law";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector("#concept-search");
    input.value = "仲裁";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.lawConceptSearch = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent),
    resultBar: document.querySelector(".concept-result-bar")?.textContent.replace(/\\s+/g, " ").trim()
  }))()`);
  await evaluate(`document.querySelector(".concept-row")?.click()`);
  results.lawConceptModal = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasPlain: document.body.textContent.includes("先懂再做题 · 人话版"),
    hasHuman: Boolean(document.querySelector(".modal .teach-human")),
    hasExample: document.body.textContent.includes("数字小例子") || document.body.textContent.includes("拿什么数字来算"),
    hasSyllabusRefs: document.body.textContent.includes("考试范围索引"),
    legacyTermLinks: document.querySelectorAll('.modal .term-link, .modal [data-action="open-term"]').length
  }))()`);
  await screenshot("work/edge-law-concept-detail.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`(() => {
    const subject = document.querySelector("#library-filter");
    subject.value = "law";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector("#concept-search");
    input.value = "票据追索";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const lawBillingAlias = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "证券虚假陈述";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  const lawSecuritiesAlias = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  results.lawAliasChecks = { billing: lawBillingAlias, securities: lawSecuritiesAlias };

  await evaluate(`(() => {
    document.querySelector('[data-action="reset-concept-filters"]').click();
    const subject = document.querySelector("#library-filter");
    subject.value = "finance";
    subject.dispatchEvent(new Event("change", { bubbles: true }));
    const input = document.querySelector("#concept-search");
    input.value = "预算的编制方法";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.budgetMethodSearch = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  await evaluate(`(() => {
    const input = document.querySelector("#concept-search");
    input.value = "递延年金";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  results.financeNewCard = await evaluate(`(() => ({
    count: document.querySelectorAll(".concept-row").length,
    titles: [...document.querySelectorAll(".concept-row h3")].map((node) => node.textContent)
  }))()`);
  await evaluate(`document.querySelector(".concept-row")?.click()`);
  results.financeFormulaLegend = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasLegend: Boolean(document.querySelector(".modal .formula-legend")),
    legendText: document.querySelector(".modal .formula-legend")?.textContent.replace(/\\s+/g, " ").trim() || "",
    hasChineseLegend: /[\u3400-\u9fff]（[A-Za-z\u03b2]/.test(
      document.querySelector(".modal .formula-legend")?.textContent || ""
    )
  }))()`);
  await evaluate(`document.querySelector(".modal-close").click()`);

  await metrics(390, 844);
  await evaluate(`document.querySelector('[data-action="reset-concept-filters"]').click()`);
  results.mobileLibrary = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    tabsRight: Math.max(...[...document.querySelectorAll(".library-mode-tab")].map((node) => node.getBoundingClientRect().right)),
    filterWidths: [...document.querySelectorAll(".concept-tools .filter-select")].map((node) => node.getBoundingClientRect().width)
  }))()`);
  await screenshot("work/edge-library-mobile.png");
  await metrics(1440, 1100);

  await evaluate(`document.querySelector('[data-action="nav-map"]').click()`);
  await evaluate(`document.querySelector('[data-action="go-subject"][data-subject="finance"]').click()`);
  await evaluate(`document.querySelector('[data-action="start-chapter"][data-chapter="f03"]').click()`);
  results.sortInitial = await evaluate(`(() => ({
    title: document.querySelector(".topic-heading h2")?.textContent,
    labels: [...document.querySelectorAll(".sort-item")].map((node) => node.textContent.trim())
  }))()`);
  await evaluate(`(() => {
    const wanted = [
      "确定战略与经营目标",
      "编制全面预算",
      "执行预算并控制差异",
      "按程序进行预算调整",
      "开展预算考核与评价"
    ];
    for (const text of wanted) {
      const button = [...document.querySelectorAll(".sort-item")].find((node) => node.textContent.trim() === text);
      if (!button) throw new Error("Missing sort item: " + text);
      button.click();
    }
  })()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.sortCorrect = await evaluate(`Boolean(document.querySelector(".feedback.correct"))`);
  await screenshot("work/edge-sort-desktop.png");

  await metrics(390, 844);
  results.mobileLevel = await evaluate(`(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    stickyFooter: getComputedStyle(document.querySelector(".level-footer")).position,
    footerBottom: getComputedStyle(document.querySelector(".level-footer")).bottom
  }))()`);
  await screenshot("work/edge-level-mobile.png");

  await call("Page.reload");
  await sleep(700);
  results.persisted = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem("ledgerquest.progress.v2") || "null");
    return {
      completed: Object.keys(saved?.completed || {}),
      xp: saved?.xp,
      homeRendered: Boolean(document.querySelector(".hero"))
    };
  })()`);

  await evaluate(`document.querySelector('[data-action="nav-map"]').click()`);
  await evaluate(`document.querySelector('[data-action="start-chapter"][data-chapter="p01"]').click()`);
  await evaluate(`document.querySelector(".answer-zone .option-btn").click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  await evaluate(`document.querySelector('[data-action="next-topic"]').click()`);
  await evaluate(`document.querySelectorAll(".answer-zone .option-btn")[2].click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  await evaluate(`document.querySelector('[data-action="next-topic"]').click()`);
  results.chapterOutro = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    chapter: document.querySelector(".chapter-pass h3")?.textContent,
    recapCards: document.querySelectorAll(".recap-card").length,
    nextChapter: document.querySelector('[data-action="open-next-chapter"]')?.textContent.trim()
  }))()`);
  await screenshot("work/edge-chapter-outro.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await evaluate(`document.querySelector('[data-action="nav-map"]').click()`);
  await evaluate(`document.querySelector('[data-action="go-subject"][data-subject="law"]').click()`);
  results.lawMap = await evaluate(`(() => ({
    tabs: document.querySelectorAll(".subject-tab").length,
    chapters: document.querySelectorAll(".chapter-card").length,
    firstChapter: document.querySelector(".chapter-card h3")?.textContent,
    tabRight: Math.max(...[...document.querySelectorAll(".subject-tab")].map((node) => node.getBoundingClientRect().right)),
    viewport: innerWidth
  }))()`);
  await screenshot("work/edge-law-map.png");
  await evaluate(`document.querySelector('[data-action="start-chapter"][data-chapter="e01"]').click()`);
  results.lawLevel = await evaluate(`(() => ({
    title: document.querySelector(".topic-heading h2")?.textContent,
    keywords: document.querySelectorAll(".level-teach .chip").length,
    hasTeach: Boolean(document.querySelector(".level-teach .teach-human")),
    translate: document.querySelector(".translate-box")?.textContent.trim()
  }))()`);
  await screenshot("work/edge-law-level.png");

  await evaluate(`(() => {
    progress.completed["p03-t1"] = { kind: "clean", attempts: 1, at: null };
    progress.completed["p03-t2"] = { kind: "clean", attempts: 1, at: null };
    saveProgress();
    openTopic("p03-t3");
  })()`);
  results.journal = await evaluate(`(() => ({
    title: document.querySelector(".topic-heading h2")?.textContent,
    vouchers: document.querySelectorAll(".voucher-option").length,
    lines: document.querySelectorAll(".voucher-option .journal-line").length,
    teachHasEntryHint: Boolean(document.querySelector(".level-teach .teach-human")?.textContent.includes("折旧分录")),
    translate: document.querySelector(".translate-box")?.textContent.trim()
  }))()`);
  await evaluate(`document.querySelector(".voucher-option").click()`);
  await evaluate(`document.querySelector('[data-action="submit-answer"]').click()`);
  results.journal.correct = await evaluate(`Boolean(document.querySelector(".feedback.correct"))`);
  results.journal.correctEntryVisible = await evaluate(`(() => ({
    human: Boolean(document.querySelector(".feedback.correct .feedback-human")),
    entry: Boolean(document.querySelector(".feedback.correct .teaching-entry .journal-line")),
    entryReason: Boolean(document.querySelector(".feedback.correct .teaching-entry .journal-why")?.textContent.trim().length > 8)
  }))()`);
  await screenshot("work/edge-journal-desktop.png");

  await metrics(1440, 1100);
  await evaluate(`document.querySelector('[data-action="nav-progress"]').click()`);
  await evaluate(`document.querySelector('[data-action="open-sync"]').click()`);
  results.syncDesktop = await evaluate(`(() => ({
    modalWidth: document.querySelector(".modal")?.getBoundingClientRect().width,
    viewport: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    modalOverflow: document.querySelector(".modal")?.scrollWidth > document.querySelector(".modal")?.clientWidth + 1
  }))()`);
  await screenshot("work/edge-sync-desktop.png");
  await evaluate(`document.querySelector(".modal-close").click()`);

  await metrics(390, 844);
  await evaluate(`document.querySelector('[data-action="open-sync"]').click()`);
  results.syncInitial = await evaluate(`(() => ({
    title: document.querySelector(".modal-head h2")?.textContent,
    hasSummary: document.querySelectorAll(".sync-summary span").length === 3,
    hasGenerate: Boolean(document.querySelector('[data-action="generate-sync-code"]')),
    hasImport: Boolean(document.querySelector('[data-action="import-sync-text"]')),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    modalOverflow: document.querySelector(".modal")?.scrollWidth > document.querySelector(".modal")?.clientWidth + 1
  }))()`);
  await evaluate(`document.querySelector('[data-action="generate-sync-code"]').click()`);
  await sleep(300);
  results.syncGenerated = await evaluate(`(() => {
    const code = document.getElementById("sync-code")?.value || "";
    return {
      hasCode: code.startsWith("LQ1Z.") || code.startsWith("LQ1U."),
      length: code.length,
      hasCopy: !document.querySelector('[data-action="copy-sync-code"]')?.disabled,
      hasBackup: Boolean(document.querySelector('[data-action="download-sync-file"]')),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      modalOverflow: document.querySelector(".modal")?.scrollWidth > document.querySelector(".modal")?.clientWidth + 1
    };
  })()`);
  await screenshot("work/edge-sync-mobile.png");
  await evaluate(`(() => {
    window.__ledgerSyncCode = document.getElementById("sync-code")?.value || "";
    document.querySelector(".modal-close").click();
    progress = defaultProgress();
    progress.completed["f01-t1"] = { kind: "clean", attempts: 1, at: new Date().toISOString() };
    saveProgress();
    document.querySelector('[data-action="open-sync"]').click();
    const area = document.getElementById("sync-paste");
    area.value = window.__ledgerSyncCode;
    area.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-action="import-sync-text"]').click();
  })()`);
  await sleep(500);
  results.syncImported = await evaluate(`(() => {
    const saved = JSON.parse(localStorage.getItem("ledgerquest.progress.v2") || "{}");
    return {
      success: Boolean(document.querySelector(".sync-notice.success")),
      message: document.querySelector(".sync-notice")?.textContent.trim() || "",
      localOnlyKept: Boolean(saved.completed?.["f01-t1"]),
      remoteRecordsRestored: Object.keys(saved.completed || {}).length >= 2,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1
    };
  })()`);
  await screenshot("work/edge-sync-imported-mobile.png");

  const failures = [];
  if (results.mobile.scrollWidth > results.mobile.innerWidth + 1) failures.push("Mobile home has horizontal overflow");
  if (!results.mobile.subjects.includes("中级经济法")) failures.push("Law subject missing on mobile home");
  if (!results.mobile.heroArt) failures.push("Yoyo hero illustration is missing");
  if (results.desktop.subjects.length !== 3) failures.push("Desktop did not render three subjects");
  if (results.help.title !== "怎么玩" || !results.help.version || !results.help.filePolicyHidden) failures.push("Help modal is missing the in-app version or exposes internal filename policy");
  if (results.progress.title !== "学习档案" || !results.progress.version || results.progress.horizontalOverflow) failures.push("Progress page is missing the in-app version or overflows");
  if (!results.level.hasTranslate || results.level.keywordCount < 2 || !results.level.hasTeach || !results.level.teachBeforeTask) failures.push("Level is missing human teaching before the task or keywords");
  if (results.level.teachText.length < 28) failures.push("Level human explanation is too short to teach the concept");
  if (!results.level.playerArt) failures.push("Yoyo dialogue illustration is missing");
  if (!results.firstCorrect.correct || !results.firstCorrect.hasHuman || !results.firstCorrect.hasQuestionGoal) failures.push("First correct answer did not include human review");
  if (!results.firstWrong.wrong || results.firstWrong.breakdown) failures.push("First wrong state is incorrect");
  if (!results.secondWrong.breakdown || results.secondWrong.steps < 2) failures.push("Second wrong breakdown missing");
  if (!results.detail.title || !results.detail.hasPlain || !results.detail.hasHuman || !results.detail.hasNumbers || !results.detail.questionAfterTeaching) failures.push("Detail modal is not teaching-first or is incomplete");
  if (results.library.concepts < 600 || results.library.tabs !== 2 || results.library.cards < 1) failures.push("Concept library did not render");
  if (results.library.syllabusMatched !== 449 || results.library.syllabusRequired !== 449) failures.push("2026 syllabus mapping is incomplete");
  if (results.library.horizontalOverflow) failures.push("Desktop library has horizontal overflow");
  if (results.conceptSearch.count < 1 || !results.conceptSearch.titles.some((title) => title.includes("会计信息"))) failures.push("Concept search failed");
  if (!results.conceptModal.title || !results.conceptModal.hasPlain || !results.conceptModal.hasExample) failures.push("Concept detail modal is incomplete");
  if (!results.conceptModal.hasSyllabusRefs) failures.push("Concept modal is missing syllabus references");
  if (results.conceptModal.legacyEnglishButton || results.conceptModal.legacyEnglishBlock) failures.push("Legacy standalone English term UI is still visible");
  if (
    !results.conceptTermDisplay.hasSppiPhrase
    || !results.conceptTermDisplay.hasFvociPhrase
    || !results.conceptTermDisplay.hasFvtplPhrase
    || results.conceptTermDisplay.legacyTermLinks
    || results.conceptTermDisplay.legacyEnglishBlock
  ) failures.push("Financial asset terms are not Chinese-first with parenthetical English");
  if (
    results.conceptTermDisplayMobile.scrollWidth > results.conceptTermDisplayMobile.innerWidth + 1
    || results.conceptTermDisplayMobile.modalScrollWidth > results.conceptTermDisplayMobile.modalWidth + 1
  ) failures.push("Bilingual concept text overflows on mobile");
  if (results.localizationAudit.badCount || results.localizationAudit.formulaTermMissCount) failures.push("English terms remain outside Chinese-first parentheses");
  if (results.challengeAudit.badCount > 0) failures.push(`Concept challenge generation defects: ${results.challengeAudit.bad.join(", ")}`);
  if (results.challengeSource.title !== "票据无因性" || !results.challengeSource.hasButton) failures.push("Concept challenge entry is missing");
  if (results.challengeStart.title !== "票据无因性" || !results.challengeStart.keywordCheat?.includes("关键词") || !results.challengeStart.goal) failures.push("Concept challenge instructions or keyword cheat are missing");
  if (results.challengeStart.options !== 4 || !results.challengeStart.submitDisabled) failures.push("Concept challenge option state is incorrect");
  if (!results.challengeWrong.wrong || !results.challengeWrong.retry || !results.challengeWrong.hint) failures.push("Concept challenge wrong-answer flow is incomplete");
  if (results.challengeWrong.actionsPosition !== "sticky" || results.challengeWrong.actionsBottom > results.challengeWrong.viewport + 1) failures.push("Concept challenge action bar is not reachable");
  if (results.challengeWrong.feedbackTop >= results.challengeWrong.viewport || results.challengeWrong.feedbackBottom <= 0) failures.push("Wrong-answer explanation was not scrolled into view");
  if (!results.challengeComplete.done || results.challengeComplete.title !== "票据无因性" || !results.challengeComplete.cleared) failures.push("Concept challenge completion was not saved");
  if (!results.challengeComplete.hasExample || !results.challengeComplete.nextButton) failures.push("Concept challenge completion review is incomplete");
  if (!results.challengeComplete.message?.includes("三关都过了")) failures.push("Concept challenge completion says the wrong number of steps");
  if (results.mobileChallenge.scrollWidth > results.mobileChallenge.innerWidth + 1 || results.mobileChallenge.cheatColumns.split(" ").length !== 1) failures.push("Mobile concept challenge layout is broken");
  if (results.mobileChallengeComplete.actions.length !== 3 || results.mobileChallengeComplete.actions.some((button) => !button.visible)) failures.push("Mobile concept completion actions are not fully reachable");
  if (results.chapterFilter.groups < 1 || !results.chapterFilter.heading?.includes("存货")) failures.push("Chapter filter failed");
  if (!results.chapterFilter.hasMap || !results.chapterFilter.hasMapEntry || results.chapterFilter.cards !== results.chapterFilter.expectedCards) failures.push("Chapter knowledge map is missing the full concept set or chapter entry");
  if (!results.chapterFilter.mapText.includes(`${results.chapterFilter.expectedCards} 个考点`)) failures.push("Chapter map does not state the full chapter concept count");
  if (results.practiceNewCard.count < 1 || !results.practiceNewCard.titles.some((title) => title.includes("毛利率"))) failures.push("New inventory valuation concept is missing");
  if (!results.researchAccountingSearch.titles.includes("内部研究开发支出的账务处理")) failures.push("Research and development accounting card is not searchable");
  if (!results.foreignCurrencyDateSearch.titles.includes("发生日的会计处理")) failures.push("Foreign currency transaction date card is not searchable");
  if (
    results.incomeChapterMap.shown !== results.incomeChapterMap.expected
    || !results.incomeChapterMap.hasFiveStep
    || !results.incomeChapterMap.hasTiming
    || !results.incomeChapterMap.hasFinancing
    || !results.incomeChapterMap.hasReturn
    || !results.incomeChapterMap.hasAllocation
    || !results.incomeChapterMap.hasResidual
    || !results.incomeChapterMap.hasVariable
    || !results.incomeChapterMap.hasContractCost
    || !results.incomeChapterMap.hasWarranty
    || !results.incomeChapterMap.hasPrincipalAgent
    || !results.incomeChapterMap.hasLicense
    || !results.incomeChapterMap.hasRepurchase
    || !results.incomeChapterMap.hasInitialFee
    || !results.incomeChapterMap.hasEntry
  ) failures.push("Income chapter map does not expose all 34 official knowledge points and chapter entries");
  if (results.lawConceptSearch.count < 1 || !results.lawConceptSearch.titles.some((title) => title.includes("仲裁"))) failures.push("Law concept search failed");
  if (!results.lawConceptModal.title || !results.lawConceptModal.hasPlain || !results.lawConceptModal.hasExample) failures.push("Law concept detail modal is incomplete");
  if (!results.lawConceptModal.hasSyllabusRefs) failures.push("Law concept modal is missing syllabus references");
  if (results.lawAliasChecks.billing.count < 1 || !results.lawAliasChecks.billing.titles.some((title) => title.includes("追索权"))) failures.push("票据追索 alias search failed");
  if (results.lawAliasChecks.securities.count < 1 || !results.lawAliasChecks.securities.titles.some((title) => title.includes("虚假陈述"))) failures.push("证券虚假陈述 alias search failed");
  if (!results.budgetMethodSearch.titles.includes("预算的编制方法")) failures.push("Budget preparation method card is not searchable");
  if (results.financeNewCard.count < 1 || !results.financeNewCard.titles.some((title) => title.includes("递延年金"))) failures.push("New deferred annuity concept is missing");
  if (!results.financeFormulaLegend.hasLegend || !results.financeFormulaLegend.hasChineseLegend) failures.push("Formula letters do not have a Chinese legend");
  if (results.mobileLibrary.scrollWidth > results.mobileLibrary.innerWidth + 1) failures.push("Mobile library has horizontal overflow");
  if (results.mobileLibrary.filterWidths.some((width) => width <= 0)) failures.push("Mobile concept filters did not render");
  if (!results.selfCorrected?.includes("纠错")) failures.push("Self-corrected completion kind missing");
  if (results.sortInitial.labels[0] === "确定战略与经营目标") failures.push("Sort items were not shuffled");
  if (!results.sortCorrect) failures.push("Sort correct answer failed");
  if (results.mobileLevel.scrollWidth > results.mobileLevel.innerWidth + 1) failures.push("Mobile level has horizontal overflow");
  if (results.mobileLevel.stickyFooter !== "sticky") failures.push("Mobile action footer is not sticky");
  if (!results.persisted.completed.includes("p01-t1")) failures.push("Progress did not persist");
  if (results.chapterOutro.title !== "剧情通关" || results.chapterOutro.recapCards !== 3) failures.push("Chapter outro is incomplete");
  if (results.lawMap.tabs !== 3 || results.lawMap.chapters !== 7) failures.push("Law subject map is incomplete");
  if (results.lawMap.tabRight > results.lawMap.viewport + 1) failures.push("Subject tabs overflow on mobile");
  if (!results.lawLevel.title || !results.lawLevel.translate || !results.lawLevel.hasTeach) failures.push("Law level did not render the human teaching block");
  if (results.journal.title !== "折旧分录：费用去哪边" || results.journal.vouchers < 3) failures.push("Journal level did not render");
  if (!results.journal.translate || results.journal.lines < 2 || !results.journal.correct || !results.journal.teachHasEntryHint) failures.push("Journal answer flow failed");
  if (!results.journal.correctEntryVisible.human || !results.journal.correctEntryVisible.entry || !results.journal.correctEntryVisible.entryReason) failures.push("Journal feedback is missing human review, entry lines, or entry reasoning");
  if (results.syncDesktop.horizontalOverflow || results.syncDesktop.modalOverflow || results.syncDesktop.modalWidth > results.syncDesktop.viewport) failures.push("Sync modal overflows on desktop");
  if (results.syncInitial.title !== "记录同步" || !results.syncInitial.hasSummary || !results.syncInitial.hasGenerate || !results.syncInitial.hasImport) failures.push("Sync modal is incomplete");
  if (results.syncInitial.horizontalOverflow || results.syncInitial.modalOverflow) failures.push("Sync modal overflows on mobile");
  if (!results.syncGenerated.hasCode || results.syncGenerated.length < 100 || !results.syncGenerated.hasCopy || !results.syncGenerated.hasBackup) failures.push("Sync code generation is incomplete");
  if (results.syncGenerated.horizontalOverflow || results.syncGenerated.modalOverflow) failures.push("Generated sync code overflows on mobile");
  if (!results.syncImported.success || !results.syncImported.localOnlyKept || !results.syncImported.remoteRecordsRestored || results.syncImported.horizontalOverflow) failures.push("Sync import did not merge both devices without overwriting local records");
  results.failures = failures;
  console.log(JSON.stringify(results, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  socket.close();
  child.kill();
}
