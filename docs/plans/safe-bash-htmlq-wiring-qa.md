# htmlq CLI, SDK and packed-export verification

Executed 2026-09-21 for `command-htmlq`. The private command implementation,
composition-only public subpath and qualified build/export configuration already
existed in the working tree. This increment adds grouped short flags, attached
short values (including equals attachment), and typed SDK operands. It preserves
those existing files and unrelated edits; it does not claim their authorship.

## Verification steps and observed results

1. Reproduce grouped/attached parsing and typed SDK failures with memory-VFS
   command tests before implementation. The initial suite passed 120 tests and
   failed the two new tests. A subsequent equals-attachment control failed before
   its repair. Preserve literal expected bytes in tests.
2. Run `npm run test:unit --workspace=safe-bash-command-htmlq`: **124 passed**.
   Controls cover CLI/SDK projection and paths, synchronous SDK array snapshots,
   unknown flags, literal `--`, producer ownership, foreign realms, cancellation,
   cleanup failures, resource ceilings and atomic publication.
3. Run `npm run lint --workspace=safe-bash-command-htmlq`: passed ESLint and both
   source/test TypeScript checks.
4. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: passed
   maintained dependency closure and guarded safe-bash build/postbuild. Repeat
   after the final source change also passed.
5. Run `npx vitest run scripts/bundle-safe-bash-private.test.ts
   scripts/safe-command-publication.test.ts`: **9 passed**.
6. Use `scripts/package-safe.mjs` with version `0.0.0-htmlq-wiring` and output
   under `out/htmlq-wiring-artifacts`; npm-pack the three public safe artifacts
   and install them with workspaces/scripts disabled in a consumer directory.
   Do not pack or publish the private command workspace.
7. Run copied `safe-packages-htmlq.mjs`: passed engine bytes/recovery/ownership,
   canonical runtime identity, absent default registration, explicit plugin
   registration, lazy mutation, CLI/typed-SDK equivalence, grouped/attached
   arguments, unknown flags and same-path atomic VFS output.
8. Typecheck copied `safe-packages-htmlq-types.mts` with strict NodeNext,
   exact optional properties and unchecked-index checks: passed public command,
   typed SDK options/results and engine declarations. Packaging admitted the
   qualified private owner and rewrote bundled declarations without unpublished
   runtime/declaration specifiers.
9. Capture installed shell output using the maintained screenshot command and
   inspect the PNG: `htmlq -ti -f/input.html p` retained text-node and result LFs;
   `htmlq -aid -f/input.html p` printed `first`/`second` and status 0;
   `htmlq -tx` printed `htmlq: E_ARGUMENT` and status 2. Visual review passed.
   Remove generated PNG, consumer install, tarballs and artifact directories
   after inspection. No screenshot tests or scripted QA were added.

The command manifest remains `safe-bash-command-htmlq`, private, ESM, with empty
runtime dependencies. Safe-bash still only composes/re-exports it. No default
registration change, host executable/runtime parser, ambient I/O, network
capability or native/WASM fallback was introduced. Typed operands and `argv`
are alternative input forms; combining them returns argument status 2.

Full HTML5 recovery, complete legacy selector grammar and Rust URL normalization
remain unqualified as described in the package README and behavior reviews.
Enumerated passing controls do not establish complete upstream compatibility.
No commit, push, issue closure or release was performed for this task.
