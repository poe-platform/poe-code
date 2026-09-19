# User edge validation

The user QA pass reproduced and fixed three parser behavior classes with failing
canonical regressions before product changes:

- Unknown short-cluster tails become deferred extra arguments in CPython 3.14:
  `csvclean -txyz` reports `unrecognized arguments: -xyz`. Later invalid integer
  actions can fail first; later version exits can succeed. A tail beginning with
  `-`, such as `-t-encoding`, remains an immediate ignored-explicit error.
- A terminator belongs to the positional group that consumes it. `csvcut a -- b`
  reports extra `b`; `csvcut a -t -- b` reports extra `-- b`; an already excessive
  operand followed by a terminator retains that terminator in the diagnostic.
- Fixed numeric nargs consumes option-looking values. For both SQL parsers,
  `--engine-option --help -K` binds a pair without executing help or skip-lines.
  A terminator or insufficient tokens still produces the expected pair error.

The product change is confined to the shared parser. CLI and SDK continue using
the same engine. No executable names, flags, prompts, capabilities or native
product fallbacks were added.

## Differential scope

The reference interpreter matches the frozen executable: CPython 3.14.2,
49,968 bytes, SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`.
The recorded csvkit archive identity remains
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`;
this pass did not reacquire that archive or install the frozen dependencies.

Argparse was reconstructed from parser-contract-audit-20260917.json with
defaults and captured usage/help from oracle-3.14.2.json. Comparison covered
complete stdout/stderr/status on exits and complete parsed namespaces, with
PYTHONIOENCODING=utf-8 injected on the product side. Parsed resources were
disposed after every case. No match-file content/open vectors were generated;
their lifecycle is separately covered by canonical and actual-Shell tests.

The first deterministic random cohort contained 42,000 cases (3,000 per command)
and exposed 5,057 differences after correcting the helper's omitted match-file
default. It matched after the cluster/terminator fixes. The expanded cohort
contains 140,000 cases (10,000 per command), initially exposed 16,559 differences
from prefix tails, then 637 from fixed pairs, and now has zero differences.
Cases have zero through eight tokens, sampled with CPython random seed 20260918
from this ordered list (the repeated terminator is intentional):

```json
["a","b","","--","--","-t","-e","x","-1","--unknown","--null-value=x","--null-value","-K","0","-tx","-te=","--no","--encoding=","-V","--help","-tX=y","-t-","-t?","-t=","-t-encoding","--engine-option","--query","--encoding","-te==","-- no","- 1","-1e3","-.1x"]
```

Hashes of the final research inputs and helper bytes, recorded before cleanup:

| Input | SHA-256 |
| --- | --- |
| parser-contract-audit-20260917.json | bb5a137e764399515600b3aa7bdeabfeb0ad313dfa79dc21a2c2584b8012f139 |
| oracle-3.14.2.json | e303e86c44737a65c11f0847b634d196af05d33863f6a9067a6d47630ac57a7f |
| out/csvkit-edge-probe.py | aa095a495e908ab6b0ea986b0a799244eedbc600038ab8bd158d4fd9d5e65a40 |
| out/csvkit-edge-probe.mjs | 814bd4d5f49ad7afe10b333118a55df1f125f03a5f26933d045c83c4f3b1b412 |
| out/csvkit-edge-probe.json | 8c811a880657d778652005b7e168a1d0e0394d3ca10ad6964c43a0d01eed1f78 |
| packages/csvkit/src/cli/parser.ts | 5d3590f114a92d69336b020fcdb7896c6137d5946528d71b3f2a821e8232e231 |

These are sampled grammar observations, not exhaustive argv proof, actual
csvkit class execution, help-generation qualification or CSV operation parity.
The unavailable installed csvkit environment remains an explicit blocker.

## Independent stress and checks

A different agent independently measured nine discovered argv cases against
CPython 3.14 argparse and added three actual-Shell regression tests. Two further
in-memory lifecycle tests cover overwritten eager match-file handles closing
exactly once after a later parse error, and pending opener cancellation awaiting
acquisition/close while preserving a falsey reason. No adapter product bug was
validated. Canonical tests use no native processes, disk fixtures or databases.

- Maintained domain tests: 295/295 pass; domain lint/source/test typechecks pass.
- Selected maintained domain and safe-bash build closures pass.
- Focused actual Shell tests: 62/62 pass uncached; this is not the full inventory.
- Compiled public Shell errors for the three fixed behaviors were rendered and
  visually inspected: readable wrapping, aligned usage, no clipped content.
- Maintained safe-bash source/test and public-consumer typechecks pass, including
  all 26 declared current consumer groups and required negative controls.
  Typechecking does not qualify runtime or service behavior.
- Guarded repository ESLint completes successfully: zero errors, two existing
  docx test warnings; 15,803 configured subjects linted. Its invocation overlapped
  this pass's final documentation updates and is not a sealed release gate.

Owned temporary native helpers, observations and the inspected screenshot were
removed after reducing findings here. Existing worktree edits and the index
were preserved.

The unfinished Agate inference, typed QUOTE_NONNUMERIC, regex, match-file
execution, formats, database drivers/services and interactive paths listed in
implementation-status.md remain blockers. No universal edge coverage, full
repository runtime pass, README publication, commits, pushes or releases is claimed.
