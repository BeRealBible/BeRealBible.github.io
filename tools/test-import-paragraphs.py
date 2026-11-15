#!/usr/bin/env python3
"""Semantic paragraphs/stanzas/captions regression tests; no layout coordinates."""
import importlib.util
from io import BytesIO
from pathlib import Path
import sys
import unittest
from zipfile import ZipFile

sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("paragraphs",Path(__file__).with_name("import-paragraphs.py"))
P=importlib.util.module_from_spec(spec);spec.loader.exec_module(P)


class ParagraphTests(unittest.TestCase):
    def test_p_not_m_q_or_d_and_b_collapse_at_following_text(self):
        xml='''<html xmlns="http://www.w3.org/1999/xhtml"><body><div class="main">
        <div class="psalmlabel">1</div><div class="d">大卫的诗。</div>
        <div class="p"><span class="verse" id="T1_1">1</span>开始。</div>
        <div class="q">诗行。</div><div class="b"> </div><div class="b"> </div>
        <div class="q"><span class="verse" id="T1_2">2</span>诗段。</div>
        <div class="m">不缩进续句。</div><div class="p">节中开段。</div>
        <div class="b"> </div><div class="psalmlabel">2</div>
        <div class="q"><span class="verse" id="T2_1">1</span>下章。</div>
        </div></body></html>'''
        buf=BytesIO()
        with ZipFile(buf,"w") as z:z.writestr("OEBPS/TST.xhtml",xml)
        buf.seek(0)
        with ZipFile(buf) as z:chapters,starts,stanzas=P.parse_paragraphs(z,"TST")
        self.assertEqual(len(starts),2)
        self.assertTrue(starts[1]["withoutVerseMarker"])
        self.assertEqual(len(stanzas),3)
        self.assertTrue(chapters[1][0]["superscription"])
        self.assertEqual(len(chapters[1][2]["stanzaIds"]),2)
        self.assertEqual(chapters[2][0]["stanzaIds"],["TST.b00003"])
        self.assertIn("不缩进续句",chapters[1][2]["text"])

    def test_cross_chapter_window_detects_text_not_reference_exception(self):
        donor={1:[{"text":"甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳"}],
               2:[{"text":"大卫说这就是耶和华神的殿为以色列人献燔祭的坛"},{"text":"后续正文开始"}]}
        target={1:{"verses":[[1,"甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳大卫说这就是耶和华神的殿为以色列人献燔祭的坛"]]},
                2:{"verses":[[1,"后续正文开始"]]}}
        windows,reasons=P.alignment_windows(donor,target)
        self.assertEqual(windows,[[1,2]])
        self.assertTrue(reasons)

    @unittest.skipUnless(P.poetry.DEFAULT_EPUB.exists() and (P.ROOT/"local-data"/"bible-source.js").exists(),"private local donor not present")
    def test_full_import_preserves_body_poetry_and_is_idempotent(self):
        source=P.poetry.read_source(P.ROOT/"local-data"/"bible-source.js")
        result,report=P.import_paragraphs(source,P.poetry.DEFAULT_EPUB)
        repeated,again=P.import_paragraphs(result,P.poetry.DEFAULT_EPUB)
        self.assertEqual(result,repeated);self.assertEqual(report,again)
        self.assertEqual(P.poetry.source_rows(source),P.poetry.source_rows(result))
        self.assertEqual(P.poetry.title_rows(source),P.poetry.title_rows(result))
        self.assertEqual(P.poetry_rows(source),P.poetry_rows(result))
        self.assertEqual(report["mappedParagraphs"],4732)
        self.assertEqual(report["atVerseStart"],4665)
        self.assertEqual(len(report["withinVerse"]),67)
        self.assertEqual(report["mappedStanzaBreaks"],1291)
        self.assertEqual(len(report["superscriptions"]),116)
        ch=lambda code,n:next(c for b in result["books"] if b["code"]==code for c in b["chapters"] if c["chapter"]==n)
        self.assertEqual(ch("GEN",1)["paragraphs"],[1,3,6,9,14,20,24,26])
        self.assertEqual(ch("COL",1)["paragraphs"],[1,3,9,21,24])
        self.assertTrue({26,36,42,44,48}.issubset(ch("ACT",13)["paragraphs"]))
        self.assertEqual(ch("PSA",23)["superscription"],"（大卫的诗。）")
        self.assertEqual(ch("PSA",23)["stanzaBreaks"],[{"verse":4,"offset":0},{"verse":5,"offset":0}])
        self.assertIn(31,ch("1CH",21)["paragraphs"])
        self.assertIn(1,ch("1CH",22)["paragraphs"])
        self.assertEqual(ch("1TI",6)["paragraphBreaks"][-1],{"verse":21,"offset":18})


if __name__=="__main__":unittest.main()
