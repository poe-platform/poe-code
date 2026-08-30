# Independent adapter hardening handoff

Recorded 2026-08-26 at 19:00 UTC on Darwin, Node v22.22.2. This bounded review
pass changes only `tests/fs/conformance/**` and `tests/stress/adapters/**`.
No source, remote-owned fixtures, dependencies, private SafeJS files, or other
workers' staged content were edited. An explicit-owned-path atomic commit is
authorized. This is not a product-wide pass, full-shell completion, superiority
evidence over just-bash, or evidence of 72 hours of work.

## Latest validation

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=spec tests/fs/conformance/*.test.ts tests/stress/adapters/*.test.ts
```

**272 tests: 271 passed, 1 failed, 0 skipped, 0 cancelled, 0 todo; exit 1.**
Memory 59/59, Real 60/60, S3 74/74, WebDAV 76/77, plus two passing provenance
checks. The earlier 244-test report is superseded. A first review run exposed
three incorrect new S3 call counts because root inspection also lists objects;
the test now separates successful root preflight from the malformed depth-one
listing. Final failures below are not those test-authoring mistakes.

```sh
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --skipLibCheck --types node tests/fs/conformance/*.ts tests/stress/adapters/*.ts
node --unhandled-rejections=strict --import tsx tests/stress/adapters/pagination-mutation-probe.ts
```

Scoped TypeScript checking passed (owned tests and imported dependencies, not
whole-repository typechecking). The mutation probe passed: an in-memory copy of
S3 source with cycle detection removed reaches the fourth guarded listing call.
The old expected-EIO assertion passes because transport errors are normalized;
the new outside `calls === 2` assertion fails. No source file is modified.
The standalone probe is not included in the 272-test count.

```sh
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs node --unhandled-rejections=strict --import tsx --test --test-reporter=spec tests/integrations/safejs/*.test.ts
```

**28/28 passed; 0 failed/skipped/cancelled/todo, exit 0.** Rerun because shell
source changed since the previous report. Six tests use the real local SafeJS
checkout, including structural type and concrete Shell/Memory integration;
the other 22 are existing bridge/unit/concrete-memory coverage. Observed private
repository HEAD: `587897c4442ce5af749565678247dff9ff9a4c6e`;
`git status --short -- packages/safejs` was empty. Checkout access was read-only.

## Exact remaining failures

| Test | Expected | Observed |
| --- | --- | --- |
| WebDAV shared read through non-directory parent | `readFile("/file/child")` rejects `ENOTDIR` | `ENOENT` from PROPFIND 404 |

The preceding 269/272 run additionally failed redundant-namespace listing
(EIO from namespace limit) and injected short-body integrity (read resolved).
Both independent regressions pass after the remote owner's source fixes.

The six previously reported WebDAV compatibility targets now pass, without
relaxing them: appendFile creation/append, write flag a, exclusive ax, replacing
file rename, replacing empty-directory rename, and replacing copyFile.
Root should rerun the remaining failures after the remote owner's source fixes;
this worker does not wait for or edit those fixes.

## Review additions and retained boundaries

- S3 malformed pagination asserts counts outside the adapter: two cyclic pages,
  one for every other malformed case. Guard exceptions cannot mask a loop.
- S3 exclusive copy injects destination creation during mock copyObject
  authorization; EEXIST and both original byte sets are required and pass.
- Streaming read and write capabilities are tested independently. Advertised
  capabilities require methods and exact semantics; false optional capabilities
  permit absent methods or ENOTSUP and emit visible diagnostics, never skips.
- Local streaming cancellation reuses the shared original-reason-or-FsError
  ECANCELED predicate. Historical timestamp equality is unchanged.
- Empty-directory rename verifies source absence. File-parent write, read, and
  readdir error checks are independent and require original bytes to survive.
- The namespace fixture declares xmlns:d="DAV:" on the multistatus root and
  each response. The short-body test injects Response directly, avoiding native
  HTTP enforcement masking the adapter boundary. No-length overflow remains.
- The obsolete blanket ENOTSUP test is replaced by missing-ETag append and
  unavailable-lock MOVE/COPY fail-closed tests, each preserving bytes and
  checking no payload mutation. Optional truncate rejection remains explicit.
- Existing stress covers binary slicing, pagination, partial rename reporting,
  conditional writes, cancellation, malicious DAV href/XML, actual loopback
  HTTP response cancellation, deadlines, read limits, and host-symlink escape.

## Separately labeled policy characterization

Ten tests in `policy.test.ts` record product divergence, not a new uniform API
promise. Memory/Real reject file/.. with ENOTDIR and terminal . or .. destructive
source operands with EINVAL. S3/WebDAV lexically normalize file/.. and the rm or
rename source operands before operating. Terminal-dot destination policy is not
claimed by these bounded source-operand checks. Remote symlinks remain an
explicit capability gap in shared tests.

Memory rejects rm(link/) and rename(link/, destination) with ENOTDIR. Real
follows the directory target, leaves the symlink dangling, and removes or moves
the target. Disposable native node:fs/promises fixtures on this Darwin host
showed the same Real outcomes for both operations. Diagnostics include actual
native state; this is neither a host-fidelity bug claim nor a raceproof guarantee.
Root still owns cross-adapter policy decisions.

## Unresolved host timestamp behavior

The exact `utimes("/file", 10000, 20000)` then `atimeMs === 10000` assertion
remains unchanged and passed this final run. Earlier repeated suites failed it
intermittently. The prior standalone `atime-probe.ts` measured 5/500 native and
7/500 adapter current-time-atime anomalies, with correct mtime; immediate native
stat confirmed every adapter anomaly. These are not rounding observations or
proof of timestamp granularity. No tolerance, retries, sleeps, or skips were
introduced; root's separate read-only investigation remains unresolved. The
probe was retained unchanged, not rerun or counted as a passing test here.

## Tested source snapshot and drift

Final suite started at HEAD `7db81494b5a7a9bcbe6d984456040c8dc26e0212`.
Full adapter/contract/remote-fixture SHA-256 snapshots immediately before and
after the entire final suite were identical; shared in-suite provenance checks
also passed. Relative to the previous report, WebDAV implementation and mock
changed (append, protected overwrite, and body-integrity fixes), as did the XML
parser (namespace accounting); Memory, Real, S3, and the four contract hashes
below were unchanged. Shell lifecycle fixes also landed,
which triggered the SafeJS rerun. Other workers continue independently, so
subsequent HEAD changes alone do not invalidate or establish this evidence.

After the final stable run, the remote owner changed `src/fs/webdav/webdav.ts`
again to SHA-256
`665fc53a805c08e4567ec07031b1cd15da0c16da2b5f92fd7d17da4234c49748`.
That later source is not covered by the 271/272 result; root's
final verifier must rerun rather than treating the recorded errno failure or
its resolution as established for the later source. No further audit is taken.

```text
7c63db5052a28014ac185f86e6b97d2c3ef00ce61b80638baa850a6933f57457  src/contracts/filesystem.ts
66455381fe9d9e5357d08942e73de6ea1d613a03b09acaab77a5ccccde0f2840  src/contracts/errors.ts
0ae67683ddc368c01e59c77cbac3a78715a6e362b454d91b763a9cf054e7ad46  src/contracts/io.ts
948a1ceb19fd87fa4931974282ec4d68217dbd2353fac6ce6eabd48d3b5a2f34  src/contracts/path.ts
21d4a366e3840d0d3c9e67b8a433cc0be341f7350b075fd6668aa4ad9a32d3fd  src/fs/memory/index.ts
4977b7780b067cdd16bd8c128982758cd3401d2f72864f786981d2c315b74f82  src/fs/real/index.ts
8496bbd287f7d68bd60951d520cee4cea9a493f842a21762370eb867a930d83b  src/fs/s3/filesystem.ts
1362646b4daf18da430a7f83e1ff90e6eaf0bff4d05cb8f69f1ddd4585d9cc83  src/fs/s3/mock.ts
c34aa9e92c5bc0146259a9657b490c807bb77f95b6661a216d014c2106971aa8  src/fs/s3/transport.ts
fb2b596d54bf9590add5b09c7e704c59a7e15806771bfcebb0969311e85ca9be  src/fs/webdav/webdav.ts
c5b2798ef847acb480be70348d59bb0bc0a0d80624c313880cd53ff1b293dec1  src/fs/webdav/xml.ts
f46b18da28ed03b8096dc2b8a10fc0aba768947b9af5ebf0ebae602b289d8ce0  tests/fs/webdav/mock.ts
```

The tested four real adapters use fresh Memory instances, disposable Real roots,
the repository MockS3Client with an isolated bucket/prefix, and real WebDAV over
a bounded ephemeral loopback server backed by the remote-owned MockDav. No
cloud credentials or non-loopback requests are needed. S3 shared rename opts
into non-atomic rename; default ENOTSUP and partial-progress behavior remain
explicit, and passing fail-closed tests do not establish operation support.

## Commit coordination

After this worker staged the nine explicit owned files, concurrent commit
`7db81494b5a7a9bcbe6d984456040c8dc26e0212` temporarily included them alongside
three unrelated contract/command files. Concurrent coordination subsequently
removed the mixed commit from active history and restored the staged tests;
this worker did not rewrite history. Report-only commit `21823dc` records the
intermediate handoff. The final owned commit explicitly includes the eight
test/helper/probe files and this updated report, not unrelated staged paths.
Staged whitespace checking of the nine owned files passed. Later concurrent
command/cancellation changes, including contracts/io.ts, are outside the final
tested snapshot and require root verification as well.

## Independent local-only checkpoint — 2026-08-26, 19:03–19:04 UTC

This separate delegated verification covers actual Memory/Real suites and the
actual local SafeJS integration only. No source, tests, manifests, private
poe-code files, or benchmarks were edited. S3/WebDAV test bodies and standalone
probes were not run. Shared fixture imports include remote modules, but the
name filter below excludes their tests and the remote provenance tests. This
checkpoint does not establish final remote correctness, including pending LOCK
cancellation cleanup or LOCK207 error-detail work.

### Commands and measured results

Darwin, Node v22.22.2. The initial execution ran 19:03:48–19:03:51 UTC at HEAD
`110402fa67cffab7305ec67134f354b66f9dbf36`. The direct local suite passed 152/152,
SafeJS passed 28/28, and scoped TypeScript exited 0. The initial shared-suite
console capture was truncated; its final counters are not used as evidence.
Shell source changed across this bracket, triggering the one permitted repeat.

The repeat ran 19:04:25–19:04:28 UTC; HEAD was
`97db237c383b9f57ec36cf4f0907d95e15825b75` at both command boundaries.
Exact repeat commands, including output-only filters and zsh exit reporting:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=spec tests/fs/memory/*.test.ts tests/fs/real/*.test.ts | awk '!/^✔/'
printf 'LOCAL_PIPESTATUS=%s\n' "${pipestatus[*]}"
node --unhandled-rejections=strict --import tsx --test --test-reporter=spec --test-name-pattern='^(memory|real):' tests/fs/conformance/shared.test.ts tests/stress/adapters/core.test.ts tests/stress/adapters/policy.test.ts | awk '!/^✔/'
printf 'SHARED_PIPESTATUS=%s\n' "${pipestatus[*]}"
SAFEJS_LOCAL_ROOT=/Users/kjopek/Workspace/poe-code/packages/safejs node --unhandled-rejections=strict --import tsx --test tests/integrations/safejs/*.test.ts | awk '!/^ok / && !/^# Subtest/ && !/^  ---/ && !/^  duration_ms:/ && !/^  type:/ && !/^  \.\.\./'
printf 'SAFEJS_PIPESTATUS=%s\n' "${pipestatus[*]}"
node_modules/.bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/contracts/*.ts src/shell/*.ts src/fs/memory/*.ts src/fs/real/*.ts src/integrations/safejs/*.ts tests/fs/memory/*.ts tests/fs/real/*.ts tests/fs/conformance/*.ts tests/stress/adapters/core.test.ts tests/stress/adapters/policy.test.ts tests/integrations/safejs/*.ts
printf 'TSC_EXIT=%s\n' "$?"
```

The initial commands were the same four invocations without the `awk` pipes;
test/compiler exit status was printed immediately using `$?`.

| Repeat scope | Tests | Passed | Failed / skipped / cancelled / todo | Exit |
| --- | ---: | ---: | --- | --- |
| Actual Memory + Real owned suites | 152 | 152 | 0 / 0 / 0 / 0 | 0 |
| Local shared conformance + core stress + policy | 119 | 119 | 0 / 0 / 0 / 0 | 0 |
| Actual SafeJS bridge/integration | 28 | 28 | 0 / 0 / 0 / 0 | 0 |
| Scoped strict TypeScript | n/a | n/a | no diagnostics | 0 |

All three pipeline status arrays were `0 0`. **299 selected tests passed**;
excluded remote tests are outside this scope, not silently counted as passes.
SafeJS includes six actual-checkout tests, including structural assignability
and concrete Shell/Memory stdin, pipes, and shared writes; none were skipped.
Private repository HEAD was `3be829756746d5491f61538a243f31a85abef2a2` before
and after; `git -C /Users/kjopek/Workspace/poe-code status --short -- packages/safejs`
was empty. The private checkout was read-only. TypeScript checks the listed
roots and imported dependencies, not the entire repository or private project.

### SHA-256 snapshots and remaining drift

Snapshots bracketed the initial commands at `19:03:31.884Z` / `19:03:56.275Z`
and the repeat at `19:04:08.715Z` / `19:04:33.043Z`, all on 2026-08-26.
Each group digest is SHA-256 of a UTF-8 manifest: recursively enumerate its
files, sort relative paths using JavaScript `.sort()`, and concatenate
`<file SHA-256><two spaces><relative path><newline>`. Directory traversal excludes
`node_modules`, `.git`, and `dist`. Private paths are relative to the SafeJS
package; all others are relative to virtual-bash. Digests below were identical
in all four snapshots unless separately identified as shell drift.

| Group (roots) | Files | SHA-256 before = after, both brackets |
| --- | ---: | --- |
| `src/contracts` | 7 | `19b81ced5a3eb840a2a8fa8e922d2aa5beb74688eb43f5340b31279ba1ade038` |
| `src/fs/memory` | 1 | `9996d9406a67b427d6d1a5beac2b28dcdfc63be404c627db6be10830da5d4240` |
| `src/fs/real` | 1 | `1bf45fcbaff422f217023bf7ec662bcae3b393242f9d57a0f406d1ea1a339c0e` |
| `src/integrations/safejs` | 5 | `ee7a244d7fce5e96ab699a2b865326a55e346e81df3fb8f83571569e51d2a39b` |
| `tests/fs/memory`, `tests/fs/real` | 9 | `86301d80a6c71d98f7c562731bbda3d6eac033b89efe2a7d756b8b03fa680646` |
| `tests/integrations/safejs` | 5 | `b33c15b50778a3ae924b716381dcbd060cfc827be2f13abae9e6798b1710b8dc` |
| `tests/fs/conformance`, `tests/stress/adapters/core.test.ts`, `tests/stress/adapters/policy.test.ts` | 4 | `9c74893d65260fffe32f1b6a987d7ed3743d864183b93b9e6927d8673871765d` |
| `package.json`, `package-lock.json`, `tsconfig.json` | 3 | `61e05e3228740053861db9e68601e81aaf53c5a3b8d5e811956c718040a8cbc7` |
| Private SafeJS `src` | 226 | `f3c7ce1d628d4eb5f53a46db47ebc177881f35fd0de1ef3b8a54a54cba479aca` |

Direct source-file SHA-256 values unchanged in all four snapshots:

```text
21d4a366e3840d0d3c9e67b8a433cc0be341f7350b075fd6668aa4ad9a32d3fd  src/fs/memory/index.ts
4977b7780b067cdd16bd8c128982758cd3401d2f72864f786981d2c315b74f82  src/fs/real/index.ts
c9ab864768e430bbfbea7590071646985c6374634124f62516ec09c13d9af578  src/integrations/safejs/filesystem.ts
b0866c13456991f05f30dd23cabcf895d92b8af89985eb88172ac3d76b3b8384  src/integrations/safejs/index.ts
5cb3e55c5e62adb540b41ac7ce39e8458a3a25ffb8422e6164419c1d22ef15da  src/integrations/safejs/shell.ts
94bb724a7281296e08ac4465979e0f9cac585e28f91fc79382650a3c60ea4824  src/integrations/safejs/stats.ts
91ac3025b6420a7a908736f1d746077f27c9f045f6be22d82a37f4a07ff9111a  src/integrations/safejs/values.ts
e925ab08a5ad41862d3f5c031164cc7310bc28397455b11b37b75b55a9dbacdb  src/contracts/io.ts
```

The seven-file `src/shell` manifest changed:

| Snapshot | Shell manifest SHA-256 | Direct `src/shell/runtime.ts` SHA-256 |
| --- | --- | --- |
| Initial before | `e0796d100eb8594cc8b0d20876a76326de6a3adbbe5fa38768de03179e1a21bd` | `9bc1267ae31950578e2bc295e5b966a744bb5e1218da69a4f7ef13cf92cc05f5` |
| Initial after / repeat before | `81d7ef1543305589b1cf7269b1ba1efc85cf52ed7596920ae719a1c94da57458` | `2a1272961831205eafbe65e80cc72f9d50376784be5a4210160ba309c66c882b` |
| Repeat after | `33fe6332f36b0a62c153adacb966f0c2194581a6012c4b3e2bd2cea5a3f5e21d` | `17fbabf33b9097ff8f447e5b94cd5d2519a11de340bfbd577ebf13dc29a0db4b` |

Only `runtime.ts` changed within these shell manifests. **Both SafeJS runs
passed, but neither bracket establishes a stable-shell snapshot.** Local
Memory/Real sources, contracts, bridge, selected tests, and private SafeJS src
were stable at measured boundaries. Equal boundary hashes do not exclude
transient intervening edits. Later shell state is not certified by these
passes, and scoped TypeScript is likewise not final stable-shell proof. The
single repeat allowance is exhausted; no further audit or rerun was attempted.

### Timestamp and reachable-history checks

The historical `utimes` atime equality assertion remains exact and unmodified.
Per the established native Darwin/APFS investigation supplied for this task,
the observation is actual access-related atime mutation, **not rounding**:
native **59/200** versus unlinked-before-write **0/200**, with mtime always
correct. The reader is unknown; no antivirus cause is asserted. No timestamp
research, tolerance relaxation, retries inside tests, or standalone atime
probe was performed in this checkpoint.

Read-only `git show --format='%H %s' --name-only` inspection and
`git merge-base --is-ancestor <revision> HEAD` confirmed all of these reachable
commits (ancestor exit 0) and their exact scopes:

- `d79756a`: Real implementation and its cancellation regression test only.
- `41f7d6e`: five SafeJS bridge source files and five integration files only.
- `4a6f7d6`: two conformance files and seven adapter stress/report files only.
- `21823dc`: this report only.
- `7da881f`: WebDAV README, implementation, and review regression test only.

`git diff --exit-code 4a6f7d6 -- tests/fs/conformance tests/stress/adapters`,
`git diff --exit-code d79756a -- src/fs/real/index.ts tests/fs/real/cancellation-regression.test.ts`,
and `git diff --exit-code 41f7d6e -- src/integrations/safejs tests/integrations/safejs`
were clean before this report append. The formerly mixed commit
`7db81494b5a7a9bcbe6d984456040c8dc26e0212` was not an ancestor of current HEAD
(exit 1). No history or index repair was performed. Concurrent unrelated
tracked/untracked changes were left untouched; this checkpoint's sole owned
edit is this report, to be committed with `git commit --only` and its exact path.
