# GFM reader profile and differential evidence

The original TypeScript `gfm` reader is bound to the CommonMark parser in
`packages/pandoc`. SDK validation, format availability, extension inspection
and the existing thin safe-bash inspection adapter use the same descriptor.
There is no native runtime fallback, external parser dependency or new command
wiring. GFM writing remains unavailable.

## Pinned standard and actual reference

Normative reference: GitHub Flavored Markdown specification **0.29**, dated
**2019-04-06**, https://github.github.com/gfm/.
Pinned source: https://raw.githubusercontent.com/github/cmark-gfm/0.29.0.gfm.13/test/spec.txt.
Source bytes SHA-256:
`7d8e5814befec287ac116786d81ff14e0adc9b13295b4494649e995408fd871c`.
The referenced specification is CC-BY-SA 4.0; no normative fixture or parser
implementation is copied into unit tests.

Actual differential reference: **Pandoc 3.8.3**, official arm64 macOS artifact
https://github.com/jgm/pandoc/releases/download/3.8.3/pandoc-3.8.3-arm64-macOS.zip,
SHA-256 `3eaeb3bd10982aecba5dd76158745a4f805afb39ab72a519bba2533c98ce002d`.
The executable was used only in manual differential QA, then removed. Its actual
`--list-extensions=gfm` output is recorded in
[gfm-pandoc-3.8.3-extensions.txt](gfm-pandoc-3.8.3-extensions.txt).

This is an explicitly bounded reader profile, **not equivalence to Pandoc's
complete GFM dialect or the entire GFM specification**. The base parser remains
CommonMark 0.31.2, rather than GFM 0.29's older CommonMark base.

## Exact supported extension contract

| Pandoc extension name | Default | Enabled behavior | Disabled behavior |
| --- | --- | --- | --- |
| `pipe_tables` | true | Header/delimiter and pipe-bearing body rows; alignment, short-row padding and excess-cell removal | CommonMark block/inline syntax |
| `strikeout` | true | Exact two-tilde flanking runs produce `Strikeout` | Tildes remain text or existing fenced-code syntax |
| `task_lists` | true | First paragraph whitespace/`x`/`X` marker in any list item retains state | Bracket markers follow ordinary CommonMark syntax |
| `autolink_bare_uris` | true | HTTP, HTTPS, FTP, www and email links; GFM ASCII boundaries, suffix punctuation and parenthesis balancing | Bare URLs/emails remain ordinary text |
| `raw_html` | true | Allowed raw HTML retained; nine GFM disallowed tag names filtered | HTML syntax preserved as text |

Selections apply signs **left to right; the final sign wins**, independently for
each extension. Both help/inspection and SDK reject any undeclared extension,
even when requested with a minus sign. No footnotes, math, YAML metadata, smart
punctuation, definition lists, emoji, alerts, attributes or heading identifiers
are added implicitly. Pandoc actually advertises additional enabled extensions:
`alerts`, `emoji`, `footnotes`, `gfm_auto_identifiers`, `tex_math_dollars`,
`tex_math_gfm`, and `yaml_metadata_block`; these are outside this task.

Pipe splitting runs before inline parsing, including code spans. `\|` becomes
cell text `|`; an unescaped pipe inside backticks still separates cells. Empty
cells contain no blocks; populated cells contain `Plain`. Header and delimiter
cell counts must match. At least one hyphen is required per delimiter cell.
A non-pipe continuation ends the table and becomes a separate block, matching
observed Pandoc behavior: it is never appended as a multiline cell. GFM 0.29
§4.10 instead permits a non-pipe body row padded with empty cells. This profile's
pipe-bearing-row restriction is explicit. New block starts and blank lines also
end tables. Tables work inside matched quotes and list items.

Only exact two-tilde runs participate in strikeout; single and longer runs remain
literal (or fenced code when applicable). Emphasis flanking applies; the emphasis
rule of three does not apply to tilde pairs. Strikeout can cross soft breaks but
not paragraphs. Code and backslash escapes retain their CommonMark protection.

Extended URLs trim ASCII `?!.,:*_~`, entity-like suffixes, and excess trailing
`)`; square brackets and Unicode punctuation are retained. URL targets use the
existing CommonMark percent-encoding policy. Explicit link labels and code do
not receive nested bare links. Email local/domain grammar uses ASCII letters and
digits; internationalized URL domains are accepted.

## Documented task AST

