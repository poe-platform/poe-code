# Final independent extension review — acceptance FAIL

August 27, 2026. A different independent delegated leaf performed this review
without redelegation. The source author remained the only production writer.
Only new execution harness/evidence in this directory was edited. The candidate
arrived during bounded preparation, before the ten-minute ceiling. The attempted
absent-candidate checkpoint was stopped before creating or committing it.

## Exact candidate and distribution

- Source/test commit: `fe7083d99b8ccfdfbbb9b7209e0a6abbe7979724`.
- The separately identified author evidence commit is not substituted for it.
- All 23 handoff source/test SHA256 entries match that exact Git commit.
- Source inventory SHA256: `44a879dd20b7701486bb2b08e85ccb11d7471365d005f70fe7ed20f19878fb06`.
- Packed tarball SHA256: `e5ba749fcf74ee99cabb756bef4d35af63f1be2cada18e3fcf9686f71aa00d32`.
- Installed artifact inventory SHA256: `4bb62d2e43069a3196d464d08fb99255214bc7afdbe15a3aaa34d04217976ce4`.

Inventory digests hash pretty-printed sorted `{path,sha256}` arrays plus LF;
the original Git source tree ID, complete archive SHA256, package receipt,
individual files, devtool hashes and handoff bytes are in
`candidate-fe7083d9-20260827/stage.json`. These are not hashes of the historical
nonregex candidate, live source or checkout dist.

The exact commit was git-archived to owned OS-temp, compiled offline with existing
recorded development tooling, packed, installed offline without scripts, and moved
to an unrelated temporary parent before execution. Product runtime imports use
only that installed package; no tsx, source alias, NODE_PATH or checkout-dist
fallback supplied acceptance. Node builtins remain available. Runtime dependencies
are empty. The baseline legacy comparison independently built/packed/moved
`8f19a9d5bb244ff6c095b7117e6d0738fdf40421`.

Strict NodeNext/ES2022, noEmit, strict=true, skipLibCheck=false declaration
consumption passes, including negative byte-unit, pattern, endpoint and absent
root-export checks. Its authenticated Node type declarations are development-only.
A plain Node moved consumer imports the public root and the physical installed
`dist/commands/expr/index.js`, executes arithmetic and real worker regex, and
confirms the compiler refuses caller-main-thread entry before an invalid pattern
could be compiled. **This is a physical standalone module, not an expr public
package subpath, default export, or root integration.** Those exports remain absent.

## Frozen cohorts — never combined or replaced

The original freeze is `35aa8054ac0ebc1eacefc7cde63e4706f4c72137`.
The extension freeze is `92fe8a6335366b93cbc9a80d61fede69af711444`.
All original files and receipts are unchanged. Complete frozen-subtree inventories
were checked before/after, including new entries. The separately quoted-parenthesis
correction does not replace the original grammar-error input.

| Product comparison | Denominator | Semantic | Exact stderr | Strict |
| --- | ---: | ---: | ---: | ---: |
| Original GNU9.7/Darwin/C | 95 | 95 | 87 | 87 |
| Original GNU9.7/Darwin/en_US.UTF-8 | 9 | 2 | 2 | 2 |
| Extension original GNU/C | 20 | 20 | 19 | 19 |
| Extension original GNU/en_US.UTF-8 | 3 | 0 | 0 | 0 |
| Separate corrected GNU/C | 1 | 1 | 1 | 1 |
| Original Apple/Darwin/C | 95 | 61 | 46 | 42 |
| Original Apple/en_US.UTF-8 | 9 | 5 | 0 | 0 |
| Extension original Apple/C | 20 | 16 | 19 | 15 |
| Extension original Apple/en_US.UTF-8 | 3 | 0 | 0 | 0 |
| Separate corrected Apple/C | 1 | 0 | 0 | 0 |

Thus original GNU is 97/104 semantic and 89/104 strict; extension original GNU
is 20/23 semantic and 19/23 strict; correction GNU is 1/1 strict. These separate
denominators are retained. Semantic means exact stdout/status and diagnostic
presence, not exact diagnostic wording or proof of diagnostic category. Strict
requires exact stderr too. No stderr normalization or profile substitution occurs.
Every actual and expected byte tuple remains in the corrected capture reports.

Independent native prerequisite replay itself was exact: original104 GNU and
separate104 Apple; extension-original23 GNU and separate23 Apple; correction1 GNU
and separate1 Apple. Executable, archive and source hashes, archive source member,
full version responses, linked libraries, macOS build, kernel/architecture,
environments and locale charmaps were authenticated. Native failures were not
skipped. This is GNU9.7 hosted on Darwin25.4.0 arm64, not GNU/Linux. Apple's
`--version` expression is not represented as a version interface.

