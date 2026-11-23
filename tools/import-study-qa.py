"""Import the canonical LLM_QT notes without publishing the Obsidian vault."""
import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHAPTER = re.compile(r"^##\s+Chapter_(\d+)\s*$", re.M)
SECTION = re.compile(r"^(?:#{1,6}\s*|\*\*\s*)第[12一二]类\b")
ANSWER = re.compile(r"^\s*(?:[-*+]\s+)?\*\*\s*(?:【(?:答案|解答|回答)】|(?:答案|解答|答|回答)\s*[：:])\s*\*\*\s*(.*)$")
NUM = r"[0-9一二三四五六七八九十百零〇两]{1,3}"
QUESTION = re.compile(
    rf"^(?:#{{1,6}}\s+)?(?:\*\*\s*)?(?:【|\[)?\s*"
    rf"(?:(?:疑难问题|疑难|问题|提问|问)\s*{NUM}(?:\s*[（(][^）)]*[）)])?\s*(?:[:：.、】\]]|(?=\s*(?:\*\*)?$))"
    rf"|[0-9]{{1,2}}[.、)）]\s*)(?:\*\*\s*)?"
)
META = re.compile(
    r"^(?:以下|下面|好的[,，]|当然[,，]|没问题[,，]).{0,110}(?:精心|为[您你]|研读问题|精炼版|整合版)"
    r"|^(?:这些问题|本组问题|以上问答).{0,45}(?:旨在|涵盖|希望|希望能)"
    r"|^(?:希望(?:这些|本篇|上述|以上)|如果[您你]还(?:需要|想)|如需进一步)(?:.{0,130})$"
)
RANGE = r"[-~～—–－〜至到]"
N = rf"(?:{NUM})"
CH = r"[章篇]"
V = r"节"


def source_books():
    raw = (ROOT / "data/bible-source.js").read_text(encoding="utf-8")
    return json.JSONDecoder().raw_decode(raw.split("function(){return ", 1)[1])[0]["books"]


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def primary_display(primary, index):
    """Project reviewed scopes to chapter titles or to the verses that should advertise the QAP."""
    if not isinstance(primary, list) or not primary:
        raise ValueError("Expected at least one primary passage")
    groups = {}
    for ref in primary:
        if (not isinstance(ref, list) or len(ref) not in (2, 4) or not isinstance(ref[0], str)
                or any(type(n) is not int for n in ref[1:])):
            raise ValueError(f"Invalid primary coordinate: {ref}")
        code, chapter, *limits = ref
        key = (code, chapter)
        canonical = index.verses.get(code, {}).get(chapter)
        if not canonical:
            raise ValueError(f"Unknown primary chapter: {ref}")
        if not limits:
            groups[key] = None
            continue
        start, end = limits
        actual = {n for n in canonical if start <= n <= end}
        if not actual or start not in actual or end not in actual:
            raise ValueError(f"Invalid primary verse range: {ref}")
        group = groups.setdefault(key, set())
        if group is not None:
            group.update(actual)

    refs = []
    for (code, chapter), verses in sorted(groups.items(), key=lambda g: (index.book_order[g[0][0]], g[0][1])):
        if verses is None or len(verses) > 10:
            refs.append([code, chapter])
        elif len(verses) > 3:
            first = min(verses)
            refs.append([code, chapter, first, first])
        else:
            for v in sorted(verses):
                if refs and refs[-1][:2] == [code, chapter] and refs[-1][-1] == v - 1:
                    refs[-1][-1] = v
                else:
                    refs.append([code, chapter, v, v])
    return refs


