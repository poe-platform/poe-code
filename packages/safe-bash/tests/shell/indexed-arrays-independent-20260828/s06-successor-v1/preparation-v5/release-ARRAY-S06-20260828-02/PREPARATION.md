# Fresh v5 grant — prepared, zero candidate dispatches

The real root authorization commit was created first:
`ab80122d789f07f06c64811ef102d53aeea74797`. The separate five-field grant.json
then referenced that commit as rootReceipt; no invented/self-referential hash.

Absolute path:
`/Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v5/release-ARRAY-S06-20260828-02/grant.json`

SHA256: `9f3cc5146b5e825863cd034c99be70311370f7713eefa74ab111c190e18b97f9`.
Regular mode0644,336 UTF-8/ASCII bytes, two-space indentation, one final LF.
Keys/order: action, sealSha256, candidate, packageSha256, rootReceipt.

Static DATA validation confirms action execute-array-successor-v5 matches the
exact sealed dispatcher; candidate/package/source manifest bindings and269
selected inputs match. Expected356 children, ceiling373/374 including the
coordinator. No changed limit, tool, permission, product semantics or source
fallback. The new RUN-ARRAY-S06-20260828-02 directory does not exist.

Both original v3/v4 grant hashes were rechecked unchanged. V3 remains unexecuted;
v4/019f82b0 remains consumed. This fresh v5 grant has not been dispatched. No
build, compiler, runtime, native/private/YQ/XAN work occurred during preparation.
Hardened harness proof does not establish array behavior acceptance.

**Hold until root explicitly confirms this new raw hash.** The rootReceipt
format check alone does not prove authorization. No further release is inferred.

Exact command, not executed:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v5/dispatch.mjs /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v5/release-ARRAY-S06-20260828-02/grant.json 9f3cc5146b5e825863cd034c99be70311370f7713eefa74ab111c190e18b97f9 77a629c48547d75e791a5def6a0ac83bf3618d0861c7f3f6c9e5f0fb18cb2ae7 ARRAY-S06-20260828-02
```
