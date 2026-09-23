# Sort ordering

`sort` supports `-V`/`--version-sort`, `-g`/`--general-numeric-sort`,
`-M`/`--month-sort`, `-d`/`--dictionary-order`, `-i`/`--ignore-nonprinting`
and `-m`/`--merge`. `--sort` accepts `numeric`, `general-numeric`,
`human-numeric`, `month` and `version`. Ordering flags also work on key
endpoints and use the existing key-local override rules.

These modes use the command's C byte profile, regardless of locale environment
variables. Dictionary order keeps ASCII letters, digits, spaces and tabs;
nonprinting filtering keeps bytes 32 through 126. Both preserve original output
bytes and use the existing whole-record byte comparison to break ties unless
stable or unique mode disables it.

Key character positions count bytes from the named field's start and may cross
field separators, stopping at the record boundary. An end position without a
character offset stops at the named field's end. For example, `-t '|' -k1.3,1.4`
selects `Q9` in `w|Q9`; stable and unique sorting compare those selected bytes,
so unique mode preserves records with distinct keys and keeps the first record
when keys compare equal. This applies to both LF and NUL record delimiters.

The `b` modifier skips leading ASCII spaces and tabs independently at each key
endpoint before applying its character offset, including with explicit field
separators. For example, `-t '|' -k2.1b,2.1b` selects `Q` in `w| Q`.
Global `-b` applies to both endpoints when a key has no local ordering modifiers.

Month order recognizes case-insensitive English three-letter month prefixes
after leading spaces or tabs, with unrecognized months before January.
General numeric order places unrecognized numbers before NaNs, then orders
numbers including infinities, decimal exponents and hexadecimal prefixes with
optional binary exponents. It uses JavaScript binary64 precision; this does not
promise native long-double precision or locale-dependent numeric parsing.

Version order compares digit runs by magnitude without converting to numbers,
ignores leading zeros for key equality, orders tilde before other characters,
and handles leading dots and trailing alphabetic filename suffixes. Native BSD
version-sort tie behavior may differ from this GNU-style profile.

Merge mode combines input runs in operand order using the same comparator,
without sorting within a run. Callers must supply preordered runs. It retains
the existing invocation-wide record and byte admission limits, cancellation
checkpoints, unique filtering and read-before-output-file replacement behavior.
It does not provide an unbounded external merge.
