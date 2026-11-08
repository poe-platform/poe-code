# SQL option literal conversion

Target: released csvkit 2.2.0, archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
This contract uses the existing frozen CPython 3.14.2 profile, Agate 1.14.2,
SQLAlchemy 2.0.54 and Babel 2.18.0. CPython 3.9.6's different exception
messages are not qualified by these observations.

Original observations are in `docs/csvkit/sql-unhashable-reference.json` and
`docs/csvkit/sql-key-identity-reference.json`. Canonical tests run the actual
TypeScript parser without a Python interpreter or native process.

## Parsing and conversion

`csvkit.cli.parse_list` applies `ast.literal_eval` and catches only ValueError.
The JavaScript engine parses its qualified expression grammar completely before
converting container nodes. Unsupported AST nodes retain the original option
string, including its whitespace. They never execute names, calls or operators.
Unqualified grammar remains an explicit status-78 refusal.

List and tuple elements convert in order. Set elements convert and hash one at
a time. Dictionary entries convert the key, convert the corresponding value,
then hash/insert the key before advancing to the next entry. A nonliteral node
stops conversion with original-string fallback; it does not erase an earlier
TypeError or evaluate later container nodes. Syntax failure precedes conversion.

Unhashable list/dict/set keys and set elements produce CPython 3.14.2's status-1
TypeError text. A tuple containing an unhashable value reports the outer tuple
and the first nested unhashable type. Physical source newlines do not change
these TypeError messages. Qualified multiline SyntaxError identities remain a
separate blocker.

Python dictionary equality and duplicate-key updates preserve the original key
and first insertion position. Ordinary string-key dictionaries use owned
null-prototype records. Non-string-key dictionaries use Map. Nested dictionaries
with canonical JavaScript array-index string keys also use Map to retain Python
insertion order. Hosts must consume that explicit value representation; it is
not JSON coercion. The public top-level option bag remains a Record, so arbitrary
numeric-looking option-name enumeration is not a Python-order guarantee.

Surrogate-valued string escape tokens remain refused: Python distinguishes two
surrogate codepoints from one non-BMP codepoint, while a JavaScript UTF-16 string
would merge them. Refusal assertions are not compatibility passes.

## Host effects and admission

Engine options convert before database acquisition in both SQL commands.
`sql2csv` execution options convert after connection acquisition and before
query dispatch. Failure in that phase rolls back/closes the injected session
exactly once; no query executes. Driver mocks measure only that host contract.
Actual SQL query engines have separate genuine-engine tests.

Scanning, node conversion, hashing and equality consume the injected work
callback. The direct export retains its finite work budget. Parsing retains its
existing depth refusal. Cancellation, verbose traceback provenance and real
driver/service profiles retain their separate qualification requirements.
