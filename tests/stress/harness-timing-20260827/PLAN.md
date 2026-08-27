# Harness timing author: frozen plan

Ownership is exactly the current jq `scan-boundaries.test.ts`, search
`streaming-cases.ts`, and this new directory. No product, types, registry,
contracts, root config, sibling harness, or original fullgate artifact edits.
No subagents. Root owns integration; a different reviewer must accept results.

## Checkpoint interlock

Until `/tmp/regex-production-checkpoint-closed.txt` exists: static reads and
new frozen plan/evidence only. No canonical edits, product execution, native
children, stress, pathological regex or new fixture breadth. The six regex
risk allocations remain untouched. Actual marker contents must be archived
before any execution or canonical edit.

## Frozen baseline and expected outcomes

Routing commit `51282a9` records the fullgate at product commit
`e36dab2b6abc216ddc89e5786a0eba76f08a1722`: 15,958 instances, 15,769 pass,
110 fail, 79 skip. Thirteen jq 1500ms deadlines and one native rg delivery
failure are historical fullsuite failures. Guarded and plain isolated jq
15/15 are not a fullgate pass. Original rg repeats fail/pass/pass.
Preserve raw classified failures, logs, fixtures, and hashes in `frozen/`.

Static jq finding: the owned test gives each vector 15s, but its unowned
`execute` helper creates a new 1500ms AbortSignal for each of 22 executions.
That timer starts after module loading, not at Node startup. Never describe
these original failures as loader timeouts. Preserve all 15 vectors, 330
route/transport executions, expected status/stdoutHex/stderrHex and every
existing product limit. Do not edit the unowned helper.

Static rg finding: stdin writes start on a 25ms interval, without evidence
that rg consumed the prefix before the NUL arrives. The original assertion
requires `foo\n` followed by the exact binary warning; original observed
native output was the exact warning alone, status0, empty stderr. This is
delivery timing, not regex blocking. Whole-write warning-only is an existing
separate native profile. A producer write callback is not proof of rg read
progress. A spawn event is not proof of application readiness.

## Bounded investigation after closure

1. Archive marker, exact source/test hashes, Node/native versions and argv.
2. Replay unchanged benign jq/native fixtures with strict unhandled rejections.
   Record baseline timing failure or explicitly intermittent/not reproduced.
3. Prove readiness/progress using actual events; separate cold process/module
   startup from execution readiness and completion watchdogs. Preserve product
   cancellation limits and semantic assertions. Avoid broad retries-to-green.
4. Use one fixed schedule: serial then three rounds with at most two owned
   child processes concurrently (including descendants). Exact child handles,
   bounded captures, awaited exit/close/stdout/stderr/IPC cleanup. Only isolated
   native fixture directories, no ambient user files/network/broad kill.
5. Negative controls must fail hard for suppressed readiness, withheld delivery,
   never-completion and cleanup failure; prove ownership excludes an unrelated
   sentinel. Report each mutation and watchdog actually used. Short injected
   negative-control budgets are separate from generous positive watchdogs.
6. Freeze changes in a harness-only commit; execution evidence/report in a
   separate commit. No fullgate/default/superiority claims. Notify root with
   `/tmp/harness-timing-author-ready.txt` only after stable commits and hashes;
   stop edits for independent review. Product bugs go to root, not local fixes.

## Known ownership constraint

The unowned `streaming.test.ts` wrapper currently kills its Node child after
5000ms. A larger inner watchdog cannot honestly supersede that outer bound.
Any necessary wrapper change must be requested from root, not silently edited.
