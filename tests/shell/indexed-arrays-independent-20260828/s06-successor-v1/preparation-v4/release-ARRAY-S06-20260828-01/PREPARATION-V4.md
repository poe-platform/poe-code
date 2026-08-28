# Corrected v4 grant — prepared, not dispatched

The additive root correction was committed first as
`28c84d3ec010b1d2508a7ace3dcbb57e17eaf361`; that actual full commit is the
new rootReceipt. The original7e83d873 authorization and8500e063/v3 grant
remain immutable and UNEXECUTED. Zero attempts have been consumed.

Separate grant absolute path:
`/Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/release-ARRAY-S06-20260828-01/grant-v4.json`

SHA256: `49bdcaefe494fdf2bed73a0c48ebe83f6ef75b516ce55e0ffaaa21509f3074f6`.
Regular mode0644; UTF-8/ASCII336 bytes; two-space indentation; final LF.

Static DATA checks verified:

- Exactly five original keys/order; only action and rootReceipt differ, with
  every other byte preserved from the v3 grant's serialization.
- Action now matches the authenticated sealed `execute-array-successor-v4`.
- Seal, dispatcher, candidate and package bindings are unchanged.
- Authenticated source inventory is exactly269 selected inputs; no additional
  input permission is inferred from the earlier `271?` wording.
- Original v3 grant still hashes to
  `1f3d72fb78879f7b93c7835d8865da75dea90bb5549bcfca17095624bd6d74dd`.
- `RUN-ARRAY-S06-20260828-01` does not exist. No candidate dispatcher was
  invoked; no build/install/type/product/native/private/YQ/XAN execution.

**Await root confirmation of this new raw hash before execution.** The receipt
format check does not itself prove authorization. All original scope, bounds,
cleanup/STOP conditions and one-attempt/no-retry policy remain unchanged.

Exact command, held pending confirmation:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/dispatch.mjs /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/release-ARRAY-S06-20260828-01/grant-v4.json 49bdcaefe494fdf2bed73a0c48ebe83f6ef75b516ce55e0ffaaa21509f3074f6 c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80 ARRAY-S06-20260828-01
```
