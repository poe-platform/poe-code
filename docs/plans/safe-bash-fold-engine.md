# Fold engine implementation receipt

Task: `engine-fold`, 2026-09-19. Implementation lives in the private
`packages/safe-bash-command-fold` workspace. Its parser, checked column primitive,
width primitive and bounded byte engine are exported through
`@poe-platform/safe-bash/commands/fold`. Safe Bash contains only a re-export.
The active package pattern was read at its current archived path:
[command package pattern](archive/safe-bash-command-package-pattern.md).
The deleted former path was not restored.

This task implements the pure engine boundary. It does not replace the existing
stream-inspection command, add default registration, or perform the subsequent
VFS/invocation integration tasks in [the fold plan](safe-bash-fold.md).
Hosts must await writes, register source/sink invocation cleanup before resource
acquisition and dispose the engine in finally. The engine acquires no external
resources, uses no host executables/files/network, and borrows an explicit signal
without installing listeners. Synchronous calls are bounded to 4096 input bytes;
retained line/prefix admission requires 8196 bytes. Cumulative input, output and
algorithm work have explicit limits. Caller-retained output and host capabilities
need their own resource budgets.

Original in-memory tests were written and executed before implementation; the
first run failed on the absent API. Later admission and legacy-option tests also
failed before their respective fixes. The final package unit route passed all
15 tests with no skips, covering exact bytes, counting modes, malformed decoding,
chunk boundaries, LF/file state survival, overflow replay, separator rescanning,
zero-width runs, controls, width boundaries, cancellation, byte ownership and
structured resource/arithmetic failures. The 12000-mark controls retained exact
bytes and produced the supplied byte/character-mode LF counts, 4001 and 1715.
Checked subtraction-underflow coverage uses an explicitly admitted column-state
primitive; it is not a claim that the supplied native fixtures underflow.

The GNU coreutils 9.10 archive was fetched as development research and its SHA256
verified as `16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read released `src/fold.c`, the fold section of `doc/coreutils.texi`, and upstream
fold-characters, fold-nbsp and fold-zero-width tests. Read development snapshot
`b25722854370b8206d7f53f8934c36710cdd9974/src/fold.c`: its `c32issep` predicate
is distinct from the release's blank/nonbreaking-space predicate. These are
source-derived findings. No native utility or host-locale oracle was executed.
The supplied executed controls remain user-provided observations, as qualified
in [the acceptance record](safe-bash-fold-acceptance.md).

Portable UTF-8 is named `UTF-8/Unicode-17.0.0`; general `en_US.UTF-8` remains
unavailable. The released gnulib zero/wide bitmap sets were converted into sorted
intervals and verified over all 1114112 scalar-domain values: 2521 zero/control
entries and 182780 wide entries. Generic Unicode 17 East Asian Width is not an
exact substitute: its wide set adds 376 values and omits 280 gnulib values.
The pinned gnulib table data is reused under LGPL-2.1-or-later with notices,
license texts and the modified table source bundled as explicit assets. The
parser, decoder, arithmetic and engine are original MIT implementations.
Unknown profiles and unchecked native arithmetic wraparound remain rejected.

Verified routes:

- `npm run lint --workspace=safe-bash-command-fold`: ESLint and production/test
  typechecks passed.
- `npm run test:unit --workspace=safe-bash-command-fold`: 15 passed, zero skips.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  selected workspace closure passed, including guarded build and postbuild.
- Final command-only build passed after the legacy suffix correction.
- `npm run lint:packages`: all 18 rules passed across the current 83 workspaces.
- `npm run lint:types`: root typecheck and maintained contract checks passed.
  Focused ESLint also passed for the safe-bash re-export and both installed fixtures.
- `scripts/package-safe.mjs` staged public libraries; npm-packed tarballs were
  installed offline with scripts disabled in a fresh consumer outside checkout.
  The maintained fold runtime/types fixtures passed, including strict NodeNext,
  exact optional properties and unchecked indexed access. No private fold package
  was installed; implementation/declarations and LGPL notices/table source were
  present in the public artifact, without bare private fold imports.

Final locally tested Safe Bash tarball SHA256:
`05515218b7b62b2f2f5859cba93a31a160a3f509756c933923ac7e62358712a5`.
This is local installed-artifact evidence, not published-version availability,
full native-locale qualification or full command CLI/SDK integration acceptance.
No visual CLI behavior changed, so no screenshot route was needed. The complete
repository build/unit suite was not run for this focused engine/export task.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No standalone private publication was performed. Temporary evidence used
ignored `out/engine-fold` because `/out` is unavailable on this host; staged
packages, tarballs, logs and the external consumer are purged after verification.

## Engine review, 2026-09-19

Reviewed the current task implementation for duplicated logic, proxy-only
abstractions, host access, failure cleanup, cancellation, ownership and resource
admission. A new original in-memory regression failed before correction:
standalone malformed byte `0xAD` inherited the zero width of Unicode U+00AD.
Malformed input now counts one column independently of its byte value. C high-bit
bytes also use the release's zero-character mapping during `-s` remainder
rescanning. Original bytes remain unchanged; valid UTF-8 U+00AD remains zero width.
This explicit C profile treats high-bit bytes as encoding errors for rescanning.

Re-fetched the GNU 9.10 archive and verified its recorded SHA256. Read released
`src/fold.c`, `lib/mbbuf.h`, `lib/mcel.h`, the fold manual section and upstream
fold-characters/fold-nbsp/fold-zero-width tests. Compared development snapshot
`b25722854370b8206d7f53f8934c36710cdd9974`: the blank/nonbreaking-space versus
`c32issep` distinction is preserved. These are source findings; no host fold or
implicit host locale was used.

After correction, the maintained command unit route passed 17 tests, zero skips.
Additional cases cover cancellation with a retained decoder prefix, closed-state
rejection after output-budget failure, idempotent disposal and preservation of
already delivered output. Command lint and production/test typechecks passed.
The maintained selected `@poe-platform/safe-bash` build closure passed, including
postbuild. `git diff --check` passed. No unrelated files were changed by this pass.

Staged version `0.0.0-fold-review`, packed the three public libraries and installed
them offline with scripts disabled into a fresh consumer outside the checkout.
The maintained fold runtime fixture and strict NodeNext declaration fixture
passed, together with the corrected malformed-byte cases through the public
export. No private fold package was installed. Bundled implementation/declarations
and LICENSE/COPYING/COPYING.LESSER/width-data.ts assets were present. Safe Bash
tarball SHA256: `6a8ac519e0f5b2b2b2133fa8ef5c97afa8a94891610da08262bd362f3af962d6`.

No unresolved engine-review findings remain. General libc locale qualification,
VFS command registration and CLI/SDK command integration remain the subsequent
fold-plan tasks; this review does not claim those gates passed. No visual CLI
behavior changed. Full repository checks were not repeated for the focused engine
correction. Local commits, remote-main delivery and successful releases: none.
No package was published. Task-owned temporary evidence and the external consumer
were removed; other contributors' evidence was preserved.
