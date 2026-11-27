"""Fast coverage of citation parsing before replacing the published QAP library."""
import importlib.util
import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path

spec = importlib.util.spec_from_file_location("import_study_qa", Path(__file__).with_name("import-study-qa.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StudyImport(unittest.TestCase):
    bible = module.source_books()

    def setUp(self):
        self.refs = module.References(self.bible)

    def test_display_projection_counts_unique_actual_verses_per_chapter(self):
        display = lambda *scope: module.primary_display(list(scope), self.refs)
        self.assertEqual(display(["1KI", 1, 2, 3], ["1KI", 1, 3, 3], ["1KI", 1, 5, 5]),
                         [["1KI", 1, 2, 3], ["1KI", 1, 5, 5]])
        self.assertEqual(display(["1KI", 1, 12, 14], ["1KI", 1, 7, 7], ["1KI", 2, 4, 6]),
                         [["1KI", 1, 7, 7], ["1KI", 2, 4, 6]])
        self.assertEqual(display(["1KI", 1, 5, 14], ["1KI", 2, 5, 15], ["1KI", 3]),
                         [["1KI", 1, 5, 5], ["1KI", 2], ["1KI", 3]])
        self.assertEqual(display(["1KI", 1], ["1KI", 1, 6, 10]), [["1KI", 1]])
        self.assertEqual(module.primary_display([["1KI", 1, 2, 12]], self.refs, compact=False),
                         [["1KI", 1, 2, 12]])
        with self.assertRaises(ValueError):
            display(["1KI", 1, 50, 999])

    def test_reviews_apply_only_to_verified_text(self):
        reviewed = {"id": "1KI.1.1", "q": "Q", "a": "A", "refs": [["1KI", 1]]}
        legacy = {"id": "2SA.1.1", "q": "Q", "a": "A", "refs": [["2SA", 1]]}
        scope = [["1KI", 2, 1, 5]]
        digest = sha256(module.compact_json([["1KI.1.1", "Q", "A"]]).encode("utf-8")).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "1KI.json").write_text(json.dumps({
                "schema": 1, "textSha256": digest, "items": {reviewed["id"]: scope},
            }), encoding="utf-8")
            rows = [legacy.copy(), reviewed.copy()]
            self.assertEqual(module.apply_primary_reviews(rows, self.refs, path), 1)
            self.assertEqual(rows[0], legacy)
            self.assertEqual(rows[1], {**reviewed, "refs": [["1KI", 2, 1, 1]], "primary": scope})
            rows[1]["a"] = "changed"
            with self.assertRaisesRegex(ValueError, "text changed"):
                module.apply_primary_reviews(rows, self.refs, path)

    def test_citations(self):
        self.assertEqual(self.refs.parse("《撒母耳記下》第二章末与第三章开头", "2SA", 3),
                         {("2SA", 2), ("2SA", 3)})
        self.assertEqual(self.refs.parse("参撒下3:9–10，18，并读本章第22节至第24节", "2SA", 3),
                         {("2SA", 3, 9, 10), ("2SA", 3, 18, 18), ("2SA", 3, 22, 24)})
        self.assertEqual(self.refs.parse("创1:31-2:3；诗篇第110篇1节", "2SA", 3),
                         {("GEN", 1, 31, 31), ("GEN", 2, 1, 3), ("PSA", 110, 1, 1)})
        self.assertEqual(self.refs.parse("《申命记》(如5:32, 17:20)；创12、15、17章", "2SA", 3),
                         {("DEU", 5, 32, 32), ("DEU", 17, 20, 20),
                          ("GEN", 12), ("GEN", 15), ("GEN", 17)})
        self.assertEqual(self.refs.parse("回答了问题，但第14–15章写的是另一件事；参但7:13。上午10:30到11点。", "JOS", 14),
                         {("JOS", 14), ("JOS", 15), ("DAN", 7, 13, 13)})
        self.assertEqual(self.refs.parse("王下5:27与约壹4:8的关系？", "DEU", 4),
                         {("2KI", 5, 27, 27), ("1JN", 4, 8, 8)})

    def test_default_does_not_publish_context_or_fill_gaps(self):
        bind = lambda q: self.refs.default_binding("GEN", 11, q)
        self.assertEqual(bind("11:4怎样带出12:2的对比？由1-11章走向12-50章。"), [["GEN", 11, 4, 4]])
        self.assertEqual(bind("本章家谱怎样衔接《创世记》12–50章？"), [["GEN", 11]])
        self.assertEqual(bind("11:4-8之间发生了什么？"), [["GEN", 11, 4, 8]])
        self.assertEqual(bind("11:4和11:8分别对于这个主题意味着什么？"), [["GEN", 11]])

    def test_wrappers_removed_without_dropping_bulleted_answers(self):
        text = """<!-- LLM_QA_START -->
以下是为您精心整理的研读问题：
## 第1类：深度问题
### 问题 1（故事与结构）
这两章为何放在一起？
* **答案：**
  答案正文。
---
### 第2类：疑难
**问题一：为什么？**
**【答案】**
另一段正文。
希望这些问题对您有所帮助。
<!-- LLM_QA_END -->"""
        audit = {"fallback_question_heads": [], "unpaired_question_heads": []}
        result = [(q, a) for q, a, _ in module.pairs(text, "sample", 1, audit)]
        self.assertEqual(result, [("这两章为何放在一起？", "答案正文。"), ("为什么？", "另一段正文。")])
        self.assertFalse(audit["unpaired_question_heads"])


if __name__ == "__main__":
    unittest.main()
