# Context-sensitive legacy string escapes

Native differential tests validate rejected non-strict octal escapes and
incorrect acceptance of strict `\8`/`\9` strings. The first run also exposed
four invalid test calls: the expression parser was given an entire directive
and return statement. Those controls now pass only the quoted expression;
they are test mistakes, not language defects.

Allow legacy escape tokenization in dynamic source and non-strict embedded
expressions. Mark affected string tokens and reject those markers in strict
lexical contexts. A later use-strict directive must also reject earlier legacy
string escapes in the same directive prologue. A statement or extra semicolon
ends that prologue and must not retroactively make it strict.

Decode octal escapes with the native digit-width rule: three digits for an
initial 0 through 3, otherwise at most two. Preserve raw spellings and keep
template escape validation independent. Ordinary strict tokenization still
rejects legacy strings, including non-octal decimal escapes.

Work is local until isolated parser, tokenizer, template and TypeScript checks
and focused lint pass. Deliver independently of the Function runtime work.

The isolated parser suite passes 1105 tests with one existing skip across 34
files. The package TypeScript check passes. The focused regression file has
32 passing cases, including directive termination and valid strict escapes.