def apply_primary_reviews(rows, index, directory=ROOT / "tools" / "study-qa-primary"):
    """Apply only reviewed rows; never attach an old review to a changed question or answer."""
    applied = set()
    for path in sorted(directory.glob("*.json")):
        review = json.loads(path.read_text(encoding="utf-8"))
        if review.get("schema") != 1 or not isinstance(review.get("items"), dict) or not review["items"]:
            raise ValueError(f"{path.name}: invalid primary review file")
        primary = review["items"]
        selected = sorted((r for r in rows if r["id"] in primary), key=lambda r: r["id"])
        if (applied & primary.keys() or len(selected) != len(primary) or
                {r["id"] for r in selected} != primary.keys() or
                any(not key.startswith(path.stem + ".") for key in primary)):
            raise ValueError(f"{path.name}: reviewed identities are missing, duplicated, or assigned to the wrong volume")
        payload = [[r["id"], r["q"], r["a"]] for r in selected]
        if sha256(compact_json(payload).encode("utf-8")).hexdigest() != review.get("textSha256"):
            raise ValueError(f"{path.name}: reviewed question/answer text changed; review and update the coordinates first")
        for row in selected:
            scope = primary[row["id"]]
            try:
                refs = primary_display(scope, index)
            except ValueError as error:
                raise ValueError(f"{row['id']}: {error}") from error
            row["refs"] = refs
            row["primary"] = scope
        applied.update(primary)
    return len(applied)


def number(s):
    if s.isdecimal():
        return int(s)
    digits = dict(zip("零〇一二两三四五六七八九", (0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9)))
    total = cur = 0
    for c in s:
        if c == "十" or c == "百":
            total += (cur or 1) * (10 if c == "十" else 100)
            cur = 0
        else:
            cur = digits[c]
    return total + cur


def normalized(s):
    return unicodedata.normalize("NFKC", s).translate(str.maketrans(
        "記歷詩傳約羅馬書啟啓撒歷猶亞彌鴻該箴帖後賽哀結何喬俄迦節兩",
        "记历诗传约罗马书启启撒历犹亚弥鸿该箴帖后赛哀结何乔俄迦节两"
    )).replace("*", "").replace("`", "").replace("第 ", "第").replace("\n", " ")


CHAPTER_PART = (
    rf"(?:第\s*)?{N}\s*(?:"
    rf":\s*{N}(?:\s*{RANGE}\s*(?:(?:第\s*)?{N}\s*:\s*)?{N})?(?:\s*节)?"
    rf"|{CH}(?:\s*{RANGE}\s*(?:第\s*)?{N}\s*{CH}|\s*(?:第\s*)?{N}(?:\s*{RANGE}\s*(?:第\s*)?{N})?\s*节)?"
    rf"|\s*{RANGE}\s*(?:第\s*)?{N}\s*{CH})"
)
VERSES = rf"(?:第\s*)?{N}(?:\s*节?\s*(?:{RANGE}|[、,]|和|及)\s*(?:第\s*)?{N})*\s*节"
CHAPTER_LIST = rf"(?:第\s*)?{N}(?:\s*{CH}?\s*(?:[、,]|和|及)\s*(?:第\s*)?{N})+\s*{CH}"
BARE_COLON = rf"[0-9]{{1,3}}\s*:\s*[0-9]{{1,3}}(?:\s*{RANGE}\s*(?:[0-9]{{1,3}}\s*:\s*)?[0-9]{{1,3}})?(?:\s*节)?"
CHAIN = re.compile(rf"\s*(?:[、,;；]|和|及|与)\s*(?:第\s*)?({N})(?:\s*({RANGE})\s*({N}))?(?![0-9一二三四五六七八九十百零〇两]|\s*[:章篇年月岁位名人只个日条])(?:\s*节)?(?=\s*(?:[、,;；)）\]】。！？、]|$))")
CONNECT = re.compile(r"^\s*(?:[、,;；/]|和|与|及|并见|另见|参见|比较|对照)*\s*$")


