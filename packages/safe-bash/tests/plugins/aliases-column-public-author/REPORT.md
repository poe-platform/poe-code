# Aliases and column public integration — author handoff

## Scoped result, August 27, 2026

Root wiring **`cb940da68052a9f1ab7e115279900d277e051fdb`** adds egrep, fgrep and
column to the public API/default aggregate. **Author checks pass; different
public-integration review remains required.** This is not a whole-product gate.

Final executed candidate **`3dc0ac26d681badfd4db6319f2630274095c3100`** is an
explicit isolated Git commit based on accepted
`0123c83d3aae72a15621acbb29a165b97b2c6ab6`, with only14 enumerated integration
paths replaced by committed root/fixture/harness blobs. `CANDIDATE.json` records
all paths, Git blobs, parent, tree and source commits. A temporary private index
and `git commit-tree` created it; no branch, checkout or shared index was altered.
It is **not shared HEAD** and not a cherry-picked tree silently called HEAD.

The shared source commit already has unrelated tree author `f1a90436` in its
ancestry. Live regex/expr edits and untracked du were also present. All are
excluded from this validation candidate. The exact pre-wiring root files match
0123, and candidate command-family source trees (aliases, column, regex and tree)
remain byte-identical to that accepted base. No ongoing feature is certified.

## Stable public API

- Root and `virtual-bash/commands/grep-aliases`: `grepAliasCommands(options?)`,
  `createGrepAliasCommands(options?)`, `egrepCommand(options?)`,
  `fgrepCommand(options?)`, type `GrepAliasOptions`.
- Root and `virtual-bash/commands/column`: `columnCommands(options?)`,
  `createColumnCommands(options?)`, `createColumnCommand(options?)`, types
  `ColumnCommandsOptions`, `ColumnLimits`.
- `GrepAliasOptions` retains `regex?: RegexExecutionOptions` and `replace?: boolean`.
  Standalone aliases use their own grep implementation, not a required registered
  grep command. `ColumnCommandsOptions` retains `limits?: Partial<ColumnLimits>`
  and explicit standalone replacement.
- `AgentCommandsOptions.regex?: RegexExecutionOptions` is passed to standard
  grep and both aliases. `AgentCommandsOptions.column?:
  Omit<ColumnCommandsOptions, "replace">` preserves column limits. Top-level
  `replace` alone controls aggregate registration, including untyped JS attempts
  to inject a nested replacement setting. Existing search.regex stays separate.
- Default registry is the **explicit73-name set**: prior70 plus egrep, fgrep,
  column. Curl/SafeJS remain opt-in; expr/du are absent. Runtime dependencies
  remain empty and Node>=22 is unchanged.

Both new package subpaths are **explicit entries**, not wildcard-only mappings:

```json
"./commands/grep-aliases": {
  "types": "./dist/commands/grep-aliases/index.d.ts",
  "import": "./dist/commands/grep-aliases/index.js"
},
"./commands/column": {
  "types": "./dist/commands/column/index.d.ts",
  "import": "./dist/commands/column/index.js"
}
```

The existing `./contracts/*` mapping remains unchanged. There is no general
`./commands/*` mapping or new CommonJS/require support. No API was added merely
to satisfy a wildcard-only validator. Package-lock requires no change for these
exports; dependency metadata is unchanged.

## Executed checks

Final interval: **2026-08-27 17:23:08.149–17:23:22.481 UTC**, Node22.22.2,
TypeScript5.9.3, Darwin arm64.

| Check | Final result |
| --- | --- |
| Clean candidate production build and no-emit types | pass / pass |
| Explicit registry + maintained stream canonical tests | 63/63, zero skips/TODO/cancellation |
| Strict moved-package root/subpath consumer | pass |
| Six invalid public type uses | exactly3 TS2322 +3 TS2353 |
| Actual packed runtime tests, twice | 17/17 each, zero skips/TODO/cancellation |
| Maintained stream-five and stream-inspection consumers | both compile and execute |
| Missing alias/column runtime, root and subpath | four exact ERR_MODULE_NOT_FOUND refusals |
| Unexported source import | ERR_PACKAGE_PATH_NOT_EXPORTED |
| Actual forbidden repository-source read | ERR_ACCESS_DENIED with requested source path |
| Package inventory before/after | 738 files unchanged; no new entries |
| Source/build input binding | 238 archived inputs match candidate Git blobs; source unchanged |
| Owned temporary resources | removed in finally |

