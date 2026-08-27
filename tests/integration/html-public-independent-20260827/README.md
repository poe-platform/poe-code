# Independent public HTML / owned-output freeze — 2026-08-27

**No integration candidate has been executed.** This is a fixture/protocol freeze,
not product acceptance. Root must supply the exact candidate declaration before
`run.mjs --candidate DECLARATION.json` may be used. The later runner is implemented
but has not been exercised against a product; syntax and harness-only controls
are not its end-to-end qualification. Do not rewrite expectations after receipt
of a candidate. A fixture defect requires a separately preserved correction.

## Ownership and read chronology

Only this NEW directory is owned. No product, root/package/config, AGENTS, private
checkout, historical evidence, branch or unrelated staging is modified. No agent
was delegated work. `READS.json` binds inspected files to immutable commits, Git
blobs and SHA-256; it distinguishes hash-only authentication from content reads.

1. Initial root/index/status inspection found HEAD
   `e9843e601859282de25fa40742529c6be6668bf3`, no staged paths and no tracked
   modifications; unrelated native and DU scratch paths were already present.
2. Module/API reads use `9ae34a06662db27897043d77d6145700c109b22c`;
   root/plugin/package/contracts and minimal existing lifecycle conventions use
   `e9843e601859282de25fa40742529c6be6668bf3`. Root baseline exports/defaults do NOT
   include HTML. Its public integration expectations are expected red, not run.
3. The accepted review at `37ec93907226ba6437d40b7fa29fa628282669a9` and the
   aliases public fixture at `dbceec2b` were read for profile/protocol precedent,
   not replayed. All full commit resolutions are in `READS.json`.
4. Before fixture implementation, a later status-only check exposed concurrent
   modifications to `package.json`, `src/index.ts`, `src/plugins/index.ts`, and
   `src/commands/html-to-markdown/index.ts`. Their live bytes were NOT read.
   Subsequent status showed those modifications no longer dirty and an author
   public-test directory present. This is **pre-declared-candidate**, not blind
   pre-code work. No inferred new HEAD or live wiring is treated as a candidate.

## Exact declared module API

`createHtmlToMarkdownCommand(options?) -> CommandDefinition`,
`createHtmlToMarkdownCommands(options?) -> readonly CommandDefinition[]`, and
`htmlToMarkdownCommands(options?) -> VirtualShellPlugin` are the three real
functions. The only command name is `html-to-markdown`; plugin name is
`html-to-markdown-commands`. Types are `HtmlToMarkdownCommandsOptions` and
`HtmlToMarkdownLimits`. Options are `replace?: boolean` and
`limits?: Partial<HtmlToMarkdownLimits>`; there is no fetch/sanitize/renderer API.

The 13 limits are `maxInputBytes`, `maxOutputBytes`, `maxTokenBytes`, `maxTokens`,
`maxNodes`, `maxDepth`, `maxAttributes`, `maxTableCells`, `maxTableCellBytes`,
`maxFiles`, `maxArgumentBytes`, `maxDiagnosticBytes`, `maxWorkUnits`.
Factory validation rejects invalid limits synchronously. CLI:
`html-to-markdown [--] [FILE|-] ...`; no operands means stdin, repeated `-`
shares EOF, `--` admits a leading-dash VFS filename. Usage errors return 2;
conversion/limit/VFS errors return 1 with bounded required stderr. Already
published operands are not rolled back. Input is bounded UTF-8, not a browser,
sanitizer, HTML5 parser, fetch client or script executor. **Titles remain
unsupported**. No title-feature or broad normalization research is added.

Required public surfaces are the root and literal
`virtual-bash/commands/html-to-markdown`, with matching functions and types.
The export target is `./dist/commands/html-to-markdown/index.js` and its `.d.ts`.
No commands wildcard, private renderer export or dist escape is allowed; the
already-existing unrelated contracts wildcard is not silently outlawed.
Aggregate defaults are 74 unique names, including HTML once; curl, SafeJS, du
and expr remain absent. The complete 73-name baseline inventory is retained from
the immutable aggregate test, so an unrelated dropped/renamed command cannot hide
behind a count of 74. Curl is enabled only with explicit `networkCommands`.

