# Independent HTML-to-Markdown module review — 2026-08-27

## Decision and scope

**Review executed; candidate acceptance is blocked by source defects.** No product
repair, root export/default registration, package-count change, private-engine
access, new repository dependency, broad suite or gate7 work was performed.

Source: `2272feb92f8c0f151385f59f79eee004c50d14b8`.
Supplemental test/harness revision: `21ca7b8c9c4afde7286aac479e070b29bbf5d5ed`.
Author evidence revision: `650c96fd6957945b32d6a4bc71f016a8e611cade`.
Module bytes are identical across those three objects; unrelated ancestry is not
approved. Only the source/config/dependency closure and explicitly named evidence
are authenticated. Mutable HEAD never supplied product inputs.

## Honest chronology

- Candidate was already committed at 18:52:25 UTC. Profile-only review was in
  progress by 19:04:11 UTC; exact prior exposure is in `FREEZE.md`.
- **Post-commit / pre-implementation-inspection freeze:**
  `e761af2ed973e07b9b8cf09aae68ccbfbd475ca1`, printed at 19:06:39 UTC.
  Three frozen files remain byte-identical. No pre-code/pre-candidate/blind-review
  claim. The public handoff had already exposed author summaries.
- First implementation read is timestamped 19:06:52 UTC. Thereafter all seven
  module TS files were inspected, including loop/regex, allocation, budget,
  destination, ownership, abort and cleanup paths. Public contract/host closure,
  package/build/lock inputs and relevant author/supplemental harness sections were
  inspected only after the freeze. No author full test suite was rerun.
- Actual pack/install/move, installed runtime, frozen assertions, genuine negative
  controls, adversarial supervision and native comparison followed. Raw phase
  completion times are recorded. This scoped session is not 72 hours of work.

## Findings (unrepaired)

### F01 — High: quadratic whitespace trimming bypasses work/cancellation

`src/commands/html-to-markdown/render.ts:5` uses an unanchored trailing-whitespace
alternative, `/^[ \t\r\n\f]+|[ \t\r\n\f]+$/gu`. On an internal whitespace run
followed by a nonspace, the trailing alternative retries at each position. No
work units/checkpoints occur inside it. `document()` invokes it at line 183;
list, table, emphasis, link and quote paths also call this helper.

Public input: `<pre>x` + 131072 spaces + `x</pre>`. The scoped installed command
is killed by the external five-second supervisor at both 131072 and 524288 spaces;
8192 takes about 106ms process wall time, 32768 about 816ms. These figures include
startup and cohost load; the unbudgeted quadratic structure, not a benchmark score,
is the issue. This fits **default** input/token/depth/output settings: pre text is
already split into bounded tokens. No raised maxTokenBytes is necessary for F01
(the shared stress runner did raise it, but the separate abort reproduction uses
defaults and also stalls).

The default-limit abort reproduction schedules a cooperative caller abort for
100ms at input EOF, logs `ABORT_SCHEDULED_AT_EOF`, then stalls in rendering. It is
killed after five seconds with no `ABORT_CALLBACK_FIRED`. All five timed-out product
process groups were confirmed gone. This is not an opaque host producer or cleanup
failure: the uninterruptible work is module code. The external busy-loop negative
control independently verifies supervisor termination and cleanup.

### F02 — High with enlarged token cap: quadratic unresolved-entity destination scan

`src/commands/html-to-markdown/entities.ts:37` includes
`/&(?:#[^;\s]+|[A-Za-z][A-Za-z0-9]*);/u`. Repeated `&#` without a terminating
semicolon makes `[^;\s]+` traverse/backtrack over the suffix for each ampersand.
`budget.work(value.length)` at line 34 charges once, not this quadratic work.

Input: `<a href="` + `&#`.repeat(65536) + `">label</a>` with the supported
`maxTokenBytes: 1048576`. 8192 destination bytes complete in about 99ms; 32768
about 441ms; 131072 and 524288 hit the five-second kill. The default 65536 token
cap constrains this particular single attribute, but the supported larger cap is
explicitly allowed. No unsafe active destination was demonstrated: the failure is
denial of service/work-budget bypass, before policy returns. Public work limits
must not be presented as protection from this regex.

### F03 — Medium: ordinary text creates Markdown structures

`src/commands/html-to-markdown/entities.ts:27` omits period, right parenthesis and
tilde from escaping without context-sensitive protection. `<p>1. ordinary sentence</p>`
and `<p>1) ordinary sentence</p>` become ordered lists, not paragraphs containing
literal numeric prefixes. `<p>~~ordinary~~</p>` becomes strikethrough under the
profile's own declared extension. Authenticated Pandoc CommonMark-extension ASTs
confirm OrderedList and Strikeout nodes. This is a semantic bug, not a demand to
escape every harmless sentence period or parenthesis. Repros R01–R03 fail their
literal assertions AND separate structure assertions.