Task state uses the existing standard Pandoc-compatible `Span` constructor,
leading the first `Plain` (tight list) or `Para` (loose list):

```json
{"t":"Span","c":[["",["task-list-marker"],[["checked","true"]]],[]]}
```

`checked` is exactly `"true"` or `"false"`. The span has no textual glyph or
children. Content follows the marker directly; the consumed source marker and
its separating whitespace are not retained. Empty tasks still contain the span.
Space or tab inside the brackets means unchecked; space/tab after the marker
separates content. Only the first paragraph of an item qualifies; later paragraphs do not. Nested
lists independently preserve state. This structure survives validated SDK reads
and JSON serialization, allowing downstream writers to choose their rendering.
Pandoc's glyph substitution (`☐` / `☒`) is an intentional AST difference.

## Disallowed HTML behavior

Case-insensitive tag filtering covers `title`, `textarea`, `style`, `xmp`,
`iframe`, `noembed`, `noframes`, `script`, and `plaintext`, including closing tags
and valid name boundaries. Disallowed inline HTML becomes literal `Str` text,
which an HTML renderer must escape. In raw blocks, tag-opening `<` becomes
`&lt;`. Other raw tags remain raw; names such as `scripture` remain unaffected.
Filtering is independent of pipe table toggling. This implements GFM's narrow
output tagfilter at the reader boundary; it is not general HTML sanitization.
Actual Pandoc JSON retains the unfiltered raw tags for these inputs.

## Explicit differential classifications

[gfm-differential-result.json](gfm-differential-result.json) records 51 original
inputs, exact format selections, both actual JSON outputs, and explanations for
every classification. Compare metadata and blocks exactly; the separately
recorded API versions differ (original 1.23.1.2, Pandoc 1.23.1). No other tree
normalization or fixture substitution is used.

| Classification | Cases | Meaning |
| --- | ---: | --- |
| Exact content match | 29 | Tables, escapes, empty/header-only rows, multiline separation, nested tables, ordinary strikeout, links and disabled syntax agree |
| Spec table precedence | 1 | Unprefixed single-hyphen delimiter takes table precedence; Pandoc sees a list |
| Unsupported heading identifiers | 1 | Both reject mismatched table; only Pandoc assigns a heading ID |
| Strict delimiter runs | 2 | Longer tilde runs stay literal; Pandoc consumes pairs from them |
| Structured task state | 3 | Span attributes replace Pandoc's checkbox glyph substitution |
| URI normalization | 1 | Percent-encoded Unicode target versus Pandoc's Unicode target |
| Spec autolink boundary | 1 | Fullwidth opening parenthesis does not start a GFM extended URL |
| Spec autolink punctuation | 1 | Balanced square brackets remain URL text versus Pandoc's trailing-bracket trimming |
| No nested links | 1 | Original explicit label remains text; actual Pandoc nests a bare link |
| GFM tagfilter | 2 | Original filters disallowed tags; Pandoc JSON retains raw tags |
| Unsupported Pandoc extra | 3 | Footnotes, math, YAML remain CommonMark syntax |
| Deterministic final sign | 5 | Original final disable wins; Pandoc enables when both signs are supplied |
| Literal disabled HTML | 1 | Original preserves disabled raw syntax as text; Pandoc retains raw inline tags |

These comparisons establish the listed cases only. They are not a complete GFM
conformance corpus or an equivalence claim.

## Validation

Original failing-first workspace run: 32 new cases failed, 427 existing tests
passed. Additional failing tests reproduced trailing-period links, emails after
punctuation, empty task-state loss, and tab task-marker handling before their fixes. Unit tests use only
in-memory strings and expected trees: no filesystem mutations, LLM calls,
downloaded fixtures or executable invocations.

Maintained checks: 468 pandoc workspace unit tests (41 GFM tests), ESLint and both source/test
TypeScript checks; selected workspace build closure; all 652 pinned CommonMark
0.31.2 normative examples pass. Manual adapter screenshot was rendered with
`npm run screenshot -- node -e 'eval(process.env.GFM_SCREEN)'` (environment code
calls the existing adapter for both format lists and GFM extension inspection).
The viewed [gfm-formats.png](gfm-formats.png) shows readable complete output,
including GFM availability and all five exact default extension signs. QA uses
repository screenshot tooling against the adapter because full CLI conversion
command wiring is outside this task.

Delivery: local commit only. No push, remote-main verification or release is
requested or attempted.
