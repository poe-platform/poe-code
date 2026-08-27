# Independent acceptance: exactly two canonical fraction migrations

**ACCEPT** test-only candidate
`f5341340bcbc9e4c4d46d6eb3f1759da73713097` for the previously accepted,
qualified fraction source/policy. This closes the bounded canonical-fixture
prerequisite only; it does not accept Curie's future65-to68 integration freeze.

Independent reviewer: `01a0426e-7ffc-75e2-97a7-2c875e1a0afb`.
Migration author: `01a0427f-0535-7e03-83e8-eac693a4d417`.
This reviewer is neither the migration author nor Curie. No delegation.
Only this new `canonical-review/` directory is owned; every other repository
file, including this reviewer's previous semantics evidence, stayed read-only.

## Exact diff and assertions

- Candidate `date.test.ts` SHA256:
  `91065b8d1b9e7cf08e34fb40d44e4307286040ba11ce14ae13c1ec8c015c8b67`.
- Exact commit diff SHA256:
  `bd1f5a6270e7c96e6c2a9f8cad0c254bb8619957117920634f0ee486d2518e07`.
- The commit has one existing-file modification, `date.test.ts`, and15 new
  author evidence files. No source, other fixture, config, manifest, dependency,
  runtime, oracle or root-export modification is present.
- Removing the two new positive test blocks and removing only the two old
  rejection-list entries from the original produces byte-identical remaining
  files. There are no other input, expectation, name, skip, TODO or waiver changes.

| Unchanged argv | Exit | Exact stdout | stdout hex | stderr |
|---|---:|---|---|---|
| `['-d@0', '+%12N']` |0|`000000000000\n`|`3030303030303030303030300a`|empty bytes|
| `['-d@0', '+%-N']` |0|`0\n`|`300a`|empty bytes|

Both positives assert status, stdout text and raw-byte-derived hex. Each captures
actual stderr chunks with `bytes.slice()` and asserts the concatenated bytes
equal an empty buffer. The helper's `result.stderr` alone would not prove this
when its stderr sink is overridden; the independent raw sink checks do.

Bare `%-N` remains **virtual-clock ordinary formatting, NOT strict GNU9.7/Darwin
bare parity**. The previously frozen exact three native witnesses are unchanged:
native `%12N` gives twelve zeros/LF; exact native `%-N` gives six zeros/LF;
ordinary native `%--N` gives `0\n`. There was no fresh native-profile expansion.
The original native bare mismatch and five ICU label mismatches are not waived.
The overbroad `%g` rationale remains routed to Curie; no source/doc fix here.

## Independent run, not an author marker

The complete committed archive of
`c7823633ee99f711f1319ace59d4cf2b7f622ecc` is913,039,360 bytes,14,482 paths,
SHA256 `4ba2f44723111446087b45a56269492492b34fa88df21b007a50aabf38e21530`.
Every archived tracked path was hashed before and after. All216 product-source,
package/config files were also checked against their committed `git show` bytes.
The **only tracked archive overlay/delta is `date.test.ts` from f534134**.

The whole unchanged six-file223 cohort is:
`date.test.ts`, `integration.test.ts`, `native.test.ts`, `printenv.test.ts`,
`sleep.test.ts`, `stress.test.ts`. Its other fixtures, helper, vectors and scoped
typeconfig match the original `d904ca9` bytes. Existing development tools and
three native executables were copied as regular untracked prerequisites only,
authenticated against the author profile before the run. No install or build.

Profile: Node22.22.2, Darwin, `LC_ALL=C`, `LANG=C`, `TZ=Pacific/Honolulu`,
`PATH=/usr/bin:/bin`, `TSX_DISABLE_CACHE=1`, owned external HOME/TMPDIR.
The exact author runtime argv is retained except one independent guard preload;
test concurrency1 and per-test30-second timeout are unchanged. Both commands
have strict120-second process deadlines and16MiB combined-output limits.
The pinned, inspected supervisor rejects any timeout, cleanup signal or survivor
as acceptance; it did not rescue either run.

An independently authored synchronous import guard checks source/prerequisite
SHA256 at resolution and loading and rejects outside-archive/symlink imports.
`runtime-imports.jsonl` records983 events, including actual loads of all six
test files, the immutable helper, date/calendar/formatter source, and six
successful outside-archive negative controls. No live product source was loaded.

| Independent check | Result |
|---|---|
| Whole affected cohort | **223/223 pass**,0 fail/cancelled/skipped/TODO; exit0 |
| Unchanged scoped typecheck | **PASS**, exit0, empty stdout/stderr |
| Source/full-archive guard | Only the exact authorized date-test overlay |
| Read-only repository guard |665 protected source/config/fixture/history paths unchanged |
| Process cleanup | No timeout, output overrun, signals or survivors |

The test process ran once (2,903ms supervised); scoped types ran once (884ms).
The recorded archive/replay/cleanup interval is2026-08-27T09:29:20.003Z through
09:29:41.641Z. There was no per-case retry, expectation relaxation, mutation
expansion, global typecheck, packed replay, SafeJS work or integration change.
Raw TAP and both command result records are retained. The exact scoped command:

```sh
node node_modules/typescript/bin/tsc -p tests/commands/time-env/tsconfig.json --noEmit
```

Owned scratch was removed. Despite the cache-disable setting, any observed
external TSX cache entries were removed only after matching the unique owned
archive source identity, inode and hash; no foreign cache deletion occurred.

## Historical profiles are not rewritten

- Original immutable223 on c782363 remains **221 pass /2 obsolete rejection
  failures**, as independently captured at packed review `61c66bc`.
- Migration author's **223/223** at f534134 is a separate author run; this
  review independently observes223/223 with authenticated equivalent profile.
- Previous independent semantics312 remains **301 pass /11 harness failures**
  plus its terminal environment-prototype assertion failure. The six
  throw-vs-Shell and five omitted-`or time` failures are not promoted to passes.
  That run and its evidence were not rerun, edited or resealed here.
- Original305/304/83 and other native/packed histories remain separate immutable
  evidence; this review adds no pass count to those cohorts.

`REFERENCES.json` authenticates the prior native witnesses and original223,
author223 and prior312 raw records at their respective commits.

## Seal and reproduction

`FREEZE.json` predates the two commands and records all inputs/profile details.
`RESULTS.json`, `runtime-imports.jsonl`, `canonical223.*` and `scoped-types.*`
contain this review's own measurements. `MANIFEST.json` seals only owned files.

```sh
node tests/commands/time-env-stress/fraction-independent/canonical-review/seal.mjs --check
```

This checks recorded evidence without rerunning product tests. A fresh replay
requires a separately owned empty evidence directory with this relative repo
layout; `review.mjs` uses exclusive artifact creation so this original cannot
be silently overwritten. No GNU/Linux, overall GNU date parity, current full
gate, default68 integration, or product-completion claim is made.
