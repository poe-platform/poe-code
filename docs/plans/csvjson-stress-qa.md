# Independent csvjson stress QA

Execute the registered safe-bash command through `Shell`, using its in-memory
filesystem and explicitly injected csvkit codecs, locale, clock and terminal.
Do not acquire native programs, host files, network or databases in canonical
tests. Compare exact stdout, stderr and status and preserve a sentinel VFS file.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvjson-stress.test.ts`.
2. Confirm `--stream -I -y0 -K1 -H` materializes the table and preserves both
   no-header rows. The original implementation failed this regression: it used
   the first retained row as headers and emitted only the second row.
3. Stress the raw path's duplicate numeric/prototype-looking names, missing
   cells, null spellings, empty input and ignored no-header setting against
   `docs/csvkit/additional-operation-reference.json`.
4. Stress Decimal-normalized keys, duplicate rejection, inferred stream/indent
   rejection, nonfinite floats and inferred-zero GeoJSON behavior against
   `docs/csvkit/csvjson-reference.json`.
5. Confirm reusable byte views are copied before producer mutation; awaiting a
   blocked stdout write prevents a second output write; cancellation preserves
   the false caller reason and retires the borrowed stdin generator exactly once.
6. Confirm raw streaming refuses an injected codec without `decodeStream`, before
   bulk decoding. The initial implemented engine silently returned status 0 for
   this profile while `LazyInput` consumed all input; retain that original red
   regression and require an explicit status-78 blocker.
7. Confirm GeoJSON stream errors emit no feature for the failing row, retain prior
   completed features, and distinguish missing raw cells from typed null cells.
8. Root registers the exact new test pathname in the maintained integration
   inventory, runs the uncached package build/test/lint checks and broadens checks
   where shared serializer changes affect other commands.

Shell input queues may prefetch bounded input while stdout is blocked. This QA
asserts output backpressure, not absence of all input prefetch. Unsupported and
unmeasured reference cases remain explicit blockers, never passing cases. No
commit, push or publication is authorized.
