# Extract cp into a private command workspace

Revalidated main `3f299b5fc8`: filesystem.ts owns the cp handler and recursive copy policy; copy-source is shared with move.ts, backup helpers with mv/ln, and filesystem identity already belongs to safe-bash-contracts.

1. Characterize the missing private package and real implementation boundary before extraction.
2. Move cp handler, options and preservation into private safe-bash-command-cp. Move retained copying, backup primitives and shared operand helpers into the existing private safe-bash-io-engine. Keep canonical contracts and compatibility facades.
3. Preserve default inventory, limit propagation, mounted capability admission, aliases, backups, cancellation, and cross-filesystem behavior. Add explicit factory/plugin exports without registering extra commands.
4. Move preflight regressions into the command owner unchanged apart from imports/factory selection; retain Shell and multi-command integration regressions in Safe Bash. Verify the selected build/unit/lint/type and package gates.
5. Exercise an isolated packed consumer and strict NodeNext declarations, public root/subpath identity, Shell scripts/pipes, canonical arguments/errors, registration and cancellation; qualify portable profiles. Bundle all private workspaces into the existing parent only.
6. Commit, rebase concurrent main changes, verify remote main delivery, then close the work item. Release publication is separate.
