# Playwright CLI command extraction

Migrate the existing optional command, without changing
registration, capabilities, limits, runtime profiles or public imports.

- Move the shell adapter and browser controller modules into private
  `safe-bash-command-playwright-cli`; retain static Safe Bash re-exports.
- Keep controller services independent of shell registration. Import canonical
  shell contracts from `safe-bash-contracts` and share pure MIME detection through
  private `safe-bash-mime-engine`, without dependencies back to Safe Bash.
- Preserve generated native storage literals and verify them in the owning build.
- Move controller unit tests and retain Shell integration/regression coverage.
- Admit dependency/export declarations in the maintained graph and bundle private
  runtimes/declarations into existing published surfaces.
- Verify maintained builds, unit/type/lint/package gates, isolated packed execution,
  NodeNext declarations and canonical error/value/argv identity before delivery.
- Record remote-main delivery and requirement evidence;
  release publication is separate and need not be awaited for this request.

## Packed consumer verification

After the maintained build completes normally, prepare artifacts with
`scripts/package-safe.mjs` in `out/playwright-extraction`, pack the existing Safe FS, Safe JS
and Safe Bash parents, and install those tarballs into a temporary consumer outside
the checkout (so workspace modules cannot resolve through ancestors) with
`--workspaces=false --ignore-scripts`. Copy the maintained Playwright runtime and
NodeNext declaration fixtures into that consumer. Run the runtime fixture under
Node's default, browser and workerd conditions; compile the declaration fixture
with strict NodeNext, exact optional properties and unchecked indexed access.
The consumer must contain no workspace source or private workspace installation.
Verify raw Shell argv, VFS scripts, pipes, error identity, cancellation,
registration collisions and explicit replacement. Record validation results
and purge the generated consumer, artifacts and logs after use.