class References:
    def __init__(self, books):
        self.book_order = {b["code"]: i for i, b in enumerate(books)}
        self.verses = {b["code"]: {c["chapter"]: {n for n, _ in c["verses"]} for c in b["chapters"]} for b in books}
        aliases = {normalized(n): b["code"] for b in books for n in (b["name"], b["short"], b["code"])}
        aliases.update({"撒母耳上": "1SA", "撒母耳下": "2SA", "列王上": "1KI", "列王下": "2KI",
                        "历上": "1CH", "历下": "2CH", "希": "HEB", "雅各": "JAS", "诗歌": "PSA"})
        self.aliases = aliases
        names = "|".join(map(re.escape, sorted(aliases, key=len, reverse=True)))
        full = "|".join(map(re.escape, (normalized(b["name"]) for b in books)))
        self.detached = re.compile(rf"({full})[》〉]?\s*(?:的(?:相关|平行|相应)?(?:记载|经文|叙事))?\s*[(（]\s*(?:如|见|参)?\s*$")
        singles = "|".join(map(re.escape, sorted((n for n, b in aliases.items() if len(self.verses[b]) == 1), key=len, reverse=True)))
        self.token = re.compile(
            rf"(?P<named>(?P<alias>{names})\s*(?:[》〉】]\s*)?(?P<named_ref>{CHAPTER_LIST}|{CHAPTER_PART}))"
            rf"|(?P<single>(?P<single_alias>{singles})\s*(?:[》〉】]\s*)?(?P<single_ref>{VERSES}))"
            rf"|(?P<bare>(?<![\d:]){BARE_COLON})(?!\d)"
            rf"|(?P<chap>(?<![\d:])(?:{CHAPTER_LIST}|{CHAPTER_PART}))(?!\d)"
            rf"|(?P<relative>前一章|上一章|后续一章|后一章|下一章)(?!节)"
            rf"|(?P<verse>(?<![\d:]){VERSES})"
        )
        self.invalid = Counter()
        self.review = {}

    def parse(self, s, own, chapter):
        s = normalized(s)
        out = set()
        previous = None
        cut = 0

        def add(b, c, lo=None, hi=None):
            if c not in self.verses[b]:
                self.invalid[(b, c, lo, hi)] += 1
                self.review.setdefault((b, c, lo, hi), s[max(0, m.start()-22):m.end()+22])
                return
            if lo is None:
                out.add((b, c))
            elif lo in self.verses[b][c] and hi in self.verses[b][c] and lo <= hi:
                out.add((b, c, lo, hi))
            else:
                self.invalid[(b, c, lo, hi)] += 1
                self.review.setdefault((b, c, lo, hi), s[max(0, m.start()-22):m.end()+22])
                out.add((b, c))  # Valid chapter, do not invent a verse.

        def span(b, a, z, lo=None, hi=None):
            if z < a or z not in self.verses[b] or a not in self.verses[b]:
                add(b, a, lo, hi if a == z else lo)
                if z != a:
                    add(b, z)
                return
            for c in range(a, z + 1):
                if lo is None:
                    add(b, c)
                else:
                    available = self.verses[b][c]
                    add(b, c, lo if c == a else min(available), hi if c == z else max(available))

        def verse_list(b, c, text):
            vals = [x for x in re.split(r"\s*(?:[、,]|和|及)\s*", text) if x]
            for v in vals:
                nums = list(map(number, re.findall(N, v)))
                add(b, c, nums[0], nums[-1])

        for m in self.token.finditer(s):
            if m.start() < cut:
                continue
            inherited = previous if previous and CONNECT.fullmatch(s[cut:m.start()]) else None
            b, c, va = own, chapter, False
            if m["relative"]:
                c += -1 if m["relative"] in ("前一章", "上一章") else 1
                if c in self.verses[b]:
                    add(b, c)
            elif m["verse"] or m["single"]:
                if m["single"]:
                    b, c = self.aliases[m["single_alias"]], 1
                elif inherited:
                    b, c = inherited
                verse_list(b, c, m["verse"] or m["single_ref"])
                va = True
            else:
                t = m["named_ref"] or m["bare"] or m["chap"]
                if m["named"]:
                    alias=m["alias"]
                    # Common conjunction "但" is not automatically Daniel.
                    before=s[:m.start()].rstrip()
                    after=s[m.end():]
                    cue = re.search(r"[参见如按读照自于据例《]$",before)
                    if alias!="但" or (cue or not before or re.search(r"[(（、,;；]$",before)) and (
                        cue or not t.lstrip().startswith("第") and not re.match(r"\s*(?:却|又|则|也|仍|并)",after)
                    ):
                        b = self.aliases[alias]
                elif inherited:
                    b = inherited[0]
                elif nearby := self.detached.search(s[max(0,m.start()-35):m.start()]):
                    b = self.aliases[nearby[1]]
                if m["bare"] and re.match(r"\s*(?:点[钟左右]?|分左右|时[许左右])",s[m.end():]):
                    continue
                nums = list(map(number, re.findall(N, t)))
                c = nums[0]
                if ":" in t:
                    z = nums[-2] if len(nums) == 4 else c
                    span(b, c, z, nums[1], nums[-1])
                    c = z
                    va = True
                elif t.endswith("节"):
                    span(b, c, c, nums[1], nums[-1])
                    va = True
                else:
                    if re.fullmatch(CHAPTER_LIST,t):
                        for n in nums:
                            add(b,n)
                    else:
                        span(b, c, nums[-1])
                    c = nums[-1]
            cut = m.end()
            previous = (b, c)
            if va:
                # E.g. 撒下7:11, 13–16. Do not consume full citations again.
                while (tail := CHAIN.match(s, cut)) is not None:
                    a, _, z = tail.groups()
                    add(b, c, number(a), number(z or a))
                    cut = tail.end()
        return out

    def anchors(self, own, chapter, question, answer, extra=()):
        refs = self.parse(question, own, chapter) | self.parse(answer, own, chapter) | set(map(tuple, extra))
        if not any(r[:2] == (own, chapter) for r in refs):
            refs.add((own, chapter))
        # Where a pair provides precise verses, do not independently tag the
        # whole same chapter; whole-chapter lookup still includes those verses.
        precise = {r[:2] for r in refs if len(r) == 4}
        refs = {r for r in refs if len(r) == 4 or r not in precise}
        merged = []
        for r in sorted(refs, key=lambda r: (self.book_order[r[0]], *r[1:])):
            if len(r) == 4 and merged and merged[-1][:2] == r[:2] and len(merged[-1]) == 4 and r[2] <= merged[-1][3] + 1:
                old = merged[-1]
                merged[-1] = (*old[:3], max(old[3], r[3]))
            else:
                merged.append(r)
        return merged


