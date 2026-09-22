# Fold VFS resource and failure boundary QA

Qualify the working-tree candidate without publishing the private workspace or
changing unrelated edits. Execute these steps manually; this is not a QA script.

1. Independently hash the released coreutils 9.10 archive against
   `16535a9adf0b10037364e2d612aad3d9f4eca3a344949ced74d12faf4bd51d25`.
   Read released `src/fold.c`, its manual section and all five upstream tests;
   compare development `b25722854370b8206d7f53f8934c36710cdd9974`.
   Do not execute a host fold utility or infer libc locale compatibility.
2. Run the maintained Fold test/lint routes. Check simultaneous operand and
   input/output reservations, bounded fallback read admission, input errors,
   previously delivered output on quota failure, cancellation during parsing,
   producer drainage, cross-realm input and denied external capabilities.
3. Execute `tests/plugins/fold-boundaries.test.ts` in Safe Bash. Check actual
   pipes, redirects, VFS script invocation and SDK parity. Resolve same-file
   symlink identity and explicitly distinguish Shell truncation from atomic
   replacement. Absent host paths and URL operands must remain VFS errors.
4. Run the selected Safe Bash build closure, repository build/lint/package lint
   and complete maintained `npm test`. Serialize compiler-producing gates.
   Separate failures, skips, unavailable cells and incomplete runs.
5. Stage public artifacts with the maintained packer, install only public
   tarballs outside the checkout with scripts disabled, then execute maintained
   Fold, smoke, registration and strict NodeNext declaration fixtures. Confirm
   no private workspace installation or bare private runtime/type imports.
6. Capture and inspect actual command output with the maintained screenshot
   tool. Purge task-owned temporary artifacts after recording the results.

`/out` is read-only on this host (confirmed EROFS); use ignored `out/safety-fold`
for temporary evidence and an external temporary installed consumer.

## Admission finding

A memory-only failing test reproduced separate admission of retained operands
and an input/output reservation: a 3000-byte operand plus a 4096-byte chunk
passed a 20000-byte retention ceiling. Operand reservations now remain charged
during invocation I/O. Both CLI and SDK reject the combined over-budget case;
bounded `readFile` receives the remaining limit after operand storage.

Released source uses `c32isblank && !c32isnbspace`; the development snapshot uses
`c32issep`. The prior glyph width survives LF/files. These are source-derived
findings, not newly executed native controls. Profiles remain explicit C and
UTF-8/Unicode-17.0.0; arbitrary libc locales and native unsigned underflow remain
unqualified. Conditional/exclusive file publication is not an operation offered
by Fold; it streams stdout. Same-file Shell redirection, including an alias,
truncates before operand reads and carries no atomic-output guarantee.

## Working-tree verification receipt — 2026-09-19

- TDD: the simultaneous-retention regression failed with a missing expected
  rejection before the fix; the final Fold workspace route passed all 64 tests,
  zero failures/skips. Maintained workspace lint and both typechecks passed.
- Three actual Shell boundary tests passed using memory VFS only. New unit tests
  created no host files, queried no LLM, and invoked no host utility.
- Selected maintained Safe Bash build closure passed. Complete `npm run build`
  passed all root suffix stages; its report counted 82 declared builds and marked
  the Python workspace's absent build declaration as not a pass.
- Complete repository `npm run lint` passed on retry: zero errors, four warnings,
  no traversal gaps, followed by maintained type and workflow checks. The first
  attempt exited 2/incomplete because concurrent build output replacement changed
  the root directory identity during guarded traversal. The guard was preserved.
  Package lint passed all 18 rules; focused new Shell-test lint also passed.
- Fresh public tarballs were installed offline outside the checkout with scripts
  disabled. Maintained Fold, registration and general smoke fixtures passed;
  strict NodeNext Fold declarations passed. The smoke fixture's first execution
  lacked its sibling fixture imports; copying the complete maintained fixture
  set resolved that harness setup failure without changing product code.
