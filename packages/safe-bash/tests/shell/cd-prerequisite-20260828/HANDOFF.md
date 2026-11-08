# CD prerequisite blocked on existing DAV traversal profile

## Exact scope and decision needed

**No production changes.** Current `src/shell/runtime.ts` is byte-identical to
accepted `5137a74ec855a32d8a8860eb66b62eb44d11e290`, SHA256
`b44d60ed225c2d2add07499b965043d104491edf837cb5cf7f07096230286169`.
The authorized conditional gate prevents adding mandatory X_OK while a supported
adapter rejects it. Existing `cd /directory; pwd` succeeds on all five tested
adapters; DAV's new prerequisite would fail a previously valid workflow.

| Fixed packed adapter | Directory stat | Directory X_OK | Existing cd | Missing X_OK | File X_OK | Preaborted X_OK |
| --- | --- | --- | --- | --- | --- | --- |
| Memory | directory | success | 0, `/directory` | ENOENT | EACCES | exact reason |
| Real, task-owned root | directory | success | 0, `/directory` | ENOENT | EACCES | exact reason |
| readonly over Memory | directory | success | 0, `/directory` | ENOENT | EACCES | exact reason |
| S3 / actual MockS3Client | directory | success | 0, `/directory` | ENOENT | EACCES | typed ECANCELED, not identical reason |
| WebDAV / actual MockDav | directory | **ENOTSUP** | **0, `/directory`** | ENOTSUP | ENOTSUP | ENOTSUP, not identical reason |

`src/fs/webdav/webdav.ts:965` rejects `mode & 3` before stat or cancellation.
`src/fs/webdav/README.md:113` documents unsupported write/execute probes. This is
an existing declared profile incompatibility, not a new cd implementation defect.
Only two DAV requests occurred: directory stat and baseline cd stat, both
PROPFIND; all access probes rejected locally without network work.

**Recommended separate root authorization:** have the provider owner support
directory X_OK as a truthful *virtual traversal policy* after successful bound
directory metadata authorization, preserving denial/missing/abort and retaining
file-execution/write-probe restrictions. The existing contract already allows
this for non-permission providers (`src/contracts/filesystem.md:305`); it does
not establish POSIX execute permission or guarantee later content authorization.
Required provider tests: authorized directory, 401/403, missing, file, aborted,
readonly forwarding, real-server declared-profile evidence. Decide combined
mode behavior explicitly; do not infer access from advisory mode bits. This
requires separately authorized WebDAV source/docs/tests, **outside this task's
runtime-only write set**. Do not silently swallow ENOTSUP in cd or omit X_OK.

The S3 abort row describes the existing direct FS boundary, not an escaping shell
rejection. Future cd must keep existing caller-signal precedence, checking before
and after metadata awaits so a provider-mapped cancellation is not selected as
an ordinary search miss. No S3 or shared-contract repair is proposed here.

## Presealed GNU5.3 observations

Freeze `317128ddbce8ac9d321870f46957c33bca257612` precedes execution.
28 scripts actually executed, with **21 successful cd operations and seven
diagnostic/status1 observations**, not 28 newly passing product tests. Every
script's final snapshot printf exits0; intermediate cd status is captured
separately. The task-owned mode000 directory was actually denied by native
access(EACCES), UID501, not assumed from mode bits.

| Cases | Observed behavior |
| --- | --- |
| C01–02 | First matching nonempty CDPATH component wins before cwd fallback; reversing order reverses selection; print the logical absolute path. |
| C03–07 | Leading/interior/trailing empty components, empty CDPATH and unset CDPATH select the cwd-relative match without printing. |
| C08 | Exhausted nonempty candidates still try the cwd-relative operand; success without CDPATH printing. |
| C09 | Relative CDPATH entry resolves against original cwd and prints the selected absolute logical path. |
| C10–14 | Absolute operands and leading `./`, `../`, exact `.` and `..` bypass CDPATH; no search printing. |
| C15–16 | An earlier file or search-denied candidate does not block a later directory; later success prints. |
| C17–19 | Final cwd-relative ENOENT supplies the diagnostic even after an earlier file or EACCES candidate; status1, bindings unchanged. |
| C20 | Final cwd-relative file supplies ENOTDIR after missing search candidates; status1, bindings unchanged. |
| C21 | A CDPATH symlink match stores/prints logical `/fixture/alias/target`, not the physical target spelling. |
| C22–23 | Absolute HOME bypasses search; **relative HOME participates in CDPATH** and prints on a nonempty match. |
| C24–25 | Dash converts OLDPWD first; absolute OLD bypasses search, relative OLD participates; both print, exactly once. |
| C26–27 | Missing HOME/OLDPWD yields status1 and the named missing-variable diagnostic before directory effects. |
| C28 | Explicit empty operand yields status1, `cd: null directory`, unchanged bindings. Existing virtual `target || "."` differs; no empty-operand fix silently bundled. |