def trimmed_answer(lines):
    kept = []
    for line in lines:
        line = line.rstrip()
        simple = line.strip().strip("*")
        if (not re.match(r"^[-*_]{3,}$", simple) and not
            simple.startswith(("<!--", "读经范围：", "读经范围:", "AI 研读记录")) and
            not META.match(simple)):
            kept.append(line)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()


def pairs(text, file, line0, audit):
    # Repeated records (including the older LLM_QA_START format) live under
    # chapter headings; markers are boundaries, not content.
    lines = text.splitlines()
    boundaries = [
        i for i, line in enumerate(lines)
        if line.strip().startswith("<!--") or SECTION.match(line) or
        re.match(r"^#{1,6}\s.*(?:研读记录|研读问题与|疑难问题与)", line)
    ]
    marks = [(i, m) for i, line in enumerate(lines) if (m := ANSWER.match(line))]
    answer_list = []
    for i, m in marks:
        floor = max([j for j in boundaries if j < i] + [answer_list[-1][1] if answer_list else -1])
        start = next((j for j in range(i - 1, floor, -1) if QUESTION.match(lines[j])), None)
        if start is None:
            j = i - 1
            while j > floor and not lines[j].strip():
                j -= 1
            if j <= floor or "？" not in lines[j]:
                raise ValueError(f"{file}:{line0+i}: answer without a question")
            start = j
            audit["fallback_question_heads"].append([file, line0 + j])
        qparts = [QUESTION.sub("", lines[start].strip(), count=1)]
        qparts.extend(line.strip() for line in lines[start + 1:i])
        q = " ".join(v.strip().strip("*").strip() for v in qparts if v.strip().strip("*").strip())
        if not q or not any(x in q for x in ("？", "?", "。", "：")):
            raise ValueError(f"{file}:{line0+start}: bad question boundary: {q[:95]}")
        answer_list.append((start, i, q, m[1]))
    starts = {s for s, _, _, _ in answer_list}
    for j, line in enumerate(lines):
        if j not in starts and QUESTION.match(line) and re.match(r"^(?:#{1,6}\s+|\*\*)\s*(?:疑难|问题|提问|问)\s*" + NUM, line):
            audit["unpaired_question_heads"].append([file, line0 + j, line[:120]])
    for n, (start, i, q, first) in enumerate(answer_list):
        stop = min([b for b in boundaries if b > i] + [answer_list[n + 1][0] if n + 1 < len(answer_list) else len(lines)])
        a = trimmed_answer([first, *lines[i + 1:stop]])
        if not a:
            raise ValueError(f"{file}:{line0+i}: empty answer")
        yield q, a, line0 + start