## Frozen case table

The executable catalog is `contract.mjs`; inputs/expected bytes are literals,
not regenerated from candidate output. There are **34 runtime cases**, not 34
passes: 9 semantic/refusal, 14 public/composition, and 11 lifecycle cases.
Later execution repeats them in installed and physically moved layouts (68
possible runtime receipts). There are also 5 strict type inputs per layout and
10 named future control classes; none of those product checks has run now.

| IDs | Fixed requirement / expected outcome |
| --- | --- |
| S01–S07 | Exact bounded empty, heading, emphasis, dropped active content, empty inline wrapper, rejected unsafe link, and accepted link-between-emphasis bytes; status 0 and empty stderr. No titles. |
| S08–S09 | Original v2 R04 `maxTokenBytes:8` and R05 `maxTokenBytes:4`: status 1, empty stdout, exact `html-to-markdown: EFBIG: html-to-markdown token bytes limit exceeded\n`. No budget raise. |
| P01–P03 | Identical root/subpath functions, explicit exports, private imports rejected with `ERR_PACKAGE_PATH_NOT_EXPORTED`, default74 and standalone plugin. |
| P04–P07 | Collision preflight has no partial registration; top-level replace true wins over nested false; nested true cannot bypass omitted top policy; declared aggregate module limits propagate. |
| P08–P10 | Per-invocation family budget, cumulative operands, Shell aggregate output accounting, ordered VFS/shared stdin bytes and no mutation. |
| P11–P14 | Optional curl with injected transport, real regex worker positive, standalone duplicate/replace, exact invalid-limit RangeError. |
| L01–L04 | Cleanup before acquisition; operation signal/owned write route; preclosed zero acquisition; controlled first-read close/awaited return; caller abort exact errno-shaped reason identity after retirement. |
| L05–L07 | Invalid argv and limit failure use original required stderr despite closed stdout; cleanup/finally share one awaited retirement. |
| L08–L09 | Actual `curl … | html-to-markdown | head -n 0`; controlled first-read transport disposal/iterator retirement versus explicitly ordered zero transport reads/acquisitions. Final head status 0, empty stdout, no caller abort. |
| L10–L11 | Real Shell exact-reason abort plus overlapping disposal waits for registered retirement; unenrolled opaque input receives no invented preemption. |
| Types | Positive root/subpath API plus declared aggregate option; negatives: string limit TS2322, unknown option TS2353, nested replace TS2353, private import TS2307. Each negative must have exactly one error at its intended source line. |

`public.mjs`, `lifecycle.mjs` and the five `.ts.data` files are the frozen
executable consumers. `.ts.data` classifies opt-in strict fixtures as data,
avoiding accidental canonical test/type discovery. They are materialized as
`.ts` only inside isolated consumer scratch. No exclusion/config change is made.

## Controlled lifecycle protocol

The accepted `createOutputOperation(context, destination)` contract exposes
`signal`, `output`, `child`, `registerCleanup`, `acquire`, and `close`. It enrolls
only a destination with optional `ownedOutput.consumerClosed/write`. Cleanup
registration is synchronous before admission; `close` closes admission and
shares its drain. Await owned cleanup; do not force opaque host settlement.

HTML input/conversion aimed solely at stdout must use the operation signal and
accounted output, with cleanup registered before acquisition and close awaited.
Option validation and required error stderr retain the original caller context.
L01 uses a sink whose ordinary write fails and owned write records bytes, plus a
VFS fake that refuses acquisition without prior cleanup. P09 separately checks
actual Shell accounting, not only a stub. Direct VFS fakes refuse every unrelated
method/mutation. The runtime driver also rejects host fetch, network connection,
native subprocess and selected host write APIs; this is a targeted fixture guard,
not a sandbox claim or proof of every possible JavaScript effect.

