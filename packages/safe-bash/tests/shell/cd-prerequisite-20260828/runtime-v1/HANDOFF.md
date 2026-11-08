# CD prerequisite candidate for different review

August 28, 2026. **AUTHOR result only; Locke's actual candidate review is pending.**
Directory-stack implementation remains held. No public/root/contract/provider or
shell.ts change accompanies this source batch.

## Exact candidate binding

- Source/test commit: `4641075df5355a91c83bf5b2cc3a88dfaf1f5153`.
- Runtime Git blob: `d32239c31e5b4cdf11fd7863a407283119a209ec`.
- Runtime SHA-256: `93c06908aec9d5d61d801657f99ab75122cadb6688f038e1941c587b4a8d4ed3`.
- Accepted baseline: `5137a74ec855a32d8a8860eb66b62eb44d11e290`.
- Baseline runtime is byte-identical to accepted fd1 Stage2 runtime, SHA-256
  `b44d60ed225c2d2add07499b965043d104491edf837cb5cf7f07096230286169`.
- Override only `src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md` from
  `ca1d33424b94a21ae0f40a36412fd8191611e2df`, then only runtime.ts from this
  candidate. Do **not** execute the moving candidate HEAD tree as that composition.
- The accepted pre-cd provider composition remains tree
  `7c68831a81fc49c94ad9177e58ca9fd7d0aca352`.
- Bound independent controls: `beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e` plus
  normative appendix `2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c`, rooted in
  ratification `ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de`.

The source delta adds private bounded helpers and modifies only the cd branch
plus its FsError import. The reconstruction asserts all 58 other Runtime members
are text-identical and all other builtin statements are text-identical. No state
initializer/clone, checked-variable implementation, invocation cancellation,
owned-output lifecycle, shared Budget, or unrelated exception formatter changed.

## Actual committed-blob results

`candidate-04.json.gz.base64` is the final replay against the committed source
blob, not worktree mode. Its 292 selected input records identify source, package,
build configuration and explicit regression fixtures. No AGENTS or whole-tree
archive is included. Raw stdout/stderr/status/signals and original author fixture
bytes are retained, as are the complete public package and load receipts.

| Check | Actual result |
| --- | --- |
| Source author checks | 87/87, zero skips/TODO/cancellations |
| Installed package author checks | 87/87, zero skips/TODO/cancellations |
| Moved package author checks | 87/87, zero skips/TODO/cancellations |
| Selected existing shell/state/env/getopts/Stage2 regressions | 239/239 |
| Existing owned-output operation/shell/network regressions | 42/42 |
| Scoped source/test types and fixed-composition build | exit 0 each |
| Strict installed and moved public-consumer types | exit 0 each |
| Emitted-runtime tamper controls | rejected in both layouts as expected |

The 87 checks comprise **59 author behavior/boundary checks plus 28 preserved
native-observation mapping checks**, not 87 native comparisons. Mapping C01-C27
matches the preserved observations under the disclosed fixture normalization;
C28 deliberately asserts the known native failure versus virtual dot success.
Original native28 and original directory-stack0/34 remain untouched. No new
GNU5.3 native execution or directory-stack implementation occurred. The existing
variable-scope regression separately runs ten `/bin/bash` comparisons using its
unchanged helper; the actual host binary hash is in each final capture.

All five public adapter controls run in source, installed and moved layouts:
Memory, configured task-owned Real, readonly Memory, injected S3 mock, injected
WebDAV responses. This is not new real-service or remote ACL evidence. The exact
WebDAV request sequence includes the existing provider's parent lookup after
ENOENT and a separate fresh stat for directory X_OK; no listing/content read or
permission inference replaces that access check.

The built package has **846 files**, SHA-256
`06ea635b201a1296268adaa452a2419682f92ec93906cb9083e327dc69f85914`.
Each installed/moved positive layout actually loads **207 distinct emitted
product modules**, all matched against the inventory. Product inventory is
unchanged after positives and restored byte-for-byte after the deliberately
failing tamper control. Development captures01-03 have the same package hash;
fixture repairs did not change production.

## Initial failures and exact fixture changes

| Capture | Source-focused result | Other retained failures |
| --- | --- | --- |
| baseline01 | 18 pass / 69 fail | author byte-API/S3-option types and omitted helper |
| candidate01 | 48 pass / 39 fail | same binding/type failures; 227/230 reached regression cases pass |
| baseline02 | 39 pass / 48 fail | corrected harness; old runtime lacks approved functionality |
| candidate02 | 86 pass / 1 fail | WebDAV expected wrong second request; same in installed/moved |
| baseline03 | 39 pass / 48 fail | fresh exact final fixture baseline |
| candidate03 | 87/87 each layout | worktree-mode development proof, not the final frozen binding |
| candidate04 | 87/87 each layout | committed-blob replay; only intentional tamper exits are nonzero |

README details the actual version01 repair: register standardCommands for printf,
use byte payloads, use public S3 `transport`, and include the three omitted
existing regression helpers. Version02 captured the actual WebDAV sequence;
version03 corrects only its second expected path from `/dav/absent/target/` to
`/dav/absent`. The provider's unchanged stat implementation checks ancestors to
distinguish ENOTDIR after ENOENT. No test body/native expectation was silently
removed, no provider fix was invented, and earlier raw fixture bytes remain in
their compressed captures. Adding four existing owned-output files raises the
selected-input count to292 and provides a separate42-test result, not a rescore
of the earlier230/239 regression denominators.

## Replay, cleanup, remaining limits

```
node tests/shell/cd-prerequisite-20260828/runtime-v1/verify-evidence.mjs
node tests/shell/cd-prerequisite-20260828/runtime-v1/validate.mjs candidate 05 4641075df5355a91c83bf5b2cc3a88dfaf1f5153
```

Use a different unused two-digit output version if05 already exists. The first
command verifies recorded binding/history without rerunning product tests.
The second reconstructs the fixed source and reruns the bounded author batch.
Seven author temporary roots from the recorded attempts were removed; all
recorded direct children exited with no signal/error, including expected loader
rejections. Existing successful test helpers close their nested probes/servers.
No author service or validation session remains active, no private checkout was
used, no package dependency was installed, and no global/root configuration was
edited. Root scratch data and other workers' artifacts were not cleaned.

Residual profile boundaries are intentional and remain explicit: cd empty-string
dot behavior; no physical -L/-P rewrite or stack family; EPERM/ELOOP fatal search;
bounded logical work rather than a global deadline/preemption promise; provider
X_OK rather than POSIX/remote ACL equivalence; diagnostic payload cap rather
than whole-line/global stderr/RSS bound. This is not full gate or Bash parity.
