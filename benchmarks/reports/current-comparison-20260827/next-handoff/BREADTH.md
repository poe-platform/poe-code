# Breadth next handoff — static inspection only

Results remain **e33974b8c643077453227a9679d8ceca8367998c**, accepted by **8670ebe8f0d39966c2de2638780437398e5f8490**. Initial HEAD 8670ebe8 is the static pin, not a new measured candidate.
HEAD advanced during inspection; exact initial/final HEAD, dirty status, source/evidence hashes are in `breadth-provenance.json`. No product/test/native/comparison execution or commit.

## Static availability, not documented names

Pinned `src` tree equals e339 (f214264ae13d47e1369513a12ccd2d6cf944a6ef); root/command exports are unchanged. Sole package.json delta reorders test CLI arguments, not dispatch. Relevant live files equal the pin.
Root `src/index.ts` exports `agentCommands`; `src/plugins/index.ts` composes actual factories with collision preflight. Runtime discovery selects functions/kernel/registry/interpreter before VFS-script fallback. None of the 54 is an implemented kernel builtin.
The e339 registry census records 70 literal names before/after setup; unchanged source corroborates static wiring, not a fresh HEAD run or unshadowed-dispatch trace. Arbitrary injected functions/plugins/VFS scripts are outside this default profile.
Leaf tree/time-env introductions saying root exports are not yet wired are historical; current actual aggregate/root/package wiring takes precedence. Their explicit semantic profiles remain relevant.

## Exact 54-target partition

**35 missing + 1 installed/profile-failing + 5 optional-profile absent + 13 installed/passing = 54**, once each below and alphabetical per category. Historical primary=50; additional optional=4. SQLite is primary but uses optional runtime configuration.
Historical labels: MH missing-handler; DB dependency-blocked; SB syntax-blocked-before-target; NP no-op-not-operational-proof; PF partial-functionality; FP functional-positive. Labels are preserved, not substituted for dispatch/recipe-stage facts.

### Missing current default dispatch — 35