## Genuine findings and minimal fixes for the author

### 1. Undefined rejection is confused with success

The real installed client has two reproducible synthetic-host boundary failures:

- Make the injected worker's `postMessage` throw `undefined`: the pending expr
  request rejects with a new PROTOCOL Error rather than rejecting `undefined`.
  See `controls-fe7083d9-first/controls.json`, `lifecycle-undefined-rejection`.
- Call actual `RegexExecutor.request` with a structurally accepted signal whose
  active abort reason is explicitly `undefined`: it **fulfills with undefined**.
  See `supplement-fe7083d9-first/controls.json`, `synthetic-undefined-abort`.

Both use the unchanged installed executor/receive/retirement path. Both complete
with zero synthetic live workers and no unhandled rejections. These are not claims
about native `AbortController.abort(undefined)`: that produces an AbortError here,
and exact native 0/Error/AbortError identity passed pre-admission, startup, active,
output and actual Shell cleanup checks.

At candidate `src/commands/regex-execution/client.ts:90`, `Slot.fail` uses
`terminal ??= error`; lines 97–108 and 258 use undefined as absence of failure.
Minimal fix: represent terminal presence, exchange outcome, and run rejection
state independently from their unknown reason values. A boolean/discriminated
outcome must preserve `throw undefined`; changing only one `!== undefined` check
does not fix all paths. Retain idempotent awaited retirement and native abort
precedence. Run the two exact installed reproductions and the unchanged legacy
regressions after the author's atomic fix. **No production fix was made here.**

### 2. Frozen named UTF-8 locale is unsupported

Seven original and all three extension UTF-8 observations fail under the exact
frozen `en_US.UTF-8` environment. Example: `length Aé😀é` should produce `5\n`,
status0 under the frozen native receipt; the candidate returns status2 and its
unsupported-locale diagnostic. `src/commands/expr/internal.ts` accepts only
C/POSIX/C.UTF-8/C.utf8 for character and collation operations.

Explicit C.UTF-8 scalar and byte-span controls pass separately. They do not replace
the failed en_US.UTF-8 rows. Minimal scoped direction: implement and qualify an
explicit en_US.UTF-8 character profile if that profile is required. Do not blindly
alias locale-sensitive comparison to byte collation: the frozen collation row
needs its own supported policy/native evidence. Keeping refusal is an honest
limitation, not native parity or acceptance of this frozen cohort.

### 3. Exact diagnostics differ

Eight original GNU/C syntax cases and the original extension bare-parenthesis
case have correct stdout/status/diagnostic presence but different stderr bytes.
For example `['1','+']` reports `syntax error: missing operand` instead of GNU's
token-specific missing-argument message; no operands also omits GNU's help trailer.
Minimal fix is token-aware error construction in `expr/syntax.ts` and the empty
invocation diagnostic path, preserving original token context and quoting. Do not
weaken or delete the frozen exact-diagnostic checks. The separate quoted positive
parenthesis correction already passes and does not repair the original diagnostic.

### 4. Nullable repeated backreference refusal remains a real native gap

Eight explicit diagnosis reproductions were captured separately; five differ.
For `['+','aaa',':','\\(a*\\)*\\1']`, GNU yields empty LF/status1; the installed
candidate yields status2 with `unsupported BRE: backreference to a capture in
nullable repetition`. Empty, `a`, `aa`, and a mandatory-empty repeated capture
also retain mismatches. Three non-repeated/nonnullable/no-reference controls match.
These eight rows are not folded into either frozen denominator.

The independent cause report is preserved verbatim with its hash. Its dirty-source
and late-dist-identity caveats remain intact; it is not substituted for sealed
candidate acceptance. It distinguishes program-counter-only epsilon-cycle
pruning of capture history from a GNU9.7 partially open capture-register anomaly.
Neither preferring empty captures nor widening refusal establishes parity.
The minimum structural direction is repeat identity/progress and branch-local
capture restoration with charged bounded state, retaining worker isolation and
loop limits. Correct normative repetition and narrowly specified GNU anomaly
compatibility are different decisions; no safe universal one-line fix was proven.

## Executed controls and remaining limits

- All 16 original specifications have bounded execution evidence; `coverage.json`
  distinguishes complete measured subcases from remaining phase/scan/sandbox limits.
- All seven original actual-Shell workflows meet their exact frozen bytes/status/
  stderr and file effects. Real-adapter pipelines additionally preserve captured
  version text and an invalid-UTF8 C-byte capture through files and a pipe.
- All four original ReDoS inputs run unchanged under a required 2000ms/64MiB outer
  Worker and 8192-byte output ceiling, one at a time. No outer timeout occurred.
  Results are two state-limit refusals, one explicit nullable unsupported refusal,
  and one too-large-regex syntax refusal. Heartbeats remained responsive; owned
  workers were retired. This is containment evidence, not four semantic passes.
