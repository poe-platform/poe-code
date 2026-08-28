# Timeout + curl + actual SafeJS: new bounded workflows

This post-source-inspection protocol qualifies **12 new workflows**, each once in
installed and physically moved consumers, on exact public candidate
`67eab12e315054907ef4ef435c6bbca2f59e0c36`, package
`6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`, and private
engine `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`.

## Scope and execution

`CASES.json` freezes literal guest programs, shell commands, limits, expected
statuses/bytes and distinct observations. `child.mjs` freezes all trailing
assertions and admission/cleanup barriers. There are 14 measured Shell executions
per layout (two budget workflows each include a positive baseline), plus 12
separate empty plugin-admission executions; persistent counters are not reset.
No arbitrary sleep is an admission barrier. Deadline work waits for actual HTTP
body `next` admission, then uses the injected scheduler. Cleanup is explicitly
held, observed pending, and released. Raw timeout and outer host identity are
separate from serialized guest/proxy errors. The guest facade calls actual
`CommandContext.invoke`, sharing the parent budget and sinks; it permits only the
two frozen literal child names and injects the declared read-side-effect policy.

Four negative load children exercise wrong package bytes, wrong engine bytes,
private-source fallback, and an unlisted module. Four designated predicate
countercontrols reject extra denied-hop requests, missing cleanup, missing
iterator return and missing pending-settlement evidence. Wrong-hash files are
separately declared mutant copies, never modifications to product or engine.
Negative children must load neither product nor engine.

Every child has a 12-second watchdog, 16-second parent watchdog, 1 MiB output cap,
2 MiB receipt/trace caps and no subprocess permission.
An explicit network-denial hook rejects attempted live networking. The
whole cohort has a 480-second guard bound; children are sequential, at most one
live child, 28 maximum (24 workflow and four negative). Each child exit and close
must agree; PID and process group must be absent before continuing. Ordinary
semantic failures continue only with closed resources and intact bindings;
containment, missing receipts, integrity failures or failed controls stop.
Read-only Git subprocesses are separately counted/reaped (maximum 1200 per
verifier invocation, 5-second and 4-MiB bounds each), not included in the 28 Node
children. Preparation Git calls are not workflow outcomes.

## Admission and provenance

The accepted full build/pack reproduction is **bound, not repeated**. This run
authenticates all 269 pinned committed build inputs, the full 858-member packed
artifact, then extracts it as regular files under this scope. It physically
moves the consumer; the old location must be absent. Actual public `nextLoad`
hashes, not disk inventory alone, bind the running package.

The existing qualified SafeJS regular-copy recipe supplies the exact 264-file
engine inventory and 63-file import closure. No private build/install/worktree,
symlink or write occurs. Copies, including TS, stay under owned `node_modules`.
Only engine `.js` specifiers may resolve to copied `.ts`, using authenticated
TypeScript 5.9.3 and explicit emitted-byte receipts. Product source fallback is
forbidden. Pre/post private checks cover HEAD/status/staged/index, selected root
metadata, and the complete qualified engine inventory including new entries,
modes/hashes/mtime/ctime. Atime and historical excluded build/cache directories
are not purity claims. AGENTS was read for instructions only, never copied.

`BINDINGS.json` authenticates the tools, manifests, existing accepted proof and
source inputs before execution. `MANIFEST.json` seals this entire recipe before
the first product load. Execute only once with pinned Node:

```
node execute.mjs <MANIFEST.json SHA256>
```

## Exclusions

HTTP, authorization and delayed response bodies are **injected mocks**; SafeJS
is the **actual engine**. No external network, credentials, deployed S3/DAV,
native timeout, signal/hard-preemption parity, broad provider guarantee or full
gate claim. One default-clock workflow proves bounded completion/retirement,
not a hard latency bound. Prior S1, dialect/rejection, zero-retry and historical
failure qualifications remain intact. The original 25 SafeJS profiles and
accepted public78 cohorts are not rerun/rescored. Preparation failures remain
in `PREPARATION.md`.
