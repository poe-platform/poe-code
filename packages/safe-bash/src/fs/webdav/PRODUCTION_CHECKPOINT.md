# WebDAV production-fix checkpoint — August 26, 2026

Only `src/fs/webdav/**` and `tests/fs/webdav/**` were edited. No contracts,
commands, shared fixtures, exports, dependency manifests, or matrix assertions
were changed. The library still adds no runtime dependency or host subprocess.
Verification uses injected Fetch and ephemeral loopback HTTP, not credentials
or a remote WebDAV service.

## Delivery and attribution

- Commit `a5d68b9`: real R_OK authorization probes and lazy, cancellable,
  backpressure-driven binary reads, with stream option/length/limit tests.
- The follow-up commit containing this document adds streamed PUT with
  conditional append/exclusive creation, persistent ETag-bound virtual
  timestamps through PROPPATCH, and independent owned protocol fixtures.
- Concurrent commit `b01ceda` fixes ordinary newly-created `touch` behavior in
  command source. That contribution is not attributed to the WebDAV adapter.

## Exact validation

These are working-tree observations amid concurrent workers, not a clean
immutable release or a product-wide superiority claim. HEAD observed after the
broader run was `7367ce4`. All denominators include every selected case.

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/webdav/*.test.ts
```

290 tests passed in three consecutive final strict runs; zero failed,
cancelled, skipped or TODO. The previous backend
tests remain present. Added coverage includes byte slicing, early return,
blocked-source cancellation, late rejections, deadlines, real HTTP download
abort and chunked upload, append races, permission/lock/storage errors,
malformed PROPPATCH, cross-instance timestamp persistence, and agentCommands
touch/read-gzip flows.

```sh
node --unhandled-rejections=strict --import tsx --test tests/fs/conformance/shared.test.ts
node --unhandled-rejections=strict --import tsx --test $(rg --files tests/fs -g '*.test.ts')
npm run typecheck
```

Unchanged shared conformance: 202/202 passed. Complete current `tests/fs` suite:
1,116/1,116 passed, zero failed/cancelled/skipped/TODO. Whole-repository typecheck
passed. These broader totals include other workers' contributions, not just
the 20 tests added by this assignment. The strict scoped source/test typecheck
documented in README also passed.

```sh
node --unhandled-rejections=strict --import tsx --test \
  --test-name-pattern='^webdav:' tests/integration/adapter-tools/matrix.test.ts
```

The unchanged real-agentCommands required WebDAV matrix began at 5/11.
After `readStream` and `access` implementation plus concurrent `b01ceda`, it
passed **11/11**, with zero skips or relaxed assertions. Five original failures
were resolved by the adapter changes; the ordinary new-file touch result also
depends on the independently owned command fix.

After concurrent shell diagnostic commit `19149d3`, reruns showed **10/11**:
the missing-file test still expects `/ENOENT.*missing\.txt/`, but the shell now
prints `shell: line 1: missing.txt: No such file or directory`. The adapter's
direct `access('/missing', 4)` continues to reject with `FsError('ENOENT')`.
That was recorded as a failure, not an exception or a green denominator.
The root subsequently aligned the exact shell diagnostic assertion in commit
`d0fed8f`; the final current matrix at observed HEAD `f1c1167` passes **11/11**,
with zero failures, cancellations, skips or TODO. The original matrix was not
changed by this worker, and the root's assertion update must not be attributed
to the adapter. Required flows and the denominator remain intact. No
adapter-specific command workaround was applied.

## Residual reproductions and provider limits

- Bare shared MockDav has no PROPPATCH. Existing-file `touch` on that fixture
  returns `ENOTSUP`; the owned PropertyDav fixture exercises successful first
  and repeated touch, `touch -r`, real protocol denials and version races.
  Missing-path `utimes` never creates anything. `touch -r` creation plus a later
  server rejection is still two distinct shell operations, not transactional.
- `gzip -k /file` with no existing `/file.gz` reaches secure staging and fails
  `ENOTSUP: mkdir mode` because the command requests a POSIX creation mode.
  Named reads (`gzip -c /file`, checksums) and streamed uploads work; the test
  retains this separate named-output limitation without pretending to support
  native permissions. Forced replacement also still requires atomicRename,
  which remains false.
- Virtual timestamps require strong tags, persistent arbitrary dead properties,
  conditional PROPPATCH, and PROPFIND round-tripping. They are not native DAV
  last-modified/atime updates. Reused tags, stable collection tags, and providers
  that change tags when setting metadata remain limitations detailed in README.
- Streaming is bounded by `maxResponseBytes` and request deadlines. Aborted
  uploads can already have remote side effects; cleanup cannot forcibly stop
  an uncooperative injected transport. No provider interoperability or atomic
  write guarantee is claimed.

This checkpoint does not establish full Bash/POSIX support, completion of the
72-hour request, or superiority over just-bash.
