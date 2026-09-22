# command-csvgrep integration review

Reviewed the current working-tree candidate on 2026-09-20. Unrelated edits,
including the package-pattern document's move into `archive/`, were preserved.

## Validated repair

An independent command test reproduced `-f '' -m a` returning status 0 without
attempting the VFS match-file read. The corresponding SDK options had the same
defect. File mode now depends on option presence, not path truthiness, throughout
acquisition, matching and pattern accounting. The failing command control now
passes for CLI and SDK, with status 1, empty stdout, deterministic stderr and no
CSV input acquisition when the mocked VFS rejects the directory read. A separate
matcher control proves supplied file membership wins over substring matching
even with an empty path, without charging an unused substring pattern.

## Integration and safety review

The private, ESM command workspace owns the actual command definition, typed SDK,
argument parser and optional plugin. Its runtime dependencies are empty. Safe-bash
only re-exports it through `commands/csvgrep`; no default registration was added.
The qualified private-workspace profiles and generic command build recipe admit
its implementation and CSV engine while preserving canonical contracts.

Inspected CLI/SDK snapshots, argument admission, grouped/attached options, literal
paths, match precedence, physical numbering, producer byte ownership, invocation
budgets, iterator return/error aggregation, registered cleanup and output scopes.
VFS reads and awaited writes receive the invocation signal. No command runtime
host executable, ambient file, network, download or fallback was found. Required
definition/plugin callbacks adapt those public contracts; no unsupported
proxy-removal or abstraction rewrite was made. Existing supported-profile
grammar rejection and historical/version evidence were preserved.

## Verification

- Command/matcher maintained unit route: 33 passed, no skips; maintained lint and
  source/test typechecks passed. Shared CSV engine: nine passed, no skips.
- Public Shell boundary: one passed, covering VFS scripts/pipes/redirects,
  equivalent SDK output, registration collision and denied implicit network.
- Maintained artifact/publication suites: 224 passed across `package-safe`,
  `bundle-safe-bash-private`, `safe-command-publication` and
  `verify-safe-publication`, including isolated packed runtime/type controls.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed the
  maintained selected dependency closure and safe-bash optional CLI postbuild.
- Fresh public SafeFS/SafeBash tarballs were installed offline with lifecycle
  scripts disabled in a temporary consumer outside the checkout. The maintained
  private-command runtime fixture and csvgrep strict NodeNext declaration fixture
  passed. No private command workspace was installed.
- Built-entry manual QA checked selected rows, grouped inversion and `-f ''`
  failing before CSV stdout. The terminal screenshot was inspected. `/out` was
  not writable; staging/image/driver used task-owned workspace `out/`, with the
  isolated installed consumer in an automatically cleaned OS temporary directory.
  Generated evidence was purged after recording results. `git diff --check`
  passed. No native oracle was used by unit tests.

## Unresolved compatibility findings — completion blocked

The acceptance ledger and engine/command READMEs still declare unsupported or
unqualified Python regex groups, references, lookbehind, repetition and additional
inline flag forms; CSV codecs, quoting 1/2, native field-size units, NUL transport
differences, open/zero range controls and remaining adapter containment,
cancellation/replay and versioned error cells. Native eager admission of losing
match-file arguments also differs from the tested lazy candidate behavior. These
are unresolved; supported-profile integration evidence does not certify complete
csvkit 2.2.0/Python 3.9 compatibility or discharge the full task's acceptance gates.

No snapshot/version profile was widened, native engine substituted, XAN held
source inspected or imported, or test weakened. Full repository tests/lint were
not rerun; focused checks cover this three-condition presence repair and its
existing integration graph. Local commits: none. Verified remote-main delivery:
none. Successful releases: none. No private package publication occurred.
