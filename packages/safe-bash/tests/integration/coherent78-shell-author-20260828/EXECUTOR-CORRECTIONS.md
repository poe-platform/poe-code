# Executor corrections

## v2: canonical Darwin temporary-root spelling

Initial executor `acc42a2a` built the selected composition successfully, then
stopped before importing the product root or running any of the 18 cases.
`import.meta.resolve` returned `/private/var/...`, whereas the expected URL used
the task-owned `/var/...` spelling. Raw capture
`captures/coherent78-author-O2uHTW.json.gz.base64` preserves the exact assertion,
build result and completed cleanup.

The sole probe correction canonicalizes `PRODUCT_ROOT` with `fs.realpathSync`,
matching the loader's existing canonicalization. It does not change the expected
module, admit another tree, remove hash checks, or alter any sealed case/type.
The original executor remains recoverable at its commit. This is an executor
path-binding correction, not a product or composition failure.

## v3 executor / v2 case profile: ROOT-approved bounded amendment

Root approved the two precise decisions recorded at `bf9f585b`. The original
`CASES.json`, preseal and both raw captures remain byte-identical.
`CASES-v2-overlay.json` changes only C15's final positive value to U+FFFD and
adds R15, which inherits the original C15 script/input and asserts the exact
status5/empty-stdout/parser diagnostic. C14's already-closed request signal is
recorded, not required to become aborted. C13's actual timeout-abort assertion
and all C14 acquisition/return/disposal/header/caller/timer checks remain.

The original temporary build was removed. The next run reconstructs and builds
the exact same selected source afresh. Source behavior runs only C14/C15 plus
R15; it does not rescore original18 as18/18. Installed and physically moved
consumers each run18 revised positive cases plus the separate refusal control.
Strict types retain their original payloads and now record actual compiler-listed
package declarations and authenticated hashes. Runtime code loading retains its
existing full-inventory authentication and source-fallback rejection.