### F04 — Medium: adjacent emphasis inserts visible marker characters

`src/commands/html-to-markdown/render.ts:157–163` wraps adjacent inline children
independently; `children()` lines 42–45 concatenate them without disambiguation.
`<p><em>a</em><em>b</em></p>` renders `*a**b*\n`. The named reader yields one Emph
containing literal `a**b`, not the original visible `ab`. Initial R06 was explicitly
an observation (status-only PASS); the later semantic assertion FAIL is retained,
not silently promoted from that observational pass. Marker choice may vary, but
adding literal asterisks is not legitimate formatting.

### F05 — Medium: small valid token caps silently change supported entity decoding

`src/commands/html-to-markdown/parser.ts:151` flushes a full text token with
`flushText(true)`. That discards the partial-reference retention used at lines
35–37. `&amp;` at `maxTokenBytes:4` succeeds as `\&amp;\n` instead of a literal
ampersand. `&#1114112;` at cap 8 succeeds as `\&\#1114112;\n` instead of U+FFFD.
The README supports these references and allows these positive token caps; no
silent semantic degradation is declared. Correct behavior can preserve the entity
across fragments or explicitly reject an unrepresentable limit combination; current
success with changed text is the defect. R04–R05 preserve the failing exact results.

### F06 — Low / explicit-policy mismatch: edge controls are stripped before rejection

`src/commands/html-to-markdown/entities.ts:35` applies `value.trim()` before the
control-character check on line 36. Thus an entity-decoded leading TAB in an HTTPS
href or trailing LF in an HTTPS image src becomes an active destination, contrary
to the README's unqualified rejection of controls. R07–R08 fail. The recorded
destinations are still HTTPS and no script-scheme bypass was found; R09's
TAB-prefixed javascript remains inactive. Do not inflate this policy violation
into demonstrated script execution, or waive the stated policy silently.

## Results and correction accounting

Counts are separate cohorts, NOT summed acceptance or superiority scores:

| Cohort | Actual result | Meaning |
| --- | --- | --- |
| Frozen cases + protocols | 125 executed: 119 PASS, 6 FAIL | 108 fixed input rows + 17 protocol rows (including poison-source). Nine URL-policy ambiguity rows are observation/completion checks, not blanket safety passes. L13 separately runs every one of its byte split boundaries. |
| Additive v2 corrections | 6 PASS | Original six failures retained: two harmless literal escape over-specifications, two CLI-status mistakes, one escaped-HTML detection mistake, one missing middleware return. See `CORRECTIONS-v2.md`; exact punctuation-profile wording remains a documentation ambiguity, not broad literal parity. |
| Installed negative/type controls | 10 PASS | Actual missing entry/dependency failures, two deliberately failing assertions, poisoned-source installed run and real permission denial, one positive TS and three negative TS consumers. Expected failures are not product passes. |
| Scaled supervised stress | 28 executed: 24 completed, 4 FAIL/timeouts | Five frozen form families plus two source-led regex families, four scales each; completion does not certify output parity. |
| Abort/supervisor | 1 expected-kill control PASS; 1 product FAIL/timeout | Product abort starvation remains blocking. |
| Source-led semantic probes | 9 executed: 2 observational/status PASS, 7 FAIL | F03/F05/F06 and adjacent emphasis observation. |
| Independent AST assertions | 1 PASS, 4 FAIL | Safe title/alt structure passes; list/strike/adjacent-emphasis semantics fail. |
| Supplemental protocols | 6 PASS | Shared counters, primary/cleanup error precedence, actual VFS stream signal, CLI/host separation, live poison sentinel, unexported-subpath negative control. Shared counters include five independently fitting then jointly overflowing budgets. |
| Comparative phase | 43 subprocesses completed | Version; 16 installed reruns; 16 native reruns; 10 AST parses. These are not 43 acceptance cases. All 16 recorded sides reproduced. |

Every frozen ID is listed in `CASE-MATRIX-v2.json`, with original outcome, any
versioned correction and observation-only flag. All N01–N05 controls have executed
receipts; no frozen ID is NOTEXECUTED. Worker-specific layout acceptance is **not
applicable**: this module has no workers. Gate7, root/default/public-subpath
integration and full-product gates are **not executed and remain outside scope**.

## Installed authenticity and isolation

- 34 exact candidate TS inputs (module plus public contracts, shell, memory VFS and
  their closure) compile into 136 emitted files using strict candidate compiler
  settings and a recorded include/type-root override. Unrelated source is not
  copied or accepted. Package/lock/base configs and supplemental build config are
  separately Git-blob/SHA256 bound; supplemental source is not substituted.
- Actual `npm pack --ignore-scripts --offline --json`, then actual offline npm
  install of that tarball. Tarball SHA256:
  `cee898a7392f1c69b5730b836ebc15db7c1bc8debb423a221f191ea15bc45a14`.
