# Unified76 single-assertion amendment v2

This is an author packet for independent review, not a gate launch or release.
The established 20260827 directory identifies the cohort; capture timestamps
record actual execution time. Root authorized only the ordinary length assertion
at `tests/integration/stream-inspection-public-author/public.test.ts:31`,73→76.
The two previously authorized custom counts remain77. No other assertion, title,
suffix, input, output, provider body or inventory entry was amended.

## Immutable identities

- Base: `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Previous candidate: `07047e8f7bd577f60350246b1380732712305f58`.
- Previous driver: `86f75025b423f9d25a9dbcb35d07e73e95d33f9d`.
- Pre-hunk author freeze: `3f441c65` (`FREEZE.json`).
- Single-hunk fixture commit: `fd3f71e5c84988dd960d00119597eec51db79c6c`.
- New candidate: `2ffcb23d6029250c48950030120ed0adad2e5769`.
- Tree: `d1e5f90a4ebcf184b9558b96ff6b7c5f0c410d35`.
- Unchanged product src tree: `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- Actual freshly rebuilt tarball SHA256:
  `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
- Driver serialized seal SHA256:
  `fe9d2aa889e9d9cd04a34512b504638fa65e7d974d99a6b009448f7098b10115`.
- Decoded profile SHA256:
  `2fdedfe701553059038b0c4530574e8e3ec1874485bb99c4779ae2a94d6a7969`.

`driver/CANDIDATE.json` seals the raw commit and four exact old/new blob mappings.
The sole parent is44; the only difference from070 is the single numeric hunk.
`prepare.mjs` derives from reachable44 and fixture commitfd3, not live source.
`driver/reconstruct.mjs` proves the raw commit/tree twice in fresh object stores,
including a space-containing path. Its minimal skeleton is not a full package;
all other bodies are supplied by reachable44. `driver/restore.mjs` restores exact
objects with a private index and no new refs if the synthetic object is absent.

`driver/CODE-LINEAGE.json` binds the original86 runtime files. All runtime code
is byte-identical except two lexical directory-depth adjustments in common/profile
for this nested versioned directory. No admission, permission, execution order,
inventory, cleanup, TAP, public-smoke or test policy was changed. Original driver
files and evidence remain untouched.

## Actual bounded results and remaining red assertion

The fresh build and npm pack pass and reproduce the exact original tarball.
On the same product, the previous selected case fails at line31; the amended
selected case passes line31 and fails at **line32**, whose unique-count assertion
still expects73. Both targeted runs are0pass/1fail/0skip, not closure.
The complete amended file is **20pass/1fail/0skip**. Line34's literal suffix also
omits html-to-markdown/du/expr, but is not reached in the canonical case. Neither
line was authorized for change. The separate built-product control observes
ordinary76, unique76, custom77, and the three appended names without changing the
canonical fixture. Original58/10→67/1 evidence remains historical and untouched;
this version is not a rescore of that cohort.

The first author wrapper addressed `accounting.pass` rather than
`accounting.counts.pass` after the actual full-file20/1 run and stopped before its
direct count control. That wrapper error, original source and raw logs are kept
in the versioned evidence. The corrected wrapper preserves all product/test
inputs and expectations; its fresh bounded replay reaches the direct control.

## Authority and profile

Root accepted F01 as a current-consumer authority clarification. The provider
body remains selected Git blob `21f5fe464f028b4e056d2aae40b26612f560bd95`,
SHA256 `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`.
Inventory `288d17dc…` remains the historical informational field of that current
entry. WebDAV-loopback/current routes and all non-current hash checks are intact.
No fifth fixture/body/inventory rewrite occurs; original static exit1 is retained.

The new profile binds632 canonical paths,192 classified.mts,256 cleanup inputs,
and49+2 native assets, with actual pinned Node24.11.1, explicit TAP, permissions
and concurrency2. The cleanup revision/tree are this candidate; its256 input
hashes remain unchanged. The full conservative runtime superset remains37,397
entries/2,382,440,287bytes, streamed to isolated temporary storage, not a compact
typing-only closure. The unchanged runner still has the separate-build and
observation qualifications documented in the original driver README.

No private engine, full suite, current-consumer cohort or server suite was run in
this amendment. WHICH77 and later helper/runtime changes are not in this product.

## Reproduction and release hold

From repository root with the pinned Node24 executable:

```sh
node tests/integration/full-gate-20260827/unified76-driver/amendment-v2/driver/reconstruct.mjs /tmp/new-v2-reconstruction.json
node tests/integration/full-gate-20260827/unified76-driver/amendment-v2/controls.mjs
node tests/integration/full-gate-20260827/unified76-driver/amendment-v2/proof.mjs
node tests/integration/full-gate-20260827/unified76-driver/amendment-v2/driver/run.mjs --candidate 2ffcb23d6029250c48950030120ed0adad2e5769 --inspect
```

Supply the authenticated recovered RG/TREE asset paths as documented in the
original profile. `--inspect` is prerequisite admission only. `--execute` still
requires a new exact root release receipt and independent/public approvals;
none is supplied or inferred by this author packet. Review may proceed while
the residual fixture failure remains explicitly red.
