# Stopped setup: confirmed environment defect, precise denial target unknown

**SOURCE/DATA ONLY — HOLD; no rerun, repair, permission change or release.**
Questions froze at `f094d05550bf776c756ae22e26fda62f1821a54d`, before detailed
stopped-run inspection, but after authoring/attempt and with prior source-chain
knowledge. All earlier acceptances remain scoped historical evidence.

## Immutable receipt

- Attempt evidence: `df89d474bb863b3815f6e81f81917dcef4227779`.
- Root authorization: `8e6b40ecd2cec2b6dcaf2ce80c0cff477d39e6eb`;
  receipt SHA256 `f29a198d05e113a2a0b913a57bd7a2b088a7f731d6121947527652c40d2b8e74`.
- Packet: `d9dd698a33421b197ee15432a6606ad91dd06c63`;
  normalized SHA256 `7e40e84c099d8eaa2e9bc4c1cc73274b4a174d699737f34b7015eb4eb706ec70`.
- Source: `fe15f1e406fa1039accddec25c696ae7187f6135`;
  normalized driver `25ee4ded79df9c4fe0a9c8031721887dd7c8e22cb56f10d42b3d415eb30c0527`.
- Candidate: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; unchanged expected
  package `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`
  is carried, not rebuilt or freshly accepted.

All **46 authorization binding records**, **38 shipping-file bindings**, and
**seven compressed + decoded raw capture hashes/lengths** match pinned Git
objects. Parsed-JSON driver/profile/projection/routes hashes match the packet.
The actual rendered OS profile hashes to
`2ef4644d137f912449a0ea958bfc86882d55831fb55176a32e6865bac1b91a56`.
Exact source/raw/profile/tool hashes and read-only observations are in
`DIAGNOSIS.json`; no original captures or executable sources are recopied.

## Proven route versus inferred denial

Paths below are under `tests/integration/full-gate-20260827/` at the stated pins.

1. Source `unified76-driver/launcher-v3/run.mjs:13` passes **process.env** to
   `fenced-supervisor.mjs:51`; `os-instruction-fence.mjs:89` preserves it except
   owned HOME/TMP fields. `supervise.mjs:16` launches that explicit environment.
2. `execute.mjs:50` creates authenticated tool aliases; `execute.mjs:51` creates
   a **different local environment**, and `execute.mjs:54` verifies finite
   `native:tool-bin` PATH plus the 197-entry Git-core binding. Native staging
   updates seven oracle variables, not PATH. Nothing installs this object into
   the worker's process.env.
3. `execute.mjs:73` passes the object to the candidate's immutable
   `combined-8670ebe8/prerequisites.mjs:18`. Its line22 nevertheless calls
   `execFileSync("git", ["--no-replace-objects", "show", candidate+":"+path],
   {cwd: repository})`: **env is omitted**. The supplied environment is used
   later at lines48/52/74, not here. Helper SHA256 is
   `60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db`
   (5,589 bytes), matching candidate/profile and the committed staged receipt.
4. Raw inner REPORT and stdout contain `spawnSync git EPERM` and this stack.
   `execute.mjs:139` retains only message/stack: errno, syscall, path, spawnargs,
   child status, original PATH, resolved target and authority-map index are
   **not recorded**. Either of the two ordered authority-member Git calls can
   produce this stack; their exact source-derived argv are in `DIAGNOSIS.json`.
5. Worker argv is plain pinned Node24 + worker.mjs + options, without
   `--permission`. Successful `external-admission.mjs:27` rejects nonempty
   NODE_OPTIONS; the explicit permission/runtime probes at `execute.mjs:81`
   and `execute.mjs:83` were not reached. This is **not evidence of a missing
   Node allow-child-process grant**. The recorded OS profile explicitly denies
   `/usr/bin/git`; earlier direct authenticated Git subprocesses are observed.
   A selector denial caused by inherited PATH is therefore consistent/likely,
   **not a dynamically observed absolute target or conclusive kernel diagnosis**.

