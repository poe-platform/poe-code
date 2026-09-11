# Owned-byte eval source

## Confirmed defect

`eval` joins the decoded `context.args`, losing invalid UTF-8 bytes before
parsing. The independent getopt regressions and direct eval controls reproduce
the loss with valid UTF-8 saved scripts. Invalid UTF-8 VFS script files remain
an explicitly refused input profile, separate from owned eval arguments.

## Implementation

- Join the authoritative argument values, charging the actual cumulative source
  byte count before allocating a parse representation.
- Add an internal source projection with ordinary UTF-8 text and explicit
  position-keyed owned byte fragments. A genuine replacement character has no
  byte-map entry and cannot alias an invalid byte.
- Pass provenance through lexer quoting and nested parser offsets. Backtick
  unescaping and here-document collection explicitly remap retained positions.
- Retain byte values in existing text AST nodes. Do not synthesize ANSI-C syntax,
  rewrite user quoting, use display-string matching, or alter file-source decoding.
- Apply existing source, parsing, value-allocation, nesting and abort budgets.
  Keep the normal text parser path available without a provenance map.

## Scope and validation

Production paths are `shell/runtime.ts`, `shell/parser.ts`, and a narrow
`shell/source-value.ts` helper. Maintained memory-only tests cover direct eval,
getopt round trips, nested substitutions, backticks, quotes and documents.
Independent review owns its separate holdout directory. Preserve original RED
logs and native bounded Bash receipts; no builds, distribution edits or Git work.

## Approved interpreter positional follow-up

The public raw roundtrip exposed a separate loss before eval: interpreter child
states copied decoded positional argument strings. A maintained memory test
reproduces `80ff` becoming two replacement characters, and a bounded native
interpreter control retains `80ff`. Enroll the child in the existing invocation
state ledger, then publish the authoritative trailing argument values by exact
indices. Preserve interpreter flags, source admission, nesting and cancellation;
this does not change the admitted command-string or VFS-source syntax profiles.

Further native holdouts confirmed raw `$0` loss and three literal-expansion
delimiter losses. The runtime now selects `$0` by its exact argument index and
retains it under the reserved `-1` key in the existing positional value store;
ordinary positional enumeration and `$#` never count that key. Replacement and
snapshot operations retain its existing ownership. Literal delimiter expansion
now carries owned fragments through its existing quote/backslash parser.

## Final focused verification

- `/tmp/issue683-eval-source-red-v1.log`: 42 pass, 8 fail before eval changes.
- `/tmp/issue683-raw-delimiter-maintained-red-v1.log`: independent exact-byte
  delimiter regressions, 2 failures before their fix.
- `/tmp/issue683-interpreter-argument-red-v1.log`: 1 failure before the approved
  positional handoff. Its native control is recorded separately in
  `/tmp/issue683-interpreter-argument-native-v1.json`.
- `/tmp/issue683-raw-core-green-v4.log`: 191/191 focused cases.
- `/tmp/issue683-core-adjacent-v3.log`: 477/477 adjacent cases.
- `/tmp/issue683-independent-final-v2.log`: 193/193 independent cases, overlapping
  the focused suite; do not add these counts as distinct coverage.
- `/tmp/issue683-owned-source-mock-v6.log`: 48/48 source/mock consumer cases,
  including the restored saved-cat recipe and raw eval roundtrip. Prior 47/48
  failures remain preserved. These are not packed-artifact or real-browser gates.
- Source and focused test TypeScript checks pass without emitting distribution
  files. Full maintained gates, builds, integration and Git remain root-owned.
- The additional handoff corpus is reported separately: the owner preserved
  11/18 before the follow-up and 19/20 after it, while the independent expanded
  run reports 21/22. Its remaining xargs failure occurs in the shared command
  argument decoder before the interpreter, outside this patch's ownership.
  This evidence is not an all-green integration or release claim.
