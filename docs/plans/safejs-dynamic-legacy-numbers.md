# Non-strict dynamic numeric literals

Eight native differential cases reproduce rejection of valid leading-zero
numeric literals. Ordinary public parsing remains strict. Enable legacy
numeric tokenization only for dynamic function parsing, with strict rejection
in the parser's lexical context. Decode all-octal leading-zero integers in base
eight; leading-zero numbers containing 8 or 9 remain decimal. Preserve exponent,
fraction and separator rules and reject legacy BigInt spellings.

Native controls cover strict directives, nested strict functions and class
methods. Node 22 accepts legacy literals in class field initializers, so the
initial assumption that this native control would reject was removed rather
than treated as runtime evidence. Further specification review is needed for
that host discrepancy.

An expanded test exposed a separate re-tokenization path in template
substitutions. Propagate the surrounding non-strict grammar to that path, without
relaxing template escape rules. Cases also cover defaults, property keys,
numeric member access, nested functions and all four dynamic function kinds.

The isolated committed-source candidate passes all parser tests: 1073 passes
and one existing skip across 33 files, plus package TypeScript. Focused lint
passes on parser/tokenizer; the final expanded test file is checked separately.
The candidate excludes uncommitted runtime metadata. These parser changes do
not by themselves deliver the Function-family runtime constructors.
