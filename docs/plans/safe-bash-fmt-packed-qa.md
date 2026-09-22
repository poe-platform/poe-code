# ship-fmt packed export QA

## Repeatable Markdown QA

1. Run `npm test --workspace=safe-bash-command-fmt` and
   `npm run lint --workspace=safe-bash-command-fmt`.
2. Build the maintained closure with
   `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
3. Run the fmt command, adversarial and boundary integration files against that
   fresh build. Keep GNU 9.10 controls separate from historical 8.30 snapshots.
4. Stage public libraries with `scripts/package-safe.mjs --out-dir <owned-output>
   --version <candidate-version>`. Pack SafeFS, SafeJS and SafeBash with scripts
   disabled; never pack or publish the private fmt workspace.
5. Install those tarballs offline with scripts and workspaces disabled into a
   fresh consumer outside the checkout. Verify private fmt/contracts packages
   are absent. Copy the maintained `safe-packages-fmt.mjs` and
   `safe-packages-fmt-types.mts` fixtures into that consumer.
6. Execute the runtime fixture normally and with `--conditions=browser` and
   `--conditions=workerd`. Compile declarations in strict NodeNext mode with
   exact optional properties, unchecked indexed access and the corresponding
   TypeScript custom conditions. Inspect the packed export targets and check
   packed JavaScript/declarations for bare private workspace imports.
7. Authenticate the GNU 9.10 archive, read `src/fmt.c`, the fmt invocation
   documentation and all upstream fmt tests; compare the pinned development
   source. Record source findings separately from executed native observations.
8. Record results and remove task-owned temporary output and isolated consumers.
   Run screenshots for changes to CLI appearance or document rendering.

## Executed receipt, 2026-09-20

Current working-tree verification, including pre-existing edits; this is not an
immutable committed-revision receipt. No runtime implementation, packing logic,
registration or CLI appearance was changed by this task.

- Private package unit route: 1,023 passed, no failures or skips.
- Private package lint: ESLint and source/test TypeScript checks passed.
- Maintained selected Safe Bash build closure: passed.
- Fresh fmt, fmt-adversarial and fmt-boundaries integration: 726 passed,
  no failures or skips.
- Candidate version `0.0.0-ship-fmt`: public-only offline install succeeded.
  Private `safe-bash-command-fmt` and `safe-bash-contracts` were absent.
- Maintained installed runtime fixture passed under Node, browser and workerd
  export conditions, including the released width8 byte control, cross-realm
  input, canonical identity, VFS scripts/pipelines, byte prefixes and CLI/SDK parity.
- Strict NodeNext declaration fixture passed normally and with browser/workerd
  custom conditions. Packed targets are
  `./dist/safe-bash/commands/fmt/index.js` and
  `./dist/safe-bash/commands/fmt/index.d.ts`. No bare fmt/contracts imports were
  found in packed JavaScript or declarations.
- `git diff --check`: passed.

Tarball SHA256:

| Artifact | SHA256 |
| --- | --- |
| Safe Bash | `f69887b56e28e993685436266c7681e8779a9082b4c639c5114fb63a02aeaf37` |
| SafeFS | `4d5fa888e8af3a86be6e0bfdd6150a9d241e27ec47dc642858fc7e54c5d5eddd` |
| SafeJS | `f6fba4ed4be0b4960d98b1144648ba9bedd9746d9f35fe4353e11be3b2d9fe08` |

The freshly downloaded released archive matched
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Compared with `b25722854370b8206d7f53f8934c36710cdd9974`, fmt differs
only in initialization placement/removal. Read the cost definitions, strict-less
DP selection, final-line zero cost, raw MAXCHARS flush, MAXWORDS-2 boundary,
suffix retention, prefix/indentation and sentence classification. Read the fmt
Texinfo section and upstream `base.pl`, `goal-option.sh`, `long-line.sh`,
`non-space.sh` and `width.sh`. The latter explicitly gates the 9.10 inclusive
width boundary. No native utility was executed; these are source findings.

Actual browser/workerd engines and combined punctuation/prefix/margin/window
native qualification remain open. Existing safe-bash runtime dependencies are
unchanged; the private fmt workspace has empty runtime dependencies. Its README
now includes CLI examples, exact supported flags and output/status behavior;
the existing safe-bash usage/support section already documents its public API.
No rendering code or visible CLI change required screenshot validation.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No publication was attempted. `/out` was unavailable on this host;
task-owned output used ignored `out/ship-fmt` and temporary consumer storage,
then was removed after recording this receipt.
