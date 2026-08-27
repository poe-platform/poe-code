# Independent column handoff: HOLD

**Decision: HOLD for unconditional Shell cleanup acceptance. Column source work
is stopped.** Two legitimate column-local defects are fixed and verified. The
remaining hidden external-stdin return boundary belongs to Root; it is reproduced
in both the isolated candidate and the physically moved offline package. No
shared/runtime, root export, default aggregate or package change is made here.

## Frozen candidates and provenance

| Identity | Value |
| --- | --- |
| Immutable preparation | `46e90c80` — seven original files unchanged |
| Author candidate | `e090f29d9eb1aaf52eba08b2c2bf0aae53b9fb64` |
| Author five-file column digest | `62fa56a685eb5a4850b6fa782266a2f5d21b8c9335f4f0f030f4f5767e1bfdb2` |
| Author Git archive SHA-256 | `232fa2fb4fcf17c91ad1cc9905892cc9866589a5b94e2d5245c0d1e84624b7b2` |
| Source/regression/baseline-evidence commit | `38cb670acf0826467e928ea30cdcb0524436d144` |
| Fixed five-file column digest | `06a48bca73584c719bad2fa5db1e447e87c63f900e5dc715c80244701d125a75` |
| Fixed Git archive SHA-256 | `a55b09755293e068ebe2be121c5dfc762c21adbb696e8e11abe91aa539243129` |
| Packed tgz SHA-256 | `b8b17b6d9dedbf91fa63e89782335c324cda5b8f985a13328b991a4f170baa84` |
| Moved package file-inventory digest | `fb93b341dd4b6f1418a675b0fb9993e17ed9048b8283e19a612e73725ee0344d` |

The five-file digest uses the author's ordered path/SHA-256 object algorithm.
Per-file hashes, root/internal entry hashes, compiler identity, package manifest,
declaration inventory and dependency inventories are recorded in the JSON evidence.
`MANIFEST.json` authenticates the evidence files; its enclosing evidence commit
authenticates the manifest itself. These are immutable-candidate claims, not claims
about a later live HEAD.

Both archives were regular isolated directories, never live-source symlinks or
synthetic cherry-picked product trees. All **25,348** author Git blobs and all
**25,490** fixed-candidate Git blobs match their respective commits before/after
execution. Original tar hashes and locked-development-tool inventories are stable.
The post-fix commit also contains intervening owners' committed changes to
`src/commands/grep-aliases/index.ts`, `src/commands/text.ts` and
`src/shell/runtime.ts`. Those files were not edited here. Their exact frozen hashes
are retained; the two whole candidates must not be described as differing only by
the column fix. Unrelated live edits never enter either execution archive.

Read-only locked tools: Node **22.22.2**, TypeScript **5.9.3**, tsx **4.23.12**,
esbuild **0.28.2**, the locked Darwin esbuild package, `@types/node` **22.20.1**,
`undici-types` **6.21.0**, and optional `fsevents` **2.3.3**. Installed versions and
integrity declarations match the frozen lock, and reused files are hashed. No fresh
registry/signature authentication, installation or product dependency is claimed.
The recorded verification window starts with authentication at
**2026-08-27 14:39:59 UTC**; later capture timestamps are in the evidence. Initial
inspection and final reporting lie outside that first marker. This is actual
bounded work, not a claim to 72 hours or full project completion.

## Counts: separate, overlapping cohorts

| Cohort | Author archive | Fixed archive |
| --- | --- | --- |
| Unchanged author tests | 113 pass / 113 | 113 pass / 113 |
| New canonical regressions | 0 pass, 6 fail / 6 | 6 pass / 6 |
| Original recipe-associated checks, corrected harness | 79 pass, 5 fail / 84 | 81 pass, 3 fail / 84 |
| Supplemental checks | 0 pass, 1 fail / 1 (X01 only) | 4 pass / 4 |
| Execution total, corrected harness | 79 pass, 6 fail / 85 | 85 pass, 3 fail / 88 |
| Top-level frozen recipes, corrected harness | 36 pass, 4 fail / 40 | 37 pass, 3 failing assertions / 40 |
| Moved packed runtime probes | Not performed on author archive | 5 pass, 1 Root failure / 6 |

The fixed **40-recipe partition** is: **37 passing**, **2 documented native/profile
qualifications (N01, N03)**, **1 Root-blocked recipe (S38)**. The raw test result
remains **37/40 green**, not 40/40. N01/N03 expected bytes and failed assertions
are unchanged: native adds padding for absent trailing fields, while the existing
product profile forbids padding after a row's last actual cell. This is not an
excuse for the genuine context/cancellation defects, whose six original failures
remain in baseline evidence.

