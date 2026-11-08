# Two obsolete characterizations and 21 diagnostic gaps

This leaf owns exactly two existing files: `../corpus.test.ts` and
`../../table-text/differential.test.ts`. The authorized change replaces only their
shared-stdin status0/empty-stderr characterizations with GNU9.7 status1 and exact
`comm: -: Bad file descriptor\n` regressions. Inputs, output/cursor assertions,
all other case expectations, the216 native corpus and historical evidence stay
unchanged. No source, helper, native oracle, filesystem, metadata, benchmark or
dependency change belongs to this handoff. No build or emitted JS is authorized.

## Before-edit archive

`originals/` contains both complete original files, including the old assertions.
Their SHA256s, original paths, native/source pins and historical references are in
`archive-manifest.json`. Both files were copied and hashed before editing either.
`red-validation.json` and `logs/red-*.stdout` preserve actual fresh executions:

| Unmodified cohort | Pass | Fail | Skip | Failure |
| --- | ---: | ---: | ---: | --- |
| independent104 | 103 | 1 | 0 | shared original status1 versus obsolete0 |
| original311, current matching helper | 310 | 1 | 0 | shared stdin status1 versus obsolete0 |

These are real assertion failures, not missing-loader or helper failures. Both
child commands exit1 normally. Nonempty raw streams have exact SHA256s; a null
stream path means zero captured bytes and includes the empty-byte hash. Existing
reviewer red logs are separately hash-referenced, not replaced by these runs.

Exact shared input stdin is `610a610a620a620a630a`; expected and actual stdout are
`0909610a0909620a630a`, status1, and stderr
`636f6d6d3a202d3a204261642066696c652064657363726970746f720a`.
The independently captured native evidence and author capture agree byte-for-byte.
The original stdout and VFS preservation checks remain in their original places;
no cursor, stdin, driver, output normalization or diagnostic-presence policy is
changed for any other case.

## Diagnostic reproduction inventory

`repros.json` extracts exactly the21 nonexact rows from the frozen review's
195/216 exact result. It cross-checks every case hash, native expectation and
product status/stdout/stderr against the author post-fix capture and independent
native216 capture. No new inputs, fresh product scoring or diagnostic fixes were
used to build this inventory. Each row includes zero-based original index,
unchanged fixture/setup/stdin hex, actual/expected status and stdout/stderr hex,
human-readable rendering, native executable and argv0 separately, and captured
file effects. Hex is authoritative, including any non-UTF8 bytes.

- Four rows (indices74,75,76,110) differ **only** by the literal `EINVAL: `
  after the command prefix. Exact full-string equality after that one removal is
  checked during extraction. This classification is evidence, not an exemption.
- Seventeen rows (38,39,40,41,73,81,82,119,120,121,125,126,127,128,129,207,213)
  have other wording, quoting, missing diagnostic lines or context differences.
  The invalid-option rows also contain native argv0 paths, but are **not**
  argv0-only differences. No row is dismissed as context-only by assumption.
- Descriptions identify the literal raw-pair differences. No classification
  asserts equivalent meaning or weakens diagnostic requirements.
- File-byte maps come from the existing author capture; the independent product
  driver also checked `/work` namespace preservation. The native driver checked
  its attributed fixture namespace. No uncaptured timestamps, modes, inode
  identities, external effects or cursor counters are invented.

The existing **strict195/216** and **built134/142** are historical, distinct
denominators. They remain open diagnostic gaps, not universal parity. The selected
216/216 profile accepts ordinary diagnostic presence, not exact stderr. The
first-pass and corrected-alias audit remain untouched and hash-referenced. This
archive does not rerun the built cohort or the earlier six unavailable author
built checks, and does not claim global, full-shell or superiority acceptance.

## Runtime, native pins and live drift

The archived frozen review pins GNU coreutils9.7, LC_ALL=C, original author argv0,
native binary/source/archive/manual hashes, Node and dependency hashes. The
diagnostic extraction reuses that frozen runtime data; it does not recreate or
silently replace it. `archive-manifest.json` includes the exact historical driver
executable, arguments, cwd and environment overrides. Its referenced driver still
has its historical snapshot/READY guards; do not weaken them for a rerun.

Fresh red/green validations run the unchanged cohort lists against current live
source and the matching WebDAV helper SHA256
`177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`.
Each validation records Node/executable and resolved tsx/esbuild/tsc hashes,
snapshot-listed source/test/dependency/native hashes before and after, live
in-run drift, and prior-review-to-live drift separately. The red run observes six
prior-review differences (streams.ts, text.ts, shell parser/runtime and two
READMEs), zero in-run drift, and unchanged table source/helper. This is live
worktree evidence, not a clean committed-HEAD or whole-tree acceptance claim.

The table implementation remains source commit6ef0d8d; `comm.ts` SHA256 is
`34df22e9b6e1ca23ec14e83003aa9758c7d9fc1b1473828429e2ae713e4219cd` and
`internal.ts` is
`544935927754e228711318a299c20d95b3954bc756e14785722d0eac67a436d9`.
Pinned native comm SHA256 is
`86a541de8aa5d90c3404d5b88bc3646be9b2481736be5bafe5ee234522416fd3`;
native comm.c is
`3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336`.
All remaining pins are machine-readable, including distinct author binary hashes.

## Commands and containment

From the repository root, the archival commands used are:

```sh
node tests/commands/table-text-stress/diagnostic-gap-handoff/archive.mjs
node tests/commands/table-text-stress/diagnostic-gap-handoff/run.mjs red
node tests/commands/table-text-stress/diagnostic-gap-handoff/run.mjs green
node tests/commands/table-text-stress/diagnostic-gap-handoff/run.mjs types
```

The archive and validation drivers refuse to overwrite existing artifacts. For a
later replay use a newly assigned evidence path rather than deleting this record.
`run.mjs` records each exact underlying Node command, test file list, cwd,
environment overrides and raw log hashes. `types` invokes the existing TypeScript
compiler with `--noEmit` and a config scoped to these two test files and imports.
No new test-support or runtime dependencies are installed.

Fresh native/real fixtures are confined to the owned ignored `.runtime/<phase>`
cwd and TMPDIR. Only read-only oracle and frozen-pin links point outside it.
The old independent helper leaves71 native fixtures per104 run: each is checked
against its sentinel and an existing exact fixture byte/name map before the fresh
owned phase directory is removed. Unattributed `.native-*` artifacts elsewhere
are never inspected for cleanup or changed. No permission retry, metadata repair,
delegation, dormant worker or SIGSTOP process is part of this task.

The initial evidence commit precedes the separate two-file test-only commit.
Fresh green/typecheck logs and final integrity inventory may follow in a separate
owned-evidence commit; they do not rewrite this before-edit record. Final counts
and completion are recorded in `completion.json` when validation finishes.
