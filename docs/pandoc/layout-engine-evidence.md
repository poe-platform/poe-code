# PDF layout engine evidence

Original in-memory failing tests preceded the implementation. The initial eight
layout cases failed against the previous engine. Additional failing cases exposed
oversized JPEG admission, `.notdef` coverage, heading/image separation, timer
cancellation starvation, vertical metrics and invalid horizontal metric counts.

Verified scope: `npm test --workspace=@poe-code/pdf` (23 tests),
`npm run lint --workspace=@poe-code/pdf` (ESLint and both TypeScript configs), and
`npm run build:workspaces -- --workspace=@poe-code/pandoc` (maintained dependency
closure including pdf and office-package). No unit host mutation or executable,
downloaded fixture or LLM was added. Metric expectations independently read raw
sfnt head/hhea/hmtx records rather than the layout's calculated boxes.

PDFKit/AppKit independently rendered every page through Swift outside unit tests.
Inspected all five engine PNGs: one empty page, one single page containing Latin,
Greek and Cyrillic, and three pages of one 35-line table row. Each table page has
the declared leading header and borders inside the 24-point margins. All owned
lines 1–35 and the secondary cell remain readable, without clipping, overlaps,
missing glyphs or endless pagination. PDFs and PNGs accompany this record.
Engine samples use 240 × 300 point pages, 24-point margins and the explicitly
supplied packaged JetBrains Mono font. Table columns are 60%/40%, one repeated
header row, and `rowSplit: "lines"`.

Profile: horizontal LTR scalar text: U+0020–007E, U+00A0–00FF and U+0370–052F,
excluding U+0483–0489. Combining sequences, RTL/bidi controls, contextual scripts
and absent glyphs fail explicitly. Ordered supplied font fallback checks actual
glyph identity, not coverage alone; `.notdef` and nonpositive advances fail.
This is not CSS or TeX layout equivalence and does not promise general shaping.

Paragraphs wrap at spaces, retain source characters, and break long words at
glyph boundaries by default; `longWord: "error"` rejects them. Font ascent/descent
determine common baselines and line height (at least 1.2 em). Defaults are two
widow/orphan lines, relaxed only on a page too small to satisfy them. Indentation
is explicit. `keepTogether` rejects oversized blocks; paragraph `keepWithNext`
reserves following paragraph start lines (all lines when kept together), an
image, or a table's leading header/body row. Conflicting explicit breaks fail.
Rectangular unspanned tables repeat `headerRows`; row splitting is opt-in and
otherwise oversized rows fail. Images default to aspect-preserving contain within
their explicit box and page; `natural` fails if intrinsic dimensions do not fit.

Font bytes/count, sfnt directory ranges, metric counts, glyph outline locations,
cmap Unicode ranges/expansion, image decoded dimensions, glyph/work/page/object
budgets are admitted before corresponding engine allocations/work. Cancellation
uses an injected scheduler or an event-loop timer by default. These admission
checks are not a claim that the upstream font parser is a general security sandbox.
Repository-wide tests were not run; verification above is the maintained scope.
No push or release authorized.
