# Independent contract v1 — post-design, held pre-product

## Authority and timing

The immutable author packet is `053505fcb5b63d8872991eb09655bc927dd7080d`,
`tests/shell/directory-stack-design-20260828/final-v1/PACKET.md`; grammar preseal
is `23fca35fc5d7c749a7273015b802aef6376096a2`. Read that packet, its prior proposal,
the command/filesystem contracts, and accepted CD ratification before inspecting
public declarations. No anticipated runtime.ts/shell.ts body was inspected.
Hashing committed bytes for identity is not semantic implementation inspection.

ROOT's exact supplied policy resolves all four design areas, including fresh
exec/process tails; clone isolation; same-State sharing; a private Symbol stamp
at actual stack cwd publication before checked PWD; enclosing same-State stamp
preservation; reached-token/HOME work and final flush; separate Stack/CdLookup
8Mi counters; required cd print plus stack display; after-cd insertion/removal
only after required print success; and no rollback of published effects.
The packet's historical "pending" language is not an unresolved policy question.
No exact durable author ratification commit was supplied: future authentication
must bind the relayed document and check consistency without rewriting this seal.

The first recorded local clock check was 2026-08-28T07:12:50Z. The review is
post-author-design. ROOT says new stack implementation is HELD. This seal proves
what this leaf read/authored and its static checks, not absence of unobserved
work by other workers. A commit timestamp alone is not a global ownership proof.
No runtime candidate or post-LET base is guessed from HEAD.

## Declarative cases and legitimate observation

`cases.json` is an independent input/expected-result matrix. Each row is one
case, not a runtime pass. `argv` is already-expanded literal argv, not a new
parser API. The future driver must lower it to existing public Shell execution
with lossless quoting or actual `CommandContext.invoke`, never call private
stack helpers. Inputs containing lone surrogates use literal invocation from a
legitimate registered host command, not lossy shell serialization.

Default fixture: fresh exec at `/c`, PWD `/c`, OLDPWD `/old`, HOME and CDPATH
unset. Scripted/Memory directories include `/`, `/c`, `/a`, `/b`, `/d`, `/old`,
`/c/+1`, `/c/-dash`, `/c/a`, `/c/b`, `/search`, `/search/leaf`; `/missing` is absent.
Unless overridden, `full` seeds `[cwd, ...tail]` via public `pushd -n` in reverse
tail order with setup output discarded separately. Seed calls are real admitted
commands: measure their budgets separately or account for them, never reset a
live command budget to hide setup. State rows may instead supply an explicit
public script/host orchestration. State snapshots mean `dirs -l -p` plus public
cwd/env observations inside the SAME execution; they are not public stack fields.
Use separate stdout channels/capture markers so probes do not change the subject
status or mix setup/display bytes. New exec cannot inspect a previous tail.

`expect.full` is an observational vector, NOT permission to initialize internal
State. Env attributes/exports and middleware effects require the existing public
host boundary and same-exec shell witnesses. `expect.unchanged` includes tail,
cwd, PWD, OLDPWD, export/readonly attributes and namespace unless explicitly
qualified. Namespace/content changes are forbidden for these builtins. Successful
real cd requires stat-directory then X_OK with the supplied signal; `calls:0`
means subject metadata/content calls only, not fixture construction or probes.
Failure rows distinguish prior publication from forbidden later effects.

`observationRoles` marks logical byte-cache/stamp and post-abort/limit state
expectations as source proof unless a legitimate pre-abort public witness is
separately presealed. In particular, encoded stdout cannot prove original lone
surrogate identity; L06 retains I07 proof rather than inventing a private getter.
The 138 rows include gated host/boundary and mixed-proof cases, not a claim of
138 currently executable, exclusively dynamic tests.

Exact stdout is frozen where the packet defines it. For errors the packet does
not specify a full usage/origin envelope; require correct command/path/meaning,
status and the unchanged accepted CD formatter/readonly behavior, not invented
GNU bytes. The seven private diagnostic payloads ARE exact, bounded separately
from the shell-origin prefix/final newline. No blanket diagnostic relaxation.
The ordinary caller-output-limit rejection in C09 follows accepted5137's
`tests/shell/output-accounting.test.ts`: ShellLimitError/maxOutputBytes, not a
new stack status or limit. Only existing test declarations were read; none ran.

Public dynamic rows with host schedules are obligations, not an executable
harness yet. Future harness/adaptation preseal must pin callbacks, barrier order,
setup, observation points and actual import/declaration closure BEFORE execution.
An unobservable private effect must retain its source-proof role, never become a
fabricated dynamic counter assertion. Long paths/unpaired surrogates use a
truthful scripted public FileSystem: Memory's 255-byte component limit cannot
be bypassed and called a Memory pass. No remote service is involved.

## Private proofs and limits

`proofs.json` separates pinned-source obligations from public behavior. Source
review must bind actual candidate file/blob/line/function evidence and audit all
construction/clone paths; a regex match or arithmetic model is not a runtime
measurement. Optional test-only instrumented variants require independent
preseal, exact diff/hash, valid build and authenticated loads; they never stand
in for uninstrumented product execution. No private API is added for observation.

