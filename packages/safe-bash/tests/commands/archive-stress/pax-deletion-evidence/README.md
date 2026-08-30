# PAX deletion author evidence (2026-08-27)

This is bounded **author validation**, not the different leaf's final acceptance,
global typecheck or build. No source/test commit is authorized yet. The user
approved one legacy expectation correction; no other old177 oracle changes.

## Policy and provenance

Empty supported PAX values remain explicit tombstones. Local state is consumed
by the next real member, including excluded members. Global state persists per
keyword; unrelated global records do not clear it. Last duplicates and later
reintroduction win. A tombstone never exposes raw USTAR or GNU L/K fallback.
Checksums/envelopes and extension physical lengths remain checked. Only selected
raw semantic fields are decoded. Unknown/critical layout keys and BINARY charset
records remain rejected even when empty or shadowed; optional vendor policy is
unchanged, with no metadata-restoration promise.

Missing path, size or a required link target fails before that member's effects.
Deleted non-link targets require no substitute. The implementation also rejects
deleted size on zero-data types: a conservative framing restriction, not a POSIX
universal error mandate. Root should explicitly review this small policy choice;
it does not infer zero from deleted raw bytes or add linkdata/new types.
Deleted UID/GID/mtime display as `-`. No ownership lookup/restoration is added.
Deleted mtime is not restored. Absent atime retains the existing mtime fallback;
explicitly deleted atime suppresses it. Mixed restoration uses fresh post-write,
post-chmod stat for the other paired-utimes field, propagating errors/cancellation.
This is non-atomic and not a pathname/identity lease. Existing-directory state,
earlier publications and partial writes are not rolled back. Default64MiB member
and configured limits, actual hardlinks, capability checks, advisory permissions
and the existing AppleDouble presentation profile remain qualified as before.

Primary investigator report consumed BEFORE handoff:
`/tmp/safe-bash-pax-deletion-research-detail.txt`, SHA256
`f45b65178bddf4f63c970dd0bac4a02067b9e6fc3d33afa9b8518f87d30808b2`.
Official captures and retrieval manifest remain in
`/tmp/safe-bash-pax-deletion-sources/`; no web/native research was repeated here.

- POSIX.1-2024 Issue8 pax:
  `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html`
  sections `tag_20_94_04`, `tag_20_94_13_02`, `tag_20_94_13_03`,
  `tag_20_94_13_04`, `tag_20_94_13_06` (preservation, scope, deletion, precedence,
  effective fields/type layout). Body SHA256
  `398b008eab3110cd482eee2e62797adaf915405e488b1f36bc73fc2a29591efb`.
- GNU tar1.35 official source/manual commit
  `e545d446dfe6564265cdf4186641ee76f4acc7fa`, `doc/tar.texi` and
  `src/xheader.c`, captured from `https://cgit.git.savannah.gnu.org/cgit/tar.git/`.
  CLI `delete=keyword` filtering is not archive empty-value deletion.
- The investigator's eight new native vectors (17 reader/configuration pairs,
  34 behavior calls plus2 version calls) are profile counterevidence, not twelve
  product expectations. GNU empty-time errors/whole-global replacement and BSD
  epoch/global-time behavior are not copied as normative defaults. Native JSON:
  `/tmp/safe-bash-pax-deletion-native-evidence.json`, SHA256
  `bc055d5449cc943a9283c8f3b40fd8a19ca2803b3c2d14bc171e30b08f2ac82e`.

## Exact oracle preservation and author results

`options.original.ts.txt` is the exact pre-change options test, non-auto-test
extension, SHA256 `34e3aa6ac71cc7078371502255c7880994ef0644ecf00dc8da351e785532d66f`.
Original line108 requires deleted mtime to become raw `1700000000000`ms. The
authorized replacement supplies literal deterministic backend post-write state
`1600000007125`ms and requires it to survive; neighboring local/global assertions
and archive bytes are unchanged. The expected value is not sampled product or
native output. The new D01/D08/D09 cases also check restoration intent/state.

`runs.json` contains exact argv/cwd/status/counts/hashes plus **lossless raw TAP
and stderr strings**, including failed attempts. Decoding each string as UTF-8
reproduces the recorded SHA256. Original raw files and full input manifests are
retained outside the project in the listed private regular-file snapshots.

| Frozen phase | Result | Interpretation |
| --- | --- | --- |
| `WBSg6U` literal old177 + baseline source | 177 pass / 0 fail / 0 skip | Before source patch, original oracle |
| `dpNJ0U` literal old177 + patched source | 176 pass / 1 fail / 0 skip | Only original options line108; BEFORE oracle correction |
| `ppmrU9` final new12 + baseline source | 1 pass / 11 fail / 0 skip | D01-D11 reproduce defects; D12 structural control passes |
| `h4nGkc` same final new12 + patched source | 12 pass / 0 fail / 0 skip | New targeted cases, separate denominator |
| `h4nGkc` corrected177 + patched source | 177 pass / 0 fail / 0 skip | One transparent approved expectation migration, not unchanged177 |
| `h4nGkc` scoped archive TypeScript | exit0 | Not full-repository typecheck; no build run here |

