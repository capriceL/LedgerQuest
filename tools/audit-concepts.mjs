import { existsSync, readFileSync, writeFileSync } from "node:fs";

const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const contentFiles = [
  "work/content-practice-v1.json",
  "work/content-law-manual-v1.json",
  "work/content-finance-v1.json"
];
const glossaryFile = "work/glossary-v1.json";

const readJSON = (file) => JSON.parse(readFileSync(file, "utf8"));
const concepts = conceptFiles.flatMap((file) => {
  if (!existsSync(file)) throw new Error(`缺少概念包：${file}`);
  const parsed = readJSON(file);
  return Array.isArray(parsed) ? parsed : parsed.concepts || [];
});
const glossaryRaw = readJSON(glossaryFile);
const glossary = Array.isArray(glossaryRaw) ? glossaryRaw : glossaryRaw.terms || [];
const syllabusFile = "work/syllabus-audit.json";
const syllabusAudit = existsSync(syllabusFile) ? readJSON(syllabusFile) : null;
const expectedChapters = contentFiles.flatMap((file) => {
  const parsed = readJSON(file);
  const subjects = Array.isArray(parsed) ? parsed : parsed.subjects || [];
  return subjects.flatMap((subject) => subject.chapters.map((chapter) => ({
    subjectId: subject.id,
    subjectName: subject.name,
    chapterId: chapter.id,
    chapterTitle: chapter.title
  })));
});
const foundationChapters = [
  { subjectId: "practice", subjectName: "中级会计实务", chapterId: "p00", chapterTitle: "会计地基与报表口径" },
  { subjectId: "law", subjectName: "中级经济法", chapterId: "e00", chapterTitle: "经济法地基" },
  { subjectId: "finance", subjectName: "中级财务管理", chapterId: "f00", chapterTitle: "财管地基" }
];
const allExpectedChapters = [...foundationChapters, ...expectedChapters];
const errors = [];
const warnings = [];
const seenIds = new Set();
const seenTitles = new Set();
const seenLawHowTo = new Map();
const seenLawFormula = new Map();
const genericLawMarkers = [
  "假设题干出现",
  "题干先圈：",
  "同时盯住“不、除外、善意、书面、登记、期限”",
  "先定主体和行为，再找对应制度；检查意思表示",
  "先分有限公司或股份公司，再看股东、董事、监事等身份",
  "先分普通合伙、特殊普通合伙还是有限合伙",
  "先定物权类型，再找公示事实",
  "先看合同是否成立、生效，再处理履行抗辩",
  "先分票据、证券或保险场景，再看主体、形式要件",
  "先分预算、国有资产还是政府采购场景",
  "主体→行为→权限/程序→时效/管辖→效力→后果",
  "公司类型→主体身份→职权/程序/表决比例→决议效力→责任",
  "合伙类型→合伙人身份→事务权限→对外责任→内部追偿",
  "物权类型→公示方式→设立/对抗→优先顺位→清偿或归属",
  "成立→生效→履行/抗辩→保全→变更转让→解除→违约责任",
  "场景→主体→形式/期限/披露→权利行使→责任承担",
  "场景→主体/权限→程序/期限→合法性→救济或责任"
];

if (!syllabusAudit) {
  errors.push("缺少 syllabus-audit.json，请先运行 node tools/build-syllabus-audit.mjs");
} else if (!syllabusAudit.gate?.coveragePass) {
  errors.push(`2026 大纲仍有 ${syllabusAudit.summary?.missingTotal ?? "未知"} 个知识点未映射，覆盖门禁未通过`);
}

const requiredFields = ["id", "subjectId", "chapterId", "chapterTitle", "title", "plain", "howTo", "keywords"];
for (const concept of concepts) {
  for (const field of requiredFields) {
    if (!concept[field] || (Array.isArray(concept[field]) && concept[field].length === 0)) {
      errors.push(`概念 ${concept.id || "(无 id)"} 缺少 ${field}`);
    }
  }
  if (seenIds.has(concept.id)) errors.push(`概念 id 重复：${concept.id}`);
  seenIds.add(concept.id);
  const titleKey = `${concept.subjectId}:${concept.chapterId}:${concept.title}`;
  if (seenTitles.has(titleKey)) warnings.push(`同章概念标题重复：${titleKey}`);
  seenTitles.add(titleKey);
  if (concept.subjectId === "law") {
    for (const field of ["howTo", "formula", "example", "trap"]) {
      const value = String(concept[field] || "");
      const marker = genericLawMarkers.find((text) => value.includes(text));
      if (marker) errors.push(`概念 ${concept.id} 的 ${field} 仍含通用模板：${marker}`);
    }
    const howTo = String(concept.howTo || "").trim();
    const formula = String(concept.formula || "").trim();
    if (howTo.length < 28) warnings.push(`概念 ${concept.id} 的 howTo 偏短：${howTo.length} 字`);
    if (formula.length < 14) warnings.push(`概念 ${concept.id} 的 formula 偏短：${formula.length} 字`);
    for (const [field, bucket] of [["howTo", seenLawHowTo], ["formula", seenLawFormula]]) {
      const value = String(concept[field] || "").trim();
      if (!value) continue;
      if (bucket.has(value)) warnings.push(`经济法 ${field} 重复：${bucket.get(value)} / ${concept.id}`);
      else bucket.set(value, concept.id);
    }
  }
}

