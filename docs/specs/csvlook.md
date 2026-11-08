# csvlook 2.2.0

The literal executable descriptor retains exactly the local and inherited flags
from CSVLook, including argparse help and version actions. The collision audit
is canonical; no `csvkit` subcommand or omitted shared flag is introduced.
CLI argv and SDK destination settings reach the same engine.

`commands/csvlook.ts` loads a normalized typed Agate-compatible table and invokes
`table/print.ts`. `--max-rows` limits records loaded before inference and width
calculation. With a header, zero rows still load the header; without a header,
zero rows load no CSV records. Skipped physical lines and dialect sniffing occur
before that limit. Row limits preserve CPython's integer range through sys.maxsize;
larger limits raise the original islice diagnostic. Physical-line numbers are inserted before inference, so a
one-row number column can infer Boolean, and multiline records advance numbers
by physical lines. `--zero` does not alter these numbers.

csvlook passes None for rendering row/column/width limits. Consequently defaults
are unlimited and there is no renderer-only row omission footer: the loader
already limited rows. Omitted columns use `...`, with the alignment of the first
omitted column's type. Negative column counts preserve Python slice/iteration
behavior, including the original empty-table IndexError path. Text truncation
uses Python scalar slicing and `...`, even for widths below three.

Number precision defaults to three. Each Number column uses its maximum normalized
decimal precision, adjusted for the frozen precision-28 decimal context and
bounded by `--max-precision`. Half-even rounding, grouping, fixed trailing zeros,
NaN payload formatting, infinity spelling and signed zero retain reference bytes.
When precision truncates, every finite formatted value in that column receives
`…`. `--no-number-ellipsis` affects only this invocation. All typed columns,
including headers and null cells, align right; Text aligns left.
Agate's `math.isinf` checks convert Decimal values to binary floats: finite
Decimals that overflow that conversion (such as `1E+309`) are excluded from
precision calculation and retain scientific notation without grouping or ellipsis.
Finite values whose formatted coefficient exceeds precision 28 report the
original `InvalidOperation` diagnostic before any table output.

Dates, datetimes, durations and booleans use the typed engine's Python spellings;
null cells display as empty strings. Only embedded LF in body values becomes
`↵`. CR, tab, ESC, NUL, pipes and header newlines are not additionally escaped.
This literal Agate output uses Python scalar length, not terminal cell width:
wide glyphs, emoji and combining marks may look misaligned in a terminal. No
repository design-system table formatting is applied.

Warnings require injected source deployment identity or explicit suppression.
Parser errors, empty tables, excess row values and invalid negative row limits
retain measured diagnostics. Unqualified quoting modes, locale/inference cases,
sniff-warning identities and verbose Python tracebacks retain explicit status 78
blockers from the shared engine.

For headerless zero-row named input with no sniffing or skipped lines, the SDK
requires optional `CsvkitContext.probeInputOpen(path, {cwd, signal})`. This host
callback must open and close the input without reading it, own cleanup and honor
cancellation; stat-only checks do not implement the contract. Without a binding
this path returns status 78. safe-bash binds its optional filesystem `open` with
read access and creation `never`, registers an idempotent closer before acquiring,
and closes even a late admitted descriptor. `CsvkitCommandsOptions.probeInputOpen`
may supply an explicit host binding. No filesystem capability is auto-enabled
outside the injected filesystem, and there is no process or Python fallback.

Output writes are awaited. Runtime work, retained memory and output admission
remain invocation-local; borrowed stdin, caller cancellation reasons and
cooperative cleanup retain shared ownership rules. This specification does not
certify full suite or every locale/encoding/driver combination.
