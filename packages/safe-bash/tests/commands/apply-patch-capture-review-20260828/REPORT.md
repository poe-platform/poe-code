# Independent C18 sidecar — SOURCE conditional; actual closure HOLD

August 28, 2026. Author source 33e2b4c7fb14c2ab5ad23be50ac07bcc4bfed848;
disputed successor 1d5892457775714fbbaea5673f0adb1f906f7681; evidence
0ed41d4786319d1f703a1b396da8063c4ad5732d. No author or product file changed.

## Root decision

The refusal was Node's intrinsic `fs.symlink` Permission Model check:
`ERR_ACCESS_DENIED`, `node:fs:1879`, requiring full fs.read/fs.write permissions.
The original restricted child had scoped grants. Its fixture builder called
symlinkSync at run-controls.mjs:44, before admission testing. The preserved
873-byte stderr and receipt establish that origin; there is no demonstrated
platform-sandbox denial or product failure. No new symlink call/syscall probe ran.

**The disputed parent relocation is NOT accepted or retroactively authorized.**
Separate, explicitly authorized fixture preparation followed by an unchanged
guarded observer is a technically coherent future recipe, but it requires a
fresh grant, exact finite link/target bindings and independent refusal/read-order
proof. Alternatively retain the symlink case as unsupported. Never grant full
filesystem authority to the observer merely to construct this fixture.

## Source findings

97 original source/tool bindings and 12 seals/history files matched; repository
files also matched the named immutable commits. The shared controller invokes
readCapture before parseTree/treeHash. The reader authenticates the finite
manifest, exact complete namespace, all regular file mode/size/hash bindings,
references, schemas, fragment order and channel totals before returning bytes.
The full future controller's five exact substitutions reproduce 32,318 bytes,
SHA256 89af8472d1f19e2e0dee02c3f09d7d011e7c677cec755b4c614aa8b6a5b8ab3d;
admission precedes its first work acquisition and child. No new source defect
established in that C18 repair. This is static composition review, not execution
of the future controller/lifecycle or independent capture closure. Original C18
remains helper-local, not a demonstrated prior controller bypass.

## Actual independent attempt and remaining gap

Preseal 8751ed5b0eb7547f01f0304423db38569e5bde37; SHA256
fa0d5273a384b99f548a27c3ae58b83980b084610c550bcce4f035bf407cbedc.
One permitted regular-file DATA attempt, 19:06:28.203–.207 UTC, stopped in my
preflight: run.mjs:9 resolved four parent levels instead of three, producing
`/Users/kjopek/Workspace/tests/.../CONTROLS.json` ENOENT. This is **my harness
defect**, not an author rejection. Primary and postguard failures retained in
data-01/RECEIPT.json; no successful run guards. **0/52 observations, 0/3 binding
counterchecks, zero children/loads/staging/symlinks; scratch absent.** No retry.
The outer terminal text was tool-returned, not a separately authenticated raw
stream file; no missing raw bytes are reconstructed or claimed.

Preparation-only run-v2.mjs corrects that depth and versions only preseal/output
names. Observer, 20 fixture rows, 52 route observations, three counterchecks,
tool, permissions and budgets stay fixed. All 109 corrected-path metadata/hash
bindings match (STATIC-V2.json); this is not a passing run. PRESEAL-V2 SHA256:
406ab6f12ddc2bb52fd6daf70af40f95a3c4f57ad1aa71b8a3524abed478efd7.
**Fresh GO needed for this successor; all 52+3 remain unexecuted.** Symlink proof
is separately unexecuted pending the root choice above. No apply_patch actual GO.

Author-01 failure, unauthorized author-02 66+66 NOT CREDITED, original
197 PASS/1 FAIL/1 unsupported/7 unrun, 98/50002 proofs and 25 DATA/68 NOT_RUN
remain unchanged. Candidate/build/runtime/native/network/private/Node-bridge/
comparator execution zero. No product, permission or policy relaxation.