for (const concept of concepts) {
  for (const relatedId of concept.related || []) {
    if (!seenIds.has(relatedId)) errors.push(`概念 ${concept.id} 的关联断链：${relatedId}`);
  }
}

const chapterBuckets = new Map();
for (const concept of concepts) {
  const key = `${concept.subjectId}:${concept.chapterId}`;
  if (!chapterBuckets.has(key)) chapterBuckets.set(key, []);
  chapterBuckets.get(key).push(concept);
}

const minimumBySubject = {
  practice: 5,
  law: 6,
  finance: 5
};
const chapterCoverage = [];
for (const chapter of allExpectedChapters) {
  const key = `${chapter.subjectId}:${chapter.chapterId}`;
  const items = chapterBuckets.get(key) || [];
  const minimum = chapter.chapterId.endsWith("00")
    ? chapter.subjectId === "practice" ? 20 : 6
    : minimumBySubject[chapter.subjectId] || 8;
  if (!items.length) {
    errors.push(`章节完全无概念覆盖：${key} ${chapter.chapterTitle}`);
  } else if (items.length < minimum) {
    errors.push(`章节概念密度不足：${key} ${chapter.chapterTitle} 仅 ${items.length}，至少 ${minimum}`);
  }
  chapterCoverage.push({
    ...chapter,
    count: items.length,
    minimum,
    conceptIds: items.map((item) => item.id)
  });
}

const conceptBlob = (concept) => JSON.stringify(concept).toLowerCase();
const requiredTopics = {
  practice: [
    "账面余额",
    "账面净值",
    "账面价值",
    "当期损益",
    "营业利润",
    "利润总额",
    "净利润",
    "其他综合收益",
    "存货",
    "固定资产",
    "无形资产",
    "投资性房地产",
    "长期股权投资",
    "资产减值",
    "发出存货计价",
    "毛利率法",
    "售价金额核算法",
    "金融资产",
    "职工薪酬",
    "股份支付",
    "借款费用",
    "或有事项",
    "收入确认",
    "政府补助",
    "非货币性资产交换",
    "债务重组",
    "递延所得税",
    "外币折算",
    "租赁",
    "持有待售",
    "合并财务报表",
    "会计政策",
    "会计估计",
    "资产负债表日后事项",
    "政府会计",
    "民间非营利组织"
  ],
  law: [
    "法律行为",
    "代理",
    "诉讼时效",
    "仲裁",
    "公司",
    "股东",
    "合伙企业",
    "物权",
    "合同",
    "票据",
    "证券",
    "保险",
    "预算",
    "国有资产",
    "政府采购"
  ],
  finance: [
    "货币时间价值",
    "递延年金",
    "资本成本",
    "经营杠杆",
    "财务杠杆",
    "净现值",
    "内含报酬率",
    "预算",
    "营运资金",
    "成本差异",
    "股利政策",
    "杜邦分析",
    "经济增加值",
    "责任中心"
  ]
};
for (const [subjectId, topics] of Object.entries(requiredTopics)) {
  const subjectConcepts = concepts.filter((concept) => concept.subjectId === subjectId);
  for (const topic of topics) {
    const matched = subjectConcepts.some((concept) => (
      conceptBlob(concept).includes(topic.toLowerCase())
      || (concept.aliases || []).some((alias) => String(alias).includes(topic))
    ));
    if (!matched) errors.push(`关键知识缺口：${subjectId} 未找到“${topic}”`);
  }
}

const requiredTerms = [
  "FV", "NRV", "PV", "TVM", "FVTPL", "FVOCI", "SPPI", "ECL",
  "WACC", "NPV", "IRR", "CAPM", "EOQ", "EVA", "DOL", "DFL", "DTL"
];
const termNames = new Set(glossary.flatMap((term) => [term.term, term.full]));
for (const term of requiredTerms) {
  if (![...termNames].some((name) => String(name || "").toUpperCase().startsWith(term))) {
    errors.push(`英文术语缺口：${term}`);
  }
}

const bySubject = Object.fromEntries(["practice", "law", "finance"].map((subjectId) => {
  const items = concepts.filter((concept) => concept.subjectId === subjectId);
  return [subjectId, {
    concepts: items.length,
    chapters: new Set(items.map((item) => item.chapterId)).size,
    glossary: glossary.length
  }];
}));

const report = {
  generatedAt: new Date().toISOString(),
  ok: errors.length === 0,
  totals: {
    concepts: concepts.length,
    chapters: allExpectedChapters.length,
    coveredChapters: chapterCoverage.filter((chapter) => chapter.count > 0).length,
    glossary: glossary.length
  },
  contentQuality: {
    lawConcepts: concepts.filter((concept) => concept.subjectId === "law").length,
    lawGenericTemplates: errors.filter((message) => message.includes("通用模板")).length,
    lawRepeatedHowTo: warnings.filter((message) => message.includes("howTo 重复")).length,
    lawRepeatedFormula: warnings.filter((message) => message.includes("formula 重复")).length
  },
  bySubject,
  chapterCoverage,
  errors,
  warnings
};

writeFileSync("work/concept-audit.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: report.ok,
  totals: report.totals,
  bySubject: report.bySubject,
  errors: report.errors,
  warnings: report.warnings
}, null, 2));
if (!report.ok) process.exitCode = 1;