The original 40 recipe inputs, 28 native recipe groups and 88 native captures are
byte-identical to preparation. The execution harness has disclosed corrections
and added supplemental probes; this is not an unchanged-all-harness-inputs claim.
`HISTORY.md` preserves middleware/cleanup-observer harness defects and the original
unhandled rejection caused by the observer. The final stress run has **zero
observed unhandled rejections**. Canonical regressions, recipe checks and packed
probes overlap; **do not add their denominators into a unique-test total**.

### Raw native profile comparison

| Frozen native profile | Exact stdout bytes + stderr bytes + status | Different | Denominator |
| --- | ---: | ---: | ---: |
| Darwin BSD `/usr/bin/column` | 12 | 32 | 44 literal variants |
| util-linux 2.41.2 built on Darwin | 18 | 26 | 44 literal variants |

Every raw comparison remains present, including unsupported native options, native
zero statuses with error diagnostics, partial-line errors, separator differences,
strict UTF-8/control differences and shared-stdin behavior. Neither profile is GNU
column or a GNU/Linux host profile. There are no new native invocations in this
phase, no normalization of failures, no native parity/superiority claim, no old
comparator/performance rerun and no whole-repository gate. Historical whole-gate
counts do not certify this candidate.

## What changed in column

- `internal.ts`: replace lossy object spread with a local forwarding context that
  keeps inherited/nonenumerable properties, original accessor receivers and
  caller-owned arrays/maps. Only owned FS/stdin/signal are replaced. Frozen inputs
  work; caller objects are not mutated. No new regexp or dependency is introduced.
- `column.ts`: recheck the caller's exact signal after cooperative cleanup settles,
  including cleanup rejection after an earlier handled input-budget error. Direct
  contexts with/without registerCleanup now preserve late abort identity.

The canonical six regressions reproduce the failures against the unchanged author
archive and pass against the committed fix. Source edits are limited to these two
files, with no author-test/fixture modifications. Source is closed after this handoff.

## Actual runtime and limits coverage

The frozen recipes exercise cumulative input/rows/cells/fields/files/argv/work/output,
record/chunk byte boundaries, explicit empties, custom separators, fill remainders,
tabs, partial records, multiple operands, repeated stdin, missing files, strict
UTF-8, combining/CJK/emoji/control handling and producer reuse. Async sink gates,
late read/write/return failures, caller abort identities, pending stat/fallback
readFile rejection, closed admission and overlapping owned cleanup are recorded.
Actual Shell pipelines, literal nested invoke, middleware, exact replacement env,
VFS redirection bytes, collision preflight and intentional replacement are exercised
without installing the agent aggregate.

The billion-wide S33 literal cannot be admitted because its requested configured
bound exceeds the documented 67,108,864 ceiling; its bounded factory refusal is
recorded, **not** advertised as huge-allocation runtime proof. A separate admitted
512-wide table probe verifies the oversized 511-space padding is refused before
`String.repeat` is called. This is bounded allocation-order evidence, not RSS or
performance certification. S39 distinguishes an opaque delayed stat/read promise
from a cooperatively owned VFS iterator; only the latter supplies the mandatory
retirement barrier. No profile permits ignoring an acquired cooperative return.

## API, defaults and text profile

The internal module exports `columnCommands`, `createColumnCommand`,
`createColumnCommands`, `ColumnCommandsOptions` and `ColumnLimits`. Options remain
`replace?: boolean` and `limits?: Partial<ColumnLimits>`, snapshotted at creation.
Root export and `virtual-bash/commands/column` are intentionally absent.

| Bound | Default |
| --- | ---: |
| `maxInputBytes` | 8,388,608 |
| `maxOutputBytes` | 16,777,216 |
| `maxDiagnosticBytes` | 65,536 |
| `maxRecordBytes` / `maxChunkBytes` | 65,536 / 1,048,576 |
| `maxRows` / `maxCells` | 50,000 / 250,000 |
| `maxFields` / `maxFiles` | 1,024 / 64 |
| `maxSteps` / `maxArgumentBytes` | 4,000,000 / 65,536 |
| `maxWidth` | 65,536 |

All configured bounds are positive safe integers capped at 67,108,864. Fill width
defaults to 80, reduced if maxWidth is lower. Table width is not truncation.
Supported: `-t`, `-s`, `-o`, `-c`, `-x`, documented long aliases, `-h`/`--help`,
clustered/attached options, `--`, shared `-`. Empty explicit fields are retained;
default ASCII whitespace runs collapse. No sorting occurs. Fill uses actual TAB
padding; retained tabs expand at cell-relative eight-column stops. Records do not
merge across file boundaries. Missing opens continue with status 1; fatal input
errors precede layout publication; later rendering/sink limits may leave a prefix.

