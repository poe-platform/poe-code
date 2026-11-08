# R21/N04 targeted reconciliation — original gate remains HELD

Authorization August 28, 2026. Independent leaf reviewer; all writes are inside
tests/integration/expr-public-independent-20260827. No product, root exports,
package/config, AGENTS, engine/TEMP, private repository or foreign changes.

## Recipe and durable evidence

- Recipe commit: `0efeb43ece20f2dd55ae1cd5328c6dd3abc5ca08`.
- Recipe manifest: `f7fa8110f3141acf6c99cabae2414c449035289de043a5d23023b66cdaa44d51`.
- Evidence manifest: `e89be0a522712f0fc51555d5b8a34b6d96b71365a735de1e7732c1e9f3a8c466`.
- Evidence seal: `6202ffd8c2f8dad281c4355fc8c7ca9f6ade3e52ce4d857a0737567550e57e34`.
- Archive: 3,005,742 bytes, SHA256
  `b16d258a28abfe70cfbb6039deb1bbcad6b7fe532efb20d3b39bf3b810c216c4`.

Artifacts are in ../r21-n04-reconciliation-v1. This separate result document is
written after the sealed attempt; it does not modify that recipe or its sealed
evidence. The evidence commit containing this document is the atomic final handoff.

The precommit whitespace check exits2 for the generated, already sealed
REPORT.md:62 (`new blank line at EOF`). Its bytes are intentionally preserved;
no evidence hash is rewritten to tidy the generated report. The initial shell
commit chain stops before invoking git commit. Final explicit-path commit
proceeds with this disclosed whitespace warning, not a product rerun or repaired
test outcome.

## Complete new denominators

One frozen attempt, no retry or postseal expectation adaptation:

- **16/16 R21 observations captured**, never scored against the old expectation.
- **8/8 targeted type outcomes pass**: only N04 and combined in four layouts.
- **72/72 new controls pass**, zero failed/unrun:42 exact type-validator controls
  (2 authenticated positives +40 wrong-receipt harness negatives),6 exact
  resolution-line controls (1 positive +5 negatives),16 actual observer boundary
  controls,4 actual source-fallback guards,4 fresh positive TRACE bindings.
- **48/48 probe children close naturally**, zero forced:40 exit0,8 compiler
  negative-target exits2. Exit0 from an observation child means capture/cleanup
  succeeded, NOT that its expr product result satisfies the old R21 predicate.
- All4 positive compiler TRACE children close naturally and retain complete raw.
- Zero workers created by these nonregex probes; not a replay of v5's80 workers.
- Entry and outer exit0 naturally.116 recorded entry metadata Git children close
  naturally (58 PRE,58 POST). Launcher also completes31 synchronous recipe Git
  checks; these are not separately persisted as per-command OUTER receipts.
- **98/98 runner integrity checks pass**, plus PRE/POST binding/finalization.

Actual outer interval:2026-08-28T02:54:58.577Z through02:55:47.241Z,
48.664seconds. No72-hour completion claim. Preseal filename guesses and the
draft44-to48 child-count correction are preserved in preparation notes/raw;
this is not a claim of a mistake-free first draft. No unsealed product attempt.

## R21: every original subcase at both boundaries

The authenticated frozen component fixture contains exactly `["bad\u0000arg"]`
and `["\ud800"]`. It contains no low-surrogate subcase. Each row below was
independently observed in EACH of installed Node22,installed Node24,physically
moved Node22,moved Node24:four identical observations per row,16 total.

| Original input | Boundary | Expr handler calls | Literal-wrapper calls | Exact status | Exact stderr, including LF |
|---|---|---:|---:|---:|---|
| `bad\u0000arg` | Shell/CommandContext.invoke | 0 | 1 | 1 | `shell: line 1: invoke requires a command and literal string arguments without NUL\n` |
| `bad\u0000arg` | public factory's direct execute | 1 | 0 | 2 | `expr: NUL is not supported in argv\n` |
| lone high surrogate `\ud800` | Shell/CommandContext.invoke | 1 | 1 | 2 | `expr: argv must contain well-formed Unicode\n` |
| lone high surrogate `\ud800` | public factory's direct execute | 1 | 0 | 2 | `expr: argv must contain well-formed Unicode\n` |

All16 stdout values are exactly empty. Full stderr hex, original code units,
admitted code units, individual invocation counts, actual module loads and cleanup
receipts are retained in REPORT.json and raw archive. A zero-call observation
has no admitted argument sample: its generic argumentUnitsPreserved=true is a
vacuous empty-array result, NOT evidence that Shell forwarded the NUL argument.

Public controls exercise the actual agentCommands-registered expr definition,
wrapped by a counting transparent delegate with intentional replacement. Valid
public/direct controls prove one dispatch and exact7+LF. NUL command-name and
non-string argument controls prove zero expr dispatch and the exact shell
admission diagnostic/status1. Root and leaf public factory identity is checked.
No native OS argv/NUL parity claim; the arguments are JavaScript strings.

### Pinned path trace

Candidate `44f00bf84278e3361b52106478d59c707ab7b2bc`, not mutable HEAD:

- src/shell/runtime.ts:1572 rejects NUL before isolated nested execution at1603
  and registry handler dispatch at990. Its outer catch at594–611 emits the shell
  diagnostic and maps ordinary TypeError to1. Source SHA256
  `c746e4cee0f5245d94bba2082ce72b62fdc3b251fd400ee247371fa44dfed722`.
