# C18 independent sidecar — regular-file DATA preseal

2026-08-28. Leaf reviewer; no product authority. The author source is
33e2b4c7fb14c2ab5ad23be50ac07bcc4bfed848, disputed preparation successor
1d5892457775714fbbaea5673f0adb1f906f7681, evidence
0ed41d4786319d1f703a1b396da8063c4ad5732d. Original C18 is helper-local,
not a demonstrated controller bypass. Author-01 preparation failure and
author-02's unauthorized 66 helper/66 composed observations remain NOT CREDITED.

## Source adjudication before execution

The preserved 873-byte stderr explicitly reports Node v22.22.2's internal
`node:fs:1879` ERR_ACCESS_DENIED: `fs.symlink API requires full fs.read and
fs.write permissions.` The call originates in run-controls.mjs:44, fixture
construction, before its execute() admission assertions. The recorded child
uses --permission with scoped read/write grants, not full filesystem grants.
The receipt has exit 1, empty stdout, close/groupAbsent/retired true, no link
created. The denial is the intrinsic Node API permission check evidenced by
the stack, not a demonstrated platform sandbox rejection, tested capture
rejection, or product bug. No syscall tracing or newly executed denial claimed.

The second recipe moved fs.symlinkSync to the unrestricted parent and reused
the removed original work namespace. No child flag widening does NOT mean no
authority change. Its preparation relocation/retry lacked accepted GO. This
review neither executes that recipe nor grants it retrospective authorization.

## Fresh permitted run

One `data-01` attempt; one harmless observer child, peak controller+child two.
At most 300 seconds including guards/preparation/cleanup, child 45 seconds plus
2-second TERM grace; 128 MiB child old-space (not RSS); 1 MiB combined child
streams, 16 MiB total captures, 64 MiB working data. No child/grandchild ability
is granted to the permission-restricted observer. No network, native oracle,
product source/import/build/runtime, private data, engine, compiler, AGENTS
plaintext, or OS symlink creation. No denied operation is repeated or relocated.

INPUTS.json binds original source/tool/old evidence. PAYLOAD.json contains only
exact authenticated harness closure, a 20-case subset of original DATA fixtures,
and their original pinned manifests. The original manifest-bindings.mjs and
all five admission/parser modules are byte-identical. Their directory base is
relocated as a whole beneath this review's scratch, preserving relative imports
and finite profile paths. No author directory is written. This is an explicit
location adapter, not acceptance of a changed original manifest. No manifest
values, expected bytes or errors are relaxed. Module URLs and hashes are
recorded on actual import/invocation; this is not a separate universal loader
trace or hostile-host sandbox claim.

20 named fixtures each run helper and shared controller admission: positive,
c18-original, unknown-extra, missing, truncated, file-hash, file-mode,
file-directory, unreferenced-manifest-record, referenced-duplicate,
receipt-reference-order, dot-alias, record-total-truncated,
record-base64-canonical, receipt-outcome, object-getter, empty, stderr,
joined-namespace, other-receipt-invalid. Then C18 restore, three namespace
aliases, missing capture ID, and self-asserted manifest digest each run both
routes: 52 observations total. Missing/extra/duplicate/truncation controls must
reject with CAPTURE_ADMISSION, not setup/permission/parser errors. Positive
controller cases require original exact bytes, entries, root. Getter calls zero.
Three separate source/manifest/tool binding counterchecks require mutated
expected hashes to reject. These are DATA guard checks, not engine load proofs.

The DATA controller calls the same admitCapturedTree as the future full main.
Review of that full controller and exact five-substitution derived SHA is
SOURCE-ONLY: checkHarness/checkTools, early admission, then work/child/parser
use. The future controller is never evaluated. Its lifecycle, package and
candidate obligations remain future, not inferred from this admission stage.

Preseal binds runner/observer/inputs/payload and the exact launch. Original
inputs, sources and tool are checked before/after; scratch census exact before
observer, exact after except the single declared C18 extra-file deletion. All
known children close and group absence is checked before deletion. Primary,
postguard and cleanup failures remain distinct; unsafe failures stop. Ordinary
observation failures aggregate in the child with raw reasons captured before
assertions. Captures are retained before assessment, never replaced by a rerun.

## Symlink decision requiring root

Current independent symlink execution: UNSUPPORTED/UNEXECUTED, never PASS.
An acceptable future policy could explicitly authorize a NEW finite preparation
role to create exactly one in-scope link to an in-scope harmless regular target,
record target/link bytes, modes and lstat identities, close preparation, then
start a separate unchanged restricted read-only observer. That would be a new
authority grant, not a workaround authorized here. No full-fs grants to the
observer, no link following, no ambient target, no reroute on denial. Observer
must prove CAPTURE_ADMISSION regular-file refusal before target content read,
plus positive/restored regular controls and both helper/shared-controller
routes. Remove the link only after observed child retirement, without following
it. Root may instead retain the honest unsupported case. Exact future fixture,
tool, namespace, launch and one-shot bounds must be sealed BEFORE fresh GO.
