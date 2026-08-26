# Independent default S3 rename review

## Scope and evidence

Curie owns only this independent test directory and root documentation.
Poincare owns all adapter source and backend tests. No adapter, existing
expectation, provider credential, runtime dependency or cloud resource was
changed for this review. Native subprocesses are not used by virtual commands;
the verifier uses Node processes and git archives solely as local test tooling.

All tests run under Node v22.22.2 with strict unhandled rejections. Tests inject
deterministic mutations/failures through the actual transport and supplied mock,
not timers. Both full source archives below use the same SHA-pinned owned test
overlay; no uncommitted adapter edits enter them.

| Product archive | Runs | Cases per run | Pass | Fail | Skips / TODO / cancelled |
| --- | ---: | ---: | ---: | ---: | --- |
| b4033fb96b353bf82025a28aafff6619066967dc | 3 | 42 | 34 | 8 | 0 / 0 / 0 |
| acef1118fe4e5e0342114ee7d28de5ea02df2327 | 3 | 42 | 39 | 3 | 0 / 0 / 0 |

`b4033fb-evidence.json` and `acef111-evidence.json` retain every TAP assertion,
exact source/archive/manifest hashes, command, revisions and separate limitation
observations. `worktree-evidence.json` records the intermediate 39/42 result
against Poincare's then-uncommitted edits: source hashes were stable during that
run, but it is explicitly not a committed-HEAD result. The later acef111 archive
independently establishes that result. Repetitions are not new distinct cases.
Scoped strict TypeScript and verifier syntax checks pass; no global suite or
new build is claimed.

## Concrete defect for Poincare

**Missing minimum destination-mutation capability preflight.** At acef111,
`rename()` requires `conditionalDelete`, but if `conditionalCopy` is absent or
false, it intentionally omits the destination `If-Match` / `If-None-Match`
guards. It then resolves successfully after overwriting the destination and
deleting the source. A destination concurrently created just before the copy
is silently replaced; the recorded transcript confirms both absent guards and
successful resolution, not merely a theoretical timing window.

Minimal reproduction shape:

```ts
const transport = createS3Transport(client, { conditionalDelete: true });
const fs = new S3FileSystem({ transport, bucket });
// The independent transport hook inserts target="concurrent writer" just
// before copyObject; source initially contains "original".
await fs.rename("/source", "/target");
// Current result: resolves; source absent; target="original".
```

Exact failing test names:

- `minimum mutation capabilities preflight {"conditionalDelete":true}`
- `minimum mutation capabilities preflight {"conditionalCopy":false,"conditionalDelete":true}`
- `no destination guard capability must not clobber concurrent create`

Requested source remedy: preflight sufficient destination and deletion guards
before effects. For these clients, neither conditional copy nor another
negotiated guarded publication method exists, so reject with typed `ENOTSUP`
before mutations rather than silently downgrading. A separately designed,
bounded guarded fallback could support other clients without relaxing safety.
Update the adapter's minimum-capabilities documentation, which currently names
only conditional deletion. No test demands globally atomic directory rename.

Keep safe legitimate default rename and stable-target replacement enabled on
capable clients. Tests explicitly assert both success paths, actual copied bytes,
source removal, destination conditions and `atomicRename === false`.
`allowNonAtomicRename: false` still rejects before host calls. This review does
not recommend rejecting all rename operations merely because S3 lacks an atomic
multi-object rename transaction.

## Earlier eight failures and the five fixed by acef111

The b4033fb source did not send destination conditions even with all mock
capabilities enabled. Five failures now pass at acef111:

- `default guarded rename succeeds and advertises non-atomic semantics`
- `stable existing destination is legitimately replaced with destination ETag guard`
- `destination creation race retains both current writers`
- `destination replacement race retains both current writers`
- `concurrent destination child blocks its copy without deleting any source keys`

The first two previously passed the byte/state assertions but failed missing
request-header assertions. The last three actually resolved after overwriting
concurrent destination bytes; diagnostic transcripts retain those states.
The other three failures are the capability-preflight defect above. These are
eight failing vectors, not eight unrelated root causes. They are a new review
cohort, separate from the earlier 51 full-suite and 21 adapter-matrix failures.

## Verified controls and honest partial effects

- All directory copies precede any source deletion, including paginated trees.
  Copy and delete failures at each of three positions preserve exact actual
  bytes and acknowledged key lists. Error phase/code/cause/path/destination
  and immutable `copiedKeys` / `deletedKeys` are asserted.
- Different-content source mutation before copy or deletion is rejected with
  `EAGAIN`; a deleted/recreated source with different bytes survives. A later
  changed directory child survives even after earlier source keys were deleted.
- 404, 409, 412, access denial, timeout and internal errors do not resolve as
  success. Unconfirmed copy results never authorize source deletion. Missing
  acknowledgements after completed copy/delete produce explicit errors, with
  actual partial state recorded separately from acknowledged progress.
- Pre-abort and deterministic abort during copy/delete stop further effects.
  Signals reach the mock host work. These tests do not prove cancellation of an
  arbitrary uncooperative provider or rollback of an already completed request.
- New source children outside the enumerated set are never swept into deletion.
  Prefix isolation, encoded Unicode keys, same-path no-op, missing source and
  structural preflights are covered. Scope is finite and not full S3 parity.

## Limits are observations, not passing guarantees

`observe.ts` records two separate observations in each archive report. They are
not added to the 42 acceptance-test denominator and are not claimed fixed:

1. Recreate the source with identical bytes and different metadata between
   copy and delete: the mock's ETag is unchanged; the replacement is deleted
   and rename resolves. ETag equality is not object-incarnation identity.
   Thus the verified protection applies to changed ETags, **not every new or
   metadata-changed object**. Stronger identity guarantees need additional
   provider/version/coordination semantics, not an assertion that ETags suffice.
2. Add a new source child after enumeration: existing keys move, the new child
   remains, and rename resolves. This preserves the new data but success does
   not establish an atomic directory snapshot or disappearance of the source
   path. The corresponding acceptance test checks preservation only.

No remote provider credentials, real signing client, versioned bucket, object
lock, multipart copy or deployed endpoint is exercised. The client must honestly
advertise and enforce its negotiated preconditions and fully parse copy results.

## Primary protocol references

Read August 26, 2026, from current AWS documentation:

- `https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html`
  distinguishes source ETag conditions from destination conditions; a copy can
  embed an error in HTTP 200, so a completed response must be validated.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html`
  documents destination `If-Match` and `If-None-Match` for CopyObject. They are
  not equivalent to `CopySourceIfMatch`.
- `https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-deletes.html`
  documents ETag-conditional deletion, failed preconditions and concurrent
  conflicts. ETag conditions do not provide a multi-object transaction.

These AWS facts do not automatically apply to every S3-compatible transport.

## Reproduce

```sh
node --unhandled-rejections=strict --import tsx --test tests/stress/s3-policy/rename.test.ts
node tests/stress/s3-policy/verify.mjs --revision b4033fb --output /tmp/s3-policy-before.json --repeat 3
node tests/stress/s3-policy/verify.mjs --revision acef111 --output /tmp/s3-policy-after.json --repeat 3
```

The archive runner checks cached package/lock consistency, overlays only its
explicit hashed test and observation files, and retains its temporary archive.
It exits nonzero on failures, unavailable/incomplete runs, skips or TODOs. The
current red tests remain ordinary failing tests; no blanket skips or assertion
relaxations hide the defect while Poincare implements the source remedy.
