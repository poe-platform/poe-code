# CORE two-source transport producer — presealed preparation proposal

## Current disposition

**PREPARATION READY FOR INDEPENDENT REVIEW. No producer or CORE execution GO.**
Six recipe/clock/shape groups pass in the second of two DATA/PURE helpers.
No compiler, build, pack, installation, product import, Worker or baseline
materialization occurs in this preparation. The executable producer is authored
and syntax-constructed, not executed or independently accepted.

ROOT's later coordination supplies private transport SOURCE/PURE acceptance
`f17d8dec11190ef40ecac6c175b208a2e29c7fbf` (16 replay + 10 novel groups).
`SOURCE-ACCEPTANCE-ADDENDUM.json` binds this update to the unchanged preseal and
composition. It supersedes the earlier ongoing-Hooke status text in those frozen
snapshots, without rewriting their bytes or rerunning their controls. The SOURCE
dependency for producer preparation is removed. Actual13/private T1 acceptance
remains pending; fresh producer review and ROOT producer GO remain required.

## Exact source selection

- Frozen CORE derived tree: `da4e1cc187022255521879b00db2ac77674f79d9`.
- Frozen producer: `439138a0e13595a41e84841f83e4f2f51b36ff68`; ROOT receipt `c9326e17`.
- Frozen complete package: `4f90df04dba998f184473254bb450f9e085b9fc9d5994dc91a21a7ccf1d1d66e`, 1002 shipping members.
- New derived composition: **`ff0c86a560da56b58437928c499ca7f5b9d25d70`**.
- Exactly 305 selected input paths: **303 byte-identical frozen inputs + two private overlays**.
- Overlay commit: `4abbdeec8e34de88ed2cf7bd32be9c06b413c631`.

| Only changed source | Stored blob | SHA256 |
| --- | --- | --- |
| src/commands/regex-execution/ere/transport/owner.ts | 7ca56c0bc512fabf0f7786bf7605fbc344290976 | 3be71f829880b141a07add2a22322787ad56a3e52c305c46fd46698cacc14098 |
| src/commands/regex-execution/ere/transport/root.ts | fb608736efd9aa63675521659f98b4b212d5b970 | 32ee1931ed070ba9b169a97d4ebbd705e77562884da5d6ecde5b529544d0f4cb |

`COMPOSITION.json` contains the individual path/mode/blob/size/SHA256/origin
manifest. One bounded Git batch authenticates all 305 original blobs and both
replacement blobs. Git tree bytes are reconstructed with Git directory ordering;
the old tree digest matches da4e and the new digest is recomputed, without
requiring either derived tree to be a stored object. The initial failed stored-
object probe is preserved in the direct capture, not treated as lost source.

No HEAD archive, public Node overlay, B35/K08/PIPE change, or baseline recompilation
is used. The preparation reads blobs as data and does not materialize them.

## Preseal and inherited writer acceptance

`PRESEAL.json` SHA256:
**`02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17`**.

The preseal binds the executable producer, recipe/guard, full composition and
baseline-data manifests, controls/results, layout recipe and distinct empty
user/global npm configs. This publication's commit additionally binds the later
SOURCE acceptance addendum and proposal. Source-status text in the preseal is a
historical snapshot, not a revocation of the addendum's acceptance.

V7 writer source: `e33b99af9fbec345b4f5a76d50f627c3d4d9f73a`; seal
`0efb8f129c77f02a119548f9308eca39ad70ca73c5fb548c1fa9918b757326f2`.
Writer acceptance: `e7b90371e8fc338d3a5faae10fcb7e36b3d36f44`, receipt
`fbc5797d8ee2c49a81ada006620f19a4f7ee6e3ec9cc8574b0f2f7da4a44fbcf`.
Its version-qualified 11 inherited controls + corrected C09 + eight inherited
novel groups remain qualified as before, not a newly rerun combined cohort.

## Exact tools and future producer commands

All commands below are **proposed, not authorized or executed now**. Run from
`/Users/kjopek/Workspace/safe-bash`; do not substitute PATH tools or HEAD sources.

