# Independent nonregex baseline replay — partial evidence

## Identity and outcome

Candidate **85675366efe962c0d52993bb8aa286dc9683f6a6**, original independent freeze
**35aa8054ac0ebc1eacefc7cde63e4706f4c72137**, author provenance marker
**d96f9ffe7e23488c8b739b4e4fccdc88e13eb2ac**. Candidate dirty is **false**: only an
immutable Git archive supplied product inputs. The concurrent live extension was
neither loaded nor awaited. This delegated leaf did not redelegate or edit product,
root, author tests, frozen inputs, expectations, or oracles.

Final replay ran **2026-08-27 17:10:57.783–17:11:06.071 UTC**. This is the final
run's measured interval, not the task's entire work duration and not 72 hours.
The archived build, scoped strict source check, offline installation, moved strict
consumer, and installed-module runtime consumer succeeded. The actual replay and
unchanged frozen comparator both returned **exit 1**, retaining mismatches.

## Original literal denominator

All **95 unique frozen inputs** ran, including regex. GNU normative observations
are **104 = 95 C + 9 en_US.UTF-8**. Original Apple **104** remain separate. Fresh
bounded native replay reproduced **208/208** original receipts exactly against
each profile's own original bytes/status; this is oracle authentication, not
candidate acceptance or GNU/Apple equality.

Semantic means exact stdout bytes and exit status plus diagnostic presence.
Diagnostic means exact stderr bytes, without normalization. Strict requires both.

| GNU cohort | Original observations | Semantic matches | Diagnostic matches | Strict matches |
| --- | ---: | ---: | ---: | ---: |
| Full original GNU | 104 | 74 | 66 | 66 |
| C, all original inputs | 95 | 72 | 64 | 64 |
| en_US.UTF-8, original encoding inputs | 9 | 2 | 2 | 2 |
| Independently classified nonregex, both locales | 77 | 72 | 64 | 64 |
| Nonregex C | 70 | 70 | 62 | 62 |
| Nonregex en_US.UTF-8 | 7 | 2 | 2 | 2 |
| Regex-containing, both locales | 27 | 2 | 2 | 2 |

Independent classification finds **70 nonregex + 25 regex-containing unique
inputs**, not 95 nonregex inputs. Seven nonregex encoding cases and two regex
encoding cases recur in the UTF-8 profile. Regex-containing includes both skipped
regex branches even though those two rows match. The exact ID set is in the final
summary; every original row and expected/observed byte receipt is retained.

## Mismatches and exact reproduction

The 38 full-cohort strict mismatches are disjoint:

- **8 diagnostic-only mismatches**, all in nonregex C. These are real strict
  diagnostic defects, not semantic failures or passes after relaxation.
- **23 known pending-regex status-3 mismatches**, in C. Evaluated regex is not
  implemented in this checkpoint. These remain failures in the full denominator.
- **7 unsupported-locale/profile mismatches**, all en_US.UTF-8: five nonregex
  character/collation operations plus two regex operations. The regex rows in
  this profile fail locale validation before the pending callback. They are not
  hidden under a generic regex classification or rerun using a different locale.

No additional **nonregex semantic defect** was found in this fixed corpus under
the supported C profile. This is not a broader parity claim. The five UTF-8
nonregex refusals remain original semantic mismatches even though the candidate
explicitly documents narrower supported locale names.

Diagnostic-only exact argv and messages below all have empty stdout and status 2.
`expr:` prefixes and terminal LF remain in the raw receipts; abbreviated display
here does not alter comparison.

| Frozen ID / literal argv | GNU diagnostic body | Candidate diagnostic body |
| --- | --- | --- |
| `ambiguous-index-keyword`: `["index","index","a"]` | `syntax error: missing argument after 'a'` | `syntax error: missing operand` |
| `missing-operands`: `[]` | `missing operand`, then `Try 'expr --help' for more information.` | `syntax error: missing operand` |
| `missing-rhs`: `["1","+"]` | `syntax error: missing argument after '+'` | `syntax error: missing operand` |
| `missing-close`: `["(","1","+","2"]` | `syntax error: expecting ')' after '2'` | `syntax error: expecting ')'` |
| `trailing-token`: `["1","2"]` | `syntax error: unexpected argument '2'` | `syntax error: unexpected argument` |
| `skip-still-requires-rhs`: `["kept","|","1","+"]` | `syntax error: missing argument after '+'` | `syntax error: missing operand` |
| `skip-still-requires-close`: `["0","&","(","1"]` | `syntax error: expecting ')' after '1'` | `syntax error: expecting ')'` |
| `skip-still-requires-keyword-args`: `["kept","|","substr","abc","1"]` | `syntax error: missing argument after '1'` | `syntax error: missing operand` |

Root was informed of the `expr 1 +` reproduction and eight diagnostic differences
before any source change; this leaf made none. Classification uses independently
read official pinned GNU 9.7 source/documentation through `web.run`, listed in
`PRIMARY_SOURCES.md`, not author expected answers. GNU 9.7 on Darwin is **not** a
GNU/Linux result. Exact executable/version/library/host receipts are in provenance.

## Frozen controls and workflows

**73/73 bounded baseline subchecks** passed their explicit assertions. These are
not 73 independent features, not all 16 frozen specifications fully accepted, and
not regex-safety passes. The original specifications remain verbatim in the final
control coverage map, with their unready portions named.

- Zero stdin getter/iterator/next/return/throw, FS, and invoke access across four
  explicit/implicit/binary/never-ending source setups and four frozen argv inputs.
  Args, cwd and environment are frozen. Regex input's zero-read assertion does
  not make its status-3 semantic result acceptable.