- Installed qualification passed all 45 fixed released `fold.pl` input variants
  across actual file, pipe and redirect routes invoked through VFS `.sh` files,
  plus two ENOENT controls. The 90 direct memory CLI/SDK variants remain part of
  the maintained command tests. Locale-dependent upstream shell wrappers are
  mapped to explicit profiles rather than executed using ambient libc locales.
- Installed CLI returned status 1/no stdout for the repaired quota boundary;
  direct SDK rejected with canonical `FoldError('LIMIT')`. Partial-output quota
  failure retained the previously delivered two bytes and closed input once.
  Initial manual controls incorrectly used a 3000-character single path component
  (memory VFS correctly rejected ENAMETOOLONG), then expected Shell to reject its
  promise instead of mapping the escaping command error to status 1. Corrected
  controls used valid nested components and inspected actual CLI/SDK outcomes.
- AST inspection covered 1260 installed JS/TS/declaration files with no bare
  private command/contracts specifiers; neither private Fold nor contracts was
  installed. The Fold manifest remains private with empty runtime dependencies.
- Installed Fold was bundled in memory and evaluated in a Node VM with process,
  Buffer, require and WebAssembly explicitly unavailable, imports denied and a
  throwing fetch capability. It passed with zero authority attempts. This is
  conditional Node-hosted realm evidence, not an actual browser/workerd run.
- Ad hoc installed-command screenshot captured with the maintained screenshot
  tool and visually inspected: wrapping, unavailable-option diagnostic and
  status 1 rendered correctly. No screenshot test was added.
- General original/replay smoke controls passed; no new exhaustive Fold replay
  matrix is claimed. Actual Bun/browser/workerd runtimes, arbitrary libc locales,
  native unsigned underflow and widths beyond JS safe arithmetic remain
  unverified/unqualified. Host resource-limit wrappers are represented by
  deterministic byte/work quotas, not a native RSS or wall-clock measurement.

Base HEAD: `35d01c57f8078d8afa916dc59929395d857e9c55` plus preserved working-tree
edits and this task's command fix/tests. This is working-tree qualification,
not a committed archive or released revision.

Candidate inventory: sorted relative Fold `src/*.ts`, package manifest and public
wrapper, each path + NUL + binary SHA256(file), 13 files:
`27bf96f13d03a4ca50b396a6afd49749a0b70e8c2c729aa8dd2a679de8d1d2c9`.
Released archive and source hashes matched the existing command QA receipts;
development Fold SHA256 is
`0172cb5af864c0f75eacce93778c1b72510869a2d333c9c4b9a7d1458c77e3a9`.

| Public installed artifact | SHA256 |
| --- | --- |
| Safe Bash | `236f1f5199d0106f137e113b517ffc80bb629d14f32ad16b9f773ef4449e2c70` |
| SafeFS | `d43a9ba4c7ff6d607028d02b63c5ded89b48973fdce8c32dfe74064ad7a62b34` |
| SafeJS | `869427e9017e711209f31382f7b59f2054cb6ee39f3acbefb3d653021011752c` |

Full `npm test` **failed**, exit 1. Its Safe Bash runner checks passed 558/558;
the subsequent unit stage reported 42714 tests: 41884 passed, one failed,
829 skipped, zero cancelled/todo, approximately 1185 seconds. Earlier shared
workspace batches completed with two skips. The failure was independently
reproduced with the exact archive control:
`private checkout refuses qualification through retired public exports`.
The verifier reports
`Peer binding requires the selected committed package metadata` before the
test's expected retired-public-runtime refusal. Working-tree Fold export,
dependency and private profile metadata differs from committed HEAD. The
assertion and archive guard were preserved; no unrelated metadata was committed
or reverted to conceal the failure. Downstream workspace routes and root
posttest were not reached. Focused passes do not complete this broad gate.
No timeout occurred. Compatibility acceptance remains incomplete for this
archive gate and the unavailable runtime cells listed above.

Task-owned ignored staging/logs/screenshots and external consumer were purged
after recording receipts. `git diff --check` passed. Local commits: none.
Verified remote-main delivery: none. Successful releases: none. No package
publication or push was requested or performed.
