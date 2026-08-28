# Preserved author metadata preflight failure

Executor9a0a21eb,2026-08-28: exit1 at run.mjs:12, before mkdtemp, source
materialization, child creation, compiler or product. assert.deepEqual compared
the generated manifest object with its serialized SOURCE.json. In-memory tool
rows had own sha256:undefined (four tools) and node had two undefined inventory
fields; JSON correctly omitted them. All candidate/source/tool hash values matched.

The terminal captured ERR_ASSERTION with the exact extra undefined-property
diff; large object printing was truncated by the tool, not a retained full stderr
artifact. This summary does not claim otherwise. The original executor/prepare
source and seal remain in9a0a21eb/EXECUTOR.json; no old failure is rescored.

V2 constructs exactly the finite applicable tool fields rather than adding
undefined fields. Deep equality remains strict; SOURCE.json and all272 selected
inputs, tree identity, helper data, expected outputs and bounds stay unchanged.
No product source or assertion adjustment. EXECUTOR-v2.json versions only the
author helper change and selects the new seal before the first build/dispatch.
