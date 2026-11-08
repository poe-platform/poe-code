# Publication native child execution QA

1. Run the original control below independently through the built publication helper. Keep the original one-second child deadline and five-second unit deadline.
2. Verify a nonzero exit preserves code 7 and output exceeding the one-megabyte cap produces `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`, rather than a deadline error. The maintained fast tests check the configured cap, kill signal, deadline and error propagation at the actual Node process boundary.
3. Store temporary evidence under `out` and purge it after verification.

```ts
await expect(runCommand("/bin/sh", ["-c", "exit 7"], { timeout: 1_000 }))
  .rejects.toMatchObject({ code: 7 });
await expect(runCommand("/bin/sh", ["-c", "printf '%2000000s' x"], { timeout: 1_000 }))
  .rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
```
