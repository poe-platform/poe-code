# Independent classification of all 16 comparative rows

Candidate: `2272feb92f8c0f151385f59f79eee004c50d14b8`. Inputs and original outputs
are authenticated from `650c96fd`'s compressed evidence, then ALL 16 were rerun
against the moved installed module and the actual existing Pandoc binary.

Pandoc 3.10.1: `/opt/homebrew/bin/pandoc`, SHA256
`61574e53a089110eae07817b91510ff150e826807ac020aa744e0ade23025e0d`.
Arguments: `--sandbox --from=html --to=commonmark-raw_html --wrap=none`.
No installation, network fetch or private engine. Every rerun matches its recorded
side byte-for-byte, status and stderr. This reproduces **5 exact / 11 different**;
it does NOT establish semantic equivalence, HTML5 compliance or superiority.

The names below are exact original row IDs. Actual input/output bytes reside in
`capture-01/author-pandoc.json` and all independent raw reruns in
`capture-01/comparative/` (losslessly archived in the final evidence bundle).

| ID | Independent classification | Rationale tied to this input and source |
| --- | --- | --- |
| heading-paragraph | Exact; no defect found in row | Both retain Release as h1 and ready as a separate paragraph. Renderer lines 155–156 and 182–187 implement these boundaries. |
| emphasis | Exact; no defect found in row | Bold/italics each have surrounding word boundaries; the final period is ordinary text. This row does not exercise adjacent emphasized siblings or line-initial numeric punctuation. |
| safe-link | Legitimate formatting | `[docs](<https://example.test/doc>)` vs bare destination delimiters retain the same HTTPS URL and label. `render.ts:170` deliberately uses angle delimiters; `entities.ts:32–53` checks destination policy. |
| image | Legitimate formatting | Angle-wrapped `/logo.png` vs bare `/logo.png` retains the same relative destination/alt. No title or fetch. Same renderer destination construction. |
| unordered-list | Exact; no defect found in row | Both retain two source items in order using hyphen list markers. `render.ts:51–74`. |
| ordered-list | Legitimate formatting | One vs two spaces after `3.` and `4.` does not change this simple list's start, order, or item text. No nested-list indentation issue is exercised here. |
| blockquote | Exact; no defect found in row | Both retain two blockquoted paragraphs with a quoted blank line. `render.ts:172–177`. |
| inline-code | Legitimate formatting | Both use a two-backtick delimiter around `a ` + literal backtick + ` b`. Pandoc adds removable one-space padding; module does not need padding because content does not start/end in a backtick/space pair. The code text remains identical. `render.ts:142–147`. |
| pre | Legitimate formatting | Both use four-backtick fences and language js around the same three content lines. Space before js is optional info-string formatting here, not changed code text. `render.ts:132–141`. |
| entities | Legitimate formatting | Module escapes the literal ampersand, Pandoc leaves it unescaped. In this exact position it cannot start an entity; both preserve literal `<x>`, &, copyright and emoji. `entities.ts:11–28`. |
| unicode | Exact; no defect found in row | Both preserve Chinese, café and emoji. This row alone is not a split-byte or invalid-UTF8 test; those are independent L13 and E01–E04. |
| table | Writer capability/profile mismatch; baseline content loss | Module emits the documented pipe-table extension retaining A/B/x/y. The selected Pandoc CommonMark writer emits only `[TABLE]`, losing this row's cells. It would be misleading to call this mere whitespace or a product parity failure. No full table-layout/browser claim. `render.ts:76–125`. |
| raw-drop | Declared structural-policy difference; no lost visible source characters | Input is `a<script>…</script><style>…</style><!-- … -->b`, with NO visible interstitial whitespace. Module drops active/comment nodes and yields `ab`; Pandoc imposes a paragraph break (`a\n\nb`). Module's policy does not promise invented separation where the input has none. Not a sanitizer claim or a waiver for joining words around actual source whitespace. `parser.ts:116,154–156`; `render.ts:36–49`. |
| malformed | Malformed-input policy difference; baseline drops preserved tail | Input ends in `before <b unfinished`. Module retains the malformed ordinary tail as escaped literal text per README lines 74–75. Pandoc drops it. This is real content preservation by the declared module profile, not HTML5-equivalence evidence. `parser.ts:172–176`. |
| unknown-entity | Legitimate formatting/defensive escaping | `\&madeup;` vs `&madeup;` both display the same unsupported reference in the chosen reader; module additionally prevents a later entity decode as explicitly documented. No source content is lost. `entities.ts:13–14,27`. |
| textarea | RCDATA/profile difference; baseline loses content | Module preserves the literal `<b>literal</b> &` as escaped text, as README lines 80–81 promise. Pandoc yields only a newline. Calling this a generic formatting difference would hide baseline loss. `parser.ts:134–136,176`; `entities.ts:27`. |

Totals among the 11 differences: **7 legitimate formatting, 1 declared structural
policy difference, 1 writer-capability mismatch with baseline loss, 2 recovery/
RCDATA policy differences with baseline loss**. No unsafe module destination or
lost module content was found in these 16 particular inputs. No new issue was
found in the five exact rows. This does not mitigate the independently reproduced
source defects in `REPORT.md`; their inputs are outside this small comparative set.

Separate semantic checks use the authenticated Pandoc `commonmark_x` reader to
show OrderedList, Strikeout and spurious literal `**` nodes in followup output,
and to validate that the title/alt attack yields only the intended safe Link/Image
with no RawInline/RawBlock. This is a precise, named renderer profile, not universal
security certification. Raw JSON ASTs and assertion failures are preserved.
