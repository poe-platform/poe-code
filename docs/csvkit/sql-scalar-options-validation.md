# SQL scalar option validation

This is the earlier scalar qualification record. Adjacent strings are now
qualified by [sql-adjacent-strings-user-validation.md](sql-adjacent-strings-user-validation.md).

The frozen CPython 3.14.2 csvkit 2.2.0 deployment's executable SHA-256 and
nineteen runtime distribution versions were authenticated against
`reference-profile.json`; pip remains installer-only and absent in this uv
deployment. This does not reauthenticate installed-file manifests. The target
source archive remains SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Capture used the frozen C/UTC/UTF-8/80x24 environment and actual
`csvkit.cli.parse_list`, whose inspected implementation is included in
`sql-scalar-options-reference.json`.

Of 44 native scalar observations, 34 now match values and types: booleans,
None, ASCII signed/underscored decimal integers, precision-preserving large
integers, hexadecimal/octal/binary literals, signed binary64 floats including
negative zero, exponents and decimal underscores, single/double/triple-quoted
strings, raw/Unicode prefixes, standard escapes and hexadecimal/Unicode/octal
escapes, and measured bare-name ValueError fallbacks. Ten observations remain
explicit blockers at the time of this earlier validation: compound literals,
adjacent strings, named escapes, and
native SyntaxError profiles including invalid Unicode whitespace/digits and
malformed numeric/string literals. Their refusal assertions are safety checks,
excluded from the compatibility denominator. No eval or product Python path is
used.

Before implementation, original in-memory tests reproduced 28 failures in the
43-case initial capture plus duplicate/prototype-key checks. The initial
integer assertion was tightened to check the actual type before establishing
that final red count; conversion of a returned string by the test itself is
not compatibility evidence. A subsequent native nonbreaking-space observation
reproduced an additional incorrect conversion before the whitespace refusal
fix. JSON tooling can erase signed zero; the capture explicitly records its
native sign rather than inferring it from transformed JSON numbers.

Each supported native scalar also reaches an explicitly injected test database
through argv, SDK and the actual safe-bash Shell. These checks compare output,
status and connection/query/result-close/rollback/close effects and assert
cleanup remains idempotent. They qualify scalar transport and orchestration,
not real driver behavior, SQLite persistence or database parity. No canonical
test creates files or accesses native programs, network or real databases.

Native warning/traceback/error identity, arbitrary compound/Python expression
syntax, bytes/complex/set literals, unusual newline and string prefix forms,
Unicode-name escapes and full Python tokenizer behavior remain unqualified.
Scalar refusal is an observable divergence, never a reference pass. Larger
numeric conversion bounds are host policy; this parser is not a general Python
interpreter. Current verification results are recorded in the implementation
status; no README, staging, commit, push or publication changes were made.
