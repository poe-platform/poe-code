# yq phase 1 semantics — September 4, 2026

## Status and dialect boundary

This remains an experimental, source-only, explicitly installed command family.
`createYqCommand`, `createYqCommands`, and `yqCommands` are retained; command
factories now carry `commandRuntimeIdentity`. No default registration, package
export, build admission, README, shared query-core, or dependency change is part
of this phase.

The implementation is the restricted YAML 1.2 Core / existing safe jq profile
selected by DESIGN.md section 9, **not Mike Farah yq compatibility**. Mike Farah
v4.53.3 is the pinned reference for future compatibility work and the explicitly
identified comparisons below. It is not a claimed implementation identity.
In particular, this profile uses `-o json -c` for compact JSON, whereas the pinned
reference uses `-o=json -I=0`; Mike's `-c` controls YAML sequence indentation.
Query operators, default scalar presentation, option grammar, help/version,
diagnostics, and statuses still differ. The native comparisons intentionally
translate those output-format options; they do not assert identical CLI grammar.

Official references consulted:

- https://yaml.org/spec/1.2.2/ — comments, flow collections, plain scalars.
- https://raw.githubusercontent.com/mikefarah/yq/v4.53.3/cmd/root.go — pinned CLI.

## Correctness and safety repairs

- Flow comments no longer become scalar data or change bracket/quote balancing.
  Token-boundary comments after commas, opening brackets, and quoted scalars are
  recognized. Quoted hashes and hashes within plain scalars remain data.
  Comments terminate plain scalars rather than joining subsequent tokens into a
  different scalar. Comment scans still consume the existing bounded work budget.
- File operands are made absolute without removing `.` or `..` components.
  Symlink traversal belongs to the VFS, for both streaming and readFile paths.
  Relative operands at `/` do not introduce a new double-leading-slash namespace.
- All owned argument bytes must be valid UTF-8 before any source acquisition.
  Invalid byte filenames cannot alias an existing replacement-character filename:
  they return status 2 and `yq: cli: CLI_INVALID_UNICODE`. A genuine U+FFFD,
  leading U+FEFF, and non-ASCII UTF-8 filename retain their distinct identities.
  This is an explicit string-VFS restriction, not arbitrary native byte-path parity.
- Every input chunk, including an empty one, consumes a unit of existing query
  work before retention. Empty chunks are not retained. Existing work checkpoints
  yield to the event loop; timer cancellation interrupts empty producers and
  cleanup returns the owned producer. The normal maxSteps limit also applies to
  chunk admission. A small injected work refusal tests this without a million-
  chunk workload or giant allocation.

Input is still collected, not a constant-memory document stream. Existing byte,
document, value, query, output, and work limits remain; no total heap/RSS guarantee
or forced termination of uncooperative host work is introduced. More fragmented
input consumes more work. Nonempty retained chunks remain owned copies.

## Canonical evidence and historical conflict

New current tests are in `tests/commands/yq-scripting/regressions.test.ts` and
`tests/commands/yq-scripting/oracle.test.ts`; helpers live beside them. All VFS
fixtures use memory. Tests do not create host files or download an oracle.
The suite covers the four repairs, ownership across reused producer buffers,
small injected work exhaustion, source closure, runtime tags, and actual Shell
invocation with a raw byte filename.

The initial scoped run was red (22 tests: 7 pass, 15 fail, no skips). One failure
was a test-facade defect: spreading the memory provider omitted its prototype
methods. That facade was corrected; the other reproduced defects included actual
wrong output, path selection, raw-byte aliasing, cancellation starvation, and
missing factory identity. Additional comment-boundary tests were red before the
parser refinement (32 tests: 21 pass, 11 fail, including the native parent suite).
A separate double-leading-slash regression was red before its correction.

Two active canonical expectations initially conflicted with the fix. After root
confirmed their maintained discovery and expressly authorized their correction,
only these expectations in the existing test file were updated:

- `tests/commands/yq-author-20260828/yq.test.ts`,
  `inline continuation preserves quoting, inserted newlines, and comments`
  previously asserted `[1,"# comment 2"]` for `[\n  1, # comment\n  2\n]`.
  The corrected expectation and native result are `[1,2]`.
- In the same historical file,
  `inline continuation preserves malformed diagnostic positions`
  previously asserted rejection of `[\n  1, # [\n  2\n]`. This row moves to the
  successful-input table with `[1,2]`, matching the pinned reference.

The pre-correction active test run was 64 pass / 2 fail. The original 26,953-byte
test file remains in Git history; its SHA256 before these two corrections was
`b04af746b3a37cf58511958cb0408e3e5e0733fd51734764cb1a11a64316e23d`.
No other old expectation, raw capture, manifest, owner hash, or discovery entry
is changed. The adjacent repair-allocation-v1 suite remains active and unchanged.
Root owns new literal test registration; there is no exclusion workaround.

Initial phase-1 validation: the active author suite (66), unchanged allocation
repair suite (9), and new scripting suite (36 with native prerequisites) pass
111/111, with zero failures or skips. Without either oracle environment variable,
the combined run is 102 pass and one native-suite skip. Separate hash-only and
nonexistent-path prerequisite runs each exit 1 with no skips. Strict NodeNext
TypeScript checking of source and all four test files passes. Root retains the
guarded whole-lint, package/build, public-consumer, and registration checks.

Independent review subsequently reproduced cancellation settling before the
actual input producer's cooperative teardown completed. Input acquisition now
registers producer cleanup first, memoizes its return, and awaits it through the
invocation owner. The independent review and lifecycle tests preserve falsey
cancellation reasons, reused buffers, opaque pending reads, and completed-source
behavior. The final root run of author, allocation, and scripting suites passes
147 tests with zero failures or skips; strict source/test types also pass.
The additional tests are `review.test.ts` and `lifecycle.test.ts` in
`tests/commands/yq-scripting`.

## Native prerequisite and measured comparison boundary

Supply **both** `SAFE_BASH_TEST_YQ` (absolute executable pathname) and
`SAFE_BASH_TEST_YQ_SHA256` (64 lowercase hexadecimal characters). There is no
implicit temporary path or PATH lookup. If both are absent, only the native suite
skips. An empty, partial, malformed, nonexistent, nonregular, nonexecutable,
oversized, or hash-mismatched supplied prerequisite fails instead of skipping.

The reviewed Darwin arm64 Mike Farah v4.53.3 executable is authenticated against:

```text
877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213
```

The suite checks its exact version output, six successful flow-comment outputs
(stdout, stderr, and status), and two invalid scalar-continuation cases. The last
two explicitly check native status 1 versus this profile's status 5, rather than
pretending the diagnostics/statuses match. The helper bounds executable hashing
at 32 MiB and each output stream at 1 MiB, uses a two-second child deadline, kills
on failure, and settles only after child close/drain. The oracle path must remain
trusted and stable between authentication and execution; this is not a hostile
host-filesystem TOCTOU isolation claim.

## Unresolved compatibility

Full Mike expression syntax, YAML node/style/comment round-tripping, broad YAML
grammar, merge-key behavior, non-string/duplicate keys, unsafe integers, tags,
file-only argument detection, input formats, eval-all, null input, in-place writes,
output controls, and exact diagnostic/status grammar remain unqualified or
unsupported. Even flow-mapping colon grammar is not claimed equivalent: the
observed `{a:# comment\n 1}` is interpreted differently from the reference.
These phase-1 repairs do not establish full YAML conformance or native-tool parity.
Parser/evaluator redesign, dependencies, public/build admission, and broader
compatibility require separate assignments.