- Held stdout and stderr writes delay execution settlement; byte chunks are
  copied on admission and checked for mutation; no concurrent unawaited writes.
  A rejected stdout is explicitly converted to utility status 3 with a bounded
  diagnostic, not success or exact stdout-sentinel propagation. Rejected stderr
  preserves its sentinel; rejecting both yields the stderr sentinel. Admitted
  output in those receipts is not claimed to be successfully delivered output.
- Object, primitive and errno-shaped caller reasons preserve identity at direct
  preabort and public Shell preabort/output-abort settlement. Cooperative index
  evaluation aborts; late opaque sink rejection is observed without waiting for
  that uncooperative operation. No unhandled rejection was observed.
- Concurrent/repeated dispose, a same-Shell sibling, and a second Shell were
  exercised. The baseline acquires no regex resources and registers no cleanup;
  this does not certify required future regex lease/admission/retirement behavior.
- UTF-8 argument bytes at B−1/B/B+1, skipped-branch preflight and `4 * maxNodes`
  argv-count cap. Counts exclude separators/terminators. Signed and zero-padded
  decimal D−1/D/D+1, a 128-digit carry, and intermediate product-growth refusal.
- AST nodes N−1/N/N+1, including skipped branches; literal/operator/prefix each
  count one node. Group/prefix depths H−1/H/H+1; parser root depth is one and
  grouping adds parser depth without an AST node. Skipped unclosed syntax fails.
- Invocation work boundaries (the literal `x` costs nine documented charges),
  repeated arithmetic/index work, numeric-error short circuit, separate Shell
  command budgets and nested literal `invoke` sharing. String allocation and
  output byte boundaries; LF included; long integer and aggregate Shell output
  limits preserve refusal without truncated successful results.
- Declared C.UTF-8 scalar controls produce length five and the intended emoji;
  lone surrogates and NUL reject deterministically. These are separate frozen
  policy controls, not replacement native oracle rows. Invalid-UTF-8 argv remains
  unmeasured. Literal shell metacharacters are not evaluated and do not call FS.

**6/7 frozen Shell workflows** match exact output/status and specified memory-VFS
effects: increment substitution/pipeline; false last-stage status; false upstream
default status; pipefail; arithmetic-error status; VFS build artifact. The regex
version-extraction pipeline fails: empty stdout and pending-protocol stderr. Its
final pipeline status is 0 because `cat` succeeds; this does not erase the upstream
expr status-3 failure or turn the workflow into a pass. Expr is a registry command,
not mislabeled a builtin. Only memory VFS is covered; no remote-provider claim.

**Regex safety is NOT READY, zero passes.** Four frozen dangerous inputs ran only
inside sequential required outer workers (2 seconds, 64 MiB old generation,
8-KiB combined output, 4-KiB arguments). All returned the pending status 3. Two
frozen skipped-regex probes returned their skipped values. Instrumentation observed
zero product worker admissions and no constructor-based regex compilation in
those six probes; heartbeat advanced. That does not certify real compile/match
isolation, deadlines, captures, cancellation, cleanup, or positive admission.
All six outer workers had termination and exit awaited. No dangerous native regex
oracle probes or main-thread untrusted regex compilation were used.

## Provenance, validation and limits

- Source Git tree: `d29d1fa08c683bc800c750cfe587b1ca7014fc6f`.
- Enumerated source-manifest SHA256:
  `e44d6697bc9f9373a338bee48fd4f74bfe21b59fc707bf2386438090a944d77d`.
- Exact selected candidate Git archive SHA256:
  `f25c535691a9c36cacb1003ff069fdf0746c2a0ab9dc543f6b3bfb0e5bea4d60`.
- Expr command source SHA256:
  `afcb4dd7cb5e013ea042a5d064ca9e7646d889c0a08f1e99bd8ad5da23829282`.
- Executed installed expr module SHA256:
  `cb7bc068aec8cf038c5766d6e36649194c9da26b729e70e03f644d66e1b30991`.
- Final adapter SHA256:
  `01bce412d14f292af289848be5ce46f33babeb128ec9034f28cf989e2699c0ed`.

Existing Node **22.22.2**, TypeScript **5.9.3**, npm **10.9.7**. Strict source build
and no-emit build-config check ran against archived source. A moved installed
consumer compiled under strict NodeNext and ran its emitted module successfully.
No live dist/source fallback, expr public subpath, default integration, runtime
dependency or main-project install is claimed. The transitive static expr runtime
import audit and exact hashes are recorded; spies/audit are not a host-JS sandbox.

Before/after comparisons enumerate paths and directory entries, so appended
entries are detected, not merely modifications to original tracked files. Built
dist and installed dist are separately checked. These are isolated candidate/freeze
checks, not a veto based on unrelated concurrent live edits.

Preliminary full replay receipts and the successful preliminary control receipts
are preserved. Two harness mistakes are explicit: inherited `--input-type` in an
outer worker, and CJS resolution used on an ESM-only package root. They were fixed
in owned harness code, not product or expectations. The first preparatory npm run
inherited normal npm cache/configuration and may have written normal npm metadata;
the final capture isolates npm HOME/cache/configuration. No ambient user content
was inspected. Lossless compressed preliminary provenance preserves its original
bytes rather than discarding an overly verbose archive log.

`CLEANUP.json` records removal of all three task-owned temporary trees and awaited
outer-worker cleanup. `verify.mjs` is evidence-read-only and checks the full new
file inventory as well as retained comparator exit 1. No current whole gate,
author suite, deployed backend, performance, superiority, complete expr feature,
universal locale/byte semantics, or 72-hour completion is certified.
