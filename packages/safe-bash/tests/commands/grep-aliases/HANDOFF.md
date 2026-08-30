# Frozen author handoff — different verifier required

Source/test commit: `c9bd0dbb05553dc1f1cf9136a4e11ed6a3767bc8`.
No product or canonical test source changed after that commit.
Alias implementation SHA-256:
`61da567865598900545a4bbff2184ce5c68eb0c7e0347e7236e9f92789372c0a`.

The post-commit author replay started `2026-08-27T14:21:47.920Z` and finished
`2026-08-27T14:21:51.715Z`. HEAD was the source/test commit at both ends.
The all-source/canonical-input manifest remained stable during that replay:
`cede29ac556483949fe3eaffe293098471abf87a4ecb399bf2325f75d593eb13`.
Built worker SHA-256:
`bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.
`author-evidence.json` and `final-*.log` are the post-commit record; their initial
pre-commit versions remain available in the source/test commit's Git history.

## Results

- `npm run build`: exit 0.
- `node_modules/.bin/tsc -p tests/commands/grep-aliases/tsconfig.json`: exit 0.
- The three scoped test files with `GREP_ALIASES_NATIVE=1`: 119 total,
  118 pass, 0 fail, 1 GNU-prerequisite skip.
- `node --import tsx tests/commands/grep-aliases/consumer.mts`: exit 0;
  consumes built internal aliases and declarations, not root alias exports.
- Native BSD corpus: **39/50 exact tuples; 11/50 explicit profile differences**.
  The independent pinned native replay reproduces all 50 raw native tuples;
  it does not convert the 11 product differences into native passes.
- Safety process: 24 actual workers, 24 exits, zero active at its after-hook.
  Native child runs completed and were reaped; zero timeouts and no remaining
  owned `.native-*` fixture directory. No long-running author task remains.
- Source/docs/canonical-test whitespace check passed. Raw TAP/build logs retain
  their original trailing spaces/blank lines; the broad staged whitespace check
  reports these data-only findings. They were not normalized to fake a pass.

## Qualification and next owner

The replay worktree also contained other owners' untracked column source/tests,
two preexisting native scratch directories and a SafeJS review directory. All
were preserved, never staged or committed by this author. The full-source build
therefore observed a qualified shared worktree, not a pristine whole-package
candidate. Tracked product source had no diff from the source/test commit after
the replay; complete worktree hashes/status are recorded. The alias-only runtime
cohort does not claim acceptance for those unrelated inputs or suites.

GNU grep was unavailable: **required GNU native capture remains unfulfilled**.
The genuine local GNU binary/launchers must be supplied by root/verifier; see
`REPORT.md` for capture and strict replay commands. Do not erase GNU warnings
or present the BSD-derived cohort as GNU acceptance. No native version is called
the latest. Root export/default integration is deliberately not implemented.

The module API is `grepAliasCommands`, `createGrepAliasCommands`,
`egrepCommand`, `fgrepCommand`, and `GrepAliasOptions` with `regex`/`replace`.
Two alias definitions share one existing grep executor per family construction.
Standalone plugin execution does not require a registered grep command.
The author is now stopped: different-agent stress/verification and any root
integration must proceed from the frozen source/test commit and its hashes.