- All 32 frozen wire mutation rows execute through the installed validator AND
  real installed client receive path with positive counterparts: 30 malformed
  rows reject PROTOCOL, and M31/M32 valid unmatched/empty states are accepted.
  Additional endpoint/type variants and old rg/glob envelope separation pass.
- Actual byte/scalar worker spans, capture absent/unmatched/empty/no-match/repeated
  states, cache/profile separation, returned-result mutation isolation, owned
  Buffer subject/pattern copies, eight malformed worker requests and all seven
  worker input/compiler/search/work/allocation limit dimensions were exercised.
- Registration precedes acquisition; synchronous cleanup/throw0/Error prevents
  admission. Queue count/charged bytes, queued abort reuse, startup/active timeout,
  protocol retirement, late startup failure, late admission, idempotent close and
  termination latches were exercised. Actual Shell exec/dispose waits registered
  cleanup while an independently active sibling Shell completes correctly.
- Existing unchanged baseline regression inputs: **276 passed, 0 failed, 0 skipped**
  on the archived candidate. Installed baseline/candidate legacy grep/rg/glob
  responses/defaults agree, as do seven actual moved-installed Shell transcripts.

No blanket control score is claimed. Specifically unmeasured: precise interruption
inside the compiler versus matcher phase, every string-index work-limit boundary,
arbitrary invalid-byte argv, arbitrary concurrent host mutation, universal locale
collation/submatch ordering, and a general host-JavaScript sandbox. Async acquisition
is not applicable to synchronous `RegexExecutor.open`; late admitted startup
failure is tested instead. The larger-cohort author 1381 nonregex proof remains
historical/scoped and contributes zero new acceptance cases here.

## Harness corrections preserved, not erased

1. Initial runtime URL containment compared `/var` with Node's canonical
   `/private/var` and blocked valid installed workers. All initial observations,
   their failing summary, and the authenticated original adapter bytes remain.
   The new capture canonicalizes the authenticated installed root; no product,
   oracle, input or expected tuple was changed.
2. Frozen comparators require GNU-only report envelopes. The original combined
   GNU/Apple reports and assertion failures remain; separate GNU-only views retain
   every GNU row unchanged. Both real frozen comparators then return exit1 for
   the genuine preserved mismatches.
3. Two limit probes originally let synchronous pre-admission refusal escape a
   promise helper. Original failures remain; the same inputs wrapped in a deferred
   invocation confirm the expected typed limit refusal, not a product defect.
4. Two supplemental held-sibling probes accidentally exhausted both equal 80ms
   deadlines. Those failures remain. New supplemental probes use a 500ms sibling
   phase allowance and deterministic ready-release ordering, while the failing
   phase retains 80ms. They prove fresh-worker replacement while a sibling remains
   active, **not unchanged all-80ms fixture acceptance**. Original 80ms startup/
   active controls and live-sibling actual Shell controls remain separate.
5. An initial missing brace in the unused staging helper was caught and corrected
   before staging; no candidate executed through that syntax defect.

## Integrity, bounds and handoff

Native calls are literal argv, sequential, 2s deadline/SIGKILL, 64KiB output,
128 arguments/8192 bytes, ignored stdin, empty owned scratch and awaited child
close. No native ReDoS or native-shell evaluation was used. Build/package helpers
have 60s/120s bounds and 8MiB output caps; owned process groups are killed on helper
timeout/interruption and the child close event is awaited. The runtime workers and
all retained process sessions have settled; no owned server/background worker is
left running. Native and real-VFS scratch directories were removed. Build/archive
and moved-package directories are retained for reproduction, with exact paths in
the receipts. No other agent's process, staging, temporary file or lock was removed.

Final checks authenticate both source trees and installed package inventories,
including new entries; archive and packed bytes are unchanged. The frozen source
inventory checker accepts the positive and rejects changed/missing/added in-memory
mutations without touching production. Both original frozen subtrees are checked
including new entries. Checks do not certify an append-proof entire archived test
tree or a full TypeScript/service gate. Source typechecking was the offline build;
strict moved declarations and scoped runtime tests are distinct evidence.

`verify-execution.mjs` is read-only and checks the sealed execution inventory and
both freezes. Version-specific capture drivers require explicit capture/unique
labels and are outside canonical test discovery. Snapshots are `.mjs.data`, not raw
TypeScript fixtures. This report, manifest and owned evidence are atomically
committed with explicit paths; the commit and remaining blockers are handed to
`/tmp/expr-extension-final-review-candidate.txt`.

**No whole gate, full GNU parity, root/default integration, superiority, expr
completion, or 72-hour work claim follows from this failed bounded acceptance.**
