# Table geometry and projections

Implement only the original TypeScript table converter in packages/pandoc.
Preserve the unrelated existing plan edit. No native fallbacks or upstream fixtures.

1. Add original failing geometry cases; extract shared bounded sparse placement.
   Require complete occupancy; reject invalid spans, overlaps, section crossing,
   row-header boundary crossing and uneven rows rather than repair them.
2. Add failing independently asserted HTML5/GFM/Plain projection cases and
   CLI/SDK lossy cases; implement writer bindings and a byte-only safe-bash adapter.
3. Run package test/lint/build routes; record evidence under docs/pandoc.
   Commit verified atomic changes on main, with explicit owned paths. Do not push.

QA: inspect HTML with an independent DOM parser, compare GFM and Plain against
literal original expected output; exercise strict/lossy diagnostics, bounded
generated tables, idempotence and source text order. No unit filesystem mutation,
external executables, downloaded fixtures or LLMs. No visual CLI styling changes.

Status: geometry committed as 001bbb3c2; writers committed as a0beb9626. Byte-only
adapter red/green complete. Final 535 package tests, lint/typecheck and selected
workspace build passed; screenshot reviewed. Task complete in local atomic commits
on main. No push or release authorized or performed.

## Executed manual command QA

Build the selected pandoc workspace. Invoke the exported createPandocCommand
factory with real HTML reader input:
`<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td colspan=2>Span text</td></tr></tbody></table>`.
Use byte stdin and awaited byte stdout/stderr sinks. Run `-f html -t gfm`, then
`-f html -t gfm --lossy`. Check strict failure produces no document output and
lossy success keeps Span text once with a blank covered position; check exact
diagnostic cell paths. Capture using `npm run screenshot -- --output
docs/pandoc/table-command.png --no-header node --input-type=module -e '<inline
factory invocation>'` and visually inspect the saved image. This is a Markdown
QA procedure executed ad hoc, not a committed QA script.