- src/commands/expr/index.ts:22 calls Budget.arguments. Its handler catches
  ExprError and emits the expr diagnostic/status. Source SHA256
  `e7cf6a0077a291578f4c669fe41da37188be8cebcb19bdb574838fd7fae2eb8e`.
- src/commands/expr/internal.ts:83 rejects NUL;84–90 reject malformed surrogate
  sequences, with ExprError's default status2. Source SHA256
  `07f203d8fc4e991e4d23cab87d67a23911f7960a2ed6d649fd843b0d7060e840`.

Exact committed blobs, numbered excerpts and the prior expr README's JavaScript
argv wording are in INSPECTION.json. The observations match these distinct
admission paths; no product-contract violation is established by this cohort.

### PROPOSED R21 fixture amendment — NOT IMPLEMENTED

For a future root-authorized version, split R21 by invocation boundary while
retaining both exact original inputs and the immutable historical fixture:

1. Public NUL: expect Shell status1, empty stdout, exact shell diagnostic above,
   zero expr calls and one literal-wrapper call. This checks Shell admission,
   not expr's invalid-argument handler.
2. Direct NUL: expect status2, empty stdout, exact expr NUL diagnostic and one
   real handler call, through createExprCommand().execute.
3. Public and direct lone-high-surrogate: preserve status2, exact expr Unicode
   diagnostic, empty stdout and one handler call in each boundary.
4. Keep each boundary/subcase independently executed so the first assertion
   cannot hide later variants. Never apply a general2-to1 conversion.

These are a proposal only. Original R21 remains frozen/failed in v5; the new
observations do not rescore it. Further amendment requires root authorization.

## N04: exact prerequisite and case-specific new expectation

Before creating new fixtures, all4 full old N04 receipts were authenticated as
natural compiler exit2, empty stderr, exactly one error in the intended consumer
atline11,column32; all4 combined receipts contained the same occurrence among
the five otherwise matching diagnostics. Exact representative full raw line:

```text
installed-node22-N04.ts(11,32): error TS2561: Object literal may only specify known properties, but 'maxRegexSteps' does not exist in type 'Partial<ExprLimits>'. Did you mean to write 'maxRegexStates'?
```

Matching old full raw TRACE resolves both root and leaf public declarations in
each pinned layout. The new version changes only N04/combined's matching
expectation fromTS2353 toTS2561; the validator additionally requires exact
consumer, line,column,field,type,suggestion,message, count,exit and bindings.
The other combined tuples stay5/TS2353,7/TS2353,9/TS2322,13/TS2322,15/TS2322.
Original negative input bytes are unchanged; new target bytes equal the old
generated target bytes. No broad diagnostic whitelist or other negative waiver.

Both targets retain their original flags: neither adds --traceResolution.
Four separately presealed positive binding controls qualify the fresh absolute
paths, using unchanged positive input and --traceResolution. Installed stdout
is1,374,722 bytes per runtime (SHA256
`82603c82ade4f3ac697881c56ae2ed7048b806f1913173ff00bcb70f7a697b7f`);
moved stdout is1,404,914 bytes per runtime (SHA256
`2652bdeb704847445a5b7dd2208eda96d3211548e9590b98c788b7a02c705635`).
All four exceed the1MiB preview and retain complete full raw under unchanged
64MiB ceiling/bounded parser. Both successful public resolution lines bind
package dist/index.d.ts and dist/commands/expr/index.d.ts at exact package hashes.

Forty wrong-diagnostic/receipt mutations exercise the same validator used on
the8 actual target outcomes, with qualified positives first and mutation receipts
saved before predicates. They are harness negatives, not invented compiler
product observations. No unrequested full40 or104 replay occurred.

## Independent load, integrity and proof reuse

The sealed archive authenticates **255 raw entries /24,911,320 bytes**,96 channel
hashes and6,564 actual main-load hashes, spanning203 distinct product module
paths.203 loaded modules is not834 executed package members. All834 members are
bound by the accepted pack; the whole consumer is physically renamed and its
old path checked absent. Four real guard controls reject source fallback.

Node22/24 binary hashes, tool/loader/supervisor/input/package hashes and modes,
and fresh-entry inventories are checked. Compiler permissions allow only
isolated package/tool reads, no writes or broad workspace permissions. Consumer
and tool trees have per-child before/after new-entry checks; recipe/predecessor
scopes have PRE/POST checks; raw archiving checks entries before/after. These
finite checks are not a lease or proof against arbitrary later tree append.

P01 is BOUND_ACCEPTED_PROOF from v4 evidence
`1ec1912001db43f803af46bb5dea89a7e397b83b`:357 exact inputs,834 pack members,
727526 bytes, SHA256
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
No build/repack and no authorpack-as-build claim. Reader16/repair28/trace38 are
reused evidence, not new controls. R25/R26 old all4 passes are untouched/not rerun.

Original v5 remains100/104 runtime,32/40 types,36 package+38 new controls,80
workers/guards closed, with its old failures unaltered. Accepted-DU and original
gate remain HELD; DU75 is selected, not accepted. No Raman DU29 acceptance is
inferred. HTML remains separately root-accepted and untouched. No whole76,
release, superiority, universal parity or full completion claim.
