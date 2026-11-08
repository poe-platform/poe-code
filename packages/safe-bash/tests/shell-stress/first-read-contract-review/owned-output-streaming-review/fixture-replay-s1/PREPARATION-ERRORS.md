# Preserved preparation errors

No positive probe or candidate product execution ran during these errors.
The first corrected all20 execution was not retried and required no second round.

1. `artifacts/preparation.stderr.data` is the raw first preparation error.
   The literal replacement for S07 omitted the old error/close listener lines,
   so the exact-occurrence assertion rejected the replacement (1 !== 2).
   `artifacts/prepare-first-error.mjs.data` preserves the attempted script.
   Correction: include those exact old lines in the replacement's source text.
2. While making that correction, an apply_patch call mistakenly included a
   leading `+` in its context. It failed without changing any file. The tool
   response is transcribed exactly below; it was not originally captured to a file.
3. `artifacts/preparation-second.stderr.data` preserves EACCES recopying the
   immutable public-profiles.json, whose mode had been preserved by copying.
   `artifacts/prepare-second-error.mjs.data` preserves that script. Correction:
   verify an existing copy's exact hash rather than overwriting it. No chmod or
   modification of the old file; no sandbox/permission bypass. Third preparation
   succeeds; raw third stdout/stderr are retained.

Failed apply_patch tool response (verbatim transcription):

```text
Failed to find expected lines in /Users/kjopek/Workspace/safe-bash/tests/shell-stress/first-read-contract-review/owned-output-streaming-review/fixture-replay-s1/prepare.mjs.data:
+        request.once('aborted', () => rejectData(new Error('fixture upload aborted before data')));
```

The originally archived freeze stdout is an early empty capture taken by its own
archival step. `round1/freeze-complete.stdout.data` preserves the completed output;
the earlier capture remains unchanged, not silently filled in afterward.

## Later foreign-root sealing error

The first final-seal attempt failed because live package.json changed concurrently
after the successful after-record identity check. tsconfig.json also changed.
The tool response is transcribed in `round1/seal-first-error.stderr.data` (not an
original redirected stderr capture); `round1/seal-first-error.mjs.data` preserves
the exact failed script. The observed package change replaces typecheck scripts;
the root-config deltas and before/after bytes are preserved separately. No root
file was changed or reverted by this leaf. Final validation still asserts every
candidate/config/tool/patch hash and live source file exactly; it separately
classifies only those two observed concurrent live-root changes. This is not a
fixture execution correction, waiver of acceptance, or product-source repair.
