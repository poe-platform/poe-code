# Standalone op manual QA

Use only synthetic objects and variables. Never capture the developer's actual
environment or authenticate a real password-manager account for these checks.
This procedure is executed by an agent; it is not an automated QA program.

1. Run the maintained selected workspace build, unit tests, package lint, and
   workflow lint. Record actual results and distinguish required README approval
   from implementation failures. Do not waive either.
2. Run the built CLI help and version without a backend. Inspect help screenshots
   for readable usage, command groups, flags, and backend setup. The standalone
   screenshot route is `npm run screenshot -- node packages/op/dist/bin.js ...`;
   the poe-code-specific route targets the separate root CLI.
3. Create an empty synthetic JSON seed under ignored `out/op-smoke`. Configure
   only that file through `OP_BACKEND_FILE`. Create a Private vault and a Login
   item. Verify list/get JSON, human concealment, explicit read, and field
   projections. Confirm no agent/runtime integration was added.
4. Pipe synthetic binary bytes into document creation. Retrieve them in another
   CLI process and inspect exact hexadecimal bytes. Verify overwrite refusal,
   explicit force, file permissions, and persisted store decoding.
5. Use `env -i` and explicit synthetic variables to capture selected and complete
   environment snapshots. Verify create/list metadata omits values, get returns
   stored values, empty differs from unset, and a restored child receives the
   intended variables without changing its caller. Inspect explicit shell output
   and default child masking separately from the no-masking option.
6. Generate a synthetic Ed25519 key, inspect public metadata, and validate a
   conversion to PKCS8 using Node crypto. Any native SSH oracle must use newly
   generated temporary keys, not the user's SSH directory.
7. Verify approval allow/deny/ask/cancellation using the maintained synthetic
   fixtures. Inspect the process cleanup regressions: abort must not settle the
   Node CLI before an owned child's close event. Verify saved files remain
   unchanged on failed persistence and metadata does not expose attachment bodies.
8. Generate shell completion and validate Bash/Zsh syntax. Compare stable
   command metadata against the pinned 2.39.0 inventory. Beta availability and
   package snapshot extensions are separate from the stable native command set.
9. Pack through the package's maintained prepack route. Install the tarball into
   an ignored scratch consumer without install scripts. Exercise its `op` bin,
   public SDK, strict declaration consumer, and explicit Node subpath. Inspect
   the tarball for portable relative imports, license, and package documentation.
10. Use synthetic managed-session seeds and an injected clock to verify manual
    bearer possession, transferable explicit tokens, app terminal binding, idle
    expiry, hard expiry, and restart persistence. Account-selection metadata is
    not authentication. Hold a hook pending while signing out or revoking its
    session; verify it cannot publish local changes or return its result after
    revocation. Concurrent activity-only refreshes must remain valid. Verify
    snapshot restoration preserves account/session selectors through its nested
    backend request, and approval binds the same immutable host identity.
11. Only after required checks and documentation permissions are satisfied,
    stage the owned package/workflow/docs and owned lockfile changes. Commit with
    a Conventional Commit, push main, verify remote main, and monitor the specific
    GitHub release workflow until successful. Verify the published registry
    artifact independently. Keep the full compatibility goal open while any
    explicit behavior remains incomplete or unverified.
