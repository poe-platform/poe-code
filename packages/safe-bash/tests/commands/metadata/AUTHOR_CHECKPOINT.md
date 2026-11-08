# Metadata author checkpoint — August 26, 2026

Author delivery, awaiting a different agent's independent stress/fix review.
No full GNU utility parity, broad repository pass or superiority claim.

## Exact scope

Source: chmod `64b55e4`, stat `cb707e6`, mktemp `7e14b72`, sequential GNU
conditional-execute fix `f846ce4`, readonly/readable-mode fix `c7f8d59`.
Root integration adds metadata to the existing aggregate without enabling
optional curl/SafeJS or the unfinished archive plugin. Counts are 52 unique
plugin names, not 52 independently verified native-compatible tools.

APIs from the root and `virtual-bash/commands/metadata`:

```ts
metadataCommands(options?: MetadataCommandsOptions): VirtualShellPlugin
createMetadataCommands(options?: MetadataCommandsOptions): readonly CommandDefinition[]
```

Options: `replace?: boolean`, `umask?: number`, `limits?: Partial<MetadataLimits>`.
Limit defaults: `maxEntries: 100000`, `maxDepth: 128`, `maxOutputBytes: 1048576`,
`maxArgumentBytes: 65536`, `maxAttempts: 128`; virtual umask 0022.
Aggregate options forward these as `agentCommands({ metadata: { ... } })`,
with replacement controlled by the aggregate's top-level `replace`.

## Reproducible author observations

Node v22.22.2, Darwin. Base revision:
`4fa4ba9502dac843bd13aa5031d128a3171f597d`.

The moving-worktree run at that HEAD passed 71 scoped tests, but global
typecheck/build exited 2 on three unfinished, untracked archive diagnostics:
`internal.ts:91` (`String.isWellFormed`) and `stream.ts:9,10`
(`ZlibOptions.highWaterMark`). Archive belongs to Archimedes; no source or
compiler configuration was changed to hide these. A prior broader targeted
run at `57d9d98` passed 301 contracts/core/metadata/plugin tests. None is a
whole-repository test result.

To isolate the owned integration, a `git archive` of the exact base was
extracted to `/tmp/safe-bash-metadata-integration.pDogGP`, with cached
`node_modules` linked and only the following five working files overlaid:

| File | SHA-256 |
| --- | --- |
| package.json | cd70038d1cb78ff164aa1c6819371d22afbc0c72c5d36c30345d2254602db2c3 |
| src/index.ts | aa50a4a7c25e43e1a7a33005dda53bb4f40b5fcdebc91067c0ccb5977c585004 |
| src/plugins/index.ts | 0f715a884709bf4400f9868626b9e7ead32266fee7d3733ee2a5df235574174e |
| tests/plugins/agent-commands.test.ts | 097a1775334398f2580d56e3f6ec811052f63b2965d929c5c868b8dca8d0f862 |
| tests/commands/metadata/integration.test.ts | 0ecbb8745a2483baaea607b4192e28f3ed956c038eb618109090c072dc25f2c4 |

This is a declared overlay, not a pristine committed-HEAD snapshot. It excludes
other workers' uncommitted files without modifying the actual worktree.

```sh
npm run typecheck
npm run build
node --unhandled-rejections=strict --import tsx --test \
  'tests/commands/metadata/*.test.ts' 'tests/plugins/*.test.ts'
```

All exit 0 in the archive. Tests: **71 pass, 0 fail/skip/TODO/cancel**:
19 chmod, 6 stat, 12 mktemp, 6 root/FS/shell integration, 28 aggregate.
Temporary raw logs: `/tmp/safe-bash-metadata-isolated.tap` and
`/tmp/safe-bash-metadata-integration-checkpoint.tap` (moving worktree).

Built-root/subpath import smoke verifies identical metadata factory exports,
52 unique default names, and absence of curl/SafeJS/tar. All 16 expanded export
entries import and have JS/declaration files. Manifest and lock agree on dev
dependencies and engines, with zero runtime/optional/peer dependency declarations.
An AST import scan using the already installed TypeScript tooling finds zero
third-party or computed imports in the snapshot's production source. An initial
regex scan falsely matched the text `from` inside a chmod diagnostic; it was
discarded in favor of AST inspection, not treated as a product dependency.

Actual built-root shell, after creating virtual `/tmp`:

```sh
file=$(mktemp); printf payload > "$file"; chmod u=rw,go= "$file"; stat -c '%a:%s' "$file" | cat
```

Assertions: exit 0, stderr empty, stdout hex `3630303a370a`, exactly one created
file with bytes hex `7061796c6f6164`. The script is executed by the virtual Shell,
not the host shell. This author smoke does not exercise all backends or flags.

## Committed-revision follow-up

After integration commit **097f56df1f3933f1dee6473f4effaed0c6500ab2**, a fresh
`git archive` of that exact revision (no overlaid files) was extracted to
`/tmp/safe-bash-metadata-committed.DRZ0GZ`, with only cached dependencies linked.
Global typecheck, build and the same scoped test command each exit 0:
**71 pass, 0 fail/skip/TODO/cancel**. Raw log:
`/tmp/safe-bash-metadata-097f56d.tap`.

A fresh built-root/subpath smoke passes at this exact revision: factory identity,
52 unique names excluding optional curl/SafeJS, and the actual virtual
mktemp/chmod/stat/pipeline workflow with the same exact stdout/stderr/exit and
file bytes asserted above. These are author integration checks, not the
independent full-suite audit. The earlier 16-export/AST scan belongs to the
explicit overlay cohort; it was not counted as a new full scan here.

A simultaneous live-worktree typecheck at HEAD `097f56d` still exits 2, now
reporting `src/commands/archive/format.ts:45` TS1487 (octal escape syntax).
This changed diagnostic is in the other author's active untracked source, not
the committed archive. It is routed to Archimedes without changing that file.
Owned metadata/root paths and staging were clean immediately after integration;
other workers' files remained untouched. No live-worktree build success or
whole-repository test pass is inferred from the isolated revision.

## Review priorities and honest limits

- GNU/BSD differences: 15 native ordinary chmod observations contain 13
  agreements and two preserved BSD disagreements. GNU expectations for these
  two are source-derived, not a pinned GNU executable run. See
  `gnu-mode-evidence.json`; do not erase the original author error history.
- Probe symbolic/reference/recursive chmod and symlink replacements; backend
  permission enforcement and descriptor-relative atomicity are not fabricated.
- Probe stat format width/precision/byte escapes and unavailable optional fields;
  timestamps intentionally expose millisecond UTC, not GNU nanosecond parity.
- Probe mktemp exclusive collisions, quiet/errors, dry-run races, cancellation,
  output limits and post-create failures. Private modes require capability
  support; no host `/tmp` fallback or unsafe cleanup of competing paths.
- Author integration covers memory, readonly and actual MockS3 boundaries;
  it does not establish all-backend metadata parity. Native tests currently use
  the local Darwin oracle profile; preserve that distinction on other hosts.
- Full repository tests/comparison were not rerun for this author checkpoint.
  Dirac's current frozen integration audit is independent and separately owned.
