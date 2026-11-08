# Shuf private workspace

## Ownership and compatibility

Revalidated remote main `3a001d444ae8136a31dcd8ab98a400372479b4cf`.
The extraction already exists in `packages/safe-bash-command-shuf/src`.
`packages/safe-bash/src/commands/shuf.ts` retains the `shufCommand` alias;
`commands/shuf/index.ts` and `src/shuf.ts` forward the private implementation.
The current default and optional factories share that implementation. Preserve
this current behavior, including the separately implemented synchronous evaluator,
rather than restoring the historical pre-extraction implementations.

The private workspace owns parsing, sampling, random-source reads, output and
limits. It imports canonical contracts and the existing filesystem and IO engine;
it has no dependency back to Safe Bash. Existing manifests admit its exact
optional modules and portable profile. The parent bundles them into public
exports; the command workspace is never independently published.

## Verification plan

- Preserve all existing workspace tests and Safe Bash regression/integration tests.
- Build through the maintained selected Safe Bash workspace dependency closure.
- Run the shuf workspace unit, lint and strict source/test type checks, package
  policy checks and focused packaging tests.
- Pack the shipping packages with the maintained packaging route. Install tarballs
  into an isolated consumer without private workspaces or repository sources.
- Verify root, legacy `shuf` and `commands/shuf` canonical runtime identity; default and
  explicit registration, collisions/replacement, raw byte argv, VFS scripts and
  pipes, seeded sampling, cancellation identity and explicit limits.
- Compile strict NodeNext public consumers and exercise portable public exports.
- Keep temporary build evidence under `out` and remove it after verification.

No output, help, default inventory, random-source policy or resource default is
changed by this verification work. Existing count, large-range, output ownership,
input budgeting and cancellation regressions remain authoritative.

## Verification completed

The maintained Safe Bash build closure, 34 fresh shuf workspace tests, 294 focused
Safe Bash regressions, 243 packaging tests and shuf lint/source/test typechecks
passed. Package policy passed 17 rules; the two root-application-bundle rules were
not applicable to this selected build and reported skipped.

The shipping tarballs passed the dedicated shuf consumer and strict NodeNext
declarations outside the repository with no private Safe Bash workspaces installed.
The same consumer passed Node's browser and workerd export conditions; these are
conditional-export checks, not claims of deployed browser or Cloudflare execution.
The existing portable regression also passed with Node globals removed.

Core and optional exports intentionally contain separate factory functions, while
their command runtime identities and public contracts remain shared. The consumer
checks that contract rather than requiring factory reference equality. No product
implementation or historical test assertions were changed during this audit.
