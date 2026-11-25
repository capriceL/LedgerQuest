import { readFileSync, writeFileSync } from "node:fs";

const conceptFiles = [
  "work/concepts-practice-v1.json",
  "work/concepts-law-v1.json",
  "work/concepts-finance-v1.json"
];
const teaching = JSON.parse(readFileSync("work/concept-teaching-v1.json", "utf8")).cards;
const concepts = conceptFiles.flatMap((file) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(data) ? data : data.concepts || [];
});
const byId = new Map(concepts.map((concept) => [concept.id, concept]));
const errors = [];
const checks = [];
const requiredTitles = [
  "授予知识产权许可",
  "内部研究开发支出的账务处理",
  "长期股权投资的初始计量",
  "或有事项的确认",
  "发生日的会计处理",
  "资产负债表日或结算日的会计处理",
  "资产收益与收益率",
  "资产的风险及其衡量",
  "证券资产组合的收益与风险",
  "预算的分类",
  "预算的编制方法",
  "预算的执行",
  "投资项目财务评价指标",
  "存货的成本",
  "最优存货量的确定",
  "盈利能力分析",
  "企业的定价目标",
  "纳税管理"
];

const textFor = (id) => {
  const concept = byId.get(id);
  if (!concept) {
    errors.push(`${id} 不存在`);
    return { concept: null, text: "", formula: "" };
  }
  const override = teaching[id] || {};
  const formula = String(override.numbers || concept.formula || "").trim();
  const entryText = [
    ...(override.entry || []),
    ...((override.entryGroups || []).flatMap((group) => [
      group.title,
      group.note,
      ...(group.lines || [])
    ]))
  ].flatMap((line) => (
    line && typeof line === "object"
      ? [line.side, line.account, line.amount, line.why]
      : [line]
  )).filter(Boolean).join("\n");
  const text = [
    concept.title,
    concept.plain,
    concept.howTo,
    concept.formula,
    concept.example,
    concept.trap,
    override.human,
    override.ask,
    override.numbers,
    override.entryNote,
    override.memory,
    entryText
  ].filter(Boolean).join("\n");
  return { concept, text, formula };
};

const expect = (id, pattern, label) => {
  const { text, formula } = textFor(id);
  const ok = pattern.test(`${formula}\n${text}`);
  checks.push({ id, label, ok });
  if (!ok) errors.push(`${id} ${label}：没有找到 ${pattern}`);
};

const forbid = (id, pattern, label) => {
  const { text, formula } = textFor(id);
  const ok = !pattern.test(`${formula}\n${text}`);
  checks.push({ id, label, ok });
  if (!ok) errors.push(`${id} ${label}：出现不应有的 ${pattern}`);
};

