# ship-csvgrep current candidate QA

Scope: local packed-export qualification and capability documentation, not
publication or full csvkit compatibility. Preserve existing dirty edits and
the package pattern at `archive/safe-bash-command-package-pattern.md`.

## Manual steps

1. Inspect command ownership, privacy, empty runtime dependencies, public
   re-export, flags, CSV/regex profiles, quotas and cleanup. Compare independent
   controls to the requested csvkit 2.2.0 / agate 1.14.2 / Python 3.9 semantics;
   keep later pinned-source behavior and unsupported cases separate.
2. Run command and CSV-engine maintained unit/lint routes and the maintained
   selected safe-bash workspace build closure. Documentation changes do not
   require broad infrastructure gates; report these as focused checks only.
3. Stage the public SafeFS/SafeJS/SafeBash packages, pack them with scripts
   disabled, and install only those tarballs offline in a temporary consumer
   outside the checkout. Verify no private workspace package is installed.
4. Execute the maintained private-command runtime fixture with default,
   browser and workerd export conditions. Compile the csvgrep declaration
   fixture under strict NodeNext with each condition. Bundle and execute the
   runtime fixture in separate browser/workerd-condition VM realms without
   process, require or Buffer. These are conditional graph checks, not actual
   browser/workerd engine qualification.
5. Run independent packed CLI/SDK controls with literal expected outputs for
   physical multiline numbering, CRLF conversion, numeric and duplicate
   selectors, Unicode match-file stripping, empty patterns, anchors, Unicode
   digits, invalid/unsupported patterns and unknown flags. Execute the README
   example against the packed consumer.
6. Record exact candidate source and tarball hashes, passes/failures/skips and
   unavailable cells. Check documentation diffs. Purge task-owned output and
   the isolated consumer after recording evidence.

No CLI appearance or document renderer changes are proposed; screenshots are
not applicable to these Markdown capability/example edits. Native executables
and held XAN sources are not inputs to this QA. Full compatibility, actual
browser/workerd engines, performance and checkpoint/replay remain separate
unverified cells. No private package publication is authorized.

## Execution receipt — 2026-09-20

Executed against dirty HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8`,
Node v22.22.2. This task changes only the command README and this QA document;
the existing safe-bash support row already describes the public subpath and
bounded profile. The README now has a self-contained memory-VFS example with
disposal and exact SDK option names. No runtime defect was validated or fixed.

Passed:

- Command maintained unit route: 55 tests; engine maintained unit route: 9
  tests. Both have zero failures, cancellations, skips or TODOs. Independent
  byte/chunk, aggregate, grammar/error, quota and cleanup controls are included.
- Both workspace lint routes, including source and test typechecks.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`, including
  native postbuild; shared cache enabled. This is a selected closure, not the
  full repository build or an explicit uncached verification.
- Stage with `scripts/package-safe.mjs --version 0.0.0-ship-csvgrep-current`,
  pack all three public artifacts with scripts disabled, and offline-install
  them outside the checkout. Lock inspection found no private command,
  contracts or CSV-engine installation.
- Maintained private-command runtime fixture under default, browser and
  workerd conditions; strict csvgrep NodeNext declaration fixture under each
  condition. Both browser/workerd-condition bundles also passed separate VM
  realms without process, require or Buffer. These checks include canonical
  runtime identity, owned bytes, CLI/SDK equality and missing-file errors.
- Seventeen additional independent packed CLI/SDK controls: physical multiline
  numbering, embedded CRLF conversion, numeric headers, duplicate headers,
  exact range-looking names, zero positions, empty all/any modes, Unicode
  match-file rstrip and empty-regex precedence, Unicode/ASCII digits, final-LF
  and absolute anchors, invalid group, unsupported lookbehind, short rows and
  tabs overriding delimiters. Each compared literal expected stdout, stderr
  and status; CLI/SDK complete results also matched, including raw byte fields.
- README example and unknown-flag status-2/empty-output negative control.
- AST inspection of 1,291 staged JS/declaration files found no bare private
  command/contracts/CSV-engine imports. Privacy and empty command runtime
  dependencies were rechecked. Production imports remain first-party-only;
  no host execution, ambient I/O, implicit network or downloaded fallback.

