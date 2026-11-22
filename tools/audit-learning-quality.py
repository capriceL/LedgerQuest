#!/usr/bin/env python3
"""Audit player-facing learning copy for OCR noise, placeholders and truncation."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
SUBJECTS = {
    "practice": WORK / "concepts-practice-v1.json",
    "law": WORK / "concepts-law-v1.json",
    "finance": WORK / "concepts-finance-v1.json",
}

NOISE_PATTERNS = {
    "ads": re.compile(r"精讲班\s*[-—]|微信号|扫码"),
    "page_header": re.compile(r"第\s*[一二三四五六七八九十0-9]+\s*章\s*\|\s*精讲班"),
    "answer_material": re.compile(r"【答案】|【解析】|参考答案|答案解析"),
    "figure_label": re.compile(r"\[(?:图示|票样|表格|图片|略)\]"),
    "broken_table": re.compile(r"(?:√\s*×|×\s*√|\|\s*\|)"),
    "ocr_spacing": re.compile(r"[\u4e00-\u9fff]\s{2,}[\u4e00-\u9fff]"),
}
GENERIC_TEMPLATES = (
    "这部分不是让你背一整页",
    "材料里的关键结论是",
    "先认清主体和场景",
    "这部分主要考查",
    "熟悉相关概念和应用",
    "掌握相关内容即可",
)
EXAM_NOTE_TEMPLATES = (
    "本题只抓",
    "先圈主体",
    "别和同卡",
    "再把题干数字",
    "先找分类标准",
    "本条讲",
    "这条只讲",
    "关键词先看",
    "先认基数、比例和期间",
)
TABLE_REFERENCE = re.compile(
    r"(?:如下表|如表(?:所示|[^。；]{0,6}(?:所示|列示))?|"
    r"(?:上|下|本|该|前述|上述)表中|如图(?:所示)?|图示|见图|"
    r"表\s*\d+\s*[-—－]\s*\d+|图\s*\d+\s*[-—－]\s*\d+)"
)
BROKEN_FRAGMENT = re.compile(
    r"(?:只设一(?:名)?(?=[。；]|$)|法定。|前述。|上述。|按照。|按照；|"
    r"(?:^|[：；])(?:相关|有关)[。；]|相应。|包括；|例如；)"
)
PLACEHOLDER_PATTERNS = (
    re.compile(r"^(?:略|待补|暂无|相关知识点|有关内容)[。；;]?$"),
    re.compile(r"^(?:掌握|熟悉|了解)[^。]{0,16}即可[。]?$"),
)
TRUNCATED_END = re.compile(
    r"(?:[的和及或与在对为应按；，、：]|包括|例如|比如|由于|所以|但是|而且)$"
)
REQUIRED_FIELDS = {"plain", "howTo"}


def read_concepts(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    return data.get("concepts", [])


def compact_len(value: str) -> int:
    return len(re.sub(r"\s+", "", value))


def add_issue(
    issues: list[dict],
    severity: str,
    code: str,
    card: dict,
    field: str,
    message: str,
) -> None:
    issues.append(
        {
            "severity": severity,
            "code": code,
            "cardId": card.get("id", ""),
            "subject": card.get("subjectId", ""),
            "chapterId": card.get("chapterId", ""),
            "title": card.get("title", ""),
            "field": field,
            "message": message,
        }
    )


def check_copy(card: dict, field: str, value: object, issues: list[dict]) -> None:
    if not isinstance(value, str):
        return
    text = value.strip()
    if not text and field in REQUIRED_FIELDS:
        add_issue(issues, "error", "empty", card, field, "字段为空")
        return
    if not text:
        return
    length = compact_len(text)
    minimum = 6 if field == "trap" else 8
    if field in REQUIRED_FIELDS or field in {"example", "trap"}:
        if length < minimum:
            add_issue(issues, "error", "too_short", card, field, f"仅 {length} 字")
    if field == "plain" and length > 360:
        add_issue(
            issues, "warning", "plain_too_long", card, field, f"首屏释义 {length} 字"
        )
    if field == "example" and length < 14:
        add_issue(issues, "warning", "example_thin", card, field, f"仅 {length} 字")
    for marker, pattern in NOISE_PATTERNS.items():
        match = pattern.search(text)
        if match:
            add_issue(
                issues,
                "error",
                f"noise_{marker}",
                card,
                field,
                f"发现原文噪声：{match.group(0)}",
            )
    if any(template in text for template in GENERIC_TEMPLATES):
        add_issue(issues, "error", "generic_template", card, field, "使用统一模板话术")
    if any(pattern.search(text) for pattern in PLACEHOLDER_PATTERNS):
        add_issue(issues, "error", "placeholder", card, field, "疑似占位内容")
    if field in {"plain", "howTo", "example", "trap", "formula"} and TRUNCATED_END.search(
        text
    ):
        add_issue(issues, "error", "truncated_end", card, field, "句尾疑似被截断")
    if text.count("（") != text.count("）"):
        add_issue(issues, "warning", "unbalanced_paren", card, field, "中文括号不配对")


def check_sections(card: dict, issues: list[dict]) -> int:
    count = 0
    groups = card.get("legacySections")
    if not isinstance(groups, list):
        return count
    for group_index, group in enumerate(groups, start=1):
        if not isinstance(group, dict):
            add_issue(
                issues,
                "error",
                "section_shape",
                card,
                "legacySections",
                f"第 {group_index} 组不是对象",
            )
            continue
        if not str(group.get("title") or "").strip():
            add_issue(
                issues,
                "error",
                "section_title",
                card,
                "legacySections",
                f"第 {group_index} 组缺标题",
            )
        items = group.get("items")
        if not isinstance(items, list) or not items:
            add_issue(
                issues,
                "error",
                "section_empty",
                card,
                "legacySections",
                f"第 {group_index} 组没有知识条目",
            )
            continue
        for item_index, item in enumerate(items, start=1):
            count += 1
            if not isinstance(item, dict):
                add_issue(
                    issues,
                    "error",
                    "section_item_shape",
                    card,
                    "legacySections",
                    f"{group_index}-{item_index} 不是对象",
                )
                continue
            title = str(item.get("title") or "").strip()
            text = str(item.get("text") or "").strip()
            if not title:
                add_issue(
                    issues,
                    "error",
                    "section_item_title",
                    card,
                    "legacySections",
                    f"{group_index}-{item_index} 缺标题",
                )
            normalized_title = re.sub(r"[\s。；;：:]+$", "", title)
            normalized_text = re.sub(r"[\s。；;：:]+$", "", text)
            if normalized_title and normalized_text == normalized_title:
                add_issue(
                    issues,
                    "error",
                    "section_item_placeholder",
                    card,
                    "legacySections",
                    f"{title} 只是标题占位",
                )
            elif compact_len(text) < 8:
                add_issue(
                    issues,
                    "error",
                    "section_item_short",
                    card,
                    "legacySections",
                    f"{title or group_index} 仅 {compact_len(text)} 字",
                )
            for marker, pattern in NOISE_PATTERNS.items():
                match = pattern.search(text)
                if match:
                    add_issue(
                        issues,
                        "error",
                        f"section_noise_{marker}",
                        card,
                        "legacySections",
                        f"{title}：{match.group(0)}",
                    )
            if TRUNCATED_END.search(text):
                add_issue(
                    issues,
                    "error",
                    "section_truncated_end",
                    card,
                    "legacySections",
                    f"{title}：句尾疑似截断",
                )
    return count


def main() -> int:
    report = {
        "subjects": {},
        "summary": {},
        "issues": [],
    }
    all_issues: list[dict] = []
    global_plain = defaultdict(list)

    for subject, path in SUBJECTS.items():
        concepts = read_concepts(path)
        issues: list[dict] = []
        section_count = 0
        note_count = 0
        for card in concepts:
            for field in ("plain", "howTo", "example", "trap", "formula"):
                check_copy(card, field, card.get(field), issues)
            section_count += check_sections(card, issues)
            if card.get("legacySections"):
                add_issue(
                    issues,
                    "error",
                    "legacy_sections",
                    card,
                    "legacySections",
                    "交付数据仍含原始讲义长文",
                )
            notes = card.get("examNotes")
            if isinstance(notes, list):
                seen_notes: set[str] = set()
                for note_index, note in enumerate(notes, start=1):
                    if not isinstance(note, dict):
                        add_issue(
                            issues,
                            "error",
                            "exam_note_shape",
                            card,
                            "examNotes",
                            f"第 {note_index} 条不是对象",
                        )
                        continue
                    label = str(note.get("label") or "").strip()
                    note_text = str(note.get("text") or "").strip()
                    note_count += 1
                    if not 2 <= compact_len(label) <= 22:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_label",
                            card,
                            "examNotes",
                            f"第 {note_index} 条标签长度异常",
                        )
                    if not 20 <= compact_len(note_text) <= 340:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_len",
                            card,
                            "examNotes",
                            f"第 {note_index} 条正文 {compact_len(note_text)} 字",
                        )
                    template = next(
                        (
                            value
                            for value in EXAM_NOTE_TEMPLATES
                            if value in note_text
                        ),
                        "",
                    )
                    if template:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_template",
                            card,
                            "examNotes",
                            f"第 {note_index} 条含模板尾巴：{template}",
                        )
                    table_reference = TABLE_REFERENCE.search(note_text)
                    if table_reference:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_table_reference",
                            card,
                            "examNotes",
                            f"第 {note_index} 条指向未呈现的表图：{table_reference.group(0)}",
                        )
                    broken = BROKEN_FRAGMENT.search(note_text)
                    if broken:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_broken_fragment",
                            card,
                            "examNotes",
                            f"第 {note_index} 条含残句：{broken.group(0)}",
                        )
                    if note_text in seen_notes:
                        add_issue(
                            issues,
                            "error",
                            "exam_note_duplicate",
                            card,
                            "examNotes",
                            f"第 {note_index} 条与同卡内容重复",
                        )
                    seen_notes.add(note_text)
                    check_copy(card, f"examNotes[{note_index}]", note_text, issues)
            plain = str(card.get("plain") or "").strip()
            if compact_len(plain) >= 30:
                global_plain[plain].append(card.get("id", ""))
        all_issues.extend(issues)
        report["subjects"][subject] = {
            "concepts": len(concepts),
            "sectionItems": section_count,
            "examNotes": note_count,
            "errors": sum(item["severity"] == "error" for item in issues),
            "warnings": sum(item["severity"] == "warning" for item in issues),
            "byCode": dict(sorted(Counter(item["code"] for item in issues).items())),
        }

    for plain, card_ids in global_plain.items():
        if len(card_ids) < 2:
            continue
        for card_id in card_ids:
            concept = next(
                (
                    item
                    for path in SUBJECTS.values()
                    for item in read_concepts(path)
                    if item.get("id") == card_id
                ),
                {},
            )
            add_issue(
                all_issues,
                "warning",
                "duplicate_plain",
                concept,
                "plain",
                f"与 {len(card_ids)} 张卡使用相同释义",
            )

    report["issues"] = all_issues
    report["summary"] = {
        "concepts": sum(item["concepts"] for item in report["subjects"].values()),
        "sectionItems": sum(
            item["sectionItems"] for item in report["subjects"].values()
        ),
        "errors": sum(item["errors"] for item in report["subjects"].values())
        + sum(
            1
            for item in all_issues
            if item["severity"] == "error" and item["code"] == "duplicate_plain"
        ),
        "warnings": sum(item["warnings"] for item in report["subjects"].values())
        + sum(
            1
            for item in all_issues
            if item["severity"] == "warning" and item["code"] == "duplicate_plain"
        ),
    }
    (WORK / "learning-quality-audit.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report["subjects"], ensure_ascii=False, indent=2))
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    return 1 if report["summary"]["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
