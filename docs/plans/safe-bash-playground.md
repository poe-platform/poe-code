# Safe Bash playground

## Scope

- Add a private, plain HTML/CSS/TypeScript browser playground in
  `packages/safe-bash-playground`, without a frontend framework.
- Keep shell/session implementation and browser UI separate from packaging.
  Zero UI libraries does not mean zero dependencies: the real engine is a
  pinned build-time dependency bundled into the browser application.
- Use the root's existing build tooling. Prefer Vite CLI unless the real shell
  engine requires custom browser adaptation; the engine agent owns that build
  integration and must use TDD for any custom build-script logic.
- Build portable static files to `dist/site` with relative asset URLs.
- Extend `publish-schemas-pages.yml`; stage the playground at `safe-bash/`
  alongside `schemas/` and `toolcraft-landing-page/` in the same Pages artifact.
- Leave unrelated root manifest and lockfile changes untouched.

## Integration decisions

- Registry checks on September 1, 2026 found no installable `safe-bash` or
  `virtual-bash` package. The real published shell is `poe-code@14.0.4` through
  its `/safe-bash` export, which has no browser condition.
- The parent selected the pinned build-time alias
  `safe-bash-engine: npm:poe-code@14.0.4`, now declared in the private package
  manifest. Bundle the real supported shell subset, not a fake shell, without
  external browser runtime dependencies.
- `build:site` invokes `scripts/build.mjs`, owned by the engine adaptation agent,
  and expects `dist/site`. `build` typechecks first. `dev` serves live source
  files on `127.0.0.1:5173` using Vite and the same browser-engine plugin,
  registered through the package's `vite.config.mjs`.
- Session uploads and editor saves allow 2 MiB per file; the workspace has a
  16 MiB total budget including samples. Shell-generated files may exceed the
  per-upload limit within that total. There is no separate file-count cap.
- Refresh loses tab-local memory. Confirmed reset replaces the session with
  sample files at `/home`, clearing uploads, edits, and command history.
- Engine budgets are 64 KiB output, 1,000 commands, 1,000 loop iterations,
  substitution depth 16, 16 KiB source, 1,000 expansion fields, 64 KiB expansion
  bytes, and a 16 KiB pipe high-water mark. The session requests cooperative
  cancellation after five seconds. README documents the supported command set
  and unavailable runtime, network, and regular-expression capabilities.
- The authoritative `supportedCommands.length` is 28. Functions, pipelines,
  substitutions, redirects, loops, and shell scripts use the real interpreter;
  brace sequences stay literal. `awk` and `jq` are unavailable alongside the
  other documented excluded commands. Cooperative cancellation is not a hard
  CPU or heap sandbox.
- The active source adapter lowers command-internal buffers to 2 MiB using a
  checked TypeScript AST transformation of the pinned engine, replacing its
  inherited 32 MiB default.
- Session `help` prints registered commands, examples, and limits and supports
  pipelines. Files and cwd persist between submissions; variable and function
  definitions do not. The root-state callback preserves cwd when execution
  ends early, including `exit`.
- Browser package typechecking overrides the root's Node module resolution and
  ambient types; root `tsconfig.build.json` includes only root `src` files.
- The parent authorized a focused dependency install and lockfile sync using
  `npm install --ignore-scripts --no-audit --no-fund --workspace packages/safe-bash-playground`.
  The alias is installed. The user subsequently authorized adding
  `devDependencies["safe-bash-playground"] = "*"` to both root manifests and
  their lockfile root metadata, as required by workspace registration checks.
  All other pre-existing fields remain unchanged.

## Validation and manual QA

1. Run package typechecking and the production static build once engine and UI
   inputs are available. Run root typechecking after upstream workspace builds.
2. Run `npm run lint:workflows`; do not add workflow unit tests.
3. Serve the generated site beneath `/poe-code/safe-bash/` and confirm HTML,
   JavaScript, CSS, and any worker assets load without origin-root paths.
4. Capture desktop and narrow-screen screenshots. Exercise command execution,
   file upload, validation errors, and session reset against kernel decisions.
5. Confirm the assembled Pages artifact retains schemas and Toolcraft landing
   content, with the playground at `safe-bash/index.html`.

### Packaging checks completed

- `npm run lint:workflows` passed after the shared artifact change.
- `npm run lint:types` and `npm run lint:workflows` passed during final package
  integration review on September 1, 2026.
- `npm run build --workspace packages/safe-bash-playground` passed package
  TypeScript checking and the production build. Generated HTML references the
  JavaScript and stylesheet with relative `./assets/` URLs.
- Workflow, package manifest, browser TypeScript config, README, and plan
  formatting passed.
- The installed `safe-bash-engine/safe-bash` import resolves to the pinned
  release and successfully loads its real shell exports in Node.
- `npm ci --dry-run --ignore-scripts --no-audit --no-fund` passed after lock sync.
  The lock gained only the playground workspace and engine package entries.
- Review exposed cwd loss after `cd examples; exit 7`; the engine/session owners
  resolved it with the root-state callback. Packaging did not modify their
  implementation. All 31 session tests and 12 kernel tests passed in the final
  post-toast run.
