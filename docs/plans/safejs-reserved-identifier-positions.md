# Reserved words in identifier positions

Native comparisons validated that eight reserved words still tokenized as
identifier tokens were accepted as labels and bindings. The initial test run
failed eight rejection groups and passed eight property-name control groups.

Identifier eligibility now excludes the tokenizer's existing reserved-spelling
set. Token kinds used by existing statement parsing remain unchanged, and
IdentifierName positions such as property keys and member names remain valid.
Tests cover labels, variable bindings, arrow parameters, function names,
shorthand properties, explicit properties, methods and destructuring keys.

All 16 focused regression groups and package TypeScript passed. The broader
parser/runtime suite passed 1,354 tests (one skipped); focused lint passed.
This change is outside the frozen
isolated suite already running. Pushes and releases remain paused.
