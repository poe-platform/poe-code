# behavior-fmt follow-up review

Reviewed the existing working-tree implementation on 2026-09-19. Preserved all
pre-existing edits; this follow-up changes only the fmt command's acquisition
tracking/profile admission, its tests, and this receipt. The package pattern is
at [the archived path](archive/safe-bash-command-package-pattern.md); its original
path was already deleted on entry.

## Source qualification

Downloaded the concrete GNU coreutils 9.10 release and verified archive SHA256
`16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
Read fmt.c, the fmt manual section and all five upstream tests. Fresh comparison
against development revision `b25722854370b8206d7f53f8934c36710cdd9974`
confirmed only default initialization placement differs in fmt.c; the manual
section and four tests are identical. Development base.pl changes platform
ERANGE diagnostics, not formatting fixtures. No native utility or host locale
was executed. Historical 8.30 snapshots retain their separate profile/version.

## Reviewed increments

1. A failing memory-VFS test demonstrated invocation cleanup settling before an
   admitted capabilitiesFor lookup completed. InputScope now tracks the entire
   acquisition before asynchronous VFS work starts. Cleanup awaits it, checks
   cancellation before subsequent source acquisition, and shares idempotent
   completion. The regression test explicitly blocks/releases cooperative VFS
   work and verifies no read starts after cleanup.
2. A failing test demonstrated an explicitly empty SDK profile falling back to
   the default and acquiring stdin. Only undefined now selects the default;
   unsupported profiles receive the same PROFILE diagnostic through direct SDK
   execution and the command factory before I/O.
3. Added byte comparisons for all 200 specified MAXCHARS recipes, across ten
   lengths, five leading margins and default/uniform/crown/tagged modes, with
   three chunk sizes. Expected bytes are source-derived, not native captures or
   candidate-generated outputs. A first expectation incorrectly assumed tagged
   secondary indentation when the end word itself caused a multiword flush;
   source reinspection corrected it to first indentation in the retained window.
   No formatter algorithm change was needed for these controls.

## Safety and architecture review

Command logic remains in private safe-bash-command-fmt, TypeScript ESM, with
empty runtime dependencies. Safe Bash facades compose/export it. Reviewed the
parser, byte helpers, engine, diagnostics and invocation scopes for host access,
proxy-only abstractions, duplication, failure paths and version mixing; no
additional validated code defect was found. No speculative simplification was
made. Formatting uses raw bytes rather than decoded Unicode or terminal widths,
and paragraph DP differs from hard folding/greedy wrapping.

Input/output, decodedBytes=0, retained engine bytes, bounded arguments and work
remain explicitly accounted as described in the package README and previous
[behavior review](safe-bash-fmt-behavior-review.md). Word/DP object storage has a
fixed count bound rather than a claimed physical-byte measurement. Arithmetic
is checked; recursion depth is fixed. Source fragments are copied before
producer advancement; output writes are awaited; cancellation checkpoints and
cleanup remain covered. The new acquisition fix does not claim preemption of
uncooperative host capabilities.

## Acceptance and unresolved findings

| Cell | Disposition |
| --- | --- |
| Goal/maximum DP, width7/8 baseline, upstream goal fixture | Passing maintained package controls |
| Crown/tagged/split precedence, sentence spacing, prefixes | Passing original package controls; combined native qualification OPEN |
| Final LF, stdin and multiple file boundaries | Passing package and integration controls |
| MAXCHARS 200 recipes | Source-qualified exact-byte comparisons pass; original native byte captures OPEN |
| MAXWORDS boundaries | Existing byte controls pass; full 144 native byte captures and combined tie/carry/punctuation controls OPEN |
| Cancellation, ownership, limits and cleanup | Package and focused integration controls pass, including new failing-before-fix regressions |
| Profile availability | Explicit unknown/empty profiles fail before I/O; complete released non-C diagnostics OPEN |
| Private package and public composition | Existing boundary preserved; no private package publication |
| Installed public artifact | Public-only offline installation, runtime and strict declarations pass; no bare fmt/contracts specifiers |
| Browser/workerd | Independent runtime qualification OPEN |

Missing full native transcripts and combined algorithm/window qualifications
remain unresolved findings and block claiming complete compatibility. Passing
source-derived fixtures does not close native-observation cells. See the
[acceptance matrix](safe-bash-fmt-acceptance.md) for original recipes and evidence
labels. No unsupported profile is counted as a passing locale case.

## Fresh verification

- 57 private package tests pass, including the 200 source-derived cases.
- Private package ESLint and source/test TypeScript checks pass.
- 719 focused fmt/adversarial/registration integration tests pass.
- Maintained selected Safe Bash build closure passes, including 18 declared
  workspace builds and native postbuild stages; repeated after the final fix.
- Staged version 0.0.0-behavior-fmt-task-review with package-safe.mjs after the
  selected build. Packed only SafeFS/SafeJS/SafeBash, then installed those three
  tarballs offline with scripts disabled in an external temporary consumer.
  Neither private fmt nor contracts was installed. The maintained fmt runtime
  fixture and strict NodeNext declaration fixture pass, as does the installed
  empty-profile regression. AST inspection of all 1274 shipped JS/declaration
  files found no bare fmt/contracts specifiers; canonical relative private
  implementation paths remain intentional.
- git diff --check passes. Repository-wide suites were not repeated for these
  focused command fixes.
- Rendered and visually inspected an ad hoc terminal PNG from the installed
  artifact's width8, crown and tagged output; margins and paragraph boundaries
  were legible and matched the byte controls. No screenshot test was added.

An initial packing attempt ran before staging finished and was discarded. A
re-staging attempt correctly refused an existing destination; that task-owned
destination was removed before successful staging/packing. An initial artifact
text search incorrectly rejected canonical relative private-directory names;
the subsequent AST check validates bare specifiers. Failed tooling attempts
were not counted as successful verification.

No local commit, verified remote-main delivery or successful release is claimed.
No command package was published. Temporary task output uses repository
out/behavior-fmt-review because absolute /out is unavailable on this host. All
task-owned temporary output and the external consumer were purged after capture.
