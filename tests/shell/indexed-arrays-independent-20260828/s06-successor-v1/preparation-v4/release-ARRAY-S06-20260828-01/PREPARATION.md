# Grant prepared; zero dispatches; action mismatch held

The root authorization was durably committed first as
`7e83d873223f10df5f48271bf2afe31bfc9983ab`. Only then was grant.json written,
with that actual commit as rootReceipt. The five keys/order and requested
`execute-array-successor-v3` are preserved exactly. The file is regular,
mode0644, UTF-8/ASCII336 bytes, two-space indentation and one final LF.

Absolute path:
`/Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/release-ARRAY-S06-20260828-01/grant.json`

SHA256: `1f3d72fb78879f7b93c7835d8865da75dea90bb5549bcfca17095624bd6d74dd`.

Static regular-file/bytes/keys/hash checks passed. The authenticated seal and
dispatcher both require v4, so **this requested v3 grant is not admissible**.
No dynamic dispatch was used to demonstrate that source-visible mismatch.
Root confirmation of the exact hash is still required, and the action mismatch
must be resolved by root before dispatch. No changed action, new seal or source
repair was silently substituted. No attempt was consumed; no active children,
build/install/type/runtime/native/private/YQ/XAN execution or product changes.

The literal requested command is recorded for inspection only; **do not run**
while the action mismatch and root-confirmation hold remain:

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/dispatch.mjs /Users/kjopek/Workspace/safe-bash/tests/shell/indexed-arrays-independent-20260828/s06-successor-v1/preparation-v4/release-ARRAY-S06-20260828-01/grant.json 1f3d72fb78879f7b93c7835d8865da75dea90bb5549bcfca17095624bd6d74dd c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80 ARRAY-S06-20260828-01
```
