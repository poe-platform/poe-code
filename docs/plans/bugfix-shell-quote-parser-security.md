# Fix shell-quote parser availability dependency

## Scope

Configuration-only dependency fix, using the TDD exception. Change only:

- `package.json`
- `packages/poe-agent/package.json`
- `package-lock.json`
- `docs/plans/bugfix-shell-quote-parser-security.md`

No production code, new tests, new dependencies, README changes, broad upgrades,
audit-fix, commits, or pushes. The parent owns commit and release. Preserve tar
`7.5.22` from commit `03784be93` and all concurrent workers' changes.

## Confirmation and reachability

- Primary maintainer advisory, reviewed August 26, 2026:
  <https://github.com/ljharb/shell-quote/security/advisories/GHSA-395f-4hp3-45gv>.
  It identifies growing-array concatenation in token finalization as quadratic
  parser work, affecting versions `<=1.8.4`, patched in `1.9.0`. This is an
  availability issue, not a command-execution or data-disclosure vulnerability.
- Independently rechecked registry metadata using
  `npm view shell-quote dist-tags version engines --json`: latest `1.10.0`,
  Node engine `>= 0.4`. Both manifest floors and the installed/locked version
  initially resolved to `^1.8.4` and `1.8.4`, respectively.
- Local source: `packages/poe-agent/src/runtime/acp-core.ts:555` dispatches
  `preToolUse` before tool execution. The policy plugin at
  `packages/poe-agent/src/plugins/poe-agent-plugin-policy.ts:28` validates tools
  in read/edit mode; yolo (and undefined mode) skips this policy check.
- A model-supplied `run_command` command reaches synchronous
  `parseShellCommand` in
  `packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts:315`; nested shell
  wrappers also parse at line 501. Parsing precedes command-runner timeout and
  output retention. Those controls do not bound synchronous parser work.
- This establishes a local agent availability path, not an exposed remote
  server or a command-execution vulnerability. No hostile command was executed.
- The root dependency also serves
  `packages/toolcraft-design/scripts/generate-docs.ts:469`, which parses
  repository-authored demo arguments. It needs compatibility validation, not
  a remote-input exposure claim.

## Implementation

- [x] Parse both manifests and merge only the shell-quote floor to `^1.10.0`.
- [x] Install exactly `1.10.0` with lifecycle scripts disabled:

  ```sh
  npm install shell-quote@1.10.0 --workspace=@poe-code/poe-agent --include-workspace-root --save-prefix='^' --ignore-scripts --no-audit --no-fund
  ```

- [x] Restore, using `apply_patch`, only the two unrelated `auth-store` metadata
      lines this npm invocation removed from the toolcraft-openapi lock entry.
- [x] Compare parsed lock entries against the pre-install baseline: changes are
      limited to the root dependency floor, poe-agent dependency floor, and
      `node_modules/shell-quote` version/tarball/integrity. All other entries,
      including toolcraft-openapi metadata and tar `7.5.22`, are unchanged.

## Validation

- Existing scoped tests: **35 passed, 18 deliberately skipped**, three files.
  Fourteen shell tests cover policy parsing, configuration, an injected runner,
  and memfs path validation; all 15 policy tests pass; six design-doc generation
  tests use supplied output callbacks or pure rendering. The selection excludes
  real shell execution, background processes, timeout tests, and executable
  design-demo capture. No LLM requests or actual tool commands run.

  ```sh
  node_modules/.bin/vitest run packages/poe-agent/src/plugins/poe-agent-plugin-shell.test.ts packages/poe-agent/src/plugins/poe-agent-plugin-policy.test.ts packages/toolcraft-design/scripts/scripts.test.ts --maxWorkers=1 -t 'poe-agent-plugin-policy|poe-agent-plugin-shell (validates|rejects|resolves|allows)|generate-docs (lists|renders|keeps|includes)'
  ```

- `npm run lint:types`: passed.
- `node_modules/.bin/tsc -p packages/poe-agent/tsconfig.json --noEmit`: passed.
- Prettier check of all four scoped files and `git diff --check`: passed.
- `npm ls shell-quote --all`: root and poe-agent resolve deduplicated `1.10.0`.
  An existing extraneous nested poe-code installation also resolves `1.10.0`;
  no unrelated cleanup was performed.
- Independent root/workspace resolution assertions verify installed `1.10.0`
  and the unchanged Node `>= 0.4` dependency engine floor, compatible with the
  repository's Node `>=18.18` requirement.
- In-memory parser smoke: exactly 10,000 plain tokens parsed with exact count
  and token-value assertions. No file creation, shell execution, LLM calls,
  large-input reproduction, or elapsed-time pass/fail threshold.
- No CLI presentation changes; screenshots and actual design-doc generation
  are not applicable to this isolated config fix.

## Audit delta, separate from existing findings

Read-only `npm audit --json --ignore-scripts` before and after installation:

- Before: **10 packages** (8 high, 1 moderate, 1 low).
- After: **9 packages** (7 high, 1 moderate, 1 low).
- Removed: only shell-quote / GHSA-395f-4hp3-45gv. No added findings; remaining
  vulnerability entries are identical to the baseline. Tar is absent both times.
- Remaining high findings: brace-expansion, fast-uri, hono, ip-address, js-yaml,
  nanoid, postcss. Moderate: @hono/node-server. Low: body-parser.
- Audit exits 1 for these existing findings; this is not a clean-audit claim.
  They are outside this fix and were not upgraded.
