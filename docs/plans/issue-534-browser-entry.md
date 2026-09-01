# Issue #534: portable public shell

## Scope

Expose `poe-code/safe-bash/browser` with the existing Shell interpreter and an
explicit 28-command filesystem/text subset. Keep the Node barrel unchanged.
Share the canonical filesystem bundle rather than copying its error classes.
Exclude Node adapters and regex workers; refuse `[[ =~ ]]` explicitly.

## Verification

1. Run portable POSIX path differential tests and in-memory browser bundle tests.
2. Verify command/output budgets, cancellation, disposal, writable and read-only
   mounts, binary output, and canonical filesystem/error identity.
3. Run the maintained workspace build, including root bundle publication checks.
4. Pack the built package, install the tarball into a fresh temporary consumer,
   and use only the package's public exports for the remaining checks.
5. Import the regular entry in Node and the browser entry with browser conditions.
6. Bundle the installed browser entry using esbuild's browser platform and
   `workerd`, `worker`, `browser` conditions, without aliases or Node externals.
7. Typecheck the consumer with browser conditions, DOM/ES2022 libraries, and no
   implicit Node types.
8. Run the bundled consumer in workerd with no compatibility flags. Exercise a
   filesystem pipeline, writable persistence, limits, cancellation, and disposal.
9. Run normal commit and push checks. Report remote delivery separately from
   release status; release monitoring is delegated to the user's engineer.

## Local results

- The maintained build succeeds. The scoped filesystem, browser, bundling, and
  package-metadata suite passes 1,007 tests.
- A fresh consumer installed the generated npm tarball. Node retained its normal
  entry; Node and Bun loaded the new entry with browser conditions. Browser-only
  TypeScript checking passed without implicit Node types.
- The consumer bundled only its installed artifact files, with no aliases,
  external Node modules, or repository source inputs.
- workerd 2026-09-01 returned `ok: true` for pipelines, writable/read-only mounts,
  binary bytes, limits, cancellation, disposal, and explicit regex refusal.
  The worker used compatibility date `2026-09-01` and no compatibility flags.
- Local artifact verification is not a claim that npm has published the change.

## Non-goals

Standalone package publication (#533), default-condition Bun compatibility
(#536), and porting every Node command or regex worker are separate work.
