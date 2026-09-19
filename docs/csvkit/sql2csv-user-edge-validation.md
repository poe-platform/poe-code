# Independent sql2csv user edge validation

The independent stress agent exercised the registered literal `sql2csv`
executable through the actual safe-bash `Shell`, using injected in-memory
database providers and `MemoryFileSystem`. No native programs, network,
database drivers, filesystem fixture creation, or Python fallback were used.

`packages/safe-bash/tests/commands/sql2csv-user-edge.test.ts` covers seven cases:

- Three frozen empty-result differentials from
  `docs/csvkit/sql2csv-reference.json`, including `-l` and `-H -l` writer quirks.
- Caller cancellation during admitted driver reads that eventually succeed or
  reject: iterator return is requested before read settlement, result/session
  disposal waits for settlement, and subsequent Shell disposal is idempotent.
- Explicit `--query` bypasses both a missing FILE and an unavailable query-file
  encoding.
- Original driver read failure remains the internal-error callback reason when
  iterator return also fails; result close, rollback, and connection close still
  occur exactly once. Exact Shell stdout, stderr, and status are asserted.

Validation on the live workspace:

```text
node --import tsx --test packages/safe-bash/tests/commands/sql2csv-user-edge.test.ts
7 tests passed; 0 failed, cancelled, skipped, or TODO
npx eslint packages/safe-bash/tests/commands/sql2csv-user-edge.test.ts
exit 0; no diagnostics
```

The final empty-result fixture uses `yield* []` so its generator explicitly
declares an empty sequence and satisfies the maintained `require-yield` lint
rule. Focused tests and ESLint were rerun after that fixture-only correction.

The driver-error test initially assumed Shell rejects ordinary driver Errors;
the concrete result showed Shell's documented diagnostic boundary renders
`shell: line 1: internal error` with status 1 and reports the original Error to
`onInternalError`. The test was corrected to that existing contract. This was a
test assumption failure, not a validated product defect. No product changes
were needed for these cases.

This is bounded live-workspace integration evidence, not complete csvkit or
external database-driver compatibility. Real network databases, external
driver transactions/autocommit, terminal behavior, and exhaustive flag/codec
combinations were not measured by this review.
