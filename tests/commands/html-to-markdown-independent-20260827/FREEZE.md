# Independent post-commit fixture freeze

Date: 2026-08-27. Reviewer is the independently assigned leaf; no delegation.
Ownership: ONLY new files in this directory. No product repair or root wiring.

## Chronology and exposure

Candidate `2272feb92f8c0f151385f59f79eee004c50d14b8` already existed (commit
2026-08-27T13:52:25-05:00) when this review began. At 2026-08-27T19:04:11Z its
availability was checked. This is a **POST-COMMIT / PRE-IMPLEMENTATION-INSPECTION**
freeze, NOT a pre-candidate, pre-code, or blind-module-review claim.

Before freezing, the reviewer read:

- Live `../AGENTS.md` lines 1–6 and root `AGENTS.md` lines 1–168; checked for
  scoped instructions at tests/, tests/commands/, both module directories and
  src/, src/commands/. No additional applicable file was present.
- Immutable candidate `src/commands/html-to-markdown/README.md` lines 1–149,
  including the requested rendering profile starting at line 32.
- Evidence revision `650c96fd6957945b32d6a4bc71f016a8e611cade`
  `tests/commands/html-to-markdown/AUTHOR_HANDOFF.md` lines 1–122. This necessarily
  exposed author aggregate results, development-failure summaries and broad
  comparative-difference descriptions, not author test bodies/expectations or
  the 16 comparative inputs/outputs. These summaries are not independent evidence.
- Candidate index exported declaration lines 7, 9, 50, 54 only, selected with awk;
  function opening signatures were visible, no implementation bodies.
- Candidate `options.ts` exported interfaces lines 1–15 and 17–20 only, selected
  with awk. This supplements index re-exported names without reading options logic.
- Git root/status/index, candidate metadata/tree identities, executable locations
  and Node version. Supplemental revision resolves to
  `21ca7b8c9c4afde7286aac479e070b29bbf5d5ed`; supplemental test bodies unread.

Initial instruction command failed with exit 127 because a zsh loop variable named
`path` replaced PATH. After printing parent instructions/root heading, `cat`,
`date`, and `git` were unavailable in that one command. Corrected invocation used
`file`; no repository mutation, implementation read, or execution occurred.
Two long read outputs were transport-truncated; narrower reads recovered the
profile and handoff. Exact tool transcript remains the contemporaneous record.

## Fixed independent expectations

`frozen-cases.mjs` defines literal HTML/output cases, destination invariants,
malformed/encoding and each declared cap. `frozen-protocols.json` defines
stream/invocation/installed/type/host controls. These files and this document must
be committed before reading implementation or author test bodies. Their commit
will be printed immediately. Later harness code may translate these fixed cases
to actual public API calls but cannot change them. Mistakes need additive versioned
corrections preserving original execution results.

The literal conversion convention is one trailing newline for nonempty rendered
documents, none for empty documents. The README specifies block separation but
does not explicitly specify terminal newline: this assumption is frozen as a
**format ambiguity**, not a security or content waiver. Exact marker/indentation
choices for lists, fences and tables are not completely prescribed: those cases
test declared content/order/structure invariants rather than arbitrary bytes.
NBSP/other Unicode whitespace destination handling and nested percent encodings
are not fully specified; probe and record output. No universal renderer/DNS safety
assertion. Explicitly forbidden schemes/controls/backslashes/network paths must
not become active links; dangerous labels/alt text must not inject Markdown links
or raw HTML. Titles are omitted, not preserved or interpreted.

## Execution design (frozen)

Build from exact immutable candidate source, package/lock/config and dependency
closure in unique external temp directories. Bind all inputs by Git blob and
SHA256; tools separately. Use real `npm pack`, real install of that tarball, then
move the installed regular package to a fresh consumer and retire old build and
install locations. Import its emitted module-local leaf, NOT a fictional root or
package subpath export. Record tarball, package layout, emitted pre/post hashes,
runtime import URLs/hashes and source-read fence results. No source TS runtime.

Run each potentially adversarial conversion in a supervised subprocess with an
external 5-second deadline (large stress cases 10 seconds), kill its process group
on timeout, await exit, retain stdout/stderr/status/signal/time/cleanup receipt.
Normal tests may share a supervised process only if per-case results and skipped
IDs remain explicit. Small budgets must reject oversized inputs promptly. Add
scaled high-work probes for repeated delimiters/unterminated tags/rawtext/entities,
without turning machine-specific timings into a universal complexity proof.

Use only exported leaf functions and public Shell/registry/VFS APIs; no private
parser calls. Cooperative producer cleanup is tested, never opaque-host hard
preemption. No new dependency, host fetch, private engine, global suite, or gate7.
Negative controls genuinely remove the installed leaf, poison a retired source
location, deny file reads, compile invalid types and disturb emitted layout.
Record unavailable controls as NOTEXECUTED, never passes. No worker layout claim
if the module has no workers.

After execution independently classify every recorded Pandoc comparative row,
including each of 11 differences, from actual input/output. Formatting is not
equivalence; content loss and unsafe destinations remain bugs. Authenticate the
recorded baseline and binary if available; do not install a new oracle.