expect("pc-p00-27", /PV\s*=\s*未来现金流\s*[÷/]\s*\(1\s*\+\s*折现率\)\^期数/, "现值统一口径");
forbid("pc-p00-27", /\bFV\s*=\s*PV\s*×/, "现值卡不得显示终值公式");
expect("fc-f00-02", /PV\s*=\s*FV\s*[÷/]\s*\(1\s*\+\s*i\)\^n/, "复利现值公式");
forbid("fc-f00-02", /PV\s*=\s*FV\s*×/, "复利现值不得乘 (1+i)^n");
expect("fc-f00-03", /(?:FV\s*=\s*PV|终值\s*=\s*现值)\s*×\s*[（(]1\s*\+\s*(?:i|每期利率)[）)]\^n|终值\s*=\s*现值\s*×\s*[（(]1\s*\+\s*每期利率[）)]\^期数/, "复利终值公式");
expect("fc-f02-03", /FVA\s*=\s*A\s*×\s*\[\(1\s*\+\s*i\)\^n\s*-\s*1\]\s*[÷/]\s*i/, "普通年金终值公式");
expect("fc-f02-04", /PVA\s*=\s*A\s*×\s*\[1\s*-\s*\(1\s*\+\s*i\)\^?-n\]\s*[÷/]\s*i/, "普通年金现值公式");
expect("fc-f02-05", /\(1\s*\+\s*i\)/, "预付年金调整系数");
expect("fc-f02-05", /P\/A\s*,\s*i\s*,\s*n\s*-\s*1|n-1/, "预付年金可用 n-1 期系数");
expect("fc-f02-06", /A\s*[÷/]\s*i/, "永续年金现值");
expect("fc-f02-06", /没有终值/, "永续年金无终值提示");
expect("fc-f02-x26", /\(P\/A\s*,\s*i\s*,\s*n\)\s*×\s*\(P\/F\s*,\s*i\s*,\s*m\)/, "递延年金现值");
expect("fc-f05-05", /Wd\s*×\s*Kd\s*×\s*\(1\s*-\s*T\)\s*\+\s*We\s*×\s*Ke/, "WACC 公式");
expect("fc-f05-09", /DTL\s*=\s*DOL\s*×\s*DFL/, "总杠杆公式");
expect("fc-f06-03", /营业收入\s*-\s*付现成本.*折旧|EBIT\s*×\s*\(1\s*-\s*T\).*折旧/, "营业现金流公式");
expect("fc-f06-07", /(?:NPV\s*=|净现值\s*=).*初始投资/, "净现值公式");
expect("fc-f07-07", /EOQ\s*=\s*√?\s*\(?2\s*×\s*年需求量\s*×\s*每次订货成本\s*[÷/]\s*单位年储存成本/, "EOQ 公式");
expect("fc-f10-11", /营业净利率\s*×\s*总资产周转率\s*×\s*权益乘数/, "杜邦分析");
expect("fc-f10-13", /税后净营业利润\s*-\s*投入资本\s*×\s*加权平均资本成本/, "EVA 公式");

expect("pc-p18-y05", /租赁激励/, "使用权资产必须扣租赁激励");
expect("pc-p18-y05", /使用权资产\s*=.*租赁负债.*租赁激励/, "使用权资产初始计量顺序");
expect("pc-p20-y09", /部分商誉法/, "商誉部分商誉法");
expect("pc-p20-y09", /完全商誉法/, "商誉完全商誉法");
expect("pc-p20-y18", /少数股东权益/, "少数股东权益口径");
expect("pc-p20-y18", /完全商誉法/, "少数股东权益完全商誉法");
expect("pc-p06-x02", /最终控制方原收购形成的商誉|原收购.*商誉/, "同一控制合并成本含原商誉");
expect("pc-p02-t05", /max\s*\(\s*0/, "存货跌价准备下限为零");
expect("pc-p16-y10", /其他综合收益|OCI/, "递延所得税费用须排除 OCI");
expect("pc-p15-y03", /计入投资收益|投资收益/, "金融资产抵债的差额科目");
forbid("pc-p15-y03", /差额.*其他收益/, "金融资产抵债不得默认其他收益");
expect("pc-p15-y04", /其他收益/, "非金融资产抵债的其他收益科目");
expect("pc-p15-y05", /权益工具公允价值/, "债转股按权益工具公允价值拆分");
expect("pc-p00-06", /销售费用.*管理费用.*研发费用.*财务费用/, "营业利润列示完整费用");
expect("pc-p00-06", /营业外收支.*不计入|营业外收支.*排除/, "营业利润不含营业外收支");
expect("pc-p20-y27", /期初.*期末|期末合并所有者权益/, "合并权益变动表期初期末勾稽");
expect("pc-p20-y27", /少数股东权益/, "合并权益变动表分归母与少数股东");
expect("pc-p20-y28", /未实现利润.*多摊销|多摊销.*未实现利润/, "内部无形资产交易抵销逻辑");
expect("pc-p20-y29", /max\s*\(\s*0.*可变现净值|集团成本.*可变现净值/, "内部存货跌价准备按集团成本重算");
expect("pc-p20-y30", /债权投资.*应付债券|应付债券.*债权投资/, "内部债券本金抵销");
expect("pc-p20-y30", /利息收入.*利息费用|利息费用.*利息收入/, "内部债券利息抵销");
forbid("pc-p00-15", /期末损益结转/, "信用减值损失不得挂通用期末结转");
expect("pc-p00-15", /信用减值损失.*坏账准备|坏账准备.*信用减值损失/, "信用减值损失分录口径");
forbid("pc-p00-18", /期末损益结转/, "所得税费用不得挂通用期末结转");
expect("pc-p00-18", /当期应交所得税|应交税费—应交所得税/, "所得税费用包含当期税");
expect("pc-p00-18", /递延所得税负债|递延所得税资产/, "所得税费用包含递延税");
expect("pc-p00-16", /营业外收入.*本年利润|本年利润.*营业外收入/, "营业外收入结转分录");
expect("pc-p16-t03", /递延所得税负债/, "所得税费用递延负债分录");
expect("pc-p16-t03", /递延所得税资产/, "所得税费用递延资产口径");
expect("pc-p12-x18", /合同履约成本/, "合同履约成本分录");
expect("pc-p15-t01", /金融资产/, "债务重组金融资产抵债口径");
expect("pc-p15-t01", /非金融资产/, "债务重组非金融资产抵债口径");
expect("pc-p04-y01", /研究阶段.*费用化|费用化.*研究阶段/, "研发支出先分研究与开发");
expect("pc-p04-y01", /开发阶段.*五项|五项.*开发阶段/, "开发阶段五项资本化条件");
expect("pc-p06-y01", /同一控制.*最终控制方|最终控制方.*同一控制/, "同一控制长投初始成本");
expect("pc-p06-y01", /非同一控制.*购买日.*对价公允价值|购买日.*对价公允价值.*非同一控制/, "非同一控制长投初始成本");
expect("pc-p11-y01", /现时义务/, "或有事项确认的现时义务");
expect("pc-p11-y01", /很可能.*经济利益流出/, "或有事项确认的可能流出");
expect("pc-p11-y01", /可靠计量|可靠估计/, "或有事项确认的可靠计量");
expect("pc-p17-y07", /交易日即期汇率|交易发生日即期汇率/, "外币交易发生日汇率");
expect("pc-p17-y10", /期末或结算日即期汇率/, "外币期末或结算日汇率");
expect("pc-p17-y10", /货币性项目.*非货币性项目|非货币性项目.*货币性项目/, "外币项目分类调整");
expect("fc-f02-y01", /期末价值.*期初价值.*现金流入/, "资产收益率口径");
expect("fc-f02-y01", /概率.*收益率/, "预期收益率概率加权");
expect("fc-f02-y02", /方差.*标准差|标准差.*方差/, "风险衡量方差标准差");
expect("fc-f02-y02", /变异系数/, "相对风险变异系数");
expect("fc-f02-y03", /组合期望收益.*权重|权重.*组合期望收益/, "组合收益按权重");
expect("fc-f02-y03", /相关系数/, "组合风险须考虑相关系数");
expect("fc-f03-y01", /经营预算.*专门决策预算.*财务预算/, "预算按内容三分类");
expect("fc-f03-y02", /固定成本.*单位变动成本.*实际业务量/, "弹性预算公式");
expect("fc-f03-y02", /滚动预算.*每过一期补一期|每过一期补一期.*滚动预算/, "滚动预算规则");
expect("fc-f03-y03", /实际数.*预算数/, "预算差异公式");
expect("fc-f06-y01", /净现值.*初始投资.*折现/, "项目净现值公式");
expect("fc-f06-y01", /现值指数.*未来现金流现值.*初始投资/, "现值指数公式");
expect("fc-f07-y01", /取得成本.*储存成本.*缺货成本/, "存货三类相关成本");
expect("fc-f07-y02", /经济订货批量.*年需求量.*每次订货成本.*单位年储存成本/, "最优存货量公式");
expect("fc-f09-y01", /总成本.*目标利润.*预计销量/, "目标利润定价公式");
expect("fc-f09-y02", /税后收益.*合规成本/, "纳税管理净收益口径");
expect("fc-f10-y01", /毛利率.*营业收入.*营业成本/, "毛利率口径");
expect("fc-f10-y01", /净资产收益率.*净利润.*平均股东权益/, "净资产收益率口径");
forbid("pc-p04-x05", /研究阶段也资本化/, "研究阶段不得写成可以资本化");

const titles = new Set(concepts.map((concept) => concept.title));
for (const title of requiredTitles) {
  const ok = titles.has(title);
  checks.push({ id: title, label: "必需同名考点卡", ok });
  if (!ok) errors.push(`缺少同名考点卡：${title}`);
}

for (const concept of concepts) {
  const { formula } = textFor(concept.id);
  const title = String(concept.title || "");
  if (!formula) continue;
  if (/^现值$/.test(title) && /\bFV\s*=\s*PV\s*×/.test(formula)) {
    errors.push(`${concept.id} 现值卡显示了终值公式`);
  }
  if (/^终值$/.test(title) && /\bPV\s*=\s*FV\s*[÷/]/.test(formula)) {
    errors.push(`${concept.id} 终值卡显示了现值公式`);
  }
  for (const [left, right, label] of [["(", ")", "英文圆括号"], ["（", "）", "中文圆括号"], ["[", "]", "方括号"]]) {
    const leftCount = formula.split(left).length - 1;
    const rightCount = formula.split(right).length - 1;
    if (leftCount !== rightCount) {
      errors.push(`${concept.id} ${label}不配对：${formula}`);
    }
  }
  if (/[=＝]\s*$/.test(formula) || /[÷/×+\-]\s*$/.test(formula)) {
    errors.push(`${concept.id} 公式疑似被截断：${formula}`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  ok: errors.length === 0,
  checked: checks.length,
  concepts: concepts.length,
  errors,
  sources: [
    "2026 中级会计实务/财务管理/经济法考试大纲",
    "2026 中级会计教材常用公式口径",
    "公开章节知识点与公式目录"
  ]
};
writeFileSync("work/formula-audit-v3.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
