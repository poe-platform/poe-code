# Independent expr extension review freeze

Preparation only, by a different delegated leaf, without delegation. Ownership is
ONLY this new `extension-review/frozen/**` subtree. No product, root package,
author test, previous frozen file or competing worker edit is part of this work.
The shared implementation was read exclusively using `git show` at
`8f19a9d5bb244ff6c095b7117e6d0738fdf40421`; original evidence was read at
`35aa8054ac0ebc1eacefc7cde63e4706f4c72137`. `provenance.json` binds those bytes.
The author design note was consulted only to bind the proposed transport API,
not its algorithm, tests or expected answers. No extension candidate was loaded.
This is not a temporal claim that no author worked concurrently.

## Frozen scope

- 20 additional literal argv cases; none duplicates the original 95 argv inputs.
- GNU9.7/Darwin/C: 20 observations; GNU9.7/Darwin/en_US.UTF-8: three.
- Apple/Darwin: the same 23 observations, strictly separate, never normative.
- 24 boundary/lifecycle/regression specifications and 32 synthetic mutation
  specifications. These are NOT executed product controls or measured kills.
- Original 95 inputs / 104 GNU observations, 16 safety controls, seven Shell
  workflows and four contained ReDoS probes remain separate and unchanged.

Added inputs focus on alternative anchoring, escaped-parenthesis parity and
bracket contexts, repeated/nested captures, suffix-sensitive longest selection,
backreference failure and shifted multibyte spans. Existing broad safety controls
are referenced rather than claimed as additional native coverage. Their extension
subcases specify worker events, malformed wire values and exact cleanup ordering.
No new pathological corpus or random fuzzing is introduced.

The independent control expectations live in `controls.json` and `mutations.json`.
Native expected bytes/status live only in the immutable oracle receipt. Preserve
unmatched, absent, empty, repeated and no-match capture states at the wire even
where CLI output alone cannot distinguish them. Example span coordinates in P05
are literal-byte deductions, not a claim that native expr exposed protocol spans.

## Primary evidence and boundaries

`primary-sources.json` identifies official tagged GNU9.7 source and manual plus
moving GNU documentation, consulted through web.run. The prior authenticated
archive/source pins are rechecked locally, including extracting the expr source
from that archive. The runner records the release manual member hash, executable
SHA256, resolved path, full version observation, dynamic libraries, macOS build,
Darwin kernel/architecture, locale/charmap and full supplied environment.
No detached-signature verification or binary rebuild is claimed by this leaf.
Apple's `--version` expression is not called a version interface. Current manual
labels do not turn this into a newer GNU cohort.

Every native call is an absolute executable and literal argv, never a shell:
sequential, 2-second deadline, 64-KiB combined output, at most 128 arguments and
8192 UTF-8 argument bytes including terminators. An empty unique owned cwd and
ignored stdin are used. The child close event is awaited, SIGINT/SIGTERM close
admission and kill/reap the child, and only that cwd is removed. No native ReDoS,
product process, credential discovery, filesystem input or network is involved.
Capture aborts as BLOCKED on pin/host/locale mismatch, never substitutes Apple.

Node's literal argv bridge supplies well-formed UTF-8 strings, not arbitrary byte
argv, NUL or lone surrogates. C-locale output can contain partial UTF-8: base64 is
authoritative. GNU9.7 on Darwin is not GNU/Linux. The UTF-8 observations do not
prove arbitrary locale collation, grapheme matching or every POSIX submatch tie.
Unsupported or uncertain behavior stays OPEN, not green.

## Read-only verification and capture

Run from `/Users/kjopek/Workspace/safe-bash`:

```sh
node --input-type=module - verify < tests/commands/expr-stress/frozen/runner.mjs.data
node --input-type=module - verify < tests/commands/expr-stress/extension-review/frozen/runner.mjs.data
node --input-type=module - verify-native < tests/commands/expr-stress/extension-review/frozen/runner.mjs.data
```

