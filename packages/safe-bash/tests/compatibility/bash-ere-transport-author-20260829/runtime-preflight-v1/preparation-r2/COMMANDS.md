# Prospective executable command — DO NOT RUN without fresh ROOT GO

Execution preseal SHA256: `97c27022e9f5b80be43c2b74e5e2901a970ac52138ec653336d6e38a62d3430c`.
Authority manifest SHA256: `3f200a4f93160caa9ba5c6cad93dfb185fc3cefd994157ef92f71aebd90529b5`.

Root must separately accept all exact importer edges and create/commit `ROOT-GRANT.json` with the template's exact ten keys, changing authorized to true and supplying its retained SHA256 below. Merely executing this command without that grant refuses. The current template is deliberately inactive. The current exact CASES tree and empty ACTUAL-01 parent are preprovisioned; missing/drifted inputs, existing owner captures or missing parents are STOP, not automatic reconstruction/retry.

Run from `/Users/kjopek/Workspace/safe-bash`, through the pinned non-login `/bin/zsh` tool. `set -C` prevents overwrite of the fresh external raw captures. The shell/env/Node exec transitions occupy one process identity, not three concurrent children. Replace only `ROOT_GRANT_SHA256` with the hash of the separately authorized exact record:

```sh
set -C
exec /usr/bin/env -i \
  PATH=/Users/kjopek/.nvm/versions/node/v22.22.2/bin \
  LANG=C LC_ALL=C \
  HOME=/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/preparation-r2/ACTUAL-01 \
  TMPDIR=/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/preparation-r2/ACTUAL-01 \
  /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node \
  tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/preparation-r2/supervisor.mjs \
  97c27022e9f5b80be43c2b74e5e2901a970ac52138ec653336d6e38a62d3430c \
  ROOT_GRANT_SHA256 \
  > tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/preparation-r2/capture/ACTUAL-01.outer.stdout \
  2> tests/compatibility/bash-ere-transport-author-20260829/runtime-preflight-v1/preparation-r2/capture/ACTUAL-01.outer.stderr
```

## Proposed ceilings and enforcement scope

-146 known OS processes: one external supervisor,135 sequential case Nodes, ten reserved grant/authentication/publication administration starts. Peak3 known OS including outer tool owner. At most111 cumulative Workers, one concurrently; V8/libuv/native helper-thread totals are not censused or promised. No guest interpreter or subprocess inside a case.
-30 minutes observed owner-entry through archive/cleanup/publication, excluding tool scheduling/startup. Each case gets at most10 seconds before TERM, then2 seconds before KILL;180 seconds reserved for publication.135×10 seconds leaves450 seconds for escalation and administration. Admission refuses when its remaining reserve cannot fit; this does not promise every cell completes under worst-case host scheduling or IO latency. Unknown retirement/capture/integrity or deadline is STOP, not clean.
-64MiB combined capture, each stdout/stderr channel64KiB, receipt128KiB, proposed A03 child-load64KiB;135×320KiB plus16MiB owner allowance is below64MiB.256MiB owned working files, no RSS guarantee. Full input census is checked before and after each cell, allowing only its declared receipt and A03 child-log append paths. Archive is authenticated before removing future case roots; raw outer and owner captures remain retained.
-Actual Worker options are unchanged: startup3000ms, request1000ms, empty env/execArgv, exact operation/version workerData, owned stdout/stderr, old-generation128MiB and stack4MiB. No public option/limit changes. Parent and engine logical A/W ledgers remain distinct, including the historical native-enumeration/clone exception.

## Authority is not inherited containment

This proposes a trusted, byte-bound host Node test harness, not an OS sandbox. No Node permission flags are silently inherited from expr, Node-command or comparison campaigns. `AUTHORITY.json` lists exact per-cell importer-to-builtin edges. `node:child_process` belongs only to the external owner; Worker construction belongs only to the bound parent bridge. Ordinary Workers use the sealed local static entry and closure.23 malformed/scheduling assets import only node:worker_threads. Proposed A03 bootstrap alone adds fs/crypto/module/url/path for its exact adjacent manifest/log and bound local engine files; no arbitrary URL/eval/subprocess/network path is admitted. The parent hook does not propagate into an execArgv-empty Worker. Different review and explicit ROOT authority are required for these actual capabilities.

The receipt gate joins actual child exit and pipe closure with strict finite receipt keys, Worker attempts/created/online/exited/retired/drain/unknown counts, trace consistency and parent-load hashes. A PASS string with nonzero exit is not acceptance. L08's deliberate test-owner retirement is separate from subject cleanup failure. Ordinary fully captured/retired assertion failures may aggregate; safety or unknown ownership cannot.

Reproduction inputs are the12 individual source records, original producer/package, versioned fixture sources and the complete current CASE archive/inventory. The materializer source documents actual installed/moved construction. A lost working layout requires newly authorized DATA reconstruction/authentication before dispatch; neither missing inputs nor an unbound moving HEAD is a fallback.
