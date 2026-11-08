# Read-only next-gap inventory — August 28, 2026

**No execution or historical rescore.** Pinned just-bash **3.4.2**, not “latest”;
the comparison used candidate `e33974b8`, not accepted78 `67eab12e`.
Original breadth remains **13/54 versus 47/54 operational** (baseline50 raw
intent matches). Full compressed archive hash, 2,071 member metadata records,
136 selected raw records and all68 recipe bindings were authenticated without
extraction. This sidecar ran no product, comparator, native tool or private engine.

## Static classification

Of the original41 uncredited target rows:
- **9 now present**, but unscored: column, du, egrep, expr, fgrep, getopts,
  html-to-markdown, timeout, which. Getopts is a builtin, not a 79th plugin.
- **23 still missing** from accepted78, including separate ongoing/planned work.
- **2 missing plus parser-blocked:** mapfile/readarray need indexed expansion.
- **1 behavior/profile mismatch:** tree charset/root-count output; not absence.
- **5 host-process/job/runtime-profile gaps:** exec, wait, node, python, python3.
  Their captured semantics are not authorization for ambient process spawning.
- **1 optional-engine distinction:** js-exec is not the opt-in SafeJS CLI/API.

Curl is an explicit opt-in historical control, not a missing default. SafeJS was
not injected into historical JavaScript rows. Neither optional capability earns
automatic comparison credit. DU's unknown allocation and which's real virtual
PATH lookup also preclude assuming native-looking captured outputs from presence.

## Ranked next work

Complexity estimates are judgment, not timing promises; all proposals retain
zero runtime dependencies and need scoped design/review before implementation.

| Rank | Feature / captured need | Complexity and coordination |
|---|---|---|
| 1 | pushd/dirs/popd: enter, list and restore directories | Medium-high; already planned, wait for cd464 review. |
| 2 | XAN: `xan select name rows.csv` | Finish existing review/integration; **0ec84fc3 module exists but is unregistered**, not in accepted78. Do not duplicate. |
| 3 | yq: YAML `.items[1].name` to JSON | High; **docs/precode only**. Follow existing approved subset/review owners, not full YAML ambitions. |
| 4 | Indexed arrays, mapfile/readarray, declare/typeset | High; parser/state/stream budgets must evolve together; names alone cannot fix captures. |
| 5 | alias/unalias with actual expansion | Medium-high; bounded lexical expansion, quoting, recursion and scoped state. |
| 6 | shopt dotglob/expand_aliases subset | Medium; share state/parser work with aliases; captured hidden-file workflow. |
| 7 | let: `count+=7` | Low-medium; reuse existing arithmetic evaluator and status/budget rules. |
| 8 | time: `command time -f completed printf …` | Medium; reuse shared-budget invocation, injected clock and cleanup; no native CPU/process claim. |

## Engine metric correction

Original **24 engine runs** means24 wrapper invocations, not24 successful or
distinct programs. Receipts evidence24 guest-body starts:16 guest bridge calls,
six direct guest-output invocations, two intentional guest throws. There are
**12 successful engine returns +12 expected rejections**:6 cancellation,
4 shell-budget,2 guest errors; all24 settle. Seven guest programs span10 workflow
families/two layouts. No internal interpreter-step counter was captured.
The W05-only continuation has126 module-load observations but **0 guest evaluations**.

`BREADTH.json`, `SOURCE-INVENTORY.json`, `PRIORITIES.json`, and `ENGINE-METRIC.json`
retain exact case/source/receipt bindings. No native/provider/service/full-gate
or superiority claim; root chooses subsequent owners and priorities.