First-read tests await an explicit `next()` admission latch before closing the
destination or aborting the caller. Cooperative `next()` observes its supplied
signal; `return()`/transport disposal waits for a test release latch. At that
known barrier, direct handler / public exec / overlapping dispose must still be
pending. Release allows natural settlement. One event-loop turn observes that
explicitly blocked state; it is not a universal millisecond timing guarantee.

The first-read pipeline delays only `head` admission until injected transport
body `next()` is entered. Zero-read middleware delays HTML/curl admission until
each **actual enrolled destination** is closed. This is a deliberately controlled
profile, not a claim that arbitrary scheduling never starts transport. No real
network is used. Transport registers cooperative cleanup before handing back its
response; disposer is idempotent and gates release, with exactly one body return.
The HTML converter itself cannot fetch or mutate VFS. Required stderr tests
deliberately close stdout while stderr is already blocked, then release stderr.

Each later runtime case has a 15-second external supervisor. Any timeout, forced
kill, signal, output-buffer failure or missing expected receipt is **NOT a pass**.
All raw stdout/stderr/status/error and pre-run inputs remain. No arbitrary
opaque handback preemption, global worker-zero guarantee, or all-producer
enrollment is inferred. L11 releases its opaque fake itself; it does not test an
uncooperative forever-pending host or claim that such a host can be canceled.

## Pending root clarifications — do not infer from candidate output

1. **Aggregate property spelling:** no HTML property exists in the inspected
   immutable `AgentCommandsOptions`. Root must declare its exact new single
   property name as `agentOption`; the type template substitutes only that
   identifier. Its shape is `Omit<HtmlToMarkdownCommandsOptions, "replace">`.
   This is an explicit parameter awaiting declaration, not an invented API.
2. **Direct stdout-close disposition:** resource/cancellation contracts do not
   alone choose HTML direct handler rejection versus a particular exit status
   or diagnostic for EPIPE/operation-close. L02/L03/L07 freeze resource invariants
   and retain disposition unscored; no one may call these full outcome passes.
   Likewise L08/L09 retain early-close stderr as an unscored observation. Root
   must clarify policy separately before claiming exact close-status acceptance;
   adding such assertions requires a new pre-candidate freeze, not rewriting this.
   L04/L10 caller abort identity and L05/L06 required stderr ARE fully fixed.
3. **I/O source binding:** root must name exact changed HTML index/input/budget
   paths (`htmlIoPaths`) and give `sourceScopeApproval` for routing-only changes.
   Input/budget edits are not silently authorized by this fixture. Renderer,
   parser, options, entities and text stay byte-identical to accepted 9ae. The
   renderer SHA-256 stays
   `a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378`.
   Every changed product path since the recorded baseline is declared exactly,
   including concurrent accepted changes; declaring them authenticates scope,
   not semantic acceptance of unrelated producer/tool changes.
4. **Exact package/candidate:** supply full candidate and fixture commit IDs,
   exact Git archive and FULL npm pack SHA-256, complete archive file hashes,
   complete package file hashes, manifest exports, worker layout hashes, and
   pinned local tools. An accepted module-closure pack is not this evidence.

## Future full-package runner and controls

`run.mjs` requires `--candidate` and has no mutable-HEAD or baseline execution
mode. `validateDeclaration` in `contract.mjs` defines the required fields:

- `candidateCommit`, `fixtureCommit`, `baselineCommit`, `declaredBy`, `subpath`,
  `agentOption`, `changedProductPaths`, `htmlIoPaths`, `sourceScopeApproval`.
- `archiveSha256`, `packSha256`, `rendererSha256`; `packageFiles` is the entire
  exact Git archive inventory (including README/config/docs), not a selected
  source closure; `packFiles` is the entire extracted npm package inventory,
  including npm's automatic README/package/license admissions.
- `packageExports` is the complete exact export object. `workerFiles` includes
  at least regex worker/client JS; the whole package inventory also binds their
  protocol and neighboring files. HTML has no worker claim.