- Post-toast package build, root typecheck, workflow lint, and
  `git diff --check` passed. The UI owner resolved the two toast-label assertion
  mismatches; all 121 focused package tests now pass in the detached publishing
  worktree against current remote main.
- HTTP checks beneath `/poe-code/safe-bash/` passed for the production HTML,
  stylesheet, entry script, dynamically loaded session chunk, and engine
  license. Nested-path screenshot QA remains an integration check.
- The live Vite server returns HTTP 200 for the HTML, main TypeScript module,
  and real browser-kernel virtual module; its HTML includes the HMR client.
- The engine owner added browser-shim watch registration and kernel cache
  invalidation during review; the new focused engine test passed. Reinstall
  and restart development when changing the pinned engine dependency.
- The live HMR WebSocket completed its `connected` handshake on port 5173.
  Persistent live-server session `48818` remains running.

## Packaging change ownership

This packaging agent created or modified exactly these repository files:

- `packages/safe-bash-playground/package.json`
- `packages/safe-bash-playground/tsconfig.json`
- `packages/safe-bash-playground/.gitignore`
- `packages/safe-bash-playground/vite.config.mjs`
- `packages/safe-bash-playground/README.md`
- `.github/workflows/publish-schemas-pages.yml`
- `package.json`
- `package-lock.json`
- `docs/plans/safe-bash-playground.md`

Engine adapters, `scripts/build.mjs`, session/UI source and tests, and the
separate browser-QA record belong to other agents and were not edited here.
No existing root README was changed.

The original user edits remain intact: root `package.json` and
`packages/poe-agent/package.json` still contain their original `shell-quote`
upgrade. The lock adds 16 workspace/engine entries, including the published
engine's bundled dependencies and package metadata, plus the authorized root
workspace registration. Removing that registration and those 16 additions
from the parsed lock reproduces its original dirty-content Git blob hash
`8e7b58f451d649415122a699b6a81912947b3144`; all other fields of the 705
pre-existing entries are preserved. Removing only the new registration from
the root manifest reproduces its original dirty-content hash
`48edc16503d8125a02593842c526e59171b5ef66`.

Other initial untracked plans, `out/`, and terminal-pilot assets were untouched.
Generated `dist/` and development-cache `node_modules/` output are ignored and
untracked. The final production build clears stale site output before rebuilding;
retain current artifacts while live/preview consumers may still be using them.
No pure do-nothing proxy or unnecessary new UI dependency was identified in
the scoped simplicity review. No speculative refactoring was needed.

## Authorized detached-worktree delivery

The user subsequently authorized a focused commit and push to main, explicitly
without waiting for release completion. The original checkout is 3,629 commits
behind remote main and retains unrelated dirty user files, so delivery uses a
separate detached worktree rather than changing or stashing that checkout:

- Worktree: `/Users/kjopek/Workspace/.worktrees/poe-code-safe-bash-playground-publish-20260901`.
- Initial remote base: `500a0c17d87fe436849618f3ab91b098ea2a700d`.
- No new branch; the intended push is detached `HEAD:main`, without force.
- The remote Pages workflow was inspected and merged, preserving schemas and
  Toolcraft. No existing remote playground package required replacement.
- Dependencies were installed separately with lifecycle scripts disabled, then
  normal Husky hooks were initialized. No main-checkout modules were changed.
- The target lock preserves all other fields of its 714 original remote entries
  and adds the root workspace registration plus 16 engine/workspace entries.
  The old dirty root manifest/lock were not copied.
- Source code needs no target-specific adaptation; both copies match. The
  finalized browser-QA plan is included; ignored screenshots are not committed.
- Build and focused tests pass in the target; required root checks and normal
  commit/push hooks remain mandatory. Fetch and verify fast-forward safety
  immediately before delivery; never force, reset, or auto-stash user changes.

The existing workflow deploys committed GitHub sources, not uncommitted local
files. Report the delivered commit and any started Actions run separately from
release success; do not wait for release completion under the user's override.
Keep the original live Vite session `48818` running throughout delivery.

### Remaining local hook blocker

- Normal commit hooks passed for the initial feature commit. The first push
  stopped in its normal pre-push tests; nothing reached remote main.
- The missing root workspace registration is corrected in both checkouts.
  `tests/integration/workspace-deps.test.ts` now passes.
- Five unrelated Ctrl+D cases still fail at
  `packages/toolcraft-design/src/prompts/interactive/lifecycle.test.ts:122`,
  covering text, password, select, confirm, and multiselect. Targeted runs
  reproduce all five failures in approximately 20 ms, without broad-suite load.
- A minimal Node readline reproduction closes a terminal input containing
  `abc` on Ctrl+D on Node 22.22.2, 22.23.2, and 24.14.0. Interactive core wires
  that close event to cancellation, whereas these tests expect no cancellation.
  This is not a timeout or resource-load failure. Lifecycle code/tests are
  unchanged; the user assigned that unrelated repair to another engineer.
- Keep the corrected feature commit ready locally, without retrying the
  known-failing push or bypassing hooks. No release monitoring is required.
