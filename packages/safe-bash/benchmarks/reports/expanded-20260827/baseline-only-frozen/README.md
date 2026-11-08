# Distinct baseline-only coverage matrix

Frozen source bd2cacb3a20403302fd0a49441932d5522793e56; just-bash3.4.2. This is an extraction of
existing observations, **not** a new comparison or current implementation claim.

53 names are baseline-only in that frozen inventory. Three have one native-backed
primary recipe each: ours0/3, baseline3/3. The remaining50 names are unmeasured,
not passing, unsupported-by-test or removed from the full product goal.
The224 denominator and all original scores remain unchanged.

| Name | Baseline dispatch | Primary recipe | Ours passes | Baseline passes |
|---|---|---|---|---|
| . | kernel | kernel/dot/dot | 0/1 | 1/1 |
| alias | registry | not measured | — | — |
| builtin | kernel | not measured | — | — |
| clear | registry | not measured | — | — |
| column | registry | not measured | — | — |
| compgen | kernel | not measured | — | — |
| complete | kernel | not measured | — | — |
| compopt | kernel | not measured | — | — |
| date | registry | not measured | — | — |
| declare | kernel | not measured | — | — |
| dirs | kernel | not measured | — | — |
| du | registry | not measured | — | — |
| egrep | registry | not measured | — | — |
| eval | kernel | kernel/eval/eval | 0/1 | 1/1 |
| exec | kernel | not measured | — | — |
| expand | registry | not measured | — | — |
| expr | registry | not measured | — | — |
| fgrep | registry | not measured | — | — |
| file | registry | not measured | — | — |
| fold | registry | not measured | — | — |
| getopts | kernel | not measured | — | — |
| hash | kernel | not measured | — | — |
| help | registry+kernel | not measured | — | — |
| history | registry | not measured | — | — |
| hostname | registry | not measured | — | — |
| html-to-markdown | registry | not measured | — | — |
| let | kernel | not measured | — | — |
| mapfile | kernel | not measured | — | — |
| nl | registry | not measured | — | — |
| popd | kernel | not measured | — | — |
| printenv | registry | not measured | — | — |
| pushd | kernel | not measured | — | — |
| readarray | kernel | not measured | — | — |
| rev | registry | not measured | — | — |
| seq | registry | not measured | — | — |
| shopt | kernel | not measured | — | — |
| sleep | registry | not measured | — | — |
| source | kernel | kernel/source/source | 0/1 | 1/1 |
| split | registry | not measured | — | — |
| sqlite3 | registry | not measured | — | — |
| strings | registry | not measured | — | — |
| tac | registry | not measured | — | — |
| time | registry | not measured | — | — |
| timeout | registry | not measured | — | — |
| tree | registry | not measured | — | — |
| typeset | kernel | not measured | — | — |
| unalias | registry | not measured | — | — |
| unexpand | registry | not measured | — | — |
| wait | kernel | not measured | — | — |
| which | registry | not measured | — | — |
| whoami | registry | not measured | — | — |
| xan | registry | not measured | — | — |
| yq | registry | not measured | — | — |

No option-completeness claim follows from any name. Dot maps explicitly to '.'.
Later source/dot/eval work requires its own accepted cohort. Incidental script
tokens are not treated as tested workflows. Baseline-led native recipe expansion
and different-agent fairness review remain pending; this matrix makes the
selection gap explicit rather than manufacturing observations for missing rows.

Reproduce into a new directory with node benchmarks/expanded/baseline-only.mjs PATH.
Machine-readable evidence includes hashes of the two immutable input reports.
