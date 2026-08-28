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
