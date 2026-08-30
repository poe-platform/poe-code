# Static binding preflight attempts

No candidate runtime, compiler, guest, mock transport or private query had run.

## Attempt 01

The new archive binding's three-test static preflight returned two passes and one
failure. The failed test was `exact candidate and native data classification are
authenticated`, at `binding.test.mjs:8`. Its exact assertion was:

```text
assert.ok(filename.length && !filename.startsWith("/") && !filename.includes("\\"))
```

The sealed common portable-path helper correctly refused backslash, but the full
archive contains literal POSIX native-oracle filenames. Inspecting the exact
candidate's NUL-delimited Git tree revealed six existing names: two each containing
backslash, newline and tab, all below the tree oracle's `native-fixtures/controls`.
The new parser also needed to split the Git header at its **first** tab rather
than discard subsequent tabs belonging to a literal filename. This is an archive
identity/parser binding error, not product behavior or a failed guest assertion.
The tool transcript preserves the complete TAP output: 3 tests, 2 pass, 1 fail.
No synthetic raw capture is presented as that process's stdout file.

The new version binds those exact six path/blob pairs in `CANDIDATE.json`, permits
them only as literal POSIX paths and preserves their bytes. All other path guards
remain unchanged. No canonical source/test/input is excluded, renamed, waived or
modified. The prepared public and SafeJS assertions are unchanged. A subsequent
static preflight is a new binding revision, not a runtime retry or a rescued pass.
