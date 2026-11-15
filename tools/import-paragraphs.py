#!/usr/bin/env python3
"""Restore donor semantic p starts and b stanza breaks without changing scripture or poetry.

Paragraph boundaries are textual semantics, not physical lines or page anchors.
Only ignored local-data is written by default. Canonical verse strings remain
exact, including punctuation, spaces, inline notes and merged-verse placeholders.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
from difflib import SequenceMatcher
import importlib.util
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location("poetry_import",Path(__file__).with_name("import-poetry.py"))
poetry=importlib.util.module_from_spec(spec);spec.loader.exec_module(poetry)
NS=poetry.NS


def parse_paragraphs(archive,code):
    root=ET.fromstring(archive.read(f"OEBPS/{code}.xhtml").decode("utf-8-sig"))
    main=next(n for n in root.iter(NS+"div") if n.get("class")=="main")
    chapters={};chapter=None;verse=None;count=0;starts=[];stanzas=[];pending_stanzas=[]
    for div in main:
        cls=div.get("class")
        if cls=="psalmlabel":
            chapter=int("".join(div.itertext()).strip());chapters[chapter]=[];verse=None;continue
        if cls=="b":
            item={"id":f"{code}.b{len(stanzas)+1:05d}","sourceChapter":chapter}
            stanzas.append(item);pending_stanzas.append(item["id"]);continue
        if cls not in ("p","m","q","qs","d"):continue
        events=list(poetry.text_events(div))
        texts=[];first_marker=None;leading=[]
        for kind,value in events:
            if kind=="verse":
                verse=int(value.split("_",1)[1].split("-")[0])
                if first_marker is None:first_marker=verse
            else:
                value=re.sub(r"[\r\n\t ]+","",value)
                if value and value.strip("\u00a0"):
                    texts.append(value)
                    if first_marker is None:leading.append(value)
        text="".join(texts)
        if not text:continue
        if chapter is None:raise ValueError(f"Unanchored donor body: {code}")
        if cls=="d":
            if chapters[chapter]:raise ValueError(f"Superscription after scripture body: {code}.{chapter}")
            chapters[chapter].append({"kind":"prose","text":text,"superscription":True})
            continue
        if cls=="p":
            count+=1
            pid=f"{code}.p{count:05d}"
            meta={"id":pid,"chapter":chapter,"firstVerseMarker":first_marker,"withoutVerseMarker":first_marker is None,
                  "leadingTextBeforeMarker":"".join(leading),"sample":text[:80]}
            starts.append(meta)
            part={"kind":"prose","text":text,"paragraphId":pid}
            if pending_stanzas:part["stanzaIds"]=pending_stanzas;pending_stanzas=[]
            chapters[chapter].append(part)
        elif pending_stanzas:
            chapters[chapter].append({"kind":"prose","text":text,"stanzaIds":pending_stanzas});pending_stanzas=[]
        elif chapters[chapter] and not chapters[chapter][-1].get("superscription"):
            chapters[chapter][-1]["text"]+=text
        else:
            chapters[chapter].append({"kind":"prose","text":text})
    if pending_stanzas:raise ValueError(f"Unanchored trailing stanza break: {code}")
    return chapters,starts,stanzas


def poetry_rows(source):
    return [[b["code"],c["chapter"],c.get("poetry",[])] for b in source["books"] for c in b["chapters"]]


def alignment_windows(donor,chapters):
    """Merge neighbouring chapters only when chapter-local text evidence fails.

    Canonical sources can move a verse over a chapter boundary. Detect edge
    insertions/deletions generically, then align a contiguous chapter window;
    do not encode reference-specific exceptions or silently shift verse IDs.
    """
    numbers=sorted(chapters);parent={n:n for n in numbers};reasons=[]
    def find(n):
        while parent[n]!=n:parent[n]=parent[parent[n]];n=parent[n]
        return n
    def union(a,b):parent[find(b)]=find(a)
    for index,n in enumerate(numbers):
        parts=donor.get(n,[])
        a,_=poetry.normalized("".join(p["text"] for p in parts))
        b,_=poetry.normalized("".join(t for _,t in chapters[n]["verses"]))
        matcher=SequenceMatcher(None,a,b,autojunk=False)
        for tag,a0,a1,b0,b1 in matcher.get_opcodes():
            if tag=='equal' or max(a1-a0,b1-b0)<10:continue
            near_start=a0<80;near_end=a1>len(a)-80
            if near_start and index>0:
                union(numbers[index-1],n);reasons.append({"chapter":n,"direction":"previous","kind":tag,"source":a[a0:a1],"target":b[b0:b1]})
            if near_end and index+1<len(numbers):
                union(n,numbers[index+1]);reasons.append({"chapter":n,"direction":"next","kind":tag,"source":a[a0:a1],"target":b[b0:b1]})
    groups={}
    for n in numbers:groups.setdefault(find(n),[]).append(n)
    return sorted(groups.values(),key=lambda x:x[0]),reasons


def import_paragraphs(source,epub):
    output=deepcopy(source)
    output["edition"]="rules-3"
    source_starts=[];mapped_starts=[];source_stanzas=[];mapped_stanzas=[];superscriptions=[];reviews=[];alignments=[];cross_chapter=[]
    with ZipFile(epub) as archive:
        for book in output["books"]:
            code=book["code"];donor,starts,stanzas=parse_paragraphs(archive,code);source_starts.extend(starts);source_stanzas.extend(stanzas)
            chapters={c["chapter"]:c for c in book["chapters"]}
            for chapter in book["chapters"]:
                chapter["paragraphs"]=[];chapter.pop("paragraphBreaks",None);chapter.pop("stanzaBreaks",None);chapter.pop("superscription",None)
            windows,reasons=alignment_windows(donor,chapters)
            if reasons:cross_chapter.append({"book":code,"windows":[w for w in windows if len(w)>1],"reasons":reasons})
            for window in windows:
                parts=[p for n in window for p in donor.get(n,[])]
                if not any(p.get("paragraphId") or p.get("stanzaIds") or p.get("superscription") for p in parts):continue
                records=[(n,v,t) for n in window for v,t in chapters[n]["verses"]]
                target="".join(t for _,_,t in records)
                ref=f"{code}.{window[0]}"+(f"-{window[-1]}" if len(window)>1 else "")
                mapped,audit,issues=poetry.align_group(parts,target,ref)
                alignments.append(audit);reviews.extend(issues)
                bounds=[];cursor=0
                for n,v,text in records:
                    bounds.append((cursor,cursor+len(text),n,v,text));cursor+=len(text)
                cursor=0
                for part in mapped:
                    if part.get("paragraphId") or part.get("stanzaIds") or part.get("superscription"):
                        candidates=[x for x in bounds if x[0]<=cursor<x[1]]
                        if not candidates:raise ValueError(f"No canonical paragraph anchor: {ref} {cursor}")
                        lo,hi,n,v,text=candidates[0];offset=cursor-lo;chapter=chapters[n]
                        if text.strip()=="-":raise ValueError(f"Paragraph anchored at placeholder: {ref}:{v}")
                        if any(a<offset<b for a,b in (m.span() for m in poetry.NOTE_PATTERN.finditer(text))):
                            raise ValueError(f"Paragraph splits note: {ref}:{v}")
                        # Semantic offsets count Unicode code points, matching
                        # the renderer's [...text], never visual line positions.
                        semantic_offset=offset
                        location={"book":code,"chapter":n,"verse":v,"offset":offset,
                                  "before":text[max(0,offset-35):offset],"after":text[offset:offset+65]}
                        if part.get("superscription"):
                            if offset!=0 or v!=chapter["verses"][0][0] or not text.startswith(part["text"]):
                                raise ValueError(f"Superscription is not canonical first-verse prefix: {ref}:{v}")
                            chapter["superscription"]=part["text"]
                            superscriptions.append({"book":code,"chapter":n,"verse":v,"text":part["text"]})
                        if part.get("paragraphId"):
                            if offset==0:chapter["paragraphs"].append(v)
                            else:chapter.setdefault("paragraphBreaks",[]).append({"verse":v,"offset":semantic_offset})
                            mapped_starts.append({"id":part["paragraphId"],**location})
                        if part.get("stanzaIds"):
                            chapter.setdefault("stanzaBreaks",[]).append({"verse":v,"offset":semantic_offset})
                            mapped_stanzas.append({"sourceIds":part["stanzaIds"],**location})
                    cursor+=len(part["text"])
                assert cursor==len(target)
            for chapter in chapters.values():
                if len(chapter["paragraphs"])!=len(set(chapter["paragraphs"])):
                    raise ValueError(f"Duplicate paragraph anchor: {code}.{chapter['chapter']}")

    assert poetry.source_rows(source)==poetry.source_rows(output),"Body changed"
    assert poetry.title_rows(source)==poetry.title_rows(output),"Titles changed"
    assert poetry_rows(source)==poetry_rows(output),"Poetry changed"
    assert len(source_starts)==4732,"Unexpected donor p inventory"
    assert {x["id"] for x in mapped_starts}=={x["id"] for x in source_starts},"Missing paragraph starts"
    assert len(source_stanzas)==1291,"Unexpected donor b inventory"
    assert {x["id"] for x in source_stanzas}=={i for x in mapped_stanzas for i in x["sourceIds"]},"Missing stanza boundaries"
    assert len(superscriptions)==116,"Unexpected donor d inventory"
    report={"superscriptions":superscriptions,"sourceStanzaBreaks":len(source_stanzas),"mappedStanzaBreaks":len(mapped_stanzas),"stanzaStarts":mapped_stanzas,"sourceParagraphs":len(source_starts),"sourceWithoutVerseMarker":sum(x["withoutVerseMarker"] for x in source_starts),
            "mappedParagraphs":len(mapped_starts),"atVerseStart":sum(x["offset"]==0 for x in mapped_starts),
            "withinVerse":[x for x in mapped_starts if x["offset"]>0],"sourceStarts":source_starts,"mappedStarts":mapped_starts,
            "boundaryReview":reviews,"crossChapterWindows":cross_chapter,"minimumCoverage":min(x["sourceCoverage"] for x in alignments),
            "integrity":{"bodyBefore":poetry.digest(poetry.source_rows(source)),"bodyAfter":poetry.digest(poetry.source_rows(output)),
                         "titlesBefore":poetry.digest(poetry.title_rows(source)),"titlesAfter":poetry.digest(poetry.title_rows(output)),
                         "poetryBefore":poetry.digest(poetry_rows(source)),"poetryAfter":poetry.digest(poetry_rows(output))},
            "limits":["Imported donor p semantics, not every original PDF paragraph verified", "No m, q, d element is treated as p", "b breaks are anchored to following scripture, including across chapter labels", "No physical line or page coordinates"]}
    return output,report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epub",type=Path,default=poetry.DEFAULT_EPUB)
    parser.add_argument("--source",type=Path,default=ROOT/"local-data"/"bible-source.js")
    parser.add_argument("--output",type=Path,default=ROOT/"local-data"/"bible-source.js")
    parser.add_argument("--report",type=Path,default=ROOT/"local-data"/"pdf-paragraph-import-audit.json")
    parser.add_argument("--audit-only",action="store_true")
    args=parser.parse_args();source=poetry.read_source(args.source);output,report=import_paragraphs(source,args.epub)
    args.report.parent.mkdir(parents=True,exist_ok=True);args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if not args.audit_only:
        wrapper="/* Canonical scripture with semantic paragraphs and poetry; no physical line or page coordinates. */\n"+"(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BIBLE_SOURCE=factory();})(typeof window!=='undefined'?window:globalThis,function(){return "+json.dumps(output,ensure_ascii=False,separators=(",",":"))+";});\n"
        args.output.write_text(wrapper,encoding="utf-8")
    print(json.dumps({k:report[k] for k in ("sourceParagraphs","sourceWithoutVerseMarker","mappedParagraphs","atVerseStart","sourceStanzaBreaks","mappedStanzaBreaks","minimumCoverage")} | {"withinVerse":len(report["withinVerse"]),"superscriptions":len(report["superscriptions"]),"reviews":len(report["boundaryReview"]),"written":not args.audit_only},ensure_ascii=False))


if __name__=="__main__":main()
