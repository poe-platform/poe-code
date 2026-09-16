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

Status: geometry committed as 001bbb3c2. Writer red/green complete; 531 package tests,
lint/typecheck and selected build passed. Byte-only adapter pending.