| Tool | Exact path | SHA256 |
| --- | --- | --- |
| Node | /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node | 5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011 |
| Git | /usr/bin/git | 12bed4523661307059b879b9b54e77a73176e9d27d27a0e40363271d8f0668ba |
| tsc entry | /Users/kjopek/Workspace/safe-bash/node_modules/typescript/lib/tsc.js | 2cffde0b8c6760dfb0b5b0382bbb7e00ba6a8b2d981b9205b256a700a481d983 |
| tsc implementation | /Users/kjopek/Workspace/safe-bash/node_modules/typescript/lib/_tsc.js | e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419 |

The full pinned TypeScript inventory and full npm inventory are embedded under
`COMPOSITION.json.tools`, including npm root
`/Users/kjopek/.nvm/versions/node/v22.22.2/lib/node_modules/npm` and its
`bin/npm-cli.js`. Tool verification streams executable hashes; it does not dump
or copy the Node/Git executables.

For the exact output root `OWN/future-producer-v1`, `producer.mjs produce` plans:

1. `/usr/bin/git cat-file --batch` with stdin containing only the 305 selected
   blob IDs, then size/hash admission before fresh source writes.
2. Pinned Node with arguments `[pinned tsc.js, "-p", OUT/source/tsconfig.build.json,
   "--typeRoots", OUT/empty-types]`. It is one fresh clean candidate build; the
   old compiled manifest is comparison DATA, never rebuilt/materialized.
3. Pinned Node with arguments `[pinned npm/bin/npm-cli.js, "pack", "--offline",
   "--ignore-scripts", "--json", "--userconfig=" + OWN/user.npmrc,
   "--globalconfig=" + OWN/global.npmrc, "--pack-destination=" + OUT/package]`.

The compiler's empty type-root choice follows the existing pinned invocation
shape and still requires independent source review before producer GO. No
installation, lifecycle script, native oracle or product execution is proposed.
Environment is explicit: isolated HOME/TMPDIR/cache, C locale, UTC, pinned Node
PATH, offline/ignore-scripts, audit/fund disabled; npm user and global config
paths are different zero-byte files. Git ignores system/global configuration.

Outer invocation after independent review and fresh ROOT authorization:

```sh
cd /Users/kjopek/Workspace/safe-bash
OWN=/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-core-transport-rebind-20260829
NODE=/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
PRESEAL_SHA=02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17
"$NODE" "$OWN/producer.mjs" produce "$PRESEAL_SHA" "$ROOT_GRANT" "$ROOT_GRANT_SHA" "$OWN/future-producer-v1" >"$OWN/producer-go.stdout" 2>"$OWN/producer-go.stderr"
```

ROOT_GRANT and ROOT_GRANT_SHA must be actual newly supplied exact-path/hash
values, not placeholders accepted by the program. Required grant fields:
`action: PRODUCE-CORE-TWO-SOURCE-OVERLAY`, `presealSha256`, `composition`,
`outputRoot`, an actual independent producer-review commit, and
`transportSourceReview: f17d8dec11190ef40ecac6c175b208a2e29c7fbf`.
The producer checks the raw grant hash, preseal and all sealed file hashes before
fallible source/build work. Output root must be fresh, directly under OWN.

## Complete emit and archive barriers

`FULL-EMIT-DIFF.json` compares every old/new dist member, including JS, source
maps, declarations and declaration maps, and explicitly lists additions,
removals, changes and unchanged members. Counts are computed from actual emit;
two changed source files are not represented as two changed emit files.
Source rows are reauthenticated after compilation. Unexpected emit changes
require independent review rather than silently broadening source acceptance.

New shipping membership is computed from actual README/package/dist rows, not
assumed to remain 1002. After pack, archive bytes and a complete producer receipt
are made read-only; `FROZEN.json` publishes both exact hashes. **Produce stops
without decoding.** Only after that exact receipt/hash is frozen and reviewed
may a separately hash-authorized `decode-frozen` stage run:

```sh
"$NODE" "$OWN/producer.mjs" decode-frozen "$PRESEAL_SHA" "$DECODE_GRANT" "$DECODE_GRANT_SHA" "$OWN/future-producer-v1" "$FROZEN_RECEIPT_SHA" >"$OWN/decode-go.stdout" 2>"$OWN/decode-go.stderr"
```

