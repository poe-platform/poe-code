---
title: Contextual of identifiers
---

# Contextual `of` identifier validation

While qualifying TypedArray.of snapshots, SafeJS rejected `const of=Float32Array.of`
with `ParseError: Unexpected token 'of' at line 1, column 7`. JavaScript permits
`of` as a binding identifier outside its contextual use in a for-of header.

Validate declarations, function parameters, references, object shorthand,
destructuring and for-of disambiguation against isolated native execution before
changing the parser. Keep genuinely reserved words and malformed loop headers
rejected. This is a separate atomic parser improvement after factory delivery;
no parser implementation has changed yet.

The new 13-case native-oracle suite confirms ten failing valid cases and three
passing invalid-syntax controls. Coverage includes declarations, assignment,
function names/parameters, shorthand, destructuring, `for (const of of ...)`,
assignment-form for-of, ordinary for loops and an iterable named `of`.
Native expectations are evaluated before SafeJS execution. Log:
`/tmp/poe-safejs-contextual-of-native-red.log`.

Inspection locates keyword classification in `parse/tokenizer.ts`, binding
recognition via `isIdentifierLikeToken`, and a separate keyword-based loop-header
scan in `parse/parser.ts`. Both expression/reference parsing and loop
disambiguation need validation; accepting the declaration token alone is not
enough. Float32Array.of is already on remote main as eee95d79b; its release runs
are CLI 34085616481 and scoped packages 34085616249. The previous prototype CLI
run 34085109173 was also live at the last check; its scoped release is confirmed
as @poe-platform/safe-js@0.1.308.

## Implementation and broader validation

Identifier recognition now accepts contextual `of`. The loop-header scan skips
binding positions and retains the first separator candidate while checking for
ordinary for-loop semicolons. The initial 13-case suite passed. Expanded tests
then reproduced a lexical failure: `const of=8;return of/2` was interpreted as a
regex start. Regex-start classification now distinguishes a for-of separator
from an identifier using the enclosing token context, including the tokenizer's
template-interpolation route.

The expanded parser group passed 751 tests with one skip across 23 files.
It includes division, division assignment, arrow parameters, for-in, member
targets, template interpolation and regex literals directly after for-of.
Log: `/tmp/poe-safejs-contextual-of-lexical.log`. The full SafeJS suite is now
running at `/tmp/poe-safejs-contextual-of-package.log`, with only the separate
two-test host-Promise import policy audit excluded. No parser commit or push is
claimed yet; build and actual harness validation remain after qualification.

The earlier prototype CLI run 34085109173 was cancelled when newer work arrived;
that is not a confirmed CLI publication. Its scoped 0.1.308 publication remains
confirmed. Current factory-release runs 34085616481 and 34085616249 remain under
monitoring while this parser fix proceeds.

## Qualified delivery

The full SafeJS run passed 17,710 tests with 41 skips (519 passing files,
one skipped) in 248.01 seconds, excluding only the separate two-test host-Promise
policy audit. Scoped lint and TypeScript passed. The selected build passed
23 workspace tasks and four native-ESM checks. The real harness passed after
70 uncached CLI build tasks in 59.532 seconds. An informational needless-template
diagnostic was removed from the harness by labeling its interpolation output;
the built-CLI rerun passed and its screenshot was opened and visually verified:
`screenshots/node-dist-bin.cjs-harness-run-docs-plans-safejs-contextual-of-binding.md.png`.

No matching open GitHub issue was found. This parser improvement is ready for
its own commit/push, not yet a publication claim. The preceding factory change
is confirmed published as @poe-platform/safe-js@0.1.309 (run 34085616249), while
its CLI run 34085616481 remains under monitoring.
