# Unzip command ownership

Keep `safe-bash-command-unzip` private and expose it through the existing
`@poe-platform/safe-bash` root and `commands/unzip` exports. Do not change default
inventories, collision policy, limits, runtime profiles or release scope.

The command owns argument parsing, overwrite answers, archive selection policy,
listing/testing, streamed output, extraction, staging cleanup and synchronous
execution. `safe-bash-zip-engine` retains the shared ZIP format, codecs and
bounded pattern selector used by both zip and unzip. Runtime argument/value/error
identity comes from `safe-bash-contracts`; neither workspace depends on Safe Bash.

1. Revalidate current source ownership and add a failing boundary characterization.
2. Move command-specific argument handling and direct regression tests into the
   command workspace; retain Shell integration tests in Safe Bash without changing
   their assertions. Preserve traversal, symlink, overwrite, cancellation and
   staged publication regressions.
3. Build the maintained workspace closure and run focused unit, type, lint and
   package boundary checks. Keep the existing generic private bundling admission.
4. Verify packed public imports and strict NodeNext declarations without private
   workspace installations, including real Shell scripts, pipes, byte arguments,
   cancellation and registration. Exercise portable browser/workerd profiles.
5. Commit, deliver to remote main, verify ancestry and remove the task worktree.

This extraction does not change CLI help or output. Existing external codec
implementation dependencies are bundled by the parent package; it introduces no
new runtime dependency or independently published package.
