# rg command ownership

Complete the existing private rg extraction while preserving its public Safe Bash surface.

- Move rg-only option parsing, file types, glob selection, traversal, matching,
  output, replacement and streaming limits from the search engine into the command.
- Keep shared regex compilation and the canonical search diagnostic in the lower-level
  search engine; compose independently owned grep and rg commands.
- Preserve Safe Bash search compatibility facades, registration, provider selection,
  default limits and the existing private artifact admission. Add no runtime dependencies.
- Move existing rg engine regressions without weakening assertions and declare unit
  dependency builds. Verify the command,
  shared engine, Safe Bash search integration, package boundaries and packed NodeNext consumers.
- Deliver to remote main only after focused maintained checks pass. Private workspaces
  remain bundled in the existing parent package and are never independently published.

Implemented and verified with the maintained build, scoped unit and search
integration suites, command lint/type checks, parent consumer typecheck,
packaging regression tests and package-lint gates. Isolated installed Node
consumers cover both providers, scripts, pipes, byte argv, errors, cancellation,
limits and registration. Strict NodeNext declarations and browser/workerd
consumers pass without private workspaces installed.
