# Direct SDK adapter reproduction receipt

Observed during bounded independent review on 2026-09-15, before the root adapter
correction. An inline `node --import tsx --input-type=module` session called public
SDK-backed `applyStyleModelBatch` on original admitted document/raster bytes.
The operation was `model.document.Document.add_picture.call` with initial root
document handle, `input: { kind: "vfs", path: "/work/Coast.PNG", capability:
"command" }`, and width `{ value: 1, unit: "in" }`. Context explicitly supplied
`binaryResolver.capability: "command"` and a byte source yielding original PNG
bytes. No ambient filesystem, downloaded asset or external request was used.

Actual exception printed by that session:

```text
TypeError: Primary image input requires bytes, a byte source or an explicit path.
  at Image.from_file (image-model.ts:56:83)
  at DocumentView.add_picture (document-model.ts:60:31)
  at structure-model-batch-operations.ts:60:22
  at applyStyleModelBatch (style-model-batch.ts:118:292)
```

This receipt summarizes the observed session; it is not a recreated raw execution
log. `red.log` retains actual failing shell executions. The canonical path and
explicit resolver rule out missing host authority/path normalization as the
remaining failure. Root mapped declared transport descriptors to primary model
input forms in the closed adapter; primary factories retain their documented
typed bytes/source/path boundary. Final `green.log` exercises both scoped VFS
and bounded byte descriptor forms through actual public shell commands.