- The installed regular package is moved to a new consumer. Original build/install
  directories are renamed/retired; a throwing source sentinel occupies the old
  source path. Direct sentinel execution really fails with its unique message;
  installed execution does not touch it. Missing leaf/dependency controls actually
  rename emitted files and restore them, with expected resolution errors.
- Leaf route is the emitted `dist/commands/html-to-markdown/index.js` by file URL
  within the moved installed package. **This is a scoped closure package, not
  acceptance of the full published package.** The unchanged manifest advertises
  unrelated/root entries not built in this scope. Actual import of the proposed
  HTML subpath fails with ERR_PACKAGE_PATH_NOT_EXPORTED, as expected.
- Synchronous Node load hooks hash actual main-thread loaded bytes. Every product
  load must match the installed/tarball inventory and resolve inside that moved
  package. No TypeScript loader/source fallback; copied TypeScript/@types/undici
  are development tools only, matched to candidate lock versions and file hashes.
  Node 22.22.2 binary/hash and npm/compiler tool identities are recorded separately.
  The npm CLI hash was collected post-run, not pre-run; the actual pack/install
  command receipts and resulting tarball are bound, but no stronger historical
  pre-execution npm-binary attestation is claimed.
- Runtime uses a filesystem read allowlist limited to the new consumer. Direct
  old-source reads really fail ERR_ACCESS_DENIED. Child/worker grants are absent;
  fetch/http/https/net/tls/child entry points are trapped and ESM builtins synced.
  This is testing instrumentation plus file permissions, not a Node network
  sandbox claim. Source inspection finds no module host I/O except timers; no
  subresource request, native product process, implicit credential or host file use.
- Post-run inventories compare the entire regular-file name/hash maps, **including
  new entries**, of installed and retired emitted/source trees and copied tools.
  Cleanup receipts confirm supervised process groups are gone. Retired source and
  install locations are never resurrected as runtime fallback. Final artifact
  sealing verifies the frozen files and candidate inputs again.

## Positive review observations and remaining limits

Input bytes/work are charged before the owned chunk copy (`input.ts:80–82`), and
parser token/node/depth/attribute counts precede corresponding retained growth.
Builders check remaining byte counts before retained append and charge work before
join. Rendering is bounded buffering, not constant memory; temporary strings and
logical counts are not RSS bounds. F01/F02 invalidate comprehensive CPU/work claims.

Independent tests exercise byte-split strict UTF8, reused Buffer ownership at next/
EOF, early/pre-abort, cooperative iterator return, idempotent registered cleanup,
awaited writes, sink/VFS errors, shared stdin and counters, actual Shell middleware/
pipeline/redirection, fallback read bounds and supplied stream signals. These do
not establish hard preemption/settlement guarantees for arbitrary opaque host work
or undo completed effects. No backend service interoperability claim is made.

The 11 Pandoc differences are classified individually in `COMPARATIVE.md`: seven
legitimate formatting, one structural policy difference, one writer mismatch with
baseline loss, two recovery/RCDATA differences with baseline loss. No equivalence
or universal sanitizer/HTML5 guarantee. Found defects must be repaired by their
assigned source owner and reviewed in a new candidate; this review does not do so.

## Evidence and replay

`EVIDENCE.json` authenticates a lossless compressed file map of all capture files,
including failed invocations/stdout/stderr, runtime loads, tarball, source/tool
manifests, timing/kill/cleanup receipts and corrected snapshots. `verify.mjs`
authenticates the archive, frozen Git files, source Git objects, tarball contents
and load receipts without rewriting evidence. `CASE-MATRIX.json` retains the first
generated matrix; additive `CASE-MATRIX-v2.json` resolves its `SEE_CONTROL_ROWS`
cross-reference labels to explicit PASS/FAIL/NOTEXECUTED outcomes for every ID.
Runtime consumer snapshots are exact per-phase copies. The top-level supervisor
script gained additive phase branches during review; no pre-run hash snapshot of
each historical supervisor version was taken, so whole-harness pre-attestation is
not claimed. Final driver bytes are covered by `ARTIFACTS.json` and the evidence
commit, while actual runtime module/consumer bytes and raw receipts are retained.

All capture/replay drivers are explicit `.mjs` opt-ins, outside canonical test
discovery. Native ASTs, historical generated TS fixtures (`.mts.fixture`) and raw
outputs are data, not canonical TS exclusions. No root tsconfig changes.

Replay: run `node tests/commands/html-to-markdown-independent-20260827/setup.mjs capture-UNIQUE`,
then `execute.mjs capture-UNIQUE frozen`, `controls`, `stress`, `corrections-v2`,
`followup-semantic`, `abort-and-supervisor`, `comparative`, `supplemental-protocols`,
and `semantic-audit.mjs capture-UNIQUE`. Exact pinned development packages must
already be available. Comparative replay requires the exact existing Pandoc hash.
Each execution phase refuses an existing destination. Known failures are expected
to reproduce; no success-only wrapper hides them.
