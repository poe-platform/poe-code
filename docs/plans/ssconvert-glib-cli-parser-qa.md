# Gnumeric 1.12.61 main parser QA

Root owns SDK exports, Safe Bash integration and Git. A different agent owns
independent parser stress/repairs after implementation. Do not push, publish or
edit README files. Preserve unrelated work. Scratch/evidence is under
`out/ssconvert-parser`; purge task scratch after recording the results.

1. Read root/scoped instructions and inspect status. Authenticate the official
   Gnumeric archive against SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Acquire/extract primary source only into out. Read `src/ssconvert.c` and the
   captured GLib `goption.c` option and argument parsing code.
2. Run failing original in-memory cases before repairs. Cover short clusters,
   attached/separate values, both option namespaces, boolean equals values,
   duplicate scalars/arrays/flags, empty values, interspersed operands, separators,
   missing arguments, unknown and abbreviated options, help/version/action
   precedence, raw bytes and filename inference. Unit cases never spawn native
   programs or write files; conversion fixtures use memfs and injected byte I/O.
3. Build unchanged 1.12.61 with authenticated goffice 0.10.61 in an isolated
   Debian container. The native command is exclusively a QA oracle. Capture
   dependency versions, loaded-library hashes, plugin manifests, locale and
   HOME/XDG configuration. Compare existing captured reference to fresh captures;
   report profile differences. Native utilities are never product dependencies.
4. Execute a differential argv matrix against the actual native command, keeping
   stdout/stderr bytes, statuses and namespace effects. Use only original small
   fixtures. Apply only documented argv0/fixture/deployment path substitutions.
   Report every mismatch, unsupported mode and unmeasured profile as such.
5. A different agent stresses/fixes the parser using TDD. Root handles resulting
   SDK export and integration adjustments. Preserve budgets, host boundaries,
   cancellation reason identity, realm byte ownership and replay invariants.
6. Run maintained uncached selected workspace build closures, domain unit/lint,
   Safe Bash maintained selected command tests and appropriate strict type checks.
   Validate built public SDK and virtual command exports. Record any failed gate
   independently; focused passes do not qualify an incomplete full gate.
7. Capture actual virtual command diagnostics using the maintained screenshot
   tool with an opt-in plugin host, inspect the image, then remove owned scratch.
   Do not invent a root poe-code ssconvert subcommand or screenshot tests.
8. Record verified scope, profile and all remaining mismatches in
   `docs/ssconvert/glib-cli-parser-verification.md`. Report local changes/commits
   separately from remote-main delivery/releases, neither of which is authorized.

## Graph dispatch follow-up

Authenticate the archive again. Inspect main's explicit split/merge conflict,
then graph-derived splitting and normal conversion dispatch. Add and run a failing
regression before repair. Preserve unsupported graph rejection before any file I/O.
Use a different agent for independent permutations and memfs no-effect controls.

Run maintained uncached build closures for `@poe-code/ssconvert` and
`@poe-platform/safe-bash`, domain workspace test/lint, and the existing
`node --import tsx --test --test-concurrency=1
packages/safe-bash/tests/commands/ssconvert.test.ts` route. Lint adapter/tests.
Check built public SDK and virtual command with cross-realm bytes, graph/merge,
version/error/conflict order, counting injected I/O, cancellation reason identity,
and an unchanged virtual root. Capture actual virtual diagnostics using
`npm run screenshot -- --output <out-owned-path> node <out-owned-qa-host>`;
inspect the image. Record candidate source hashes and purge owned scratch.
Unavailable native-oracle cells remain unverified, independently of historical QA.
