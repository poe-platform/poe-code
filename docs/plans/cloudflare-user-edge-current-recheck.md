# Cloudflare adapter current user edge recheck

September 14, 2026, reviewed HEAD `bb272573292ee712a09c1c5fdb1516f7a655dc97`.
Result: **BLOCKED / UNFINISHED; zero production requirements pass**.
Root owns this report, its new JSON capture and the integration-document update.
Existing modified/untracked work is preserved. No product code, README, existing
application Worker, deployment, push or release changes are made.

## Executed public user checks

Used Node v22.22.2 with `node --import tsx --input-type=module`, importing the
built `poe-code/safe-bash` entry point. Composed two public shells with
`new Shell({fs, env:{}}).use(agentCommands())`, sharing an explicitly created
`MemoryFileSystem`. The ephemeral probe used assertions and wrote only sanitized
results and source/build identifiers to [the capture](cloudflare-user-edge-current-evidence.json).
No executable QA driver or implementation-mirroring unit test was added.

Cases 0–9 in the capture, in order: inline `python`, `python3`, quoted script
path with argv, `-m json.tool`, piped program input, `--help`, `command -v python`,
output redirection, CPU-loop program and environment-import program.
Every Python dispatch returns 127 with zero stdout bytes; command lookup returns
1. Eight concurrent missing-command invocations also return 127. After each
serial attempt `printf recovered | cat` returns 0 and exact text `recovered`.
Repeated awaited disposal succeeds, and the sibling shell still executes.
The Python package subpath throws `ERR_PACKAGE_PATH_NOT_EXPORTED`; no exported
name contains Python/Pyodide. Five host-global descriptors remain unchanged.

These observations establish command absence and ordinary shell recovery only.
They do not execute the CPU loop or environment import, exercise interpreter
saturation, prove shared-provider ownership, authenticate assets or establish
Python global preservation. Redirection can have shell-owned filesystem effects
before a missing command is dispatched; no Python persistence inference is made.
The hashed built entries are existing artifacts, not a freshly rebuilt complete
authenticated closure. Missing adapter artifacts cannot be assigned passing hashes.

## Production requirement checklist and evidence classes

The [complete requirement-to-evidence checklist](cloudflare-adapter-final-review.md)
remains applicable: every row is blocked. This new capture supplements its older
revision; it does not rewrite historical evidence or certify the full build.

- Provider injection/ownership/admission, transport separation and preserved
  Python Node compatibility: no executor, original Python baseline or injection API.
- Canonical filesystem authority and actual persistence: no bridge or identified
  application backend/emulator; memory shell recovery is not durable-storage proof.
- Streams, pending-operation cleanup, cancellation, isolation, saturation and
  memory: no Python execution path to qualify. Same-isolate JSPI suspension alone
  supplies no independent CPU-loop termination mechanism.
- Supported packages, integrity/native-manifest failures and host globals:
  qualified package set remains empty; XLSX, DOCX and PDF families unqualified.
  No runtime pins, native manifest or executable asset inventory is available.
- Browser public execution, visible shared files, downloads, diagnostics and
  cancellation/reset: prior [Chrome screenshots and user checks](playground-python-user-recheck-2026-09-14.md)
  show command absence. They remain historical browser observations, not current
  Python acceptance. No visual code changed and no new browser pass is claimed.
- Deployment budget, reproducible builds, dependency/license inventory,
  pin upgrades/rollback and sanitized operational diagnostics: required procedures
  are documented in [integration guidance](../integrations/cloudflare-safe-bash-python.md)
  but unexecuted for an adapter. No accepted complete artifact exists.

Historical prototype seven-check/5,110.27 KiB gzip claims remain historical and
unreverified here. Current built safe-bash validates absence. Local workerd and
deployed public adapter checks remain blocked/unperformed: no runtime route,
application budget or admissible deployment provenance is available. No
credentials were inspected and no existing application integration is claimed.

## Independent review, validation and delivery

Independent read-only reviewer `independent_adapter_recheck` reviewed root/scoped
instructions and the same HEAD/artifact. Its separate public probe confirms
missing exports, Python/alias/module/stdin status 127, recovery and repeated
disposal. Selected source/build hashes match the earlier final-review capture;
the earlier report's HEAD is historical. It confirms that the integration document
correctly states absence and an empty qualified package set. Independent absence
review cannot pass the required final production-artifact review.

Documentation/evidence integrity and `git diff --check` are the affected checks;
unaffected maintained build/unit suites are not rerun. There is no validated
adapter defect to reproduce with a failing regression test and fix. Inventing a
replacement implementation would not be review of the requested candidate.

First blocking requirement: supply the public injected Pyodide executor and
preserved original Node API, with an achievable passing lifecycle contract.
Further prerequisites are actual persistent-backend wiring/emulation, qualified
runtime/document assets, application resource headroom and deployment provenance.
The production pipeline remains unfinished until all required rows pass against
one independently reviewed final artifact. Local documentation commit is reported
after creation; remote-main delivery and release are not attempted.