## Reached, unreached, retained

One authorized CLI attempt exited1/HOLD, **0/14 phases**, zero production builds,
no canonical denominator and no pack. The inner `fullGateLaunched:false` means
no phase cohort began; it does not restore the consumed one-attempt authority.
Preflight has no issues and51 native identity bindings, not51 semantic passes.
Setup completed37,397 logical/37,392 physical candidate entries,452,090,184 opaque
Git-history bytes without checkout, dependency projection and36 staging entries.

The helper's later native-authority work, privateState, engine copy and guest
execution were not reached. Neither were runtime/permission probes, setup
sentinel, execution guards, A10 or final source/package/private sweeps.
Private scope reached only the264-file metadata would-copy traversal
(`projection.mjs:66`); `execute.mjs:141` requires privateBefore, absent here,
so **no private postguard ran**. No private write is on this reached pinned
path, but there is no private before/after integrity attestation.

Recorded worker PID/group19721 (parent19113) closed naturally: exit1,60,383ms,
22,826 output bytes, no signals/timeout/overflow/observed survivors. Observer
groups21117/21612/21613 also have no recorded survivors. Phase-protocol and
aggregate fence cleanliness are **false** because0/13 expected phase processes
ran. Natural worker reaping is not complete gate cleanup or exhaustive telemetry.

Read-only lstat/readdir at2026-08-28T09:34:12.057Z confirms retained output and
work-root identities, outer root and execution tree. Output contains only
ADMISSION.json/REPORT.json. Six exact omitted instruction paths, safejs-engine
and SETUP-COMPLETE.json are ENOENT. This is named-path metadata, not a temporal
all-alias/no-copy proof. All original roots remain untouched; see exact paths in
`DIAGNOSIS.json`. No private tree, payload or retained source body was read here.

## Minimal correction scope, not implemented

The **current driver wrapper** must give immutable prerequisites and all later
privateState calls a verified process environment, not merely an unused argument.
Use a bounded, observed helper execution context with finite authenticated PATH,
bound Git core, sanitized Git config/hooks/replace handling, owned HOME/TMP and
declared oracle variables under the **same shipping fence**. Preserve helper
results and environment updates; do not edit historical helper/product bytes.

Do not blindly mutate the existing worker's whole process.env: later
`execute.mjs:91` calls verifyExternal(), whose ambient guard rejects nonempty
GIT_* (`external-admission.mjs:27`). Keep ambient-injection checks separate from
authenticated driver-owned child routing, without removing either check or using
unsafe process-global changes across the helper's async imports. PATH alone is
neither complete tool/config provenance nor proof that this kernel error clears.

Future separately authorized bounded verification should cover both real
authority reads, implicit/later Git routes using synthetic owned private-state
fixtures first, empty/shadowed parent environment, unchanged selector negatives,
exact before-exec tool/env receipts, unchanged parent admission, cleanup and
source/instruction guards. Capture full error fields if refusal persists; obtain
explicit approval for any further probe instead of broadening permissions.
No ambient PATH tail, xcodebuild exception, unbound helper, private access or new
gate is authorized by this diagnosis. Rebound source/evidence and fresh root
release remain necessary after a reviewed repair.

## Review operations and preservation

Only Git show/metadata, builtin JSON/gzip/SHA256, exact retained-path lstat/readdir,
and owned apply_patch/commits were used. No author modules imported or executed;
no controls, native tools, build, A10, package, process/network probes or gate ran.
Raw gzip decoding was capped20MiB/file, profile24MiB, Git blob output6MiB;
no archives or instruction payloads were extracted or persisted. Prior tracked
independent artifacts have no diff against the question-freeze commit. Foreign
staging/artifacts were not changed. No scratch trees or long-running workers
were created by this review; all read-only Git subprocesses completed.
