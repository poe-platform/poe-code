# RegExp.prototype.compile

Validate the missing Annex B compile method against native execution and the
RegExpInitialize algorithm. Keep receiver identity, guest own properties and
prototype intact. Parse replacement source/flags through the existing sandbox
compiler and its resource owner; never call the native regex compiler.

Cover original-slot copying from regex arguments, ignored Symbol.match and
source/flags getters, ordinary argument coercion order, parse failures, lastIndex
reset, and mutation-before-failure when lastIndex is non-writable. Verify compiled
ticket accounting, replacement during execution, and snapshots. Values.ts also
contains unfinished weak-collection work: stage only this feature's hunks, not
those unrelated changes, when making the eventual atomic commit.

## Verification

Eighteen of 23 public tests failed before implementation. All now pass, including
mutation-before-readonly-cursor failure, copying original regex slots despite
overridden getters, parse-failure preservation, and mutation during input coercion.
A further standalone test verifies exact compiled-data accounting through twenty
replacements and after a failed cursor reset. All 415 tests in nineteen regex,
ownership, method, and snapshot files pass. Focused lint and the maintained
23-workspace build with four fresh imports pass.

Built Node 18.18.0 and Node 24.14.0 each pass 96 native comparisons across sources,
flags, invalid patterns/flags, and writable/read-only cursors. Each also passes
two public snapshot replays, covering successful replacement and installed state
after a failed cursor reset. No matching open issue was found.

An isolated Git index stages only the two regex hunks in values.ts plus the
regex global, test, and this plan. The normal index and unrelated worktree edits
are preserved; inspect the resulting commit before pushing.

## Direct-call test typing follow-up

An explicit TypeScript check of regex-compile.test.ts found TS2345 at both
standalone method calls: their contexts omitted the required stack field. Supply
an empty stack for these top-level calls without changing runtime code or relaxing
SandboxCallContext. The explicit test-file type check and all 24 tests now pass.
