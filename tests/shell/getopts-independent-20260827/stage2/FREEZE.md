# Stage2 freeze contract — August 27, 2026

## Pre-execution boundary

Freeze these meaningful new integration inputs and expectations before the native
holdout launches and before any future Stage2 implementation inspected here.
Initial read-only HEAD was `f8fdae7289162494d09f887bed4846edfd6575cf`.
`baseline.json` records actual freeze-time HEAD and SHA256s of relevant reads,
whether each live read matches that commit, routing names and staging/status.
The runtime routing header contains no getopts entry; shell startup has no
OPTIND/OPTERR defaults. No absent-getopts execution is necessary. If unexpected
Stage2 routing metadata appears, stop rather than inspect an implementation body.

## Supported-source evidence

- `src/shell/runtime.ts:30`: builtin inventory; `:36`: special-builtin inventory.
  Neither includes getopts; builtin/declare/typeset dispatchers are absent.
- `src/shell/runtime.ts:918`: discovery; `:931`: command/type option routing and
  function-bypass dispatch. `:737`: supported declaration expansion.
- `src/shell/runtime.ts:745`: prefix assignment checks; `:1579`: local/export/
  readonly and `:1613`: unset; `:1626`: read input handling.
- `src/shell/runtime.ts:1784`: parameter assignment; `:304` and `:451`: arithmetic
  write path. `src/shell/parser.ts:60` and `:577`: relevant compound grammar.
- `src/shell/shell.ts:144`: current fresh variable/export setup, not Stage2 defaults.
- `src/shell/types.ts:1`, `src/contracts/command.md:1`, and
  `src/contracts/io.ts:1`: existing public invocation/IO/budget contracts, not
  proposed typed Stage2 APIs. Baseline hashes bind these line references.

## Corpus map and denominators

N01 regular discovery/direct/command/defaults; N02 inherited attributes and argv;
N03 real reset origins/cluster continuity; N04 prefix install+restore; N05 local
entry snapshot; N06 dynamic A/E locals; N07 clone boundaries; N08 shared contexts
and source fixture; N09 function positionals/set/shift; N10 aliases/Unicode values;
N11 usage/name validation; N12 readonly I/name; N13 intentional readonly-A divergence;
N14 failed origins; N15 local binding metadata/larger index/bare declaration;
N16 diagnostic emission/suppression. These are sixteen scripts, not their many
output lines counted as distinct tests. There are twelve separately named host/
profile invariants, not twelve executions. No Phase1 scanner projection matrix
is copied as new Stage2 acceptance. Three pending root decisions are not passes.

## Expected evidence and attribution

Expectations derive from the declared author profile/handoff, existing supported
runtime grammar, the archived author's measured Stage2 facts and primary official
Bash documentation identified in `sources.json`. Historical archived proposals
for unchecked readonly OPTARG unset are explicitly superseded by root policy.
This leaf previously inspected Phase1 source and P03/T20 evidence; no blindness
claim. The frozen primary expectations can contain reviewer mistakes: preserve
them, retain exact capture discrepancies, and add separate corrections if needed.
Never edit a frozen expectation to fit observations or count native matches as
candidate passes. Bash3.2 is separate historical evidence, not a second mandatory
product dialect. No Linux, usable-getopts, default-count, full-parity or 72-hour
completion claim. Public runtime implementation remains withheld to its owner.

`freeze-manifest.json` binds every frozen file, materialized product script and
complete expected control plus invariants. The freeze commit must contain that
manifest and inputs before `capture.mjs` starts. Native captures record the exact
freeze commit; the later evidence commit does not replace that chronology.
