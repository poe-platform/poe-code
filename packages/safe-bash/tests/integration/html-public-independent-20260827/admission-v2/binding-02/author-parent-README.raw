# HTML public/default integration author handoff — 2026-08-27

**Author verification, not independent acceptance or a whole gate.** The frozen
candidate is `aff899aa94ed0c57a936b08fd36d185688f5c0bb`, tree
`9641374115db435022ac172ec9c99d305e07dbe4`. HTML is default74; curl/SafeJS remain
explicit optional capabilities, and du/expr are absent from defaults. Do not
fold the queued DU75 integration into this candidate.

## Source and public API

- Source/docs/export commit `28cf1518eb3e1a27c5439ba89ff1801e3f852c3b`.
- The only behavioral HTML edit is `src/commands/html-to-markdown/index.ts`.
  `input.ts`, `budget.ts`, `render.ts`, `parser.ts`, `options.ts`, `entities.ts`
  and `text.ts` retain accepted module9ae34a06 bytes. No shared contract, runtime,
  shell, network, cat, DU or renderer implementation was changed here.
- Root `virtual-bash` and literal `virtual-bash/commands/html-to-markdown` expose
  identical `createHtmlToMarkdownCommand(options?): CommandDefinition`,
  `createHtmlToMarkdownCommands(options?): readonly CommandDefinition[]`, and
  `htmlToMarkdownCommands(options?): VirtualShellPlugin` functions.
- Both expose `HtmlToMarkdownCommandsOptions` and `HtmlToMarkdownLimits` types.
  Options are `replace?: boolean` and `limits?: Partial<HtmlToMarkdownLimits>`.
  `AgentCommandsOptions.htmlToMarkdown` is exactly
  `Omit<HtmlToMarkdownCommandsOptions, "replace">`; top-level replacement remains
  authoritative. There is no new renderer/sanitizer/fetch API or commands wildcard.
- Explicit export targets are `./dist/commands/html-to-markdown/index.js` and
  `./dist/commands/html-to-markdown/index.d.ts`. Runtime dependencies remain empty.

| Bound artifact | SHA256 |
| --- | --- |
| HTML index.ts | dd10597bfd33b9f35460d7e6e9d9182a94a63b1f03217077ecac412d5b951c58 |
| Unchanged renderer | a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378 |
| package.json bytes | aaea215e419a64b08e4739dee1a6b7bba5f41f9d5e1c93d4d1771f939e904842 |
| Full npm-packed .tgz | d9c1a97388357c5cb0c810cf2fa5181dc7bebff49efe517db414a5833096eed7 |
| Selected source/build input envelope | 0e7342e1dce75b2bce4c7501fd308e6d263845630bb8fa6372ed6d632aeec6eb |

The package contains830 regular files, including828 emitted files plus the
actual package.json and README. It is not the prior HTML module-closure pack.
Between review baselinee9843e60 and this candidate, the exact product-path delta
is package.json, src/index.ts, src/plugins/index.ts, HTML index/README and the
foreign expr README. The latter is documentation, not semantic acceptance here.
The package honestly contains its committed broader source; these checks certify
only the stated scope, not intervening unrelated work.

## New owned-output adoption and disposition

Factory settings and CLI arguments are validated before operation work. The
command creates `createOutputOperation(context, context.stdout)`, then routes
input/conversion/output through its signal and accounted output. `Inputs`
registers its idempotent close into the operation before input/FS acquisition.
Both explicit finally and registered cleanup await that same retirement; the
operation closes in finally. No duplicate input ownership or probing read is added.

Caller abort is checked first and retains its exact reason. A caught error that
is exactly the operation's abort reason is rethrown after cleanup; direct HTML
execution does **not** invent success/status141 or a new EPIPE diagnostic.
Shell's existing EPIPE handling maps its stage status. This differs in disposition
from cat's explicit local141 conversion, but uses the same accepted scoped
operation/cleanup seam. It is not a claim that every command must normalize alike.
Other caught errors retain existing HTML behavior: usage2, conversion/limit/FS1,
bounded stderr written with the original context/signal. An aborted operation
alone does not classify an unrelated caught error as consumer closure. Concurrent
host errors remain subject to the existing input/abort contracts, not a new
promise to preempt or observe every opaque host outcome.

Destination closure does not abort the whole caller. In controlled actual Shell
`curl | html-to-markdown | head -n0`, one admitted body read retires naturally
before public settlement: read1/return1/dispose1/active0. Without a header-file
obligation, curl's request signal aborts. With `-D /headers`, the required header
file survives and its request signal remains live; body return/dispose still
complete. A separate redirected Markdown file survives downstream head0.
Invalid argv still writes required caller stderr when stdout is preclosed;
input-limit refusal closes once. Opaque input/return remains pending until the
fixture explicitly releases it. No arbitrary host preemption is claimed.

These are **new opt-in adoption** observations. Original first-read five1/5,
plus the sixth control2/6, remain unmigrated. The prior production followup and
unapplied canonical proposal are in
`tests/integration/owned-output-production-independent-20260827/first-read-followup/`.

## Executed author checks

- Full product TypeScript build0; scoped source/test strict types0. This is not
  the global typecheck or all maintained consumer groups.
-257/257 source tests, no failures/skips/cancellations/TODOs:206 HTML tests
  (including52 nested normalization cases),9 new lifecycle tests,42 registry
  tests. The earlier205/205 run excluded the52 nested cases; it remains separate.
