# F05 v6: preadmission HOLD

Date: 2026-08-28. DATA/source audit only; no candidate activation.

## Decision

ROOT approved the exact normal CLI proposal `3d15ecc1b24863a0c1d96907a4e7d42c7bd41ae6` conditionally. The required outside raw-capture and whole-CLI supervision contract is unproven in the exposed tool interface, so admission remains closed. This is not another failed 0/34 control cohort and not a product finding. No fallback, probe, warmup or retry was attempted.

The pinned launcher starts its deadline inside `launch()`, after the CLI has already started and imported local modules. Its owner, capture handlers and TERM/KILL logic supervise the inner controller. The approved profile separately requires an external direct-exec owner to enroll before CLI admission, retain bounded raw stdout/stderr, include startup and cleanup in300000ms, and observe retirement.

`functions.exec_command` exposes a yield interval and rendered-token budget, not the necessary documented pre-admission wall deadline, raw-byte archive and process-tree retirement contract. Polling or bare shell redirection does not prove that complete contract. Adding a retained Node REPL/Node wrapper owner to the exact CLI+controller would require three campaign Node processes, exceeding the approved two. No private tool implementation was read and no hidden guarantees were assumed. This is an exposed-contract gap, not a claim that all host supervision is impossible.

## Exact unreleased invocation

`INVOCATION.json` records exact executable, argv, cwd, finite environment, local-module hashes and unchanged controller permission grants. The only unresolved argv value is the hash of the absent required v5 `ROOT-GO.json`; no digest or grant file was fabricated. This template is NOT an instruction to execute without resolving the HOLD:

```text
cwd: /Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v5-f05-local-esm
env exactly: PATH=/usr/bin:/bin LC_ALL=C TZ=UTC
executable: /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node
argv: ["--max-old-space-size=64","--unhandled-rejections=strict","/Users/kjopek/Workspace/safe-bash/tests/commands/node-provider-experiments-20260828/repair-v5-f05-local-esm/cli-entry.mjs","3d15ecc1b24863a0c1d96907a4e7d42c7bd41ae6","ed7e26d66ce4518bd1ade27c618dc2a9a1f30bb0d9e5f875cfd47b3f6acdfac3","<fresh-ROOT-GO-file-sha256>","F05V5-c602d053df472872f745ed681ee469c5"]
```

The approved outer CLI is explicitly trusted and has no Node permission flags; only its controller is permissioned. No Workspace wildcard or new permission grant was introduced. If ROOT requires enforced narrow outer filesystem permissions rather than the exact approved trusted-outer mode, that requires a separately authorized recipe change.

## Authenticated bindings

- Proposal profile: `90a57a67add81cdf9fb6d9fd961045f3d312e5cd35f9704e4c18d74988c12f8b`; exact byte copy in `APPROVED-PROFILE.json`.
- Proposal preseal: `ed7e26d66ce4518bd1ade27c618dc2a9a1f30bb0d9e5f875cfd47b3f6acdfac3`.
- This complete audit profile: `7dda3fc4b95af6ba8fe940f2e6a8125229f4fa2d55861007b0591d5ae4dd6b0d`.
- Node22.22.2 body: `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`,112989184 bytes, read-only stream hash; no version command.
- CLI entry: `9b5bd44a0ca7b1e9f795537ea0e6105b6a7c92dba22baf2ea1b42e8fa7ea720b`.
- CLI launcher: `0e910c163c73d665d76bf2dd9815032a222ecdc2a9bbc6fb076b627c22c1c126`.
- Controller: `828c7a8927f2fd0f7ac00c7f3990ff826f0075ce0254c5bc1d35dbfb7875395e`.
- Whole subject: `de2198d1274b7e232d99a64cabd4f10a8693118e1ff12ffcb037db9feea2ce83`.
- Frozen34 plan: `6412e1c862d2af1c41ed0dcbe32b911e016f543335eeb1857782a3a782c21429`.

`AUTHENTICATION.json` records all21 proposal files(238043 bytes),33 committed controller inputs(667940 bytes), NUL Git inventories, canonical existing components and append-aware directory membership. All54 live bodies equal their exact committed bindings. Existing path ancestors have no symlink/alias, files are regular single-link. Missing runtime roots have no invented realpath: their first absent component and canonical existing parent are recorded. These checks are snapshots, not namespace leases.

Exact v4 `inputs/runs` and `inputs/runs/f05-admission-01`, v5 `activation`, and v5 `ROOT-GO.json` were absent. None was acquired, reused, removed or modified. Only new v6 audit files are written. No AGENTS snapshot is retained.

## Counts and limits

Frozen inventory remains34 distinct control IDs across F05 and F03:31 whole composed acceptance routes plus3 direct reconciler routes, with2 expected accepts and32 expected rejects. F05 strictfalse and other existing stricttrue requirements remain byte-identical; no expectations or optional-field semantics changed. Mock load/close ports and fixture engineEntered1 remain inert DATA, not actual engine entry.

Actual activation0; unique dynamic labels/controls0; composed/direct0; accepted/rejected/passed/failed0; all34 UNRUN; replays0. Campaign CLI/controller/fixture children0, peak0, natural/contained retirements0, rescue0. Raw campaign stdout/stderr/capture/work0 bytes; no campaign elapsed time, exit/signal, close receipt or archive exists. Cleanup is not required because no campaign resources were acquired. Shell/Git/builtin metadata reads and audit JSON validation are source preparation, not control runs or campaign retirement evidence.

The unspent activation limits remain300000ms inclusive, peak2 campaign Node processes, maximum6 owned children,0 fixture children,16MiB capture,64MiB work,65536 combined outside CLI raw bytes and65536 combined controller raw bytes. No aggregate runtime-bound compliance is claimed without a run.

## Preserved history and next authority

- v3 `badc99d3c4a66312908c8a8c0a800eba55c510cd`: filesystem admission0/34, unchanged.
- v4 `14aeec7214fd9d6b45952b93026129e0f9c0ec71`: unsupported data-URL host-loader admission0/34, separate and unchanged.
- v5 proposal `3d15ecc1b24863a0c1d96907a4e7d42c7bd41ae6`: source-only UNRUN checkpoint, unchanged.
- Original Raman20/21 HOLD+3unscored/11harmlesschildren/rescue0 and prior author10observations/sevenchildren(4natural,3SIGTERM) remain unrescored.
- Main code `dccf634ae3fa2ffe6decab4955dcef55d48cd7c9`, manifest `b83584d1584474a7899510ed55dd76cf09aa8fa39d913da83273a08317a92bb4`:480s/192MiB/9directchildren10processes/66sources18bindings4tools/eight engine evaluations UNRUN. Source manifest `a670629995f8cb7331a5e24d35ad4bb185dc0fbe5f70de8281598de615cd35b1`; tool manifest `4efc7ff6181d6f92dd9aa3fe67803c55af027adc734b701582998efb452ae788`.

ROOT must bind an existing direct-exec supervision capability satisfying pre-admission raw capture, bounded startup-inclusive deadline and retirement without a third campaign Node process, or separately authorize a revised supervisor/process recipe. The required grant-file path/bytes must also be bound before activation. Recheck exact unused runtime-root absence and commit a complete activation preseal before any launch. This packet's `PRESEAL.json` seals a HOLD audit, not an execution grant. No separate runtime evidence commit exists because no run occurred. Focused Raman review remains necessary; no automatic engine GO or Worker work.
