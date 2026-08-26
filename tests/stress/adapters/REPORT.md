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
That later working-tree source is not covered by the 271/272 result; root's
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
`7db81494b5a7a9bcbe6d984456040c8dc26e0212` included them alongside three
unrelated contract/command files. This worker did not create that mixed commit
and does not rewrite its history. The updated report is committed separately
with an explicit report-only path. The original atomic-owned-test-commit goal
was therefore not achieved, despite explicit staging. Staged whitespace
checking of the nine owned files passed before that concurrent commit.