Failed attempts, investigated separately:

- Initial fixture copying used a repository-relative source from the isolated
  consumer cwd and failed ENOENT. Corrected by copying from the repository;
  install and all fixture runs then completed. This was a QA setup failure.
- The initial README expected-result assertion omitted the public Shell
  `stdoutBytes`/`stderrBytes` fields. The seventeen preceding semantic controls
  completed successfully. A corrected standalone README check included exact
  bytes and passed, together with the previously unreached unknown-flag check.
  No product output or assertion about supported semantics was changed.

Packed csvgrep exports resolve to `./dist/safe-bash/commands/csvgrep/index.js`
and `./dist/safe-bash/commands/csvgrep/index.d.ts`. Tarball SHA256:

| Public artifact | SHA256 |
| --- | --- |
| SafeBash | `b1d3847c5a2403f5e11311777b9697b7a6fd25eb7442ce95f698b1f327cff0d3` |
| SafeFS | `1319b2eb8e5ff8b22875cd42e48f90c5ffef715f6e3572c69298e6596df8c062` |
| SafeJS | `b721a67d32c428fc76c84bac9c3017e52bf13d89fd6d6ada601cd2b86cc0f89c` |

Command source SHA256:
`7b0370aaa991537c4cfbd9f3cde8fb35cef744ec8d0fcda0672d0bd24f2b8143`.
Matcher source SHA256:
`693ce7c7b2e2881c872e29c3051f58da5fa6752b3b96dbf1649d4e5430b3e406`.
CSV-engine source SHA256:
`c003d6102507cab752151b724d56d9adc970b51b2a5a2e8fe913ef281d484ca2`.

Qualification-input inventory SHA256:
`3780b1c0b70a609faf91d090f9cbd5652ed71e8338c0e3eb9179b67b06d9b365`.
Reproduce by sorting these relative paths, hashing each file's exact bytes,
then hashing concatenated `path + NUL + lowercase SHA256 hex + LF` records:

```text
packages/safe-bash-command-csvgrep/README.md
packages/safe-bash-command-csvgrep/package.json
packages/safe-bash-command-csvgrep/src/command.test.ts
packages/safe-bash-command-csvgrep/src/command.ts
packages/safe-bash-command-csvgrep/src/compatibility.test.ts
packages/safe-bash-command-csvgrep/src/index.ts
packages/safe-bash-command-csvgrep/src/match.test.ts
packages/safe-bash-command-csvgrep/src/match.ts
packages/safe-bash-csv-engine/package.json
packages/safe-bash-csv-engine/src/index.test.ts
packages/safe-bash-csv-engine/src/index.ts
packages/safe-bash/package.json
packages/safe-bash/src/commands/csvgrep/index.ts
scripts/bundle-safe-bash.mjs
scripts/fixtures/safe-packages-csvgrep-types.mts
scripts/fixtures/safe-packages-private-command.mjs
scripts/package-safe.mjs
```

This inventory identifies the listed focused inputs, not every shell or
transitive artifact input; tarball hashes identify the actual packed graphs.

Unsupported/unverified: full Python regex grammar, other codecs, quoting 1/2,
open ranges and the remaining versioned compatibility cells in
[the acceptance ledger](safe-bash-csvgrep-acceptance.md). Actual browser/workerd
engines, exhaustive mapped upstream variants, checkpoint/replay and performance
were not run or counted as passes. No native oracle or held XAN source was used.
The complete safe-bash artifact retains external dependencies; zero external
runtime dependencies applies to this command, not the entire shell artifact.

No shared code, workflows or CLI/rendering behavior changed, so full repository
gates, workflow lint and screenshots were not run for this documentation task.
No local commit, verified remote-main delivery or successful release is claimed.
Nothing was published.

`/out` could not be created on this host (ENOENT). Task-owned temporary output
used ignored `out/ship-csvgrep-current` and an isolated `/tmp` consumer; both
were purged after recording the receipt. Scoped whitespace checks passed.