| Name | Exact recipe ID | e339 label/status | Static route; why |
| --- | --- | --- | --- |
| alias | alias-positive | MH/127 | absent; No alias command or shell alias-expansion state; recipe cannot define/use ll. |
| builtin | builtin-positive | MH/127 | absent; No literal builtin selector; existing kernel discovery does not install this command. |
| clear | clear-positive | MH/127 | absent; No clear command; fixture demands literal ESC[2J ESC[H, not ambient terminal capability proof. |
| column | column-positive | MH/127 | absent; No column command; fixture requires -t/-s/-o byte-aligned columns. |
| compgen | compgen-positive | MH/127 | absent; No completion-list command for declared -W prefix recipe. |
| complete | complete-positive | MH/127 | absent; No completion-definition command/state for the declared recipe. |
| compopt | compopt-positive | DB/127 | absent; No compopt dispatch; recipe first fails at prerequisite complete (127), not a compopt execution. |
| declare | declare-positive | MH/127 | absent; No declare command or integer-variable attribute operation. |
| dirs | dirs-positive | DB/127 | absent; No dirs dispatch; recipe first fails at prerequisite pushd (127). |
| du | du-positive | MH/127 | absent; No literal dispatch; feasibility belongs to the separate du worker, not assessed here. |
| egrep | egrep-positive | MH/127 | absent; Literal egrep absent; existing grep supports extended-regexp mode (-E). |
| exec | exec-positive | MH/127 | absent; No exec dispatch/control-transfer; recipe also leaves forbidden after-exec. |
| expr | expr-positive | MH/127 | absent; No expr command; shell arithmetic is not an installed expr CLI. |
| fgrep | fgrep-positive | MH/127 | absent; Literal fgrep absent; existing grep supports fixed-string mode (-F). |
| getopts | getopts-positive | MH/127 | absent; No getopts dispatch/persistent option-parser state. |
| hash | hash-positive | MH/127 | absent; No hash command; registry/path lookup is not a hash-cache CLI. |
| help | help-positive | MH/127 | absent; No help command; expected help.txt content is absent, not a diagnostic-only pass. |
| history | history-positive | MH/127 | absent; No history command or declared persistent shell history facility. |
| hostname | hostname-positive | MH/127 | absent; No hostname command; fixture expects localhost, not an implicit host-identity guarantee. |
| html-to-markdown | html-to-markdown-positive | MH/127 | absent; No html-to-markdown command; heading/bold conversion unavailable. |
| let | let-positive | MH/127 | absent; No let command; arithmetic syntax elsewhere is not this literal command. |
| mapfile | mapfile-positive | SB/2 | absent; No mapfile dispatch; recipe fails before target at unsupported array expansion (2). |
| popd | popd-positive | DB/127 | absent; No popd dispatch; recipe first fails at prerequisite pushd (127). |
| pushd | pushd-positive | MH/127 | absent; No pushd command/directory-stack operation. |
| readarray | readarray-positive | SB/2 | absent; No readarray dispatch; recipe fails before target at unsupported array expansion (2). |
| shopt | shopt-positive | MH/127 | absent; No shopt command/option state; recipe cannot enable alias expansion. |
| time | time-positive | MH/127 | absent; No literal time wrapper; timeEnvCommands installs date/sleep/printenv, not time. |
| timeout | timeout-positive | MH/127 | absent; No timeout wrapper; cancellation/runtime-output redesign is not proposed here. |
| typeset | typeset-positive | MH/127 | absent; No typeset command/integer-variable attribute operation. |
| unalias | unalias-positive | DB/127 | absent; No unalias dispatch; recipe first fails at prerequisite alias (127). |
| wait | wait-positive | NP/2 | absent; No wait dispatch, but primary recipe fails earlier at unsupported &: old no-op label does not prove a virtual wait implementation. |
| which | which-positive | MH/127 | absent; No which command; fixture /usr/bin/echo is not guaranteed by a virtual registry name. |
| whoami | whoami-positive | MH/127 | absent; No whoami command; fixture user does not establish implicit host identity. |
| xan | xan-positive | MH/127 | absent; No xan CSV command; table-text family does not install xan. |
| yq | yq-positive | MH/127 | absent; No yq YAML command; jq JSON registration is not yq/YAML support. |

### Installed, strict recipe/profile mismatch — 1

| Name | Exact recipe ID | e339 label/status | Static route; why |
| --- | --- | --- | --- |
| tree | tree-positive | PF/0 | literal plugin (treeFile); Installed; ASCII branches/populated-root count (2 directories) differ from expected UTF-8 branches/1 directory. Status, stderr and preservation pass; profile mismatch, not absent dispatch. |

### Optional runtime profiles not enabled/implemented here — 5

| Name | Exact recipe ID | e339 label/status | Static route; why |
| --- | --- | --- | --- |
| js-exec | js-exec-positive | MH/127 | absent; Additional optional target; no matching handler/runtime injection. Explicit safejs is a different command, not a substitute or enable switch. |
| node | node-positive | MH/127 | absent; Additional optional target; no matching handler/runtime injection. Explicit safejs is a different command, not a substitute or enable switch. |
| python | python-positive | MH/127 | absent; Additional optional target; no matching handler/runtime injection. Explicit safejs is a different command, not a substitute or enable switch. |
| python3 | python3-positive | MH/127 | absent; Additional optional target; no matching handler/runtime injection. Explicit safejs is a different command, not a substitute or enable switch. |
| sqlite3 | sqlite3-positive | MH/127 | absent; Historical primary target in sqlite profile; no injected SQLite runtime or handler. Not an enable-only fix. |

### Installed and measured passing — 13

| Name | Exact recipe ID | e339 label/status | Static route; why |
| --- | --- | --- | --- |
| date | date-positive | FP/0 | literal plugin (time3); Exact declared status/bytes/VFS intent matched. |
| expand | expand-positive | FP/0 | literal plugin (stream4); Exact declared status/bytes/VFS intent matched. |
| file | file-positive | FP/0 | literal plugin (treeFile); Exact declared status/bytes/VFS intent matched. |
| fold | fold-positive | FP/0 | literal plugin (stream4); Exact declared status/bytes/VFS intent matched. |
| nl | nl-positive | FP/0 | literal plugin (format5); Exact declared status/bytes/VFS intent matched. |
| printenv | printenv-positive | FP/0 | literal plugin (time3); Exact declared status/bytes/VFS intent matched. |
| rev | rev-positive | FP/0 | literal plugin (format5); Exact declared status/bytes/VFS intent matched. |
| seq | seq-positive | FP/0 | literal plugin (format5); Exact declared status/bytes/VFS intent matched. |
| sleep | sleep-positive | FP/0 | literal plugin (time3); Exact declared status/bytes/VFS intent matched. |
| split | split-positive | FP/0 | literal plugin (format5); Exact declared status/bytes/VFS intent matched. |
| strings | strings-positive | FP/0 | literal plugin (stream4); Exact declared status/bytes/VFS intent matched. |
| tac | tac-positive | FP/0 | literal plugin (stream4); Exact declared status/bytes/VFS intent matched. |
| unexpand | unexpand-positive | FP/0 | literal plugin (format5); Exact declared status/bytes/VFS intent matched. |

## Fourteen tools: source-verified inventory

Tree/file=2; stream inspection=4; stream formatting=4 plus split=1; time/environment=3. Exact names/factories are in the data/provenance, not inferred by subtraction. **All 14 are targets: 13 strict passes; only tree-positive fails.** None is a control or omitted.
The named printenv query passes: no environment-ordering defect. The time trio is date/sleep/printenv, not the absent time wrapper.
Tree expects UTF-8 connectors and “1 directory, 2 files”; candidate emits ASCII connectors and “2 directories, 2 files”. Source explicitly defaults to ASCII and counts a populated root. Status 0, empty stderr and preservation pass. This is a declared-intent/profile mismatch, not absent dispatch or a demonstrated source bug; old expectations stay unchanged. Baseline ASCII/1-directory output also fails strict bytes.
Mapfile/readarray recipes fail array expansion before target dispatch; wait fails '&' parsing first. Static absence is independently established, not inferred solely from those failures. DB rows fail named prerequisites first.

## Three bounded implementation candidates for ROOT assignment

1. **egrep** — reuse actual `grepCommands(options)` / `withRegexSession` extended mode (-E), preserving CommandContext bytes/signal/cleanup and literal collision rules. Blockers: matcher-flag conflicts, truthful alias diagnostics, standalone factories and no budget reset.
2. **fgrep** — reuse that bounded handler's fixed mode (-F), not a regex/native substitute. Blockers: binary/multiple-pattern semantics, conflicting flags, cancellation, stdin provenance and session cleanup. Future edit surface overlaps the first candidate.
3. **column** — reuse table-text `Inputs`, `RecordReader`, `Budget`, `settings` and byte I/O contracts. Blockers: bounded whole-table widths/buffering, -t/-s/-o/trailing-field rules; C-byte recipe is not Unicode/ANSI/terminal-width parity.
These are choices, not implementation/ownership grants or a new proposal framework. No runtime-owned-output, env-S/shebang or duplicate du feasibility work.

## Preserved boundaries

Seven controls remain separate (three historical overlap plus four shared, including explicit curl). Seven direct diagnostics per engine remain **unscored**, never extra targets; exact IDs are in `targets.json`.
Baseline js-exec-positive stays **lifecycle-or-capture-failure**, despite stdout 42\n, empty stderr and status 0: post-result natural-exit deadline, SIGTERM, engine exit/close unobserved. Later group disappearance is not a pass. No enabling switch or hidden substitute is implied for candidate optional names.
`targets.json` retains exact expected status/bytes/file requirements, observed bytes/check failures, recipes/prerequisites/hashes and baseline outcomes. Profile/fixture attribution does not rewrite goldens; a diagnostic/no-op label is not installed functionality.
Env qualification addendum/announced receipt stay unchanged; all scores remain e339-only. No union/performance/superiority/new-holdout claim. No commits; static helper processes close synchronously and no persistent process is launched.
