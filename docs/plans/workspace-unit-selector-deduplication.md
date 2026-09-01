# Literal workspace test selectors

## Problem

Eight workspace tasks use shell-expanded wildcard arguments. Their selection
depends on shell glob behavior, and the root runner cannot conservatively prove
ownership from those declarations. Root therefore repeats those tests.

## Change

Use literal source-directory filters in agent-gaslight, agent-spawn,
agent-trace-viewer, agent-traces, markdown-reader, process-launcher,
process-runner, and workspace-resolver. Keep the existing Vitest configuration
and markdown-reader coverage options. Direct workspace commands also retain
future nested tests and spec files without enumerating current filenames.

## Validation

The real shell argument-capture regression fails before the change and passes
afterward. All 15 selector-focused tests pass. Verify the complete file union,
run the affected workspace tests, and retain serial execution and native npm
lifecycles. Commit this independently from the root ownership implementation.

The updated discovered union remains all 1135 original files: 468 in root and
667 in recognized workspace ownership, with zero uncovered files. The selectors
remove 73 additional duplicate file executions. All eight affected workspace
unit commands pass serially: 1257 passing tests and one existing skip.