Old177 comprises author128 + wiring1 + independent30 + earlier PAX author12 +
earlier independent6. Native author5 is an overlapping subset, not extra coverage.
The original30 remains five files, not six. Reruns/scenarios are never added to
unique case counts. Different-leaf acceptance remains pending.

Initial harness observations remain visible: `37HviM` old177 was176/177 because
the snapshot recipe omitted the two P09 historical BSD archive inputs; no product
failure. Its new-test module had a D10 bracket syntax error: zero targeted cases
executed, one failed file-container record. `Tp48px` scoped types failed on that
same syntax. After fixing capture/syntax, first patched targets were10/12:
D09 incorrectly expected cancellation as a returned status instead of the direct
command contract's rejected original reason; now it checks exact reason identity.
D10 expected different diagnostic words; now it requires the existing precise
symlink-escape message, retaining nonzero status, full sentinel stat/bytes and
namespace assertions. No production change was made to turn those two green.

Earlier15/18,17/19; Curie's111 attribution; baseline registration failures;
original29/30 BSD rejection; and earlier176/177 B02 failure remain historical.
The new local initial176/177 missing-fixture run is NOT the historical B02 run.
The existing167 manifest remains SHA256
`269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f`.

## Isolation, reproducibility and limits

Runner `run.mjs` seals all165 current source files plus selected transitive
archive harness/tests/config, the two required immutable BSD archives, the pinned
GNU executable and314 existing dependency files. Final closure:510 regular files,
each copied by content with nlink1 and different source/copy inode; no aliases,
hardlinks, worktree, installs or live Shell/FS/bytes imports. Before/after content
manifests match for every execution. All installed dependency versions match
the existing lock; file hashes prove copy identity, not a fresh package-download
integrity audit. Node22.22.2; TypeScript5.9.3; tsx4.23.12; esbuild0.28.2.

The original live closure was frozen first; later phases copy it and overlay
ONLY archive source, the authorized options test, the new test and runner.
Thus moving unrelated live changes are excluded from causal comparisons.
`seal.json` records actual live HEAD/dirty/index states at capture. These are
dirty working-input checks, NOT committed-HEAD validation. Archive baseline is
`3f40603372bd07c5390a2370a252da8055de1865`; accepted B02 is
`d8a1acd75c8adae3f8864fd998d8f6cd53c1dc7f`.

Final retained tree: `/tmp/safe-bash-pax-deletion-h4nGkc/tree`.
Final input-manifest hash:
`d4abfda150252c6e99cda6f2d96db56548e6ab94893a95301fa3cf039705c494`.
Baseline old177 tree: `/tmp/safe-bash-pax-deletion-WBSg6U/tree`.
Patched literal-old-oracle tree: `/tmp/safe-bash-pax-deletion-dpNJ0U/tree`.
Final baseline-target tree: `/tmp/safe-bash-pax-deletion-ppmrU9/tree`.
Private `/tmp` and `/private/tmp` spellings refer to the same retained host dirs;
no project/dependency symlinks were used. Host native extracts stay in existing
tests' isolated owned temp dirs. Native GNU1.35 hash is
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`,
copied to the frozen author-relative `.oracle/gnu-tar/1.35/bin/gtar` path.
BSD frontend3.5.3/libarchive3.7.4 hash is
`bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9`.
Existing GNU/BSD bidirectional plain/gzip and profile assertions were retained.

Each subprocess has180s/16MiB bounds, individual tests20s, existing native child
budgets and owned-temp finally cleanup. Runner children use dedicated process
groups, stopped/reaped after completion or timeout; all recorded runs completed
without timeouts. No matching retained-tree process remained at cleanup check.
Three unused own snapshots were removed; executed snapshots/reports are retained.
No unrelated process/index/work was stopped or changed.

Commands used (full exact expanded commands are in `runs.json`):

```sh
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs seal
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs refresh-baseline /tmp/safe-bash-pax-deletion-37HviM/tree
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-WBSg6U/tree old177
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-dpNJ0U/tree old177
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-ppmrU9/tree targets12
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-h4nGkc/tree targets12
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-h4nGkc/tree corrected177
node tests/commands/archive-stress/pax-deletion-evidence/run.mjs run /tmp/safe-bash-pax-deletion-h4nGkc/tree types
```

Recorded output paths use exclusive writes. For a diagnostic rerun first use
`refresh-baseline RETAINED_TREE` to create a NEW regular copy: it keeps that
tree's source/options and explicitly overlays current new-test/runner bytes,
recording hashes. Check those hashes against this handoff before calling it an
exact replay. Use `old177` only with the literal original options hash; the runner
enforces it. `overlay BASELINE_TREE` instead captures current archive/options
changes, recording them as a new phase, never silently committed verification.

No global build/typecheck/full-package/comparator/FS/jq tests ran. No staging or
commit occurred. Root review and the different final verifier are still required.
