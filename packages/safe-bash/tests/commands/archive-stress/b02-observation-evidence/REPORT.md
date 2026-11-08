# READY — B02 fixture-only observation correction

August 27, 2026. No staging or commit. This is a separate intentional test
integration change, NOT part of the PAX production fix. The different verifier
still owns the full current177-case rerun; historical176/177 remains unchanged.

## Exact delta

`tests/commands/archive-stress/limits-effects.test.ts:81` saves the original
unbound `writeStream` reference separately from the bound forwarding callable.
The counting wrapper stays installed throughout execution and ALL existing
status, pull, return and publication assertions. Only inside the post-operation
`over` stat observation is the original reference restored. Full-stat equality
is added before byte reads; scope/dev/ino, bytes, namespace and sentinel
assertions remain. No expectation of undefined, skipped vector or assertion
deletion. No FS, compareEntry, PAX source/native/targeted-test change.

The no-tar diagnosis is retained from `/tmp/safe-bash-pax-b02-review-detail.txt`:
under the pinned frozen memory implementation, changing the method reference
alone suppresses exposed identity before tar runs. Restoring that reference
reveals the same backing identity and full metadata. The correction compares
the same backing entry through the same observation surface, without bypassing
publication counting. This is solely an archive no-publication fixture
correction, not a defense or revision of host transport/FS identity policy.

## Focused evidence

`recheck.json:1` records successful no-tar control, **B02 1/1**, and scoped
archive TypeScript exit0. No skips, cancellations or TODOs. B02 still exercises:

- 67,108,864-byte declaration: two pulls, one return, one publication attempt;
  exit2 on the deliberate body-read failure and exactly empty retained content.
- 67,108,865-byte declaration: one pull, one return, zero publications; exit2
  for entry limit, exact original full stat/identity and old bytes retained.

This is not a completed64MiB extraction or new memory/rollback claim. Existing
mode, time, scope/device/inode and every other FileStat field are compared
exactly before proof reads can change atime. No clock-derived expectation.
The independent no-tar control compares real scope references, not symbol text.

`evidence.json:1` preserves the first attempt: no-tar and B02 passed, scoped
types failed TS2688 because an external temporary config lacked a Node type-root
search path. The runner correction explicitly selects the frozen
`node_modules/@types`, retaining all strict options and19 scoped TS inputs.
The second attempt passes. This was a harness-resolution correction, not a
product/source/type expectation change. Do not sum the two B02 executions.

## Frozen provenance and reproduction

Retained reviewer root: `/private/tmp/safe-bash-pax-independent-YKSbHc/tree`.
Recorded dirty-source HEAD: `cd8b5c8025e9d40ba71594f7b709a42f5249988d`.
Reviewer input seal: `3144d0d90d695e021f6bd279c34ef31c49cd49c567d5b29c80c7acae7346f261`.
No claim of current moving-source or clean committed-HEAD validation.

The runner verifies all1,629 original frozen input files against the reviewer's
recorded copied hashes, including generated tool shims. They remain regular,
single-link and unchanged before/after. This check's ordered path/size/SHA digest:
`ff70233eeb538442add987577203ae48b6bc0ee148a629bb3686117ac238b6a0`.
Its different manifest shape is NOT the reviewer's original seal hash.

No engine, snapshot or dependencies were recopied. A uniquely named regular
test overlay was temporarily added alongside the frozen test, preserving the
same relative imports. The original frozen test stayed unchanged. The explicit
scoped configuration replaces only that original test path with the overlay;
runtime and types resolve to the existing frozen files, not moving source.
Both own overlays/control/config temporary directories were removed afterward.
Snapshot retained; original frozen input hashes match exactly.

Actual successful command:

```sh
node tests/commands/archive-stress/b02-observation-evidence/run.mjs /private/tmp/safe-bash-pax-independent-YKSbHc/tree memory-intact-57a6148 recheck.json
```

For reproduction, use a NEW output basename (existing files are protected by
exclusive writes). The explicit profile pins frozen memory hash
`57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad`, original
fixture hash `b7962d85dd8362b5da7f4df5839fb6e7b1f9cbd19295607252717a4e7018f2ae`
and approved patched fixture hash below. It fails rather than following newly
changed product/fixture expectations. The recorded verifier evidence JSON is
also pinned: `6273a1e84302b08153b83131c0e7b24a66fb7d6f8adf7c64e61cdba4b787eb1b`.

Successful run02:29:42.224–02:29:43.984Z. Node22.22.2 and existing frozen tsx/TS;
no install/network/native extraction. Command limits: no-tar10s, B02 subprocess
20s/test10s, scoped types60s, output1MiB, overall120s watchdog. All three process
groups reported absent; no timeout or output overflow. Own temporary paths were
freshly confirmed absent. No other children or fixtures were stopped/removed.

## Immutable evidence and exact review paths

All167 existing PAX manifest entries were rehashed before/after, unchanged.
Manifest itself remains SHA256
`269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f`.
The original176/177 failure remains untouched at
`tests/commands/archive-stress/pax-independent/runs/run-0N6uc7/profile-refactored-stress30/stdout.log:129`,
SHA256 `f3ea27f023c79ef47bd89e7973eaafafafea8af23f29123bae19e2d74478f465`.
Scoped whitespace check passes. No global build/types or full177 rerun here.

Only these six paths belong in the eventual separately approved fixture commit:

| Path | SHA256 |
| --- | --- |
| `tests/commands/archive-stress/limits-effects.test.ts` | `7bedea0eddefcf40feb216fe41a600d2af429ff10813ed8a64df2e2d63329efe` |
| `tests/commands/archive-stress/b02-observation-evidence/control.mjs` | `33d23e73ab9bd99d38058adb802a2e8b002f2aeb587beac323149f3ab0598d23` |
| `tests/commands/archive-stress/b02-observation-evidence/run.mjs` | `fc0df1eccec04a76fd873431dfd0bd349e236580369db5221405c15c7ad25322` |
| `tests/commands/archive-stress/b02-observation-evidence/evidence.json` | `39bca153ea4498750f955b27e10400b72efce06991a752600564ee697382b45f` |
| `tests/commands/archive-stress/b02-observation-evidence/recheck.json` | `73ebfc2e182f453e59ce9127c5245964d33e9a085f6c93a66bdae0e5db4982b8` |
| `tests/commands/archive-stress/b02-observation-evidence/REPORT.md` | Self-hash supplied with the READY handoff after this file is written. |

There are exactly five small evidence files, not vendored runtime/source copies.
All unrelated index/work and the original PAX patch are left untouched. Root
approval and independent review remain prerequisites for any commit.