The decode grant action is `DECODE-FROZEN-CORE-PRODUCER-ARCHIVE` and additionally
binds `frozenReceiptSha256`. The stage authenticates a bounded regular archive,
then decodes that **same Buffer**, with a 64 MiB output ceiling, validates tar
checksums/regular members/zero trailer and reconciles every shipping payload.
No old archive is decoded and no decoded file is installed or imported.

This executable is a source-review candidate, not yet a resource-qualified
producer owner. In particular, independent review must qualify the synchronous
child timeout/retirement behavior, complete live tool closure/drift checks, tar
dialect coverage and end-to-end outer capture/work ceilings before any GO.
Its finite recipe tests are not substitutes for those obligations.

## V8 guard and three-layout recipe

`core-guard-v8.mjs` is new code; old v7/v4 dispatchers and their 7,500,000 ms /
125-minute guard remain historical, untouched and unapproved.

The new clock uses one outermost monotonic origin and a **1,800,000 ms global
deadline**, with **180,000 ms reserved for publication**. Admission requires the
complete required next-case + cleanup + publication reservation to fit. It does
not reset per layout or cell. Every remaining declared cell is recorded UNRUN
when admission fails; there is no promise of completing 210 cells. Cleanup is
attempted after case failure; failure/uncertain cleanup stops further admission.

The clock/scheduler is an integration template, not an autonomous containment
mechanism: enrolled case/cleanup owners must enforce its absolute ticket
deadlines, and the outer owner must enforce the global deadline. An arbitrary
uncooperative callback is not made bounded by awaiting it. This integration is
explicitly required by `LAYOUT-RECIPE.json` before runtime qualification.

The recipe pins the unchanged **70 definitions / 210 declared cells**, original
test body and complete static instrumentation closure across fresh source-built,
installed and moved layouts. V7 cell/dispatcher/writer/finalizer bytes are bound;
all private assets and every generated binding/map/declaration must be checked
and recounted after materialization. The old 48-asset count is inherited context,
not a fresh closure assertion. Old roots remain immutable.

Future CORE limits remain 242 known OS starts / peak four, 309 Workers / one live,
128 MiB capture, 512 MiB logical work. `recipe.mjs` recomputes the conditional
332,129,069-byte baseline bound with new layout and archive byte sizes; Git
internal physical storage, allocated blocks and RSS are excluded. New bytes
cannot silently inherit the old bound. No actual CORE authority is granted.

## Preparation evidence and proposed producer envelope

`CONTROL-RESULT.json`: 6/6 PASS. Groups cover exact two-source selection and
foreign-change refusal; exact clock fit/UNRUN; clock regression/invalid values;
maps/declarations in full emit diffs; publication reserve/remainder; and bound
recalculation plus syntax construction. Producer/build/pack/product are all false.

Proposed future producer envelope (ROOT selection required): 900 seconds with
120 seconds publication; 20 known OS starts / peak three; 32 MiB capture and
192 MiB logical work; one clean build and one pack, zero installations/products.
This is separate from both today's preparation GO and the future CORE grant.

Today's preparation starts 2026-08-29T15:22:59Z with deadline 15:37:59Z, including
publication. Exactly two DATA/PURE helpers run serially. No live helper overlaps
a patch/metadata command. Conservative maximum known hierarchy is shell + Node
DATA helper + one Git child = three. The first shell establishes direct raw
capture before external children; the CLI tool transcript also retains patch
outputs. Publication-inclusive known roles are 31: nine shells, twelve Git,
two clock reads, four patch roles, two Node helpers, one receipt-hash role and
one explicit-file byte census. Counts are invocation-local known roles, not a
universal transitive OS census. Captures and owned files remain within 48 MiB /
192 MiB; the publication command reports actual logical file-byte totals.

`PRIOR-STATE.md` records B35 finite DATA acceptance plus peak 4/3 HOLD unchanged.
No B35 replay is performed. All files in this publication are within the newly
owned preparation directory; foreign staging is preserved by explicit-path
atomic commit. Independent producer/guard review and fresh ROOT producer GO
are the next actions, not compilation under this preparation authorization.
