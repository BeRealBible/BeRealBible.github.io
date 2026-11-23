"""Fast coverage of citation parsing before replacing the published QAP library."""
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("import_study_qa", Path(__file__).with_name("import-study-qa.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StudyImport(unittest.TestCase):
    bible = module.source_books()

    def setUp(self):
        self.refs = module.References(self.bible)

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
