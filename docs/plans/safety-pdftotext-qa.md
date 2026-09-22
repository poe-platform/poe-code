# pdftotext VFS resource and failure boundary QA

Candidate scope: private `safe-bash-command-pdftotext`, exposed through
`@poe-platform/safe-bash/commands/pdftotext`. Follow the package pattern at its
current preserved location, `archive/safe-bash-command-package-pattern.md`.
This candidate is an admission profile, not a PDF extractor. Do not qualify
Poppler text/font/security/layout fidelity from informational operations.

## Execute

1. Run `npm run test:unit --workspace=safe-bash-command-pdftotext` and
   `npm run lint --workspace=safe-bash-command-pdftotext`.
   Verify malformed arguments, numeric admission, checked quotas, seeded Unicode
   encoding, cancellation, sink failure identity, listener removal, repeated
   cleanup and draining of pending owned writes. Check partial diagnostics when
   later output exceeds the shared stdout/stderr quota. Offer an infinite hostile
   byte source and require zero chunk requests for unavailable extraction.
2. Run `node --import tsx --test packages/safe-bash/tests/plugins/pdftotext-boundaries.test.ts packages/safe-bash/tests/plugins/pdftotext-wiring.test.ts`.
   All files are memory VFS. Verify CLI/SDK parity, actual Shell pipes, redirects
   and VFS `.sh` invocation, same-file and symlink aliases, preserved existing
   named outputs and absent new outputs. Independently check Shell redirect
   truncation, including an alias of the input. Deny fetch; offer host/credential
   paths and inert environment values; require no host executable fallback.
3. Lint the new Shell test and run the maintained selected workspace build
   closure, `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
4. Assemble public packages using `scripts/package-safe.mjs`, install the three
   public artifacts outside the checkout with scripts disabled and run the
   maintained pdftotext runtime and strict NodeNext declaration fixtures.
   No private package may be installed or published. Verify the assembled
   pdftotext runtime/declaration graph contains no private bare specifiers.
5. Bundle and execute the command in a Node VM realm without process, Buffer,
   require or fetch. Supply consistent web/byte constructors explicitly, deny
   stdin/VFS/environment access and exercise informational output and cleanup.
   This qualifies a conditional bundle graph, not actual browser/workerd engines.
6. Record results and unsupported cells separately; purge task-owned artifacts.
   No product visual changes are proposed; screenshots become necessary if a
   production fix changes CLI presentation. No broad/shared code or workflow
   changes are proposed; focused gates are not broad-gate receipts.

## Limits of acceptance

Extraction is unavailable and fails 99 before input/output-file acquisition.
Consequently chunked PDF parsing, cancellation during PDF parsing, parser/font/
decoded-stream budgets, PDF hostile-input recovery, conditional/exclusive named
publication, write rollback, permission-enforcing/default permission profiles,
raw SDK passwords and original/checkpoint/replay extraction remain unsupported.
The parser synchronously polls cancellation; asynchronous interruption during
its bounded synchronous loop is not an executed control. No named write identity
resolution or atomic publication implementation exists to qualify. Preserved
named operands do not prove safe publication. Shell redirects are independent
effects and can truncate source aliases even when extraction fails. Byte sinks
offer no rollback or atomic guarantee for completed writes or partial failures.
No mapped upstream PDF/font/ActualText/layout runtime cells can execute against
this candidate. Native controls supplied with the task remain research evidence,
not first-party extraction passes.

## Results — September 21, 2026

- Exact production candidate: HEAD
  `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, plus existing uncommitted command
  sources. Sorted non-test source paths followed by NUL and file contents have
  SHA256 `3abca959b48223ef36429aa095f8d22558d262ef50c2bf04ef749513531224c2`.
  No production defect was validated and no production source was changed.
  Five package controls and three Shell controls were added. Tests use only
  memory VFS/byte sources; no files are created by unit tests.
- 37 package tests and five Shell tests passed, with zero failures, skips,
  cancellations or incomplete tests in final runs. Package ESLint and source/
  test typechecks passed, as did new Shell-test ESLint. Existing seed
  `0x0595ca8e` remains reproducible. These are deterministic semantic controls,
  not performance measurements.
- Initial Shell verification failed twice: the test used nonexistent `fs.exists`
  and invoked `printf` without registering `agentCommands`. The fixtures were
  corrected to `stat`/ENOENT and explicit command registration, then the complete
  five-test Shell route passed. Neither failure justified a production change.
- Maintained selected safe-bash workspace closure passed with the default shared
  cache, reporting 26 builds and zero cache hits. Workspace membership/closure
  came from maintained declarations. `git diff --check` passed for task paths.
  Repository-wide test/lint/build, safe-bash's complete consumer typecheck and
  workflow lint were not run; no shared production or workflow changes were made.
- Public artifact assembly, scripts-disabled tarball packing, offline
  scripts-disabled install outside the checkout, maintained installed runtime
  fixture and strict NodeNext declarations all passed. Installed private command/
  contract workspaces: none. Independent installed source/destination alias and
  destructive redirect controls passed. All 1,346 installed safe-bash JS/
  declaration files were scanned for quoted pdftotext private bare specifiers;
  none were present. The export resolves to bundled
  `dist/safe-bash/commands/pdftotext/index.js` and its `.d.ts` counterpart.
  This proves pdftotext bundling, not absence of external dependencies throughout
  the complete safe-bash artifact, which retains declared public dependencies.
- Candidate version `0.0.0-safety-pdftotext`; tarball SHA256 receipts:
  safe-bash `5abd5c6a9bc70e7ba83df3922f4680a1b90f59a9c38ecce96a173920fbbcb529`,
  safe-fs `8e4ab8197e1d6426fa37d944b189fd2d947b1a1a850ebeee98f6f84ed9d7815e`,
  safe-js `f4f0ee4691c20d8bf3ae0011809f3bfe2f7f8fb307b97f60fa523e89d8aeabf5`.
- Node VM browser graph execution passed help, denied stdin/VFS/environment
  getters, cleanup and absence of host process/Buffer/require/fetch; bundle output
  had zero external imports. An initial assertion incorrectly checked esbuild's
  lexical require shim rather than host require. The corrected independent realm
  check verified absent host require and rejected `require('node:fs')`. No code
  changed. Actual browser/workerd/Bun runtime cells remain unverified.
- An installed alias audit was initially started before package installation
  finished and failed ENOENT. After the install/runtime/typecheck process
  completed successfully, that audit was rerun in full and passed. No gate was
  weakened or represented as passing before completion.
- No visual product change occurred, so screenshots were not run. Supplied
  upstream native controls were not rerun. Unsupported extraction/profile/
  checkpoint/replay cells listed above remain unsupported; full PDF resource
  and compatibility acceptance is incomplete.
- `/out` creation failed ENOENT on this host. Temporary artifacts used the
  repository's existing `out/safety-pdftotext` fallback and an OS temporary
  consumer; task-owned artifacts were purged after recording receipts.
  Unrelated edits were preserved.
- Local commits: none. Verified remote-main delivery: none. Successful releases:
  none. No private package publication was attempted or authorized.