def build(folder):
    books = source_books()
    index = References(books)
    audit = {"fallback_question_heads": [], "unpaired_question_heads": [], "books": {}, "origin_lines": {}}
    library = []
    source_chapters = 0
    path = ROOT / "tools/study-qa-anchors.json"
    extras = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    seen_extra = set()
    for f in sorted(folder.glob("[0-9][0-9]_*.md")):
        volume, name = f.stem.split("_", 1)
        book = books[int(volume) - 1]
        own = book["code"]
        if name != book["name"]:
            raise ValueError(f"Wrong book order: {f.name}, expected {book['name']}")
        text = f.read_text(encoding="utf-8-sig")
        sections = list(CHAPTER.finditer(text))
        volume_rows = 0
        for i, ch in enumerate(sections):
            chapter = int(ch[1])
            content = text[ch.end():sections[i+1].start() if i+1 < len(sections) else len(text)]
            base = text.count("\n", 0, ch.end()) + 1
            if chapter not in index.verses[own]:
                raise ValueError(f"{f.name}:{base}: unknown canonical chapter {chapter}")
            local = list(pairs(content, f.name, base, audit))
            if local:
                source_chapters += 1
            for n, (q, a, lineno) in enumerate(local, 1):
                key = f"{own}.{chapter}.{n}"
                extra = extras.get(key, [])
                if extra:
                    seen_extra.add(key)
                    for b, c, *r in extra:
                        assert c in index.verses[b] and (not r or len(r)==2 and r[0]<=r[1] and all(v in index.verses[b][c] for v in r)), (key, b, c, r)
                refs = index.anchors(own, chapter, q, a, extra)
                library.append({"id": key, "refs": refs, "q": q, "a": a})
                audit["origin_lines"][key] = lineno
                volume_rows += 1
        if volume_rows:
            audit["books"][own] = volume_rows
    if extras.keys() - seen_extra:
        raise ValueError(f"Unused verse overrides: {extras.keys() - seen_extra}")
    if not library:
        raise ValueError("No questions were found; expected the LLM_QT folder")
    audit["primary_reviewed_items"] = apply_primary_reviews(library, index)
    audit.update(items=len(library), source_chapters=source_chapters, coordinates=sum(len(x["refs"]) for x in library),
                 multi_coordinate=sum(len(x["refs"]) > 1 for x in library),
                 invalid_reference_candidates=[[*r, n, index.review[r]] for r, n in index.invalid.most_common()])
    return library, audit


def main():
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path, nargs="?", help="The folder named LLM_QT, not its parent or backups")
    p.add_argument("--apply-primary", action="store_true", help="Apply reviews to the existing generated catalogue without reimporting notes")
    p.add_argument("--check", action="store_true", help="Check generated output instead of writing it")
    p.add_argument("--output", type=Path, default=ROOT / "data/study-qa.json")
    p.add_argument("--audit", type=Path)
    args = p.parse_args()
    if (args.source is None) != args.apply_primary or args.apply_primary and args.audit:
        p.error("provide either an LLM_QT source (optionally with --audit) or --apply-primary")
    if args.apply_primary:
        library = json.loads(args.output.read_text(encoding="utf-8"))
        if library.get("schema") != 1:
            p.error("invalid generated catalogue schema")
        rows = library["items"]
        audit = {"items": len(rows), "primary_reviewed_items": apply_primary_reviews(rows, References(source_books()))}
    else:
        rows, audit = build(args.source)
    output = '{"schema":1,"items":[\n' + ",\n".join(map(compact_json, rows)) + '\n]}\n'
    if args.check:
        if not args.output.is_file() or args.output.read_text(encoding="utf-8") != output:
            p.exit(1, f"Stale QAP catalogue: {args.output}\n")
    elif not args.output.is_file() or args.output.read_text(encoding="utf-8") != output:
        args.output.write_text(output, encoding="utf-8", newline="\n")
    if args.audit:
        args.audit.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(compact_json({k: audit[k] for k in ("items", "primary_reviewed_items", "source_chapters", "coordinates", "multi_coordinate", "books") if k in audit}))
    if not args.apply_primary:
        print(f"Review: {len(audit['fallback_question_heads'])} unnumbered stems; {len(audit['unpaired_question_heads'])} headings without an answer marker; {len(audit['invalid_reference_candidates'])} invalid reference candidates")


if __name__ == "__main__":
    main()
