# Fixture v2 author handoff — independent review WAITING

**Public/default/independent integration acceptance remains HOLD.** This is the
fixture AUTHOR's package, not an independent verdict. Root must route a different
reviewer to the exact delta and actual replay before all-green acceptance.

## Observed results

Fixture-only commit: `8e5fec07ec9a39582987736269bbed51caeb795e`, committed before
execution. Actual replay: **2026-08-27 16:29:27.475Z–16:29:44.248Z**, Darwin arm64,
Node v22.22.2. No rerun, repair-after-failure or rebaseline was needed.

| Separate cohort | Actual result |
| --- | --- |
| Authorized v2 provisional-derived cases | **35/35**, 35 child executions, status 0 |
| Authorized v2 column supplement | **6/6**, one child execution, status 0 |
| Wrong-primary diagnostic assertion controls | **2/2 detected**, two children status 1 |
| Wrong-column-code assertion control | **6/6 rows failed as intended**, one child status 1 |

Negative assertions total **three executions/eight rows**, not product-source
mutants and not positive passes. They are separate from the **four historical
negative-control executions**, which were not rerun. All **39** new children
closed; exact recorded-PID checks found zero remaining processes. Watchdog
expiries and output-limit waivers: zero. No server/network handles were created.

## Exact authorized changes

`DELTA.diff` is the complete positive fixture delta from the frozen originals:
only the two READ rows now require fulfilled exitCode 1 and empty output rather
than secondary-close rejection, and only the column literal adds the exact
`EFBIG: column` text. The two shared READ descriptions alone change in
`cases.mjs`; loader bytes are identical. No inputs or identities change.

The READ rows retain exact `shell: line 1: 0\n` and
`shell: line 1: independent-primary-failure\n` diagnostics, one read, one return,
serialized reads and no output. Caller, selected-error, direct-primary and sink
checks are untouched. Column retains every other assertion, including direct
status 1 versus Shell rejection with the identical return reason, zero output,
one read and one return. Its inherited report label remains unchanged on purpose.

`NEGATIVE.diff` changes only expectations. Both wrong-primary rows fail at
`probe-wrong-primary.mjs:125` because the deliberately expected secondary-return
diagnostic differs from the actual primary diagnostic. All six wrong-column rows
fail at `column-wrong-code.mjs:33`: actual EFBIG versus deliberately expected EIO.
Raw failure messages/stacks, statuses, identities and effects are retained. These
are actual relevant assertions, not import/setup failures.

## Artifact authentication

Product: `f8819e9d6b6d535b0626e0aa004bb10a7bc36785`; author evidence:
`87dced967d3a55611fa1d05d6d1df25514c83622`. Same prior built/npm-packed/MOVED
package, copied to a fresh owned consumer and moved again before execution:

- Source archive SHA256: `dfa06095b546379bbd11054a95ceabf60884e3738b84e2b2de0a87cd8e0118bf`.
- npm tarball SHA256: `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6`.
- Input TS SHA256: `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32`.
- Actually loaded input JS SHA256: `f8b984b6fc338ff3d1ca60e10283ab100d8e62a697f4b7f8e691819c28ea7c4a`.

The prior full authentication is Git-bound to `d9a58cdc1d4fee159e21c76c708267628767bbf4`
at `../candidate-review/evidence/replay/authentication.json`, SHA256
`2b8db1a8be77cb98c555f33ec7d7e4410295b20505b0887197f2c68e73a674d9`.
It is referenced rather than duplicating historical inventories/logs. All 1,317
source/build/tool entries and 787 prior-consumer entries match before/after;
228 archived source files also match exact candidate Git blobs. The new complete
786-entry consumer inventory is captured. Checks compare full directory/file
types, modes, sizes and hashes, **including new entries**, not merely preexisting
paths. All **6,874** loaded-module receipts are byte-bound to that inventory.

No product rebuild/repack, baseline replay, live HEAD/dist loading, product/source
edit, old-consumer/evidence modification, native/performance/regex probe, external
network/server, dependency/config/barrel change or foreign-work cleanup occurred.
Concurrent live source edits do not enter this frozen artifact. Column still uses
a packed internal factory; this does not establish exported-family acceptance.

## Historical cohorts remain immutable

Original32 `0ec75ef3`: baseline **18/32**, candidate **24/32**. Provisional35
`92f76262`: baseline **25/35**, candidate **33/35**. Prior column `79f0f917`:
**0/6**. Original author34/nine fixed observations are preserved; falsy **5/5**
at `bdb49bb1` remains separate. Main candidate adapter `dc8e362b` and all earlier
reports/seals are unchanged. V2 does not relabel historical failures as passes.

## Reproduce and review

From the repository, use a fresh, unused output path and the exact fixture commit:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict \
  tests/integration/shared-external-stdin-independent-20260827/fixture-v2/run.mjs \
  /tmp/shared-stdin-fixture-v2-review-01 \
  8e5fec07ec9a39582987736269bbed51caeb795e
```

This opt-in runner never rewrites committed evidence. It requires the prior inert
artifact at `/private/tmp/shared-stdin-independent-candidate-work-1dpIJX`; if
missing or altered, stop/report rather than rebuild. The captured author consumer
is `/private/tmp/shared-stdin-fixture-v2-work-ys9tnY/moved-consumer`; author output
is `/tmp/shared-stdin-fixture-v2-replay-20260827-author-01`.

Review `FREEZE.json`, `DELTA.diff`, `NEGATIVE.diff`, `SEAL.json`, then
`evidence/authentication.json`, `evidence/cohorts.json`, raw per-case JSON and load
receipts, `evidence/commands.json`, `evidence/integrity-after.json` and
`evidence/closure-check.json`. The seal binds 85 exact capture files, including the
pre-execution frozen marker. Author integrity/whitespace checks are not independent
acceptance. Frozen inputs and actual evidence are separate commits. Reviewer WAITING.
