# Preparation admissions, not qualification results

The initial bounded metadata inspection refused historical PRESEAL.json before
reading it: its 108,224 bytes exceed the inspection's 100,000-byte limit. No
qualification was launched. Its size was subsequently obtained with lstat only.

Source generator version 1 refused VARIANTS.json before reading it: its 404,120
bytes exceed the default 200,000-byte text-file bound. Tool result f66535 exited
1; no SOURCE.patch was published. Metadata-only inspection 0988b1 then recorded
exact size/mode/streamed SHA256 for the finite input list. The generator's only
file-specific admission adjustment is the exact 404,120-byte variant JSON;
its generated patch ceiling is 2 MiB rather than 1 MiB. Neither adjustment
changes a product, administrative framing, capture, working-set, or qualification
cap. This is source preparation, not an automatically retried control attempt.

Historical binary-output HOLD 5f336d1a and its unknown raw-byte counts remain
unchanged. The native editing executable is invoked only through its interface.
