# Unicode whitespace

Native comparisons and regression tests reproduced rejection of all 16
non-ASCII Unicode Space_Separator characters between tokens. The four negative
controls (U+0085, U+180E, U+200B and U+2060) were correctly rejected by both
engines. The initial regression run failed 16 cases and passed four controls.

ECMAScript 2026 section 12.2 defines whitespace using Unicode category Zs plus
TAB, VT, FF and FEFF, not the broader Unicode White_Space property:
https://tc39.es/ecma262/2026/multipage/ecmascript-language-lexical-grammar.html#sec-white-space

The lexer retains its ASCII path and uses the Unicode Zs category for
non-ASCII characters. Tests preserve string contents and verify that these
spaces do not advance line numbers. The independent validation checkout
contains the already-delivered Unicode terminator/continuation fixes but no
pending dynamic-function changes. Parser-wide tests, package TypeScript and
focused lint are running before a separate commit and push.

Independent verification completed: 1,131 parser tests passed with one
existing skip; package TypeScript passed. Focused ESLint passed for the exact
candidate tokenizer through stdin with its real repository filename and for
the new regression file. Delivery excludes pending dynamic-function work.
