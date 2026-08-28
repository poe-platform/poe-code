# EXPRPUBLICCOMPONENT v4: separately frozen minimal repair

Authorization date: August 28, 2026. Historical 20260827 paths stay unchanged.
Only this owned subtree changes. One invocation after the exact recipe commit;
no retries, post-run expectation changes, product fixes, HTML, DU29, TAP or full gate.
Candidate 44f00bf84278e3361b52106478d59c707ab7b2bc, tree
5905cf8d43233c68ea2bd499275ada2641223d9a, source
a1c95fc52ddeef2d753950b09dd2a26b44b4ab6e remain exact.

## Observed v3 blockers

Inspected sealed recipe 56f550afee7e6fd895b6d700e4cec376b6cf1eaf and evidence
d3136122f2d1d47f0d0db82d71a4f50593359446, including CHECKPOINT, report and decoded
raw compiler receipt. The exact allow-fs-write path matches tsconfig outDir, but
the harness did not create dist before Node initialized its permission allowlist.
The compiler created the directory but all 832 emissions failed with TS5033/exit2.
The absent-directory explanation remains a hypothesis until the frozen negative
compiler controls reach that same boundary. The stale bind() reference reads
nonexistent v3/cases.json, despite staging unchanged v1 cases. Caught failures
never set process.exitCode; outer zero was not green. These failures are retained.

## Minimal repair and controls, all frozen before execution

The sole compiler write grant remains the exact owned build/dist path. Create it
exclusively with mode 0755 and verify empty before the compiler launch. Do not
change rootDir, outDir, compiler arguments, product sources or source-map paths.
No broader workspace grant or removal of --permission is allowed. Original,
source, tool and other paths remain compiler-write-denied. The unchanged legacy
offline npm-pack and isolated source-poison profiles are distinct from this
compiler fence; this recipe does not claim all host JavaScript is sandboxed.

Eight permission controls: on both pinned Nodes, a positive nested-write canary
also attempts denied writes outside output, to an owned source stand-in and an
owned tool stand-in, and queries denial of original/source/config/tool/binary
bindings without writing foreign bytes. Three actual compiler probes per Node
cover an existing but wrong output grant, an absent output-directory grant, and
the repaired precreated output grant. Negatives must exit2 with exactly four
TS5033 output-restriction diagnostics at declared output paths; missing-file
launch failures do not qualify. Positive emission must produce the four expected
JS/declaration/maps with unchanged relative source-map identity. All fixtures
and raw compiler receipts persist; the controls are not product builds.

Three fixture controls use the same frozenCases() function as the real adapter:
exact unchanged bytes, missing path (ENOENT), and separately owned whitespace
corruption (EXPR_CASES_HASH). Never regenerate cases or change an expectation.
The exact original path, length and SHA-256 are in PINS and the recipe manifest.

Seventeen aggregate controls use a declared synthetic complete component state,
not invented product results: one positive; failed/missing P01; missing reader;
missing/failed repair qualification; missing/failed package control;
missing/failed types; unrun runtime case; missing context; missing/failed
finalization; failed integrity check; unclosed child; integrity hold. The child
prints its complete input and verdict before nonzero exit. Synthetic child/outer
zero fields cannot hide a missing required phase. Exact IDs are in PINS.
Total newly executed repair controls: 28 = 8 permissions + 3 fixture + 17 aggregate.
A control failure holds P01, all package/runtime/type dependents, and aggregate.

## Reused reader, independent build and unchanged component profile

Import the byte-identical v3 streaming reader, SHA-256
5248d0c33f0a0282d80931c1ee7505bd379b802e377c4f2a7341a3e16df7932b.
Reauthenticate v3 16/16 control evidence, manifest
f2344a8bac78bf32599ba78b73eafa98e8102cf53976e5628b3d9bbf1b2af5c3,
raw payload, v1 ENOBUFS evidence and v2 interrupted draft. This is reuse, not
replay or new reader controls. Reauthenticate complete 357 selected Git inputs
with the unchanged chunk transport and metadata/path/mode/type/hash guards.
The exact 4,644,868-byte LAYOUTS JSON is separately retained with its string/object;
no whole-RSS, constant-memory or general memory-safety claim.

Historical and recipe guards check modes/hashes and new top-level entries;
selected build inputs and copied tool closures check recursive new entries.
No AGENTS materialization/following, whole archive duplication, undeclared closure
input, network, dependency install or private-repository modification. Authenticate
both exact Node binaries, Git, tool closures and every supervisor/observer/loader
input before dependent launch. The exact full pack must be independently produced:
c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd,
727526 bytes, 834 regular members. Independently built P01 and separately authenticated
authorpack fallback remain distinct. A failed P01 can never yield aggregate zero.

Four contexts, installed then physically moved, on Node22/24 retain unchanged
26 assertions each (104), ten type invocations each (40), and nine package controls
each (36). No changes to observer, silent worker, guards, child, consumer, original
case bytes or type expectations. R25 remains EXEC-only settlement before disposal;
R26 remains both cancellation boundaries with shared-definition sibling. These
tests concern pending transport, not CPU interruption. All actual product passes
require natural child/worker settlement and authenticated package module loads.

## One execution and durable verdict

Freeze explicitly enumerated recipe paths with git commit --only. Print the exact
commit, RECIPE-SEAL SHA and declared counts. Run exactly:
Node22 component-execution-v4/launch.mjs THAT_COMMIT.
The entry creates exclusive work/admission-001 and work/run-001. Each child has
15s/1MiB supervision; contexts retain 120s; outer has 900s/16MiB with a 60s
termination grace. Normal children must close naturally. Supervision failures
hold dependents. No automatic retry. Raw receipts precede control assertions;
post-binding/source/tool checks run from finally even after runner failure.
Finalization authenticates history, original fixtures, recipe and tools again.
VERDICT records required phase satisfaction before entry exit. The supervisor
flushes raw output, records actual child status, writes OUTER and evidence seal,
then exits nonzero for any required failure, absence, unrun case or bad closure.
Seal evidence atomically in a second explicit owned-path commit. Read-only failure
diagnosis is allowed; another run or repair requires new authorization.

Accepted-DU and the original gate remain HELD without updated root acceptance.
HTML is accepted separately and is neither rebuilt nor rerun. This proves only
EXPRPUBLICCOMPONENT when successful, never whole76/fullgate/engine acceptance.
