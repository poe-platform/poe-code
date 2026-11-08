# Active implementation findings for root

This is the actual approved-API implementation review, not proposal `29fe1bf`.
No production source or other worker's fixtures have been edited by this leaf.

## S3 metadata-provenance authority permits source loss

Confirmed in frozen moving-source capture `evidence/split-authority-repro` at
`2026-08-27T01:00:56.970Z`, observed HEAD
`1faf5e05ee91144c5b4162d41ea81ad1cdbdba09`. Source was not a clean committed
checkpoint; its exact archive and per-file hashes are retained.

Two custom injected S3 transports forward HEAD/list to two independent actual
MockS3 stores but route GET/PUT to the same local memory file. The genuine mock
HEAD responses carry private provenance. The product infers distinctness from
those response records although they do not establish authority for the custom
transport's content/mutation routing. No private product registrar is called by
the test, no invented identity tuple is supplied, and no compare method is stubbed.

Actual public behavior:

```text
compareEntry: distinct (required: unknown)
mount.copyFile: EIO (required: ENOTSUP before content)
content operations: GET, PUT (required: none)
source after failed destination write: partial S3 write hit source
source required unchanged: source sentinel
```

Subsequent working-tree repair rechecks (`safety-recheck`,
`complete-safety-recheck`, `qualified-failure-recheck`) return unknown, reject the
copy before GET/PUT, and retain `source sentinel`. The S3 owner restored
full-operation provider registration checks in addition to fresh HEAD provenance.
Committed-source closure still requires the final source-leaf checkpoint; these
working-tree passes do not overwrite or retroactively invalidate the finding.

Exact repro test: `remote-comparison.test.ts`,
`S3 two custom clients returning private mock metadata cannot claim distinctness for shared local data`.
Run it against current sources with:

```sh
node --import tsx --test --test-name-pattern='S3 two custom clients' tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts
```

The frozen `remote-comparison.test.ts.txt` retains the reproducing test version.
Relevant SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `src/fs/s3/authority.ts` | `c5ab9442b9c00456c1cca223e36c98c14b1393114ba12e22df5535b25eec5cfa` |
| `src/fs/s3/filesystem.ts` | `1adfbf2ffe07b78a935752449a88c896a3f4f15a50d7f4a6f8a05981f5fafdb8` |
| `src/fs/s3/mock.ts` | `99655664c7a52c595dc1ec4e5d461e4c002a0c9ba60d222ded078e5b9780841e` |
| `src/fs/mount/comparison.ts` | `4d14485234633bb472414a56744ff80de8413a360fe863ad400d042ec2e8563e` |

Route source remediation to the S3 owner through root. Returned metadata object
provenance alone is not proof of the actual backing used by an arbitrary injected
transport. Recognized closed-store positive cases must stay useful; this review
does not prescribe a replacement API or a broad trust flag.

## WebDAV parallel design risk

A similar split fetch returns the actual MockDav metadata Response while routing
GET/PUT to a local memory source. The current frozen capture returns `unknown`
and rejects copy `ENOTSUP` before effects. This is a passing safety control, not
a reproduced WebDAV source-loss finding. Recheck when mixed memory/provider
authority integration is actually present; the private-response design alone
does not establish operation routing.

## WebDAV pre-construction override authority permits source loss

Confirmed separately in `evidence/webdav-operation-override`, captured
`2026-08-27T01:13:27.131Z`, observed HEAD
`8aaf610d26e8dc310bf6ac1f713cf2614cc1120e`. This is not the passing split-fetch
case. A subclass overrides the public buffered/streaming data methods on its
prototype before the base constructor registers resource identity queries.
The registration snapshots those already-overridden methods as if they belonged
to the base adapter's operation mapping. Both views use real MockDav metadata
and the actual public product comparison; their data methods address the same
memory source. No private registrar or invented compareEntry answer is used.

Actual public behavior:

```text
compareEntry: distinct (required: unknown)
mount.copyFile: EIO (required: ENOTSUP before content)
effects: writeStream (required: none)
source: subclass destination damaged source (required: source sentinel)
```

Relevant source SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `src/fs/webdav/resource-id.ts` | `bb1ad5de415ce3f4369aaccef3a3869162bc81a8f6eb66104df4e5c7db452916` |
| `src/fs/webdav/webdav.ts` | `b03c53d4fd1e5c7da4d665d532dbf25b39e9555dc1cb47890edd2ffd2d9fa51b` |
| `tests/fs/webdav/mock.ts` | `e4f8a6806c1dd6f0622cce9f3b487f530011c39b7ca95cc2543002ce4da95266` |
| `src/fs/mount/comparison.ts` | `cedfd2b4a586ddf85eaac30e1ce7797b290b712b744498e84df5036c89f64a2c` |

Reproduce against current product source:

```sh
node --import tsx --test --test-name-pattern='WebDAV pre-construction' tests/fs/mount/identity-authority-review/implementation/remote-comparison.test.ts
```

The full frozen run is 46/47, scoped typecheck 0, no skips/todos/cancellations.
The initial S3 regression remains fixed in the same capture. Route WebDAV source
remediation through root to its owner; no production patch is made here.

## Early harness corrections, not product waivers

The first local probes required compareEntry directly on memory/real. The
approved contract makes that method optional; tests now exercise native entries
through the actual public read-only wrapper comparison instead. Alias/distinct,
metadata errors and all effect assertions remain required. Earlier raw failures
are retained, not relabeled as passes.

An early S3 test required a subclass with no overrides to be unknown merely
because it was a subclass. That is not an authority invariant: a transparent
subclass can still use actual closed-store operations. The test now overrides
content routing to another actual store, and separately checks a forwarder whose
PUT routing changes. The unchanged earlier failure remains in `early-remote`.

The overlay future-write test uses a real concurrent insertion: a lower metadata
read inserts an upper hardlink to the source before the actual-upper guard.
It no longer uses inconsistent synthetic stat/lstat responses. The expected
result is EINVAL with no copy effects and unchanged source/target bytes.

The `roots-46` run reports 45/46, with one incorrect test expectation: this leaf
had required COPY overwrite to allocate a new destination resource ID. RFC 5842
section 2.7 explicitly requires an existing resource's ID to remain unchanged
when updated by COPY; only COPY creation requires a new ID. The current mock was
correct to retain it. The lifecycle test now requires stable overwrite identity
and separately verifies fresh identity on COPY to an absent target. All earlier
raw observations, including earlier green runs against the old mock behavior,
remain unchanged and are not treated as valid proof of that protocol detail.
Primary reference, checked August 27, 2026:
`https://www.rfc-editor.org/rfc/rfc5842.html#section-2.7`.
