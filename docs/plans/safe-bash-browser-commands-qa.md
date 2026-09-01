# Safe Bash browser command coverage QA

## Scope — September 1, 2026

Register the pinned engine's complete `createAgentCommands()` bundle rather than
maintaining a separate browser command allowlist. The playground now registers
79 agent commands, plus its existing `help` command and shell builtins.

## Browser boundary

- Node buffer, path, stream, compression, checksum, and timer operations use
  bundled browser implementations. `@jspm/core` is pinned to `2.1.0`; its license
  is emitted with the site. No runtime CDN or remote execution is used.
- Regex and ERE workers are separately bundled, embedded in the main module,
  and started as same-origin Blob Web Workers. They retain the engine's message
  protocols and request timeouts. Cancellation terminates workers and revokes
  their Blob URLs.
- Browser workers do not provide Node's per-worker heap/stack limits or process
  ref/unref semantics. Existing shell limits remain cooperative, not a hard
  CPU or heap sandbox.
- The browser transport rejects values that cannot be structured-cloned. This
  is a conservative compatibility check, not Node's intrinsic proxy inspection.
  The playground accepts shell text and files, not arbitrary JavaScript objects.
- Optional network, Node/SafeJS, and Python runtimes remain unavailable. The
  filesystem remains in-memory and subject to the existing workspace budget.

## Regression checks

- [x] Registration test first fails with the old 28-command bundle.
- [x] Buffer and timer regressions first fail before their adapters are added.
- [x] All 146 focused package tests pass, including actual worker execution.
- [x] `sed -i`, `sed -n`, `grep`, `rg`, `find`, heredocs, and shell scripts work.
- [x] `awk`, `jq`, aliases, checksums, encoding, metadata, `mktemp`, `timeout`,
      `apply_patch`, and archive/compression pipelines work in the bundled kernel.
- [x] Concatenated gzip members decode; corrupt CRCs are rejected.
- [x] Cancelling a regex search retires its workers and permits a later command.
- [x] Help lists the complete command bundle without outdated exclusions.
- [x] Final production build, package typecheck, and focused ESLint checks pass.
- [x] Serve production output beneath `/poe-code/safe-bash/` and exercise the
      search/edit, regex, compression, and help flows through the visible terminal.
- [x] Inspect desktop/mobile screenshots and check for runtime console errors.

Production preview: `http://127.0.0.1:5177/poe-code/safe-bash/`. Chromium returned
`plum`, `./browser-check.txt`, `hello`, `regex-ok`, and `timeout-ok` for the combined
workflow. Help reports all 79 commands and Web Workers. Console: zero errors and
warnings. At 390px the document width remains 390px. Screenshots were inspected at
`output/playwright/safe-bash-full-commands-desktop.png` and
`output/playwright/safe-bash-full-commands-mobile.png`.

The production build still warns about bundle size and `eval` inside the bundled
third-party crypto compatibility code. These changes have not been deployed.

These are agent-executed checks, not a checked-in QA automation script.