Strict UTF-8 rejects malformed/incomplete sequences, NUL and retained forbidden
controls/BOM. The README's fixed scalar-width v1 ranges apply: selected combining
ranges have width zero, selected CJK/emoji ranges width two, other permitted scalars
width one. ZWJ is rejected. This is not a grapheme, locale, wcwidth or terminal
guarantee. The frozen README hash authenticates the exact ranges; no range set is
silently broadened to match a native oracle.

Unsupported features remain explicit failures: JSON, headers/named columns,
selection/reordering, tree mode, wrapping/truncation, ANSI/color interpretation,
keep-empty-lines, `-S`/`--use-spaces`, version, legacy `--columns`, zero/unlimited
width and other unlisted options. `-s`/`-o` require table mode; `-x` cannot combine
with table mode. No network capability is enabled and no implicit host FS is used.

## Isolated build, strict types and moved package

- Production `tsc -p tsconfig.build.json` succeeds in each authenticated archive.
- Strict NodeNext author-scoped tests/helpers plus the new regression source pass.
  Exact flags and files are captured; this is not `typecheck:all` or every historical
  TypeScript fixture/consumer.
- `npm pack --offline --ignore-scripts` uses the actual fixed build and unchanged
  package manifest. npm 10.9.7 produces a 644,039-byte tgz, 734 entries, 3,573,692
  unpacked bytes. The original extraction is physically renamed to
  `moved/node_modules/virtual-bash`; the old extraction no longer exists.
- Runtime executes under an OS sandbox denying all network and reads of the live
  repository, both source archives and old extraction. NODE_PATH/NODE_OPTIONS are
  cleared. No workspace dependency fallback, package install or live source alias
  is used. The package has zero runtime dependencies and no symlink entries.
- Runtime imports public root Shell and an actual **packed internal column file
  URL**. Both the absent root column export and absent public column subpath are
  checked. This is not public column-subpath acceptance.
- The moved standalone `.mts` consumer passes strict NodeNext checking, including
  a second trace-resolution run with library checking enabled. Root and internal
  declarations resolve to this moved package. It is a standalone consumer input,
  not a repo-local module with the same relative resolution environment. Shared
  maintained-consumer inventory is read-only; no all-inventory claim is made.
- The moved package inventory is byte-identical before/after runtime. The six probes
  retain the Root failure; the five positive probes include standalone plugin,
  collision/replace, pipeline/VFS effects, owned cancellation barriers and both fixes.

Retained artifact:
`/tmp/safe-bash-column-verify-yttMz8/pack-output/virtual-bash-0.0.0.tgz`.
Moved runtime:
`/tmp/safe-bash-column-verify-yttMz8/moved/node_modules/virtual-bash`.

## Root minimal handoff

`src/shell/input.ts` exposes ShellInput's iterator with `next()` and no `return()`.
Column cannot acquire/await the hidden external source's return. With an external
source producing `a b\n` and column maxInputBytes=1, its return is called once but
**exec and dispose both settle before that return gate is released**. The same
experiment with column-owned VFS input keeps both public operations pending until
retirement. This distinction is recorded, not changed into an all-cleanup pass.

Minimal bounded reproduction:

```sh
node tests/commands/column-stress/handoff-20260827/run-command.mjs \
  /tmp/new-root-command.json /tmp 10000 node \
  /Users/kjopek/Workspace/safe-bash/tests/commands/column-stress/handoff-20260827/root-hidden-return-repro.mjs \
  /tmp/safe-bash-column-verify-yttMz8/moved/node_modules/virtual-bash \
  /tmp/new-root-result.json
```

The reproduction exits nonzero with `HOLD`; gates are released only after the
failing observation. Root owns any ShellInput/runtime ownership fix and later
root/subpath/default integration. Do not conceal this acceptance failure by changing
the expected barrier or substituting a direct-context stub.

## Cleanup and stop

All owned child commands were bounded and reached close without timeout, output-cap
kill or spawn failure. Their process groups are retired. Controlled source/sink/
return gates are released in finally and actual exec/dispose is awaited; releasing
a gate after a failed observation is not labeled a cleanup pass. Isolated archives,
native preparation artifacts and the moved package are retained for reproduction.
No ongoing process, indefinite wait, full gate, performance run or source work is
left running. `verify-evidence.mjs` checks static evidence consistency only and does
not turn the recorded runtime HOLD into GO.
