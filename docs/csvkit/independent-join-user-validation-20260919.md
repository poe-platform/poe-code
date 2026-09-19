# Independent csvjoin/csvsort/csvstack user validation, September 19, 2026

An independent stress agent compared current `csvjoin` against released csvkit
2.2.0 using the existing isolated reference environment. The QA procedure is
`docs/plans/csvkit-user-edge-qa.md`; this document records observations only.

The oracle matched the runtime and distribution-version portions of the frozen
`darwin-cpython-3.14.2-csvkit-2.2.0` profile: CPython 3.14.2 executable SHA-256
`3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`
and all 19 non-pip distribution versions. Locale was C, timezone UTC, and Python
output encoding UTF-8. Installation-manifest drift remains a blocker; matching
versions alone does not authenticate installed source bytes or qualify the full
frozen installation. The oracle used the original `csvjoin` executable module
and original argv syntax, with `-y0 -c k` and two independently inferred inputs.

Eight deterministic key cohorts covered signed/unsigned zero, decimal scale,
booleans, boolean-compatible numeric values, NaN, positive/negative infinity,
nulls, duplicate text, dates, and equivalent aware datetime instants with
different offsets. Every ordered cohort pair ran with inner, full outer, left,
and right joins: **256 engine cases matched exact stdout, stderr and status**.

The same eight cohorts joined to themselves through actual registered safe-bash
`Shell` invocation and `MemoryFileSystem`, using all four join modes:
**32 additional cases matched exact stdout, stderr and status**. SHA-256 of the
ordered concatenation of each observed stdout byte sequence, stderr byte
sequence, and decimal status string was
`12222f988abd29f351b3f4ca21f447962273a1cb5abdf4a03b7e7a70e90778ea`.
Product invocation used injected capabilities and in-memory input files. Native
oracle input files and temporary comparison helpers were owned files under
`out`; they were removed after reducing these observations.

No discrepancy was reproduced in this cohort, so no product fix or new unit
regression was warranted. These finite cases do not establish complete csvkit
parity. No database-service, workbook, DBF, compression, interpreter/IPython,
or performance claim is made by this pass. No commit, push or release occurred.

An additional **128 engine cases matched exact stdout, stderr and status**:

- 64 `csvsort` cases crossed eight inputs with reverse, ignore-case and
  no-inference flag combinations. Inputs covered nulls, duplicate selected keys,
  signed zero and decimal scale, Unicode uppercase expansion and astral ordering,
  equal aware datetime instants, NaN, infinities and booleans.
- 64 `csvstack` cases crossed eight input pairs with explicit/empty groups,
  filename grouping, line numbers, no-header mode and group-name collision.
  Inputs covered reordered and duplicate headers, colliding grouping headers,
  short rows, blank records, multiline cells and leading blank records.

The extra cohort's observed output/status concatenation SHA-256 was
`d5dd71f1fb40362e260e20e991cf5cddc21e17260bc7d52c77e54ce3904ab9fc`.
The same installation-manifest qualification blocker applies. Additional native
fixtures/helpers remained under `out` and were removed after reduction.

After the root owner's SQLite floor-callback change, an independent focused
actual safe-bash SQL run passed **47 tests**, with zero failures, skips or
cancellations. It covered provider capability stress, SQL cleanup/lifecycle,
stream-boundary ownership, and the explicitly bound SQLite WASM provider with
in-memory persistence. The command was:

```sh
node --import tsx --test --test-concurrency=1 \
  packages/safe-bash/tests/commands/csvkit-sql-provider-stress.test.ts \
  packages/safe-bash/tests/commands/csvkit-sql-lifecycle-user-review.test.ts \
  packages/safe-bash/tests/commands/csvkit-sql-stream-boundary-review.test.ts \
  packages/safe-bash/tests/commands/csvkit-sqlite-binding-stress.test.ts
```

This is focused runtime verification, not a full maintained `npm test` result
or a qualification of external database services. The owned temporary run log
was removed after recording the result.
