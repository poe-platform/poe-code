# ROOT acceptance: finite native26 observations

Date: 2026-08-29. ROOT accepts the finite observation evidence from source
`5861ec9a8750de90bf38f93a2cd0df66198e8d9f`, independently audited in
`98192974514389759c96d20c7f35fe6050641c76`, with receipt SHA256
`e3c7637bc3d1eb144df96b02e654352ae1c131407fc2fe6ef26cf85d8558ebbd`.

The accepted scope is 125 artifacts, 109 captures totaling 104198 bytes,
26 literal scripts, 7875 completed DATA checks and eight framing controls.
These are **26 observations, not 26 parity passes**, and concern the pinned
local Bash3.2 profile, not GNU5.3 or full Bash compatibility. Exact scripts,
status, stdout/stderr bytes and effects are retained in `MATRIX.json`.

## Complete visible PIPESTATUS matrix

All P02–P18 have final exit status **0**, with no file effects. The strings below
use JSON escapes: `\n` represents an actual LF, not normalized output.

| ID | stdout |
|---|---|
| P02 | `"<>\n"` |
| P03 | `"a:<1>\nb:<0>\n"` |
| P04 | `"1:<1 0 1>\n"` |
| P05 | `"1:<1 0>\n"` |
| P06 | `"1:<1 0>\n"` |
| P07 | `"0:<0>\n"` |
| P08 | `"0:<0>\n"` |
| P09 | `"a:<1>\nb:<0>\n"` |
| P10 | `"<1>\n<0>\n"` |
| P11 | `"inner:<1>\ninner:<0>\ncaller:<7>\n"` |
| P12 | `"child:<1>\nparent:<0>\n"` |
| P13 | `"child:<1>\nchild:<0> parent:<1>\n"` |
| P14 | `"<0>\n"` |
| P15 | `"<127>\n"` |
| P16 | `"<>\n"` |
| P17 | `"<0>\n"` |
| P18 | `"inner:<>\nouter:<0>\n"` |

Stderr is empty except for P15, whose exact stderr is:

```text
"surface-function-pipestatus: __surface_missing_command__: command not found\n"
```

## What these observations do and do not establish

- **Initial visible value:** P02 runs its `printf` as the first shell command,
  without a prologue, and prints `"<>\n"`. It does **not** show a visible initial
  `[0]`. It does not distinguish unset from empty or establish an internal
  scalar/array binding type. No initial internal binding policy is selected.
- **Readonly:** P16 prints `"<>\n"` after `readonly PIPESTATUS; false`, without
  first establishing a populated indexed binding. This is **not** evidence
  that a pre-existing readonly indexed array permits or refuses internal
  updates. No readonly-index policy is selected.
- **Unset:** P17 prints `"<0>\n"` after `unset PIPESTATUS` completes. This
  establishes the visible post-command value for that script, not a general
  internal recreation/type rule or an unset-versus-empty classification.
- **Present nonarray:** no dedicated native26 probe establishes preservation
  of a present nonarray binding. Any such source/proposed policy remains
  separate from these native observations.
- **Current local:** P18 prints `"inner:<>\nouter:<0>\n"`. These are visible
  inner/outer values, not a local scalar/array type probe or proof of every
  current-visible-binding selection rule.
- **F05:** final stdout is `before`; final owned regular0644 `work/out`
  contains `x`. This is a final-file-effect observation, **not creation timing**.
- **F09:** the nonidentifier function definition is accepted with status0
  and empty output, but the function is **not invoked**.

F02/F03/F04/F08 print `x` with status0. F06's quoted `function` lookup has
status127 and the retained command-not-found diagnostic. F07/F10 have syntax
status2 and no `BAD` stdout. F01/P01 older native37 evidence is not merged into
this cohort. Ordinary command-substitution source coverage remains qualified,
not universal.

## Evidence and lifecycle qualifications retained

All 26 case records have recorded exit/close, qualified captures and absent-group
retirement evidence. The managed ledger records 27 starts, including the owner;
19 native source-fork reservations remain **UNOBSERVED**, not measured starts.
Owner exit0 is ROOT-reported and source-consistent, not independently attested
by an owner OS-exit receipt or external approval-service state in this audit.
The initial tool-shell startup remains outside the child fresh-environment and
owned-capture qualification. No universal process census or OS-containment
claim follows.

Persisted case `receiptPublished:false` belongs to the pre-credit serialization
layer; later journal credit and final RESULTS were authenticated separately.
The old locator-read failures and old review's at-least52/48 process-cap
noncompliance remain preserved, without rescoring. The fresh DATA audit used
22 known roles, peak2, and made no native calls or old PID/group probes.

## Authority boundary

This document records ROOT's bounded observation acceptance only. It grants no
new native query, runtime activation, product implementation, initial binding
type decision or readonly-index decision. ROOT will prepare separate typed-six
probes under separate authority; none is executed or accepted by this record.
