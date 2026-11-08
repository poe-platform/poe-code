# File command workspace

Baseline: `88613aec0b`. The private `safe-bash-command-file` workspace already owns
argument handling, bounded reads, formatting, limits and synchronous evaluation.
The private `safe-bash-mime-engine` owns classification shared with other commands.
Safe Bash retains its public adapter, inventories and registration policy.

Complete the extraction by moving direct behavior and resource-budget regressions
into the command workspace, preserving Shell integration and native oracle tests
in Safe Bash. Declare canonical prerequisite builds for the command unit task.
Keep all assertions and public behavior unchanged.

Verify the maintained command build, uncached unit task, lint/typechecks, package
lint and boundary tests. Verify packed public imports in an isolated consumer,
strict NodeNext declarations, VFS scripts/pipes, byte carriers, canonical errors,
symlinks, NUL output, cancellation, limits and collision/replacement. Execute the
same portable fixture under browser and workerd conditions without host globals.
Private command and MIME packages remain bundled implementation details; neither
is independently published or required in consumer node_modules.
