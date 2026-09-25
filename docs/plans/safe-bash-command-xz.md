# Extract XZ into a private command workspace

Issue: #1008. Revalidated at local main `8f5a0eecbdecd00906e080cf137cdc4d95efd7ef`;
fetched main `9751378374` has the same compression sources. The current command
and codec implementation lives in `packages/safe-bash/src/commands/bytes/compression`.
Existing local compression fixes must survive the move without being attributed
to this refactor. Related behavior issues #660 and #707 retain their own scope.

## Implementation

- Add a failing maintained package-boundary test before implementation.
- Extract reusable streaming, codec, file-operation, option-parsing and native
  assets into private `safe-bash-compression-engine`, using canonical contracts.
- Give private `safe-bash-command-xz` the XZ profile, handler, aliases and index
  listing implementation. Move command unit tests with unchanged assertions;
  retain Shell integration coverage in Safe Bash.
- Keep Safe Bash compatibility facades and compose the same command inventory
  in the same order. Admit the private graph, exports and assets through existing
  declarative packaging rules. No external runtime dependency or separate release.
- Correct the general command guidance to permit explicitly requested migrations.

## Verification and delivery

- Run workspace unit, strict type, lint and package-lint checks, the maintained
  selected workspace build, packaging tests, and complete root gates as required.
- Pack isolated consumers with no private workspace installation; exercise public
  exports, strict NodeNext declarations, Shell pipes and VFS scripts, byte argument
  and error identities, cancellation, registration, limits and codec assets.
- Preserve existing supported runtime profiles and inspect help with the maintained
  screenshot route if output changes. Store temporary evidence in the checkout's
  `out/issue-1008` and remove it after recording completion evidence.
- Review every acceptance requirement, commit the atomic refactor, push main,
  verify remote ancestry, record evidence, then close #1008. Release publication
  is separate and is not awaited, per the user's explicit instruction.