- Strict packed public consumer group0, authenticated root/subpath/relative
  declaration resolution. Four intended negative type errors are checked by
  exact line and code: TS2353, TS2322, TS2353, TS2339.
- Four full moved-package programs execute on **each** Node22.22.2 and24.11.1:
  the74-name/API/four-workflow consumer; six lifecycle controls; the maintained
  stream-inspection consumer; and maintained stream-format/split options consumer.
  Eight program executions pass. Main-thread loader authentication observes194
  modules per lifecycle run, including actual built root/HTML/renderer bytes.
  No worker-thread import-trace claim is made.
- Permission positive and actual source-read denial on both runtimes; four
  fallback controls reject missing root JS, HTML JS, explicit export, or HTML
  declarations. No unknown startup flag is counted as a permission denial.
-20 recorded subprocess steps have their intended statuses,22 explicit author
  checks pass. Negative expected statuses are not successful product commands.
-410 selected archived Git inputs match blobs; source/test/artifact inventory
  stays unchanged, including no additions. Installed package and emitted-output
  inventories remain unchanged. Deliberate negative mutations use separate copies.
  No private checkout writes or external service/product-network calls occurred;
  harness I/O uses explicitly selected host tooling and scratch. Host environment
  state was not changed.

Runtime binary hashes: Node22.22.2
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`,
Node24.11.1 `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
TypeScript5.9.3 `_tsc.js` hash
`e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419`.
Copied cached tooling is test-only; no dependency installation was needed.

## Exact fixture migrations and retained failures

`b2eb06ce` changes one canonical readFile-only assertion from caller-signal
identity to one distinct, shared, active owned-operation signal; same cap/input/
output checks remain. This is an explicit new I/O binding, not an unchanged old
assertion pass. It also adds literal HTML to two authoritative registry lists and
adjusts their exact counts. `831f1712` updates two maintained public consumers'
counts/last name and their inventory SHA. `b983a37f` fixes the remaining explicit
suffix list by adding only HTML, with its exact current inventory SHA. No old
capture bytes were modified; all prior assertions remain in Git history.

The first packed attempt07b8ce66 is retained as **failed**. Its source tests were
257/257, but the new author checker expected205; the new typed lifecycle fixture
called `.then` on a synchronous-or-promise API, and assumed a diagnostic without
its existing EFBIG prefix. It also exposed the missed maintained suffix assertion,
an overly narrow missing-declaration diagnostic (TS7016, not TS2307), and the
author archive post-check traversing copied tooling's `.bin` symlinks before
excluding authorized setup roots. These harness/fixture corrections are explicit
in `aff899aa`/`b983a37f`; no product patch or expected output was tuned to hide a
product failure. Earlier four source-author attempt TAP logs are also retained,
including async plugin-setup mistakes and the incorrect header-request abort
expectation. Only the final scoped receipts are called passing.

## Independent review admission

Meitner freeze54f1e4d declares34runtime/5types/10controls and has not been run by
this author. Its `inventory()` rejects every full-archive symlink. The actual
candidate has12 tracked historical tree-native fixture symlinks (six each under
tree/evidence/final-436bda3/harness/derived/native-fixtures and
tree/sealed/native-fixtures). Thus `declare-review.mjs` correctly refuses the
unmodified fixture protocol before executing any independent product case.
No link was dereferenced, removed, overlaid or silently exempted.

The full archive is2,340,945,920bytes (about2.2GiB), exceeding the frozen independent runner's1GiB
`spawnSync` archive buffer. This is a second admission issue, not a product
failure; stream archive bytes/hash/extraction rather than omit archived inputs.
The first author full-tree binding helper also incorrectly split a literal tab
in a historical filename; it now splits metadata only at the first tab. The
installed npm tree has `.bin` links: the receipt explicitly uses a separate
regular-file copy of that trusted cached tooling, with original CLI identity and
new complete tool-tree hash, not dereferenced product/native fixture inputs.

`evidence-v1/INDEPENDENT-BINDINGS-BLOCKED.json` is a **provenance receipt, not an
accepted executable declaration**. It binds the full archive, every regular Git
file, each literal historical symlink target/blob, the full830-file package,
tools/worker files, exact path delta and option key. Root/reviewer must version
any admission correction: inert historical links can be authenticated as data
without weakening no-symlink product/build/moved-package checks. Direct-close
disposition remains unscored where the original independent freeze explicitly
left it pending; this author handoff does not silently amend that freeze.
Full Git archive SHA256 is
`cb7f6b6d68f5946c3300e28156367ba42d1af83b12cb1b4be88832c50dfbfd07`;
the receipt covers36,339 regular files plus12 symlink-target Git blobs. The
receipt itself hashes to
`f4abf562b80e31c1c43962ffc84820c6df8ea443e924adf693f238fca8e764d0`.

## Reproduction / evidence integrity

```sh
node tests/plugins/html-to-markdown-public-author/verify-evidence.mjs
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node \
  tests/plugins/html-to-markdown-public-author/verify-public.mjs \
  aff899aa94ed0c57a936b08fd36d185688f5c0bb \
  /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node
```

The opt-in replay uses a fresh OS-temporary archive and full pack/move, never
live product overlays. `capture.mjs` requires explicit inputs and a nonexistent
output directory. `evidence-v1` losslessly preserves52 raw JSON/TAP inputs with
hashes, including original failures; integrity verification is not a behavioral
rerun or independent acceptance. Owned children settled naturally. Remaining
limitations include bounded per-operand buffering, no HTML5/sanitizer/Pandoc
equivalence, unsupported title attributes, and no whole-gate/superiority claim.
