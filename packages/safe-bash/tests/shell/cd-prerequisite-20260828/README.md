# CD prerequisite: precode qualification

This is an explicit, version-bound observation harness, not canonical discovery
or a runtime candidate. Scope is fixed accepted `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
No directory-stack implementation, provider change, root wiring or new limit API.

Before execution, seal 28 GNU Bash 5.3 scripts in `cases.json` and this runner.
Capture order, empty CDPATH components, cwd fallback, error precedence, logical
spelling, HOME and OLDPWD. The scripts record intermediate cd status and bindings;
the final printf status is not counted as cd success. These are observations,
not guessed native assertions. Native stderr is preserved byte-for-byte; the
display normalization substitutes only the task-owned fixture root.

Also exercise actual Memory, Real, readonly-over-Memory, S3/MockS3Client and
WebDAV/MockDav from the authenticated accepted public package. For each, capture
directory stat then delegated X_OK, ordinary existing cd, missing/file probes
and exact preaborted-reason identity. MockDav is the existing test helper from
the same fixed commit, transpiled with the installed development TypeScript;
its sole runtime import is rebound to the packed resource-registration module.
No behavior is changed or invented in that helper. This is a mock compatibility
check, not new real-service acceptance. Product modules never come from live src.

Known pre-execution blocker from source inspection: WebDAV `access` rejects
all X_OK, including directories, with ENOTSUP before its stat. Existing DAV cd
requires stat only. Therefore adding mandatory delegated X_OK would remove a
working profile. Runtime implementation stays held until root resolves this
provider prerequisite; no ENOTSUP bypass, synthetic mode check or provider edit
is authorized here. The shared contract already permits truthful virtual
directory traversal policy on non-permission backends; it does not require it.

All native fixtures and RealFS roots are newly created task-owned temporary
directories. Native startup files and inherited shell configuration are disabled;
environment is explicit, stdin closed, each native child has 5 seconds and 128KiB
capture bounds. No network service, private checkout, user HOME, dependency
installation or native product fallback. Denied-directory checks are witnessed
with native access rather than inferred from advisory mode bits. Cleanup restores
only the task-owned denied fixture's mode before removing its task root.

Commands (capture is one-shot and refuses existing evidence):

```
node tests/shell/cd-prerequisite-20260828/run.mjs --seal
git add tests/shell/cd-prerequisite-20260828/{cases.json,README.md,run.mjs,FREEZE.json}
git commit --only -m 'test(shell): seal cd prerequisite qualification' -- tests/shell/cd-prerequisite-20260828/{cases.json,README.md,run.mjs,FREEZE.json}
node tests/shell/cd-prerequisite-20260828/run.mjs --capture
```

Preserved history: directory-stack `50602367`, original 34 native/virtual pairs
with 0/34 matches, accidental bundled snapshot-flag errors and four separately
captured native followups are not rescored by this cd-only qualification.
This work does not change the accepted combined77/Stage2 source or earlier
component, SafeJS, getopts, DU or cancellation evidence.
