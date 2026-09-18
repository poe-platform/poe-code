# wkhtmltopdf VFS resource and failure boundary QA

Candidate: current workspace, source model pinned to
`024b2b2bb459dd904d15b911d04c6df4ff2c9031`. The command package stays private,
with no external runtime dependencies. This verifies an adapter with mocked
static rendering, not a renderer or patched-Qt compatibility.

1. Run command workspace unit tests, lint and selected maintained build closure.
   Confirm hostile byte views, exact quotas, malformed data, falsey cancellation,
   invocation expiry and exactly-once close controls pass.
2. Verify same-file, hardlink, source/directory symlink aliases, missing conditional
   authority, concurrent destination create/replace and publication quota failures.
   Require old content preservation and no renderer acquisition for admission
   failures; no ordinary write or recursive-delete fallback is allowed.
3. Run actual Shell integration with standard commands: binary PDF chunks through
   pipelines and redirects, and conversion from a VFS `.sh` file. Dispose the
   Shell and require renderer closes to equal acquisitions. Check that a rejected
   command behind `>` can still truncate the redirected file.
4. Build and package safe-bash through maintained routes into `/out`. Install only
   the generated public artifacts in an isolated consumer. Import the wkhtmltopdf
   subpath, run a branded Shell invocation, verify SDK equivalence and compile a
   TypeScript consumer. No private workspace package may be installed or resolved.
5. Capture and inspect terminal output from an isolated consumer's same-file
   rejection. Generated evidence belongs in `/out` and is removed after inspection.

Unverified cells: native patched-Qt variants, first-party rendering, actual browser
and workerd execution, network transport and separately approved script harnesses.
No checkpoint/replay mechanism is exposed by this command; renderer replay is
unqualified. Cooperative providers must honor cancellation and their own buffering
bounds. File publication depends on truthful provider conditional semantics;
stdout and shell redirection have separate partial-effect boundaries.

## Execution: 2026-09-18

Base Git revision: `052940a62255aa620236474575b4003a2df76549`, with existing
uncommitted candidate changes preserved. Reviewed production adapter SHA-256:
`9e92c372ef14ead91f7d596c7db78f0585c94f356098391229aed0f21ff554d2`.
Final Shell control file SHA-256:
`33d835cbc506ca5999a1c1a4fe1c0ef1ddc50281b9456d6612b08f0f4067b97b`.
Cases are deterministic; no generated random findings or seeds were used.

Passed:

- `npm run test:unit --workspace=safe-bash-command-wkhtmltopdf`: 82 tests,
  zero failures/skips. Two original failing controls reproduced same-file
  destruction and concurrent-destination overwrite before the adapter fix.
- `npm run lint --workspace=safe-bash-command-wkhtmltopdf`: ESLint and
  source/test TypeScript checks passed.
- `node --import tsx --test packages/safe-bash/tests/commands/wkhtmltopdf-boundaries.test.ts`:
  three actual Shell controls, zero failures/skips. Single-job HTTP 404/401/500
  retain 2/3/1 exit statuses even when renderer success is true.
- Focused ESLint for the added Shell control file passed. Initial integration
  fixture failures came from missing standard command registration and an
  incorrect import; both were corrected and the complete file rerun.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  declaration-derived closure completed, including private contracts and command.
- `node scripts/package-safe.mjs --out-dir out/safety-wkhtmltopdf/artifacts --version 0.0.0-safety`:
  completed. Isolated installed consumer contained only generated public
  safe-bash/safe-fs/safe-js artifacts. Branded Shell argv, SDK equivalent output,
  same-file rejection and disposal passed with a mocked renderer. Its TypeScript
  subpath consumer compiled with NodeNext/strict and dependency `skipLibCheck`;
  this verifies usable exported types, not every dependency declaration.
- Markdown manual QA steps above executed; terminal screenshot captured with
  `scripts/screenshot.ts` and visually inspected. Same-file diagnostic was legible.
  Temporary generated consumer/artifacts/screenshot were removed after use.

Failed gate:

- `npm run typecheck --workspace=@poe-platform/safe-bash` exited 2 before
  compilation: `Public SafeFS must preserve shared SafeJS runtime identity`.
  `tests/plugins/qualified-current-release/peer.mjs` requires the retired root
  `poe-code` `./safe-fs` runtime export. The current root lacks it, and
  `tests/shell/invocation-cleanup-public.test.ts` explicitly requires rejection
  of this checkout through that retired public surface. No assertion was bypassed,
  no retired export restored, and no completed safe-bash typecheck is claimed.

Not run: full `npm test`, repository-wide lint/build, native comparator, actual
browser/workerd cells, release builds and publication. The production change is
confined to the command adapter; shared infrastructure changes present on entry
were preserved. No commits, pushes, remote-main delivery or releases occurred.
The adapter boundary checks pass; overall renderer/runtime compatibility remains
unqualified and the failed gate remains separately recorded.
