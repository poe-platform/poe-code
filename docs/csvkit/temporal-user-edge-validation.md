# Independent temporal user-edge validation

The original twelve-case frozen native-versus-Shell cohort reproduced four temporal defects against current product code. This finite cohort does not qualify all temporal behavior or complete csvkit parity.

## Reference

The reviewer replayed the hash-pinned CPython 3.14.2 runtime lock in an owned `out/csvkit-temporal-user-oracle` venv. The executable SHA-256 was `3d6400b63b150164e89a690d9813af8b0eb420af9f336ef1f6c5102c6da60eae`; Unicode was 16.0.0. Native captures used an empty environment with only `LC_ALL=C`, `LANG=C`, `TZ=UTC`, `PYTHONIOENCODING=utf-8`, `COLUMNS=80` and `LINES=24`; stdin/stdout/stderr were UTF-8 non-TTY pipes. Product and canonical tests never invoke Python or subprocesses. Canonical inputs and effect checks use MemoryFileSystem.

## Measured corrections

| Original input/operation | Frozen native result | Original product result | Correction |
| --- | --- | --- | --- |
| `csvsort -y0`, `January 2 2024` / `January 1 2024` with NBSP | ISO dates in date order | Text spellings | Normalize internal Python-profile whitespace before implicit English date recognition |
| `csvsort -y0`, `0001-01-01` / `0002-01-01` | `2001-01-01` / `2001-02-01` | Gregorian years 1 / 2 | Numeric first field <=31 uses month/day/year; other first fields use year/month/day; years <50 add 2000, years <100 add 1900 |
| `csvsort -y0`, `1 mİn` / `2 mİn` | `0:01:00` / `0:02:00` | status78 parser blocker | Match Python IGNORECASE's dotted I duration unit equivalence |
| `csvjson -y0`, `1 ſec` | no stdout, `KeyError: 'ſec'\n`, status1 | status78 parser blocker | Direct Date key errors implemented; CLI inference remains explicitly blocked |

Additional native cast measurements establish numeric date rules rather than fixture-specific exceptions: `0012-03-04` means `2004-12-03`, `0013-03-04` is rejected, `0049-03-04` means `2049-03-04`, `0050-03-04` means `1950-03-04`, and 0100/0999 retain their original years. Explicit `%Y-%m-%d` preserves Gregorian year 0001. NBSP, NEL, EM SPACE, tab and U+001C inside the measured month-date form all yield the same date. Duration matching reaches dotted/dotless I, long s and Kelvin sign; native direct TimeDelta accepts all four.

Measured passing cases also cover AM/PM without an hour field, space-padded hours, leap day without an explicit year demoting to Text, two-field clock width rejection, seconds exceeding 59 in duration clocks, explicit fractional datetime JSON, grouped Boolean truth spellings and zero-width Boolean demotion to Text. Each original executable argv syntax is retained.

## Deliberate refusals and gaps

Agate TypeTester maintains a set of possible types per column, tests every remaining hypothesis per row while more than one remains, and chooses the preferred survivor only after sampling. Product inference currently exits on its first accepting type. Long-s/dotless-I units may therefore cause native Date `KeyError` even though TimeDelta accepts. The engine explicitly refuses matched durations containing those characters with `CsvkitBlocked("Agate hypothesis diagnostics for Unicode duration units")`. The active Shell refusal test expects no output and status78; the original native diagnostic regression remains TODO. Direct TimeDelta native parity for those characters is also TODO. These are blockers, not passes or complete hypothesis-order qualification.

Full parsedatetime NLP, inference side-effect/error ordering, broader Unicode date grammar, every locale and timezone, large-duration domains and previously recorded unsupported csvkit commands remain unqualified. No filesystem/database mutation, network, interactive, cancellation or full release qualification is inferred from these temporal tests.

## Checks

Original Shell cohort: eight passes/four failures. Original domain regressions: four failures. Final `npm run test --workspace=@poe-code/csvkit`: 33 files, 1,640 passes, six TODOs, status0. Final `npm run lint --workspace=@poe-code/csvkit` and focused ESLint on the Shell file: status0. Focused canonical Shell cohort: twelve passes and one TODO, status0. An initial active-refusal test omitted required injection config and failed; its setup was corrected before acceptance. Root records final workspace build, maintained typecheck, integration and screenshot results. Shell tests assert exact stdout/stderr/status and unchanged source bytes/directory entries. Owned venv/scripts/captures/logs were purged after reduction. No README edits, Git staging/commits, push or publication.
