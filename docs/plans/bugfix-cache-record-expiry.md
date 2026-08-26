# Cache record absolute expiry

## Plan and result

- [x] Reproduce expiry through `createCachedResource` using memfs and mocked fetch.
- [x] Run failing regressions before changing production code.
- [x] Validate `staleTtl` and check absolute record age before accepting memory hits.
- [x] Verify targeted regressions, the package suite, and package types.

## Contract and fix

The existing README defines `staleTtl` against the record's fetch timestamp.
Disk loading rejects `Date.now() - timestamp > staleTtl`, but memory previously
trusted the LRU insertion TTL. Promoting a 990ms-old record with a 1000ms TTL
therefore served it after another 20ms; a zero LRU TTL disabled expiration.

The orchestrator now rejects non-finite or negative `staleTtl` and only accepts
memory records whose absolute age is at most `staleTtl`. Equality remains valid,
including age zero with TTL zero. Expired memory falls through to disk, then the
existing network/bundled policy; it is never returned for background refresh.
No LRU TTL changes or README edits are needed.

## TDD evidence

Focused command, run before and after the production patch:

```sh
npm run test:unit -- packages/cached-resource/src/cached-resource.test.ts -t 'absolute record expiry|rejects invalid staleTtl'
```

- RED: 16 failed, 95 skipped; 43ms test time. Failures returned expired records
  instead of bundled/newer-disk/network data, or accepted invalid TTLs.
- GREEN: 16 passed, 95 skipped; 28ms test time.
- Public API cases cover `offline`/`preferOffline`, TTL 1000/0, exact boundaries,
  warm/cold agreement after expiry, newer disk records, and awaited online fetch
  success/failure. Four invalid-TTL cases cover memory hits and forced refresh.
- Date and LRU performance clocks advance together under fake timers. Filesystem
  operations use memfs; fetch is mocked. No real file or network I/O in regressions.

Additional passing checks:

```sh
npm run test:unit -- packages/cached-resource/src/cached-resource.test.ts
./node_modules/.bin/tsc -p packages/cached-resource/tsconfig.json --noEmit
git diff --check
```

The full package suite passed all 111 tests in 116ms. No CLI presentation changes
were made, so screenshots are not applicable. Changes are limited to the
orchestrator, its existing test file, and this document. No commits or pushes;
the parent handles commit, push, and release.