Before a candidate, root should bind whether C28 remains the existing profile
under “preserve HOME/OLDPWD behavior” or authorize this narrowly observed explicit
operand correction. Empty HOME/OLDPWD values were **not** measured by C28 and are
not inferred. No additional native probe is necessary for the demonstrated
CDPATH ordering/fallback prerequisite; new edge questions need a separate seal.

## Runtime-only implementation plan after prerequisite resolution

Keep the selected-directory operation sequence:
`stat directory → delegated X_OK → checked OLDPWD → cwd → checked PWD`.
No native chdir, mode inference, host UID probe, physical-path rewrite, stack
state, parser change, new command charge or budget reset. HOME/OLDPWD lookup
stays before search. Search starts only after bounded validation of its inputs;
checked variable failures retain the existing stronger fail-fast/partial-state
semantics. Await logical path output after publication; no rollback on sink
failure. Print once if dash or a nonempty CDPATH component selected the result.

Proposed private bounds to bind with the candidate (not yet implemented): 64KiB
UTF8 CDPATH and operand/constructed path, at most4096 CDPATH components plus one
fallback probe, two provider calls per viable candidate, 8Mi helper steps with
128-step yielding through existing interruption, no extra Budget command ticks.
Validate/scan before split/allocation; preserve existing expansion and parent
output accounting. Approved diagnostics: at most64KiB+256 bytes within the
parent output budget, retaining the command/diagnostic category and explicit
truncation rather than allocating an unbounded provider message. An output or
abort failure remains governed by existing runtime mapping, not a usage error.
Exact bound errors require candidate tests; these are not global work/time or
provider-preemption guarantees. Root may choose narrower private probe bounds
before implementation without changing public limits.

## Authentication, provenance and cleanup

- GNU binary: `/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`;
  `GNU bash, version 5.3.0(1)-release (aarch64-apple-darwin25.4.0)`;
  SHA256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Primary local distribution manual `bash-5.3/doc/bashref.texi`, cd section;
  SHA256 `f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`.
  Web manual retrieval returned no content; the pinned primary local manual was
  read directly. No implementation/manual text is vendored.
- Capture: August28,2026 03:02:28–03:02:30 UTC, Darwin25.4.0/arm64, Node22.22.2.
  No GNU/Linux or Bash3.2 claim. Startup files disabled; explicit environment,
  closed stdin, 5-second/128KiB native child bounds, no retries.
- Full accepted packed module closure SHA256:
  `13fe54de1cf900d587855e276375fdf72ed1ed0d0e0625cf7ef00730f2bb74c9`;
  all846 extracted package entries authenticated against the earlier full-pack
  inventory before/after. Product imports use that isolated package's root,
  not live src or a dist fallback. This is inventory authentication, **not** an
  assertion that all846 files executed or a new installed/moved candidate gate.
- Mock helper input SHA256
  `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36`;
  sole runtime import rebound to packed resource-id registration; development
  TypeScript5.9.3 transpilation, original/emitted hashes recorded. No behavior
  change or fake namespace identity; not an all-inputs-unchanged helper claim.
- `observations-01.json.gz.base64`, decoded compressed SHA256:
  `b9f81d6f6507a5d110d0a196cabebe5d4ea1e803994d817485ed0c71520df592`.
  Original stdout/stderr bytes, every script/env, adapter outcomes, helper delta,
  package inventories and source/native/tool hashes retained. Data-only check:
  `node tests/shell/cd-prerequisite-20260828/verify.mjs` (not a guest rerun).
- 31 synchronous children closed: 28 native scripts, two version witnesses,
  one package extraction. All five Shell instances disposed; only task-owned
  temp root/data removed. Native binary/manual and live runtime unchanged.
  No background children, service ports, private reads/writes, installs,
  production modifications, global typecheck/build or candidate regression run.

Original directory-stack0/34 and its four followups remain immutable and are
not rescored. This is a **blocked precode handoff**, not a CD implementation,
independent review, directory-stack acceptance or full-gate result. Once the
provider prerequisite is resolved, author the runtime-only candidate and send
it for Locke's different review before any stack integration.