The default is `verify`. Neither verification nor comparison writes committed
files. Native replay uses and removes only a unique temporary directory under
this owned subtree. Original Git-pinned files and this manifest's listed files
are checked before/after replay. These checks do NOT detect appended unlisted
entries and do not certify an append-proof tree. They neither import nor veto
unrelated live candidate edits.

The initial explicit capture command is intentionally unusable after freezing:

```sh
node --input-type=module - capture native-20260827 < tests/commands/expr-stress/extension-review/frozen/runner.mjs.data
```

Any explicitly authorized later capture requires a NEW unique label; no overwrite
or golden normalization is permitted. The runner writes new evidence through
`apply_patch`. It authenticates frozen source references, not newly changing source.

## Required future execution, not performed here

Root must appoint a different execution reviewer (or resume this freeze in a
fresh review session) after the author candidate is committed. The author must
not supply expected outputs. No idle polling is part of this preparation task.
The future reviewer needs an assigned NEW execution directory outside this frozen
subtree and the exact candidate commit; the commands below use `REVIEW` for that
directory. A review adapter is a future prerequisite, not an artifact already
implemented or certified by this freeze.

1. Verify both freezes, record candidate commit, immutable Git archive hash and
   source/test/config inventory hashes. Extract only that committed archive into
   `$REVIEW/source`; never overlay live product files. Before and after execution,
   authenticate archive and enumerated inputs; additionally enumerate new entries
   if claiming append-proof source/test integrity. Record actual immutable versus
   dirty state. Existing unrelated live edits are neither candidate inputs nor
   reasons to veto a committed-archive review.
2. Bind `controls.json.binding` to installed declarations: descriptor limit names,
   exact reply schema, byte-profile policy, standalone entry and injection seams.
   Save that binding receipt BEFORE running controls. No expectation rewrites.
   Unbound assumptions are BLOCKED/OPEN. Type/id/row/result-array cases are applied
   where that representation exists, never invented solely to make a test fail.
3. Build and pack the archived candidate; install its tarball without scripts in
   an isolated consumer, then move that consumer before executing it. A suggested
   exact command sequence, after archive preparation and tooling authentication:

```sh
(cd "$REVIEW/source" && npm run build)
(cd "$REVIEW/source" && npm pack --ignore-scripts --pack-destination "$REVIEW")
mkdir -p "$REVIEW/install-origin" "$REVIEW/moved"
printf '{"private":true,"type":"module"}\n' > "$REVIEW/install-origin/package.json"
(cd "$REVIEW/install-origin" && npm install --ignore-scripts --offline "$REVIEW/virtual-bash-0.0.0.tgz")
mv "$REVIEW/install-origin" "$REVIEW/moved/consumer"
```

   Use the actual packed filename from npm's receipt if the candidate version
   differs; do not silently select another tarball. Remove/move original install
   staging so success cannot depend on its path. Clear NODE_PATH/NODE_OPTIONS and
   loader aliases. A maintained development-tool dependency link may build the
   archive but cannot supply runtime product modules. Inventory every runtime
   module/worker URL and prove they resolve inside moved installed `dist`, with
   no source, checkout-dist, tsx or ambient resolution fallback.
   Test declared public imports separately from installed standalone
   `node_modules/virtual-bash/dist/commands/expr/index.js` and its real worker.
   If no public expr export exists, explicitly report that absence: standalone
   dist import does not prove bundled/public root support.
4. In that moved consumer, generate a strict NodeNext `.mts` consumer from the
   inspected declaration binding. Require strict, noEmit, skipLibCheck false,
   module/moduleResolution NodeNext, target ES2022, no paths/source aliases, and
   authenticated Node declarations. Include positive descriptor/result calls and
   `@ts-expect-error` negative offset-unit/type assignments. Keep generated TS
   solely in the future isolated consumer, outside canonical test discovery.
   Record resolution trace and hashes, then run:

