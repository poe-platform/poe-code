# Literal csvjoin contract

The executable is csvkit 2.2.0 `csvkit/utilities/csvjoin.py`, authenticated by
the source manifest and reference profile in `docs/csvkit`. Its implementation
is `packages/csvkit/src/commands/csvjoin.ts`; the SDK and opt-in safe-bash
fourteen-executable plugin use the same descriptor and engine.

`FILE` accepts zero or more paths with the original default stdin path. Local
options are `-c/--columns`, `--outer`, `--left`, `--right`, `-y/--snifflimit`
and `-I/--no-inference`. Shared options are precisely the supplied source
grammar; executable flag inventories have no collisions. In particular there
are no output dialect flags, `-f`, `-n`, or general composite-key selectors.
`-c` supplies either one identifier reused for all inputs or one identifier per
input. Identifier whitespace is stripped; helper indices remain one-based
even under inherited `--zero`.

Inputs are independently inferred typed Agate-style tables, including a
singleton input. Default keyed joins are inner; left and right preserve their
starting side; right traverses inputs in reverse and emits columns in that
order. Left takes precedence over outer; right takes precedence over outer.
Left plus right errors, and any outer option without columns errors. Keyed
inner/left/right omit each appended input's key column and retain the original
starting key. Full outer preserves both keys rather than filling the starting
key from unmatched right rows. Consequently a later full-outer join continues
to match the original first key, including nulls introduced by earlier joins.
Sequential joins use row positions and preserve unmatched tails.

Agate locates the omitted right column by sequence equality: the first column
whose typed values equal the selected key is omitted. This can be an earlier
column; every column in a header-only table compares equal. Full outer keeps
all columns. Each input wrapper closes after parsing; repeated stdin operands
therefore produce the original closed-file error without closing a borrowed
host stream outside the invocation's registered ownership.

Every left row emits its matching right rows in input order, preserving
duplicate multiplicity. Null equals null. Decimal equality ignores scale and
signed zero and matches Boolean zero/one; text remains a distinct type. NaN
from independently parsed rows is unequal. Dates, datetimes and durations
remain distinct; aware datetime keys compare instants and durations compare
microseconds. Datetime CSV output uses `T`. Right column names colliding with
left names first append `2`; Agate header deduplication then adds `_2`, `_3`,
and so on as needed. Frozen warning identity is explicitly injected or warnings
are explicitly suppressed. Repeated identical header warnings emit once per
invocation, including across inputs and intermediate tables.

The engine intentionally materializes every input and intermediate joined
table. It is not a streaming join. Injected aggregate input, row, column,
retained-byte, output and work budgets bound admission and Cartesian expansion;
output backpressure is awaited. Runtime-owned readers and cooperative iterators
remain registered for cleanup, cancellation preserves its original reason, and
input files are never written. No product native/Python subprocess, database,
network or ambient filesystem capability is used.

Compatibility qualification remains scoped: unsupported shared parser,
encoding/compression, numeric reader quoting and locale/temporal cases retain
explicit blockers. Verbose traceback frames require a qualified deployment
profile. Exhaustive dialect/locale grammars, the secondary CPython profile,
native signals/TTY and uncooperative host capabilities are unmeasured. These
limits and resource refusals are not passes or complete csvkit-suite parity.
