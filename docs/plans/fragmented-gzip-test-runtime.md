# Fragmented gzip fixture runtime — September 1, 2026

## Scope and retained coverage

Only `packages/safe-bash/tests/commands/bytes-stress/compression.test.ts` and this
plan change. Completed current-shell work, shared helpers, production code,
historical evidence, timeouts and concurrency remain untouched.

Keep the exact 65,728-byte archive: four gzip members of 68, 23, 65,604 and
33 bytes; the same empty/text/binary contents; the same gzip/gunzip/zcat commands;
and all original exit-status and byte-output assertions. The binary payload
remains 65,537 bytes and still spans two stored-DEFLATE blocks.

Protect every original three-byte fragment intersecting a gzip header, trailer,
member transition or stored-block header. Derive their offsets from all four
members and assert exact fragment presence and bytes: 62 original-grid fragments
cover 13 structural ranges (four headers, four trailers and five stored-block
headers), including the original short final fragment. Reject a whole-archive
chunk as a fragmentation negative control. Retain a fresh asynchronous chunk
iterator for each command, with no change to streaming ownership or cancellation.
Corrupt the third member's CRC and require all three commands to reject it with
the CRC diagnostic, without modifying the valid archive.

## Planned reduction

Only coalesce the interior payload interval `[192, 65535)` into 384-byte chunks;
its endpoints remain on the original three-byte grid. All other chunks remain
three bytes. The interval lies strictly inside the first binary stored-block
payload `[145, 65680)`, so it excludes every structural boundary. Full archive
reconstruction and protected-fragment assertions authenticate this layout.

This changes 21,910 deliveries per valid command (65,730 for three commands) to
300 each (900 total), rather than shrinking content or reducing assertions.
The production inflater awaits a zlib write for each payload chunk; excess
deliveries, not compiler/startup work, caused this case's cost.

## Baseline and TDD

Original file SHA-256:
`a541419da73f4ddae07da41c1f13ec6c26749c965b41268c6e2beff0b5f6dbae`.

Fresh unchanged full file: 21/21 passing, 20.666s wall time; concatenation case
10.864s. Earlier isolated measurement was 3.945s, illustrating local timing
variation. Preserve these as measurements, not a full-CI performance claim.

Add the protected-fragment, compact-delivery and corruption controls before
changing the iterator. The original layout must fail the 300-fragment assertion.
After implementation, run the focused case, full file and strict scoped typecheck.
TDD red: the unchanged iterator fails with `21910 !== 300`. TDD green: the
focused case passes in 216ms including all protected-boundary checks and the
third-member CRC negative control for each of gzip, gunzip and zcat.

## Final validation

| Measurement | Before | After |
| --- | ---: | ---: |
| Full file test entries | 21/21 pass | 21/21 pass |
| Concatenation case in full-file run | 10.864s | 0.185s |
| Full file wall time | 20.666s | 9.295s |
| Valid archive input bytes | 65,728 | 65,728 |
| Members / commands | 4 / 3 | 4 / 3 |
| Input chunks per valid command | 21,910 | 300 |
| Input chunks across three valid commands | 65,730 | 900 |

The new corruption controls add three rejected executions without dropping any
original tests or assertions. Every command still gets a new asynchronous
iterator. Whole-archive reconstruction proves unchanged input bytes; final
comparison confirms corruption controls do not mutate the valid archive.

Commands, run from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 tests/commands/bytes-stress/compression.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node tests/commands/bytes-stress/compression.test.ts
```

Full file and strict focused TypeScript checks pass. The original source outside
the concatenation test is byte-identical, including all other tests and fixture
helpers. All 59 snapshotted neighboring/current-shell files remain byte-identical.
No Git, raw/root ESLint, frozen checkout or historical capture was used.

Final test-file SHA-256:
`4132164bd77669e01cc47fc7f613e5d1e1944b13bbba7ec40341a5258f161cbd`.

These are local before/after measurements under varying host load, not a claim
that full CI or release targets have been achieved.
