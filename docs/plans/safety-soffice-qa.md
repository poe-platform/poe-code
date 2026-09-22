# soffice resource and failure boundary QA

Execute against memory VFS only. Follow the package pattern now located at
`archive/safe-bash-command-package-pattern.md`. Never invoke installed Office as
a product fallback or interpret its blocked dyld startup as conversion evidence.

1. Run `npm run test:unit --workspace=safe-bash-command-soffice`. Verify UTF-8
   admission, hostile operands, parser cancellation/rollback, every implemented
   quota, partial warning output, caller cancellation during awaited output,
   falsey sink errors, idempotent cleanup and unconsumed chunked input.
2. Run `node --import tsx --test packages/safe-bash/tests/plugins/soffice-wiring.test.ts`.
   Verify actual Shell pipes, redirects, `sh /run.sh`, CLI/SDK parity, denied
   network, ambient credential controls and absent executable fallback. Resolve
   symlink aliases and demonstrate shell-owned destructive redirection.
3. Run the command workspace lint/source and test typechecks and ESLint on the
   Shell integration test. Build the maintained selected safe-bash workspace
   dependency closure with `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
4. Assemble with `scripts/package-safe.mjs`, pack the three public artifacts
   and install offline with scripts disabled outside the checkout. Execute the
   maintained soffice runtime fixture with empty PATH and strict NodeNext type
   fixture without skipLibCheck. Confirm private packages are absent.
5. Bundle the installed command graph for a Node VM realm without process,
   Buffer, require, fetch or WebAssembly. Test help and denied conversion with
   filesystem/input/environment accessors denied. This does not qualify actual
   browser/workerd engines.
6. Record exact candidate hashes, failures and unavailable cells separately.
   Purge task-owned temporary evidence after durable capture.

Conversion-engine admission remains false. Office input parsing, multi-file
publication, source/destination identity preflight, conditional/exclusive atomic
publication, disposal of conversion staging, layout convergence, PDF typed JSON,
PDF/A/UA standards and original-document screenshot comparisons are unsupported.
No successful help, CSV primitive output or generated PDF qualifies those cells.
The command has no checkpoint/replay API. Argument parsing is synchronous:
injected cancellation checks establish cooperative checks, not event-loop
preemption during parsing. CSV generators yield partial byte output; neither they
nor shell redirects provide a transaction.

## Executed results — September 20, 2026

Candidate: HEAD `ab1fa8d34101e1e7f61272973f3bc28a842043d8` plus the
existing working tree and this task's test/document additions. Not a frozen
commit or release. Command `src` inventory SHA256 (sorted filename, NUL, file
bytes, NUL) is `76e26ca2ed83b0dc2f6956cc7fb16c3ce7159c5e7826fba6d04036ae90f25192`.
Shell test SHA256 is `d92dc5ac012d03347478adc17be25dbebd883faac65630c8a287ba372f174984`.

- Passed: 58 workspace unit cases and four actual Shell cases; no remaining
  failures, cancellations, skips or TODOs in those runs. New controls passed
  the existing implementation, so no runtime fix was justified or made.
- Passed: command ESLint, source/test TypeScript checks, Shell test ESLint,
  and selected maintained safe-bash build closure (24 build routes, no cache
  hits). These counts describe the receipt, not fixed future task membership.
- Passed: public artifact assembly, npm packing and offline isolated install
  with scripts disabled. Maintained soffice runtime fixture passed with empty
  PATH, shared runtime identity, byte argv and CLI/SDK equivalence. Strict
  NodeNext declarations passed without skipLibCheck. No private command or
  contracts workspace was installed.
- Passed: installed command graph bundled and executed in a Node VM with
  process/Buffer/require/fetch/WebAssembly absent; help, denied conversion,
  forbidden input/FS/environment accessors and repeated cleanup were checked.
  Retained bundle inputs were only the public Safe Bash/SafeFS first-party
  artifacts, with no external runtime implementation retained. This scopes the
  dependency claim to the command graph, not all unrelated safe-bash exports.
- Failed: `npm run typecheck --workspace=@poe-platform/safe-bash` exits 2
  before compilation/current consumer groups. The checkout peer assertion in
  `packages/safe-bash/tests/plugins/qualified-current-release/peer.mjs:245`
  requires root `exports["./safe-fs"].import` to equal
  `./packages/safe-js/dist/safe-fs.js`; current root metadata has no such
  export. This integration mismatch remains unresolved. Focused typechecks
  and installed declarations do not complete or replace that failed gate.
- Corrected test setup failures: memory VFS requires byte writes and has no
  `exists`; Shell pipelines require explicit text-command registration; the
  denied stdin accessor initially could not be overridden. Complete affected
  suites were rerun after fixture corrections, with the passes recorded above.
  No product failure, timeout or performance result was inferred from them.
- Initial realm bundling from staged artifacts failed to resolve the public
  SafeFS dependency, since staging is not installation. Bundling the actual
  isolated installation passed without externalizing unresolved imports.
- Unsupported cells are listed above. Actual browser/workerd engines, native
  Office conversion, original/checkpoint/replay, renderer geometry and standards
  validation remain unverified. Broad repository test/lint/build gates were
  not run for this focused verification-only change. No visual behavior changed,
  so CLI screenshots were not run. No compatibility admission is made.
- `/out` is absent on this host. Task-owned staging/tarballs used ignored
  `out/safety-soffice`; the isolated consumer used an OS temporary directory.
  Both are purged after capture. Unit tests created no host files.
- Package name/privacy/ESM and empty runtime dependencies were preserved;
  safe-bash's soffice source entry remains an export only. Unrelated edits were
  preserved. Local commits: none. Verified remote-main delivery: none.
  Successful releases: none. No publication was performed.

Packed SHA256 receipts, version `0.0.0-safety-soffice`:

- Safe Bash: `61018d9846173a593aea66338cb732af894c726e7c9ddffe7cc0ddb58800ae89`.
- SafeFS: `e08aad252761d2efe702a6b07428975bd33fa83a3f97e83a1129594f6bed86ad`.
- SafeJS: `886835b887c486e0ca9a7883c034e6d123ce256f7acac0ef284184dea7ff9b0a`.
