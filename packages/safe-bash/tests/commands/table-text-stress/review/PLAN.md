# Independent bounded review controls

Use two isolated snapshots: preclosure audit/mutations, then closed acceptance.
Never mutate live production/tests. All authored probe/control files use apply_patch.
Reuse only existing frozen 71 native fixtures and existing author contract cases.

1. Establish an unmutated semantic baseline from unchanged corpus.test.ts.
2. Shared-cursor control: remove reuse of Inputs.stdin in copied internal.ts.
   The existing repeated-dash paste case must fail exact stdout assertions.
3. Byte fidelity control: decode/re-encode a copied chunk as UTF-8.
   Existing NUL/invalid-byte fixtures must fail exact stdout assertions.
4. Ordering control: reverse the byte comparison sign in copied compare().
   Existing C-byte collation/order fixtures must fail stdout/status assertions.
5. Borrowed-buffer control: replace Uint8Array.from with Buffer.slice in copy.
   Existing producer-reuse contract cases must fail exact expected bytes.

Run each control independently from pristine source. A compile/load failure,
timeout, missing dependency, or merely nonzero process result does not kill it.
Save assertion failures and source hashes; restore copy and prove baseline again.
No new corpus or production repair. No Apple measurements are GNU acceptance.