- `toolPaths`: absolute existing read-only paths for `node`, npm CLI `npm`,
  `tsc`, TypeScript directory `typescript`, `nodeTypes`, `undiciTypes`, `npmRoot`.
  `toolExecutables` binds node/npm/tsc bytes; `toolTrees` binds the four directory
  inventories as SHA-256 of `JSON.stringify(inventory(directory))`. No downloads
  or broad dependency installation is required.
- `clarifications` is exactly `Read README pending boundaries; no exit-status or opaque-preemption expansion`.

The runner authenticates fixture Git bytes and exact product change inventory,
then writes PRE-RUN tool/supervisor/consumer/loader hashes. It extracts the full
immutable archive; no live product overlays, selected README omissions or dirty
input vetoes enter that archive. It builds from copied minimal pinned TS tools,
packs the unchanged complete manifest offline, installs the exact tarball, and
physically renames the consumer directory. Both layouts execute the same cases
and positive/negative strict consumers. A loader blocks TypeScript and external
file source fallbacks; type resolution traces must resolve installed declarations,
not repo/source fixtures. Worker construction is separately observed and bound
because regex workers intentionally clear `execArgv` and do not inherit the loader.

Pre/post complete tree comparisons detect **new entries as well as changed and
deleted original files**. Allowed build additions are only dist and copied tools;
installed product trees cannot gain entries. Any full-run failure retains raw
evidence and exits; it is not a test waiver. Controls use separate copied layouts
and record deliberate changes/hash inventories BEFORE launching:

| Control | Intended boundary / qualification |
| --- | --- |
| C01 missing export | Remove only literal HTML export after positive import control; require ERR_PACKAGE_PATH_NOT_EXPORTED. |
| C02 wrong source | Same authenticated SOURCE_ARCHIVE guard rejects wrong digest; pre-bound guard inputs, no product launch. |
| C03 wrong pack | Same FULL_PACK guard rejects wrong digest; not a generic process failure. |
| C04 missing dependency | Remove consumer's installed virtual-bash dependency after positive import; require ERR_MODULE_NOT_FOUND. There are no invented product runtime dependencies. |
| C05 missing worker | Remove only packaged regex worker after P12 positive; require actual worker construction plus regex WORKER_ERROR/missing-module diagnostic. |
| C06 poison launch | Replace admitted package JS entry with frozen JS sentinel; exact `HTML_POISON_SENTINEL_20260827` error and exit 1. No TS-under-node_modules stripping can intercept it. |
| C07 source fallback | Point at an existing, independently qualified sentinel outside consumer; loader must report SOURCE_FALLBACK BEFORE sentinel execution. |
| C08 permission | Same pre-hashed existing readable file succeeds without permissions, then exact FileSystemRead ERR_ACCESS_DENIED boundary with Node permissions, exit 17. |
| C09 negative types | Positive consumer first; exactly one intended TS diagnostic per negative; traces retained. |
| C10 appended tree | Exact inventory guard rejects an added entry, not merely altered original paths. |

`selfcheck.mjs` performs syntax, fixture structure, TS parsing only, synthetic
poison/sourceguard and qualified permission controls. It imports no product,
builds no product and installs/packs nothing. Its raw runs stay in owned ignored
scratch; compact retained self-check evidence is separately named. These fresh
controls do NOT rescore historical failed launches.

## Preserved limitations and stop condition

Accepted 9ae/37ec9390 is module normalization/closure evidence only. Preserve the
691 historical receipts: 665 passes, 24 failures (including unsupported title
holdouts), and 2 nonproduct intentional kills; 22/24 holdouts are not 24/24.
The two poison-launch harness failures remain historical failures: Node refused
TS under node_modules before their sentinel. They are not repaired retroactively.
The original root custom-firstread cohort 1/5 and control 2/6 remains separate,
unmigrated. Old fast natural completion is not abort coverage. Gate7 remains
separately pending; no gate replay, full superiority, deployed-service behavior,
72-hour duration, all-producer migration or complete project acceptance is claimed.

After committing this freeze, stop and await root's exact candidate. Do not run
an inferred concurrent commit, baseline, full gate or full-package replay now.
