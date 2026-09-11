# Portable fatal UTF-8 decoder errors

Actual workerd acceptance of the bounded find formatter failed before the
command ran: ANSI-C quoting of `\377` reached fatal TextDecoder decoding, whose
TypeError lacks Node's `ERR_ENCODING_INVALID_ENCODED_DATA` code. The parser
incorrectly required that Node extension before preserving invalid UTF-8 bytes.
Command substitution contained the same assumption.

Keep fatal decoding and the existing owned-byte fallback. Construct the decoder
outside the catch and catch only its decode operation. Accept uncoded TypeError
or the expected Node-coded TypeError; propagate other errors and explicit
unexpected codes. Check cancellation before byte fallback, preserving falsey
abort reasons. Do not change the formatter or bypass the failing script.

Evidence and validation:

- Installed workerd failure: `/private/tmp/poe-704-find-final-5jgufhzh/workerd.log`.
- Independent native workerd decoder probe: `/tmp/poe-704-decoder-probe/result.log`.
  Workerd 2026-09-04 reports TypeError with only stack/message own properties.
- Two uncoded-TypeError regressions failed before the fix:
  `/tmp/poe-704-decoder-red.log`.
- Existing byte-values, printf-variable and value-contract files passed 214 tests
  with nine existing skips (223 total): `/tmp/poe-704-decoder-green.log`.
  New controls cover ANSI-C and command-substitution raw bytes, valid UTF-8/BOM,
  unrelated errors, unexpected explicit codes, and false/zero/null/empty-string
  cancellation identity.
- Focused strict TypeScript: `/tmp/poe-704-decoder-types.log`.
- Fresh installed workerd acceptance, final build/lint and remote delivery are
  root-coordinated; earlier failures are retained and do not count as passes.

The error handling follows the native API contract. An unrelated uncoded
TypeError injected into the decode operation by trusted host monkeypatching is
indistinguishable from its standard malformed-input error; this is not a host
JavaScript isolation guarantee.

Root integration validation passed: normal workspace build plus root suffixes;
27 packaged checks on each of Node, Bun, browser bundle and actual workerd;
three strict TypeScript profiles and graph checks. The original workerd ANSI-C
failure passes unchanged, as does raw command substitution. Final candidate:
`/private/tmp/poe-704-decoder-final-n6fvzhig`.

The final full root lint/type/workflow route passed in 351.48 seconds with all
10,512 configured files linted, zero errors/warnings and 25 receipts:
`/tmp/poe-704-decoder-find-lint.log`.