```sh
"$REVIEW/source/node_modules/.bin/tsc" --project "$REVIEW/moved/consumer/tsconfig.json" --traceResolution
```

5. Implement the independent execution adapter in the assigned review directory,
   preserving these frozen inputs/specs. Exercise real CommandDefinition and
   Shell; keep worker-only malformed protocol injection and instrumented lifecycle
   controls separate from unmodified installed runtime success. Run original
   controls/workflows and original four ReDoS probes under their REQUIRED outer
   worker watchdog; never compile untrusted regex in the harness main thread.
   Run 24 new controls and 32 mutation specifications with positive counterparts.
   Record event order, request/worker ids, exact abort reason identity, rejection
   state distinct from undefined, owned retirement completion and sibling outputs.
6. Produce `original-report.json` and `extension-report.json` separately. Original
   report schema is documented by the unchanged original README. Extension schema
   is `{schema:1,freezeManifestSha256,candidate:{commit,sourceTreeSha256,
   adapterSha256,installedArtifactSha256,dirty},profiles:[{id,results:[{id,
   caseSha256,status,stdoutBase64,stderrBase64,signal:null,failure:null}]}]}`.
   Include both GNU profiles, every row in frozen order. Unsupported rows retain
   observed refusals/mismatches, never fabricated native bytes. A transport/outer
   failure fails structural validation; retain its raw report separately. Run:

```sh
node --input-type=module - compare "$REVIEW/original-report.json" < tests/commands/expr-stress/frozen/runner.mjs.data
node --input-type=module - compare "$REVIEW/extension-report.json" < tests/commands/expr-stress/extension-review/frozen/runner.mjs.data
```

   Comparators only compare self-reported observations; they do not authenticate
   the adapter or candidate execution. Exact stdout/status plus diagnostic
   presence is the semantic column; exact stderr is a separate diagnostic column;
   strict requires both. No blanket diagnostic relaxation. Native receipts must
   never be submitted as product observations.
7. Run existing scoped shared/grep/rg/glob regressions on the committed archive,
   after its build and authenticated development tooling. Do not use changed
   tests as a replacement for the baseline test inventory. Exact baseline paths:

```sh
(cd "$REVIEW/source" && node --import tsx --test \
  tests/commands/regex-execution/executor.test.ts \
  tests/commands/regex-execution/commands.test.ts \
  tests/commands/regex-execution/cleanup-registration/controls.test.ts \
  tests/commands/regex-execution/followup/messageerror.test.ts \
  tests/commands/regex-execution/continuation/glob-transport.test.ts \
  tests/commands/regex-execution/continuation/glob.test.ts \
  tests/commands/regex-execution/continuation/public.test.ts \
  tests/commands/grep-aliases/aliases.test.ts \
  tests/commands/grep-aliases/safety.test.ts \
  tests/commands/search/rg.test.ts \
  tests/commands/search/safety.test.ts)
```

   Also execute actual moved-installed Shell grep/rg/glob commands from a
   candidate-independent transcript: compare baseline and candidate bytes/status
   for regex/fixed matching, UTF-8 spans, no-match and glob selection. Derive exact
   option binding from the baseline tests, not author expected answers. This
   frozen plan does not assert that source-based regressions prove installation.
8. Reverify both freezes, archive/input integrity and cleanup accounting. Await
   native child close and owned worker termination; remove only assigned scratch.
   Report original/extension/native/profile/control/distribution denominators
   separately, every failure and OPEN/SKIP reason. No product acceptance, full
   gate, Linux parity, superiority or 72-hour duration follows from this freeze.

## Handoff

The atomic explicit-path commit freezes the cohort and receipts. The requested
`/tmp/expr-extension-freeze-candidate.txt` records commit, manifest hash, actual
counts, validation and cleanup. That coordination file is the sole explicitly
requested write outside the owned repository subtree. Actual work timing is in
provenance/capture/commit timestamps; no invented elapsed duration is claimed.
