# Dynamic function HTML-like comments

The constructor grammar audit compared 56 source/constructor pairs against
native Node. Eight mismatches were HTML-like opening and line-initial closing
comments across Function, AsyncFunction, GeneratorFunction and
AsyncGeneratorFunction. The initial regression file failed four constructor
cases; its ordinary-tokenizer and same-line-close rejection controls passed.

Annex B.1.1 permits this legacy Script grammar but excludes Module source:
https://tc39.es/ecma262/2024/multipage/additional-ecmascript-features-for-web-browsers.html#sec-html-like-comments

The local change opts dynamic function source and its embedded expressions
into this grammar, preserving ordinary tokenizer rejection. Closing comments
are eligible only before a token on the current line; multiline comments
containing a line terminator reset that state. Template substitutions share
trivia handling. Source positions and automatic semicolon insertion must
remain correct for every JavaScript line terminator.

Delivery is pending. The frozen dynamic candidate's already-running unit suite
does not include this follow-up; synchronize and verify it separately after
that run finishes. Do not count that earlier suite as evidence for this change.

The execution follow-up passed CR/LF cases but failed both U+2028 and U+2029
cases. The tokenizer's line-break predicate only recognized CR and LF. Local
handling now recognizes all four terminators for trivia and source positions,
while quoted string rejection remains specific to raw CR/LF, preserving the
existing tests for literal Unicode separators inside strings. Broader parser
and dynamic-constructor regressions are running; no delivery is claimed.
