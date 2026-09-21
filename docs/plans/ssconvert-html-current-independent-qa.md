# Current independent HTML stress QA

This independent worker reviewed and repaired the dirty candidate based on
`b97c4938a469ee70e09bd08a0e5fcf7e868ca04c` on 2026-09-20. Root retains integration,
exports, Git and maintained full-workspace gate ownership. No README was edited;
no commit, push, publication or release was performed.

## Manual procedure and oracle

Use the authenticated Gnumeric 1.12.61 source archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12` and dependency
profile `docs/ssconvert/html-reference-profile.json`. Invoke the separately built
oracle through Docker context `colima`, container `ssconvert-statistics-qa`,
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert`. Supply
`GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas`,
`GSETTINGS_BACKEND=memory`, `LC_ALL=C`, `TZ=UTC`, importer `Gnumeric_html:html` and
exporter `Gnumeric_XmlIO:sax:0`. Create original small fixtures exclusively under
`/out/ssconvert-html-current-independent`. Inspect output XML cells and stderr;
compare names, order, coordinates and exact values, rather than browser rendering.
This exporter emits uncompressed XML in this profile: an initial attempt to
unconditionally gzip-decode the XML failed as QA infrastructure and was corrected.
No product or unit invocation uses this oracle. Reduce findings into this document
then remove this task-owned temporary directory.

## Verified cases and repairs

Eight initial independent original native cases completed with native status 0:
active-content outside tables, textarea child markup, title child markup, numeric
references with no digits, raw script/style content inside a cell, malformed
comment closure, literal NUL text, and unterminated quoted attributes. Two further
native cases completed with status 0: script markup embedded within textarea,
and textarea child markup crossing the implementation's 4096-character boundary.

Three semantic failures were reproduced by failing in-memory tests before code
repairs. `A&#;B&#x;C&#X;D` becomes `ABCD` and emits three invalid xmlChar value 0
warnings, with native source carets at columns 19, 24 and 29. Literal NUL in
`a\0b` becomes `a b`, with `Char 0x0 out of allowed range` and a source excerpt
truncated at NUL. Textarea `<b>x</b>&amp;` contributes `x&`, and title
`<b>X</b>&amp;` contributes separate outside-table B1 `X` and B2 `&` cells.

The repairs consume measured empty numeric references, replace literal NUL text,
and re-tokenize title/textarea child markup through htmlparser2's public Tokenizer
API with absolute source offsets. Raw text is accumulated across main tokenizer
chunks before reparsing. No private tokenizer state is accessed. Script and style
handling remains on the tolerant HTML tokenizer path. The independent negative
control with script/table syntax embedded in textarea creates one sheet and text
`axb`; the 4070-character original fixture crossing a tokenizer boundary retains
4070 `a` characters followed by `x&`.

Scripts/styles outside tables contribute no sheets or text. Visible paragraph
text before and after a table occupies B1/B3 and the table occupies A2. Scripts,
styles, images, frames and external references receive no execution or acquisition
capability. Native libxml additionally warns about unexpected `</table>` syntax
embedded in some script/style payloads; those warnings remain a measured mismatch.

## Checks and candidate identity

The independent suite now contains 18 tests, all passing; together with the
existing seven HTML codec tests, 25 tests passed with zero skips. The package lint
route passed ESLint plus source and test TypeScript configurations. Root owns the
maintained uncached workspace test/build closure and command/SDK/replay boundaries.
Focused tests do not establish full-workspace completion or native diagnostic parity.

Checked product file SHA-256:
`2429e3da9c5e15d72a44c5b1d964993af3e39827e755e4cde7bd3df3e394cd6d`.
Checked independent test file SHA-256:
`1e6ccdd632dc5974b1b8bd531b6f7a9a5222215af1781efa1dfb74394d80979c`.

## Remaining measured failures and unverified cells

Malformed `<!--x--!>` recovers the same `ab`/`c` cell values, but candidate omits
native `Comment incorrectly closed by '--!>'` diagnostic. An unterminated quoted
attribute preserves native cell value `x`, but omits native `AttValue: " expected`
and `Couldn't find end of Start Tag a` diagnostics. Unexpected end-tag warnings
inside the outside-table active-content case are omitted. These are failures of
exact diagnostic compatibility, not passes.

Other libxml syntax-error classes, malformed nesting inside recursively nested
title/textarea constructs, NUL in attributes/comments/raw active content, embedded
encoding switching, arbitrary stream-boundary warning locations and invalid
encoding sequences remain unverified. No alternative locale/platform/plugin
runtime matrix was exercised beyond the captured C/UTC libxml profile. Performance
was not measured. Root owns realm/host, rollback/cleanup, namespace, command/SDK,
original/checkpoint/replay and budget integration checks. Those cells cannot be
inferred from this codec-focused review.
