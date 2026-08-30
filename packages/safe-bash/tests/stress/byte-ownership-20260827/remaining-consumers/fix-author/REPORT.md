# Two retained-copy sites: author report

Source and canonical regression commit:
`b282159921ce530e932b02f90c64eca987de2704`.

Exactly two production lines change: jq's streamed program retention and curl's
stdin replay-cache retention now construct owned `Uint8Array` values. No other
production edits, no extra transient copies, no serializer or lifecycle edits,
no new dependencies. No third source edit was necessary.

## Freeze and source identity

Before editing production, the author read only the verifier's public marker,
confirmed freeze commit `07341c4751d776ee258bcea6086bb216216dd7c2` existed and
was an ancestor of HEAD, and matched both original SHA-256 values. The exact
marker is preserved as `verifier-freeze-marker.json`. Hidden cases were not
inspected. The marker's committed source-manifest hash is
`dd7076a50d5092ad7ca67c6ccda3ec6f0f7428a534494b341febdc5b95d4c3b1`.

Fixed SHA-256:

- `src/commands/structured/jq.ts`: `096897bfa9d875ba524cebd6b3959c551a26fa5e56d3b0d2fb42f9fabdf80da3`
- `src/commands/network/body.ts`: `93d8a8463ac7df91c8ef88368f2ee8524a0abd7e7970badf4d1312587a34c880`

## Checks and denominators

| Author run | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: |
| Original pre-fix canonical | 18 | 11 | 7 | 1 |
| Corrected pre-fix canonical | 18 | 12 | 6 | 1 |
| Fixed canonical (9 jq, 9 curl) | 18 | 18 | 0 | 0 |
| Nearby before fix | 89 | 89 | 0 | 0 |
| Nearby after fix | 89 | 89 | 0 | 0 |

All runs have zero cancelled, skipped and TODO tests. The initial seven failures
include one newly authored budget-fixture defect, documented in
`BASELINE-NOTES.md`; the corrected pre-fix six are three jq and three curl
Buffer-retention failures. Original fixtures, hashes and raw failure output are
preserved, not overwritten. Uint8Array, stable input, byte limits, cancellation
and no-input-mutation controls pass before the fix. The transient-upload test
additionally verifies unchanged buffer identity and no next pull while a
completed chunk is still being handled; only replay needs owned retained bytes.
The jq invalid-UTF-8 test asserts the existing fatal-decoding author profile,
not text-byte preservation.

Scoped TypeScript passes before and after the fix using the inherited strict
NodeNext configuration, two canonical roots and their transitive imports:

```sh
node_modules/.bin/tsc -p tests/stress/byte-ownership-20260827/remaining-consumers/fix-author/tsconfig.scoped.json
```

Canonical command:

```sh
node --import tsx --test tests/commands/structured/byte-ownership.test.ts tests/commands/network/byte-ownership.test.ts
```

Nearby command:

```sh
node --import tsx --test tests/commands/structured/streaming.test.ts tests/commands/network/http.test.ts tests/commands/network/safety.test.ts tests/commands/network/files.test.ts tests/commands/network/exports.test.ts
```

The raw `.tap` and `.log` files record these runs. Empty TypeScript logs mean no
diagnostics; recorded process exit was zero. Node was v22.22.2; TypeScript was
5.9.3. The canonical curl tests use an injected in-memory transport with actual
503 retry handling; nearby existing tests include loopback/native-oracle work.
No external HTTP, new native wrappers, regex probes, full jq matrix, full
repository test/typecheck, or deployed-provider claim is part of this evidence.

## Provenance and coordination limits

Runs used the shared live worktree with foreign work/staging, not a hermetic
committed archive. The two source files and canonical tests were unchanged
between the successful runs and their atomic commit. Post-run source manifests
bind the committed source tree and the observed live tree; they do not assert
that concurrent unowned files were frozen during the author runs. Independent
committed-snapshot qualification, moved-pack runs and historical replays belong
to the verifier and are not duplicated here.

Historical packed21/24 (including its wrong-abort assertion), directcurl1/2,
read-only audit fixtures, raw results, and `fix-review/**` remain untouched.
Archived initial author `.ts.data` files are fixture data, not canonical TS
inputs or discovered tests. No test-discovery or root configuration exclusions
were added. No superiority, full parity, release acceptance or 72-hour-duration
claim follows from these bounded checks.

The source/canonical commit uses exactly four explicit paths via `git commit
--only`. This evidence is committed separately, also with explicit paths.
Foreign staging remains outside both commits. All author test/typecheck command
sessions exit normally; no author background processes or timers are left open.
The source-ready marker is published to `/tmp/remaining-byte-fix-author-ready.txt`;
final coordination markers will carry both commits and the owned-path status.
The independent verifier, not the author, decides acceptance.