The17 packed cases cover root/subpath factory identities, the exact73 names,
standalone aliases without grep, ERE/fixed differences, VFS pipelines and nested
env, selected non-UTF8 bytes, actual grep/egrep/fgrep worker resourceLimits,
collision/preflight/replacement, column limit refusal with source preservation,
deferred Shell setup errors, preabort identity/no reads, and public external
stdin return-sentinel rejection. Observed actual worker creation/exits balance;
no verifier termination or worker-policy relaxation is introduced.

Product source and installed package come only from the committed isolated
archive/build. TypeScript public resolutions are checked against the candidate
export entries. Runtime root/subpath resolutions point into the moved package;
devtool declaration symlinks are removed before runtime. Devtools are read-only
host prerequisites with before/after identity hashes, not runtime dependencies.
No install, network service or private checkout access occurs. Package/source
inventory equality is not a monitor of identical-byte write attempts or a
universal malicious-host sandbox.

## Exact artifact receipt

| Artifact | SHA-256 |
| --- | --- |
| Scoped candidate source archive | `24e52774914e7cf2393534d06d50bcb69594d0c0776a52b0638a545a9c884033` |
| Current package.json input | `691426f4934c471d2a76d49675f3fc19f3ddc47c8aa63cc38671d899a09c4535` |
| Actual virtual-bash-0.0.0.tgz | `994dca37308937059b1adacade54f24bd8227589ad65c46c7f4fb661c702c9d5` |
| Executed Node22.22.2 | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |

The tarball is identical in attempts01,03,04: only test/harness inputs changed
between those attempts, not product wiring/exports/docs. This is a new artifact,
not the old8670 tarball96d8256f or shared-input/alias source tarball62228b67.

## Preserved author failures and migrations

- Attempt01 /488ef9e3: production build/types and42 registry cases pass;
  public12/16, four incorrect synchronous Shell.use error assertions.
- Attempt02 /e19bddde: expanded canonical cohort61/63, two incompletely migrated
  stream registry tests; package phase not reached.
- Attempt03 /a2a8f87f: canonical63/63 and types pass; public14/17, three checks
  incorrectly compare registry entries to the pre-registration input object.
- Attempt04 /3dc0ac26: final results above. These are not unchanged-cohort claims:
  `FIXTURE_CORRECTION.md` explains the added deferred-setup test and actual stored
  definition identity; `MIGRATION.md` identifies intentional current-name changes.
  All raw failures, compiler diagnostics and unreached phases are retained.

Source wiring is unchanged from cb940da6. Separate count migrations are
8c0f1821,2e4909b8,3e746299; fixture corrections ed214ed9/0bd5c20b. Historical
70-name captures and old alias80/82 remain untouched. Source/fixture approvals
18c02655,3ceac6f3 and491a98b9 are prerequisites, not independent acceptance of
this newly authored public wiring.

## Reviewer use

Meitner's independent freeze dbceec2b is outside this ownership scope. It should
review source cb940da6 and execute **3dc0ac26**, using CANDIDATE.json to verify
the exact base plus root-only change set, or another root-approved candidate.
It must not silently archive moving HEAD. The actual tarball is included in the
authenticated raw capture. No default integration of future expr/du is implied.

```sh
node tests/plugins/aliases-column-public-author/verify-capture.mjs
node tests/plugins/aliases-column-public-author/verify.mjs 3dc0ac26d681badfd4db6319f2630274095c3100 /tmp/NEW-UNIQUE-ALIASES-COLUMN-REPLAY
```

The first command authenticates all recorded attempts without product execution.
The second explicitly executes the frozen candidate with existing development
tools. Replays require fresh output directories and preserve all prior captures.
