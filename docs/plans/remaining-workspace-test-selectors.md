# Remaining workspace test ownership

The GitHub workflow package's explicit test list names four files that no longer
exist. The conservative root ownership resolver consequently retains the whole
package in root coverage, while its workspace task repeats the existing selected
files. Replace the stale list with the package's source directory. This also
keeps its remaining three files covered by the workspace task rather than only
the root task.

The OpenCode auth package uses a local configuration that only makes the shared
setup-file path absolute. Run its unit task from the repository root with its
literal source directory, matching the shared configuration and existing setup.
Keep its standalone local test command unchanged.

Do not broaden the ownership parser or change discovery, worker settings,
isolation, or lifecycles. Compare actual root and workspace file inventories
before and after, run both workspace tasks, and retain the generic ownership
regression tests. No workflow unit tests or runtime code changes are needed.

Validation on the integrated main revision: 1,137 shared-config test files are
partitioned into 459 root files and 678 workspace-owned files. Root previously
selected 470. The 11 moved files exactly match actual Vitest discovery for these
two workspace commands; eight duplicated executions disappear and three files
move from root-only coverage. Both workspace tasks pass all 203 tests, and all
20 generic ownership regression tests pass. No timing target is claimed from
this small cleanup alone.

The complete root task also passes through its real npm entry point: 11,147
passing tests and one existing skip across 459 selected files. An initial direct
Vitest profiling invocation lacked the invoking npm CLI required by ten real
lifecycle controls; rerunning through `npm run test:unit` passes those controls
without changing their requirements or implementation.