Inclusive ceilings: 4096 tail entries, 4194304 remembered UTF-8 bytes, 65536 per
remembered/resolved path or reached argument/used HOME, 8388608 stack work,
8388608 combined required-path-print/stack-display bytes, 128-step scheduling
boundaries, 16384-byte chunks, 65792-byte stack-owned diagnostic payload.
Truncation keeps the longest scalar prefix <=65780 plus ` [truncated]` (12 bytes).
Counter reservation, final partial-batch flush, exact byte subtraction, clone
identity, stamp placement and no hidden allocations require source proof.
The accepted separate CdLookup8Mi/8194-call bound is reused, not merged with the
stack counter or newly measured. Shared budgets/signals/ownedOutput remain intact.

Large-state rows may be unable to reach display/remembered caps before a distinct
work cap. That is NOT a pass for the masked boundary: retain source proof and
preseal a reachable public witness or honest instrumented obligation. A modeled
at-limit number alone cannot claim admission, runtime throughput or RSS safety.
Ignored fields still undergo ordinary shell expansion; only stack-helper scans
are skipped. HOME is inspected only when formatting needs it, not for -l, clear
or silent no-op. `-n` is metadata-inert, not free of command/output/shared work.

## Public type and discovery obligations

Existing declarations were read at accepted5137: shell/types.ts, shell/index.ts,
contracts/command.ts, the ByteSink declaration and root index/package exports.
`proofs.json` freezes eight positive and eight negative strict type obligations
using those names only. No .ts fixture is authored/compiled now. Future fixtures
are gated on the exact new-base declarations and must use strict NodeNext,
exactOptionalPropertyTypes and the accepted explicit library/checking profile.
Each negative requires the intended diagnostic/site, a legitimate successful
positive import, and an independent inversion; TS2307/missing dependencies are
not rejection evidence. No DIRSTACK/stack-limit/public stack-session fields,
exports, provider, parser or default registry inventory changes are authorized.

The three additions are genuine builtins: normal function shadowing, `command`
bypass and `type` discovery; no extra registry commands or implicit plugins.
Accepted inventories remain independently declared and exact. Scalar DIRSTACK
has no stack authority; arrays and stack tilde remain deferred.

## Authentication and release gates

1. Bind the durable author R1–R4 ratification relayed by ROOT. Any difference
   requires an additive explicit decision, never silent reinterpretation.
2. Obtain explicit ROOT GO AND runtime ownership-window release. This freeze
   alone grants neither. LET may precede stack; no LET outcome/base is assumed.
3. Bind exact ROOT-approved new-base commit/tree, accepted prerequisite closure
   and ordered composition. Preserve accepted CD source/evidence/package history
   (85 fully bound plus L24 scripted-only in each layout; 82+4 rows; 12 private
   source invariants; 7 controls; 12 import negatives; 2 mutants). Preserve the
   historical L07 setup stop after61 and L24 blocked qualification. Do not replay
   CD now. Future shared-helper regression execution is separately authorized.
4. Bind exact candidate commit/tree and complete source/build/test/consumer
   inventory. Delta from that exact new base is runtime.ts + shell.ts ONLY for
   product inputs; separately enumerate authorized owned tests/docs. Types,
   parser, providers, public exports/keys, package/default counts stay unchanged.
5. Preseal the runnable driver, typed fixtures, schedules, negative/mutation
   adaptations, toolchain/runtime hashes and immutable inputs before any product
   run. No live overlay. Compile/parse/import failures are harness failures, not
   semantic mutant kills. Missing/unreachable rows stay blocked/unmeasured.
6. Verify source, genuinely npm-installed package and physically moved consumer
   separately: exact artifact/package SHA256, complete emitted/installed bytes,
   actual module loads from admitted roots, absent original consumer after move,
   working unrelated cwd, no sibling/source fallback or undeclared dependency.
   Build from the authenticated candidate, not accepted CD's old package hash.
7. Authenticate closure membership, hashes and modes before AND after each run,
   including added entries/symlinks/empty directories. Checking original paths
   alone is not append-proof. Committed-archive mode ignores unrelated live edits;
   strict-live mode rejects dirty admitted inputs. Neither is a filesystem lease.
8. Retain original failures and exact denominators per layout, controls/inversions,
   CD/getopts/invoke/owned-output regressions and source proofs as distinct totals.
   No whole gate, full native parity, actual-service, superiority or duration claim.

## Static verification and immutability

The verifier reads only its exact frozen files and immutable Git inputs. It
validates schema/counts/references, byte identities, the accepted composed tree,
unchanged grammar preseal, fixed expectations and fixture-level negative controls.
It never executes a case, imports product code, probes native Bash or rewrites
evidence. Controls that mutate JSON in memory test the static guard, NOT runtime
mutants. Product mutation obligations stay separately unexecuted.

Static attempt01 retained its full failure: the declared composed tree object
`b820fa91a3bcc904005c690d48038d9a3900cede` is not locally available to diff-tree.
The corrected guard reconstructs only the affected Git tree paths in memory
from accepted5137 plus the exact two WebDAV/runtime blobs and checks the resulting
root hash, preserving every other base entry. An unchanged-tree hash roundtrip
is a positive control. It writes no Git objects, extracts no archive and does
not infer that a recorded tree object is present. This is Git identity proof,
not modeled shell semantics or runtime measurement.

Static results and every failed preseal attempt/correction must be retained in
`STATIC-ATTEMPTS.json`. Post-seal integrity reruns report to the terminal without
rewriting this ledger. `SEAL.json` authenticates frozen membership and
bytes; its own bytes are authenticated by an explicit Git commit after sealing.
The frozen directory is append-sensitive; authorized later results go elsewhere.
