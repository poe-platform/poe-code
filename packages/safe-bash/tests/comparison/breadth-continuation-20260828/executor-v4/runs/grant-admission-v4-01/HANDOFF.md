# Single V4 runtime-admission attempt: STOP

August 28, 2026. **UNSAFE_STOP; admission not qualified. No retry.**

## Authority and launch

- Exact recipe `b993d26cd6777567ab6de45c617f1b073dd0d1de`, seal
  `fc1a0df0015ebd428810c8d86976f3507636eac1c308f366298511fca38cf0e8`.
- Accepted different review `91b7a93f60640a9496c65147fb29c8610d29f7f4`;
  REVIEW SHA256 `c9ca7175e426140afccbca23b265918a263af55ff12e21efb4995ec6161584f4`.
- Root grant commit `c1b03b641aa51f36e1461973e6d635103e1ef1e5`, exact GRANT SHA256
  `31fac8c969b07d2a41c9b52720b0c8c1eeea8a895338ebdcea013d3e19293c52`.
  AUTH references were separately committed as `4be58ad2` before launch.
- `admission-v4-01`, phase admission, attempts1. Exact interface Node22.22.2 argv
  was launched once with strict unhandled rejections and 256MiB old-space.
  ROOT-MESSAGE, interface binding, phase-plan hash, tools and launcher were sealed
  before launch. Recipe SHA means SEAL bytes; raw coordinator/plan hashes are separate.
- Coordinator PID/group4809: exit1, close1, no signal, reaped. Supervised probe
  PID4869/group4869: exit1, close1, no signals/supervision failures, reaped.
  Final absence checks cover both PIDs/groups. These were unsuccessful natural
  exits, not successful probe results. Capture persistence had no errors.
- Coordinator capture interval 11:33:14.793Z–11:33:20.045Z is bookkeeping,
  not a timing cohort or hard-latency guarantee. No additional coordinator deadline
  policy was substituted; heap is not RSS and checked elapsed is not preemption.

## Actual failure and actionable diagnosis

The first target-installed public-consumer probe returned a complete fatal envelope:
`UNBOUND_MODULE`, bare specifier `virtual-bash`, resolved URL
`file:///Users/kjopek/Workspace/safe-bash/dist/index.js`.
The strict loader rejected that URL before reading/returning product module source.
Only `consumer.mjs` has one actual returned-source witness; export evaluation did
not succeed. Empty child stdout/stderr and the full FD3 bytes/envelope are retained.

The projection puts consumer.mjs beneath this repository without a consumer-root
package.json. The observed containing package is named virtual-bash and exports its
root to dist/index.js. This supports a **harness package-scope/self-reference
contamination diagnosis**, not a product behavior failure. No fallback was accepted.

Recommended root action: route a minimal versioned projection repair defining an
exact hash-bound, non-virtual-bash consumer package scope for both target layouts,
with bare-export, moved-load and wrong-root/fallback controls. Keep source allowlists
strict; do not alias the import to a direct source path. That repair needs different
freeze and a fresh root grant. No repair or new attempt is performed here.

## Completed versus unexecuted

- Exact accepted target pack6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06
  and pinned just-bash3.4.2 archive authenticated. This is accepted-pack reuse,
  **not a rebuild, full-pack reproduction or full-history proof**.
- Comparator source closure:3843 regular content files,1 instruction member
  metadata-only,4275 total entries; before/after and independent post-stop guards
  pass. Instruction plaintext was never materialized or read for proof.
- Fresh projections:859 files/904 entries per target layout;3844 files/4275 entries
  for comparator. Target was physically moved and old origin is absent. All exact
  file/mode/hash/new-entry/symlink post-guards pass. **Disk projection is not load proof.**
- **1/14 planned worker launches,0 qualified probes**. Moved and comparator probes
  are UNRUN_UNSAFE_TAIL. All12 control families, including both C11 setups and C12,
  are UNRUN_PREPARATION_OR_UNSAFE_STOP;13 planned worker operations are unlaunched.
- Ledger:1 enrolled/attempted/launched/closed,0 unknown acquisitions, all reaped.
  Ledger unsafe=false denotes successful capture/closure only; overall result
  unsafe=true/status UNSAFE_STOP. admissionQualified was never assigned.
- **0 C11 setups,0 semantic calls**. No actual engine-module load, comparator
  evaluation, applicable CJS/asset admission or semantic qualification.99 semantic
  calls remain unauthorized. No install/network/native/timing/private/XAN actions.

## Retention

RAW-CAPTURES.json.gz preserves exact base64 bytes of all six top-level run captures,
the exclusive authority lock and eleven grant/launch records; its manifest binds
every input. This is a compact evidence archive, not a package/source archive.
RESULT and the worker receipt are also retained directly. Original files and bounded
materialized views remain on disk; views are not duplicated in Git and their exact
indices are in STAGED.json inside the capture archive. No original artifact changed.

The auxiliary prelaunch checker initially compared tool.size (absent) instead of
tool.bytes; that preparation error remains disclosed in PREFLIGHT. Actual tool hashes
and bytes matched; it neither launched nor consumed the admission attempt.

W07 comparator non-execution stays UNQUALIFIED/UNCREDITED. Original35/44/nine failures,
400/402,391/394 and13/54 versus47/54 remain unchanged. No historical or full-gate pass.
