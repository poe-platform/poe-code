# yq command ownership

## Scope

Keep YAML/TOML parsing, query evaluation, encoding, comments, aliases, resource
accounting and in-place publication in the private `safe-bash-command-yq`
workspace. The shared query and regex engines remain private dependencies;
canonical runtime contracts come from `safe-bash-contracts`.

The synchronous preparation and formatting implementation lives in `src/sync.ts`.
Safe Bash retains only command composition and executor registration, including
registration of those synchronous evaluators. Moving these functions preserves
the existing fast-path admission, fallback, input cache and output bytes.

## Compatibility

Preserve the Mike-yq default and the existing restricted query implementation,
the optional `yaml@2.9.0` peer, public Safe Bash imports, default inventories,
replacement policy and unlimited default quotas. Do not publish the command or
its engines separately. Generic packaging must embed private runtime code and
rewrite declarations into the existing shipping package.

## Verification

- Characterize ownership before moving implementation with the maintained
  `scripts/yq-workspace-boundary.test.ts` regression.
- Build the selected command and Safe Bash dependency closures using the
  maintained workspace builder; run command unit tests and lint/typechecks.
- Preserve the existing synchronous parity and yq behavior regression suites.
- Run packaging and optional-profile boundary tests and package-lint rules.
- Verify packed public imports, Shell scripts/pipes, canonical contracts,
  cancellation and registration using the maintained yq consumer fixtures;
  compile the public fixture with strict NodeNext without private workspaces.
- Deliver the atomic refactor to remote main and verify ancestry. Publication
  belongs to the existing parent release workflow.
