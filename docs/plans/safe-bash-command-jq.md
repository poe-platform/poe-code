# jq workspace extraction

## Design

- Keep the actual jq CLI, streaming and evaluation entry in the private
  `safe-bash-command-jq` workspace. Safe Bash retains public and legacy facades.
- Reuse `safe-bash-query-engine` for jq/yq/xq algorithms and
  `safe-bash-regex-engine` for shared matching. Keep runtime contracts canonical.
- Preserve default inventories, collision/replacement rules, explicit limits,
  virtual filesystem execution, cancellation and all current jq behavior fixes.
- Bundle private owners into the existing shipping parents. No private package
  installation, new runtime dependency or independent publication is required.

## Verification plan

- Move the original byte-ownership, standard-function and whole-value admission
  suites to the implementation owner without changing their assertions.
- Keep a public/legacy facade identity test in Safe Bash and authenticate the
  moved suite paths in the maintained integration discovery check.
- Run the command build closure, unit/type/lint routes and package policy checks.
- Exercise isolated packed public imports with strict NodeNext declarations,
  scripts, pipes, byte/value/error identity, registration, limits and cancellation.
- Check browser composition using the established public entry. CLI/help output
  is unchanged by this extraction, so no visual change is introduced.
