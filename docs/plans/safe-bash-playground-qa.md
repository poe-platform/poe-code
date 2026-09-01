# Safe Bash Playground: Independent Browser QA

## Preparation — 2026-09-01

- Status: scoped browser QA complete on `http://127.0.0.1:5173/` on September 1, 2026. Report is frozen for the packaging commit. Existing server stays running; QA made no implementation edits or commits. All three reported findings were fixed and retested; untested areas are explicit below.
- Read applicable workspace/repository AGENTS and Playwright skill; no nested AGENTS found in `docs` or `packages` during preparation. Recheck package instructions after readiness.
- Environment: Node `v22.23.2`, npm `10.9.8`, `npx` available; workspace discovery uses `packages/*`; Chromium caches present. Package directory not present during preparation.
- Browser: isolated session `safe-bash-qa`; use `bash /Users/kjopek/.codex/skills/playwright/scripts/playwright_cli.sh --session safe-bash-qa` because the wrapper lacks executable permission. Wrapper CLI help completed successfully; no browser opened yet.
- Writes restricted to this Markdown report and ignored screenshots under `output/playwright/`. No implementation changes, commits, or QA scripts.
- Parent supplied the live Vite server; QA does not start, stop, or restart it. CLI auxiliary artifacts/downloads are under `/tmp/.playwright-cli/`, not in the repository.

## Completed Checklist

- [x] Desktop 1440×1000 and mobile 390×844 visual inspection, including all captured screenshots through `view_image`.
- [x] Real shell pipelines, redirects, errors/recovery, explorer search/folders, preview edit/save, keyboard history/completion/clear.
- [x] Native file picker, browser drag/drop, same-name collisions, inert HTML, exact binary download.
- [x] Dirty-switch Cancel/Discard/Save-and-continue; dirty-reset Cancel/Confirm; measured timer/frame responsiveness.
- [x] Tested network-command isolation, accurate capability messaging, final help/copy/source-link regression checks.
- [x] 240-character PNG upload toast on desktop/mobile, extension/title preservation, compact status, click/keyboard dismissal, auto-hide, hover/focus pause.
- [x] Findings promptly handed to parent in conversation; direct controller messaging unavailable.

## Results

No unresolved failures in the exercised scope. Final smoke check after toast integration passed help piping, sorted pipeline, file redirection, missing-file handling, recovery, exact source href, final copy, removed badge/footer sentence, and no horizontal overflow. Browser console: zero errors/warnings. Earlier integration-triggered reloads interrupted several checks; interrupted checks were repeated or excluded rather than credited.

### Confirmed Findings

- **QA-1, minor, fixed and visually retested:** introductory sentences originally ran together on mobile. Final requested copy is spaced correctly and verified in `safe-bash-qa-mobile-final.png`. Original evidence: `safe-bash-qa-mobile-initial.png`.
- **QA-2, functional, fixed and retested:** advertised `help` originally returned command-not-found / exit 127. Current `help`, `help | head -n 3`, and `help > help-qa.txt; cat help-qa.txt` all pass. Original evidence: `output/playwright/safe-bash-qa-help-error.png` (visually inspected).
- **QA-3, visual, fixed and visually retested:** initial reset dialog used default-looking borders and low-contrast Cancel. Final dialog fits within 390px, both actions are legible, and Cancel works. Evidence: `safe-bash-qa-mobile-dialog-final.png`.

### Executed Results

| Area              | Actual result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell             | PASS: sorted pipeline, overwrite/append/input redirects, missing-file exit 1, unknown-command exit 127, unmatched quote exit 2, subsequent recovery.                                                                                                                                                                                                                                                                                                                                           |
| Explorer          | PASS: case-insensitive filename search, matching parent folders, no-match state, clearing search, shell-created files appear; explicit data-folder collapse/expand hides/restores children.                                                                                                                                                                                                                                                                                                    |
| Editing           | PASS: edit/save reflected by shell; dirty-switch Cancel retains draft, Discard restores saved content, Save and continue writes content. Mobile save and dirty-switch choices pass.                                                                                                                                                                                                                                                                                                            |
| Reset             | PASS at 390×844: Cancel retains `dirty sentinel` and selected filename; confirm reports fresh sandbox, restores 13 sample files, clears search/history, hides preview. Subsequent `cat reset-final.txt; pwd` reports missing sentinel and `/home`.                                                                                                                                                                                                                                             |
| Keyboard          | PASS: Up/Down restores command/draft; Ctrl+L clears terminal; quoted and escaped completion produce executable `space dir/read me.txt` paths. `pw` completes to executable `pwd`. `clear` empties history without changing sentinel contents.                                                                                                                                                                                                                                                  |
| Uploads           | PASS: native picker uploads existing package README on desktop/mobile; same-batch picker duplicates produce README.md and README-2.md with identical 4944-byte lengths. Browser `File`/`DataTransfer` exercises in-memory text/binary and drag/drop. Same-name drop, including duplicates in one batch, renames `picker qa-2.txt`/`picker qa-3.txt` without replacing original contents.                                                                                                       |
| HTML safety       | PASS: HTML-looking filename, preview, and shell output remain literal; no injected marker or image elements.                                                                                                                                                                                                                                                                                                                                                                                   |
| Binary            | PASS: download event suggests `binary-qa.bin`; downloaded file in `/tmp/.playwright-cli/` is exactly 256 bytes and byte-for-byte 0–255. Binary editor hidden and explanation shown.                                                                                                                                                                                                                                                                                                            |
| Network           | PASS for tested commands: request observer records zero requests during pipeline, curl, wget, and `/dev/tcp` probes; unsupported network commands fail. Not a universal sandbox proof.                                                                                                                                                                                                                                                                                                         |
| Capability claims | PASS: JS/Python samples are displayed as source; unsupported interpreters fail; current help and WELCOME explicitly say language runtimes are absent.                                                                                                                                                                                                                                                                                                                                          |
| Responsiveness    | PASS: `while true; do printf x; done \| cat` ends at command limit in ~3023 ms; 375 timer callbacks and 181 animation frames occur while busy. Maximum observed timer gap 22.4 ms, frame gap 21.9 ms. Next command succeeds.                                                                                                                                                                                                                                                                   |
| Source link       | PASS: live link href exactly `https://github.com/poe-platform/poe-code/tree/main/packages/safe-bash`; external destination not navigated.                                                                                                                                                                                                                                                                                                                                                      |
| Copy/layout       | PASS: exact final introductory sentences, removed Browser runtime badge and Temporary-by-design sentence, exact GitHub href. Current-copy desktop/mobile screenshots visually inspected. No horizontal document overflow at either viewport.                                                                                                                                                                                                                                                   |
| Upload toast      | PASS: 240-character `.png` saved filename becomes compact basename with preserved extension and full 240-character title; no long status message. Mobile toast is 358×58 at (16,770) within 390×844; desktop 360×54 at (1056,922) within 1440×1000. Click and Enter dismissal hide it and return focus to Upload files. Unhovered mobile toast auto-hides in ~5300 ms. Desktop toast remains visible through 5200 ms of hover and a separate 5200 ms of keyboard focus with pointer elsewhere. |
| Console           | PASS: final post-integration console check reports zero errors and zero warnings.                                                                                                                                                                                                                                                                                                                                                                                                              |

### Limitations

- Chromium desktop browser with resized viewports, not real touch hardware or a mobile software keyboard; no Firefox/WebKit coverage.
- Parent changes trigger Vite reloads and can interrupt temporary filesystem state. Interrupted checks are repeated, not credited as passes.
- No deployment/subpath, hard CPU/heap isolation, arbitrary adversarial-command, or cross-browser certification.
- Native picker used an existing README fixture; in-memory adversarial payloads used browser File/DataTransfer. Native OS drag gestures were not automated.
- Exact byte comparison covered binary download; text-download bytes were not separately compared. No comprehensive size-boundary/accessibility audit.
- Full pre-toast matrix was not repeated after every concurrent source edit. Final regression subset and toast checks are listed explicitly, not a blanket certification of the changing build.
- No implementation files or test suites changed; no commits. Direct controller messaging is unavailable; findings are handed off in this conversation.

### Screenshot Evidence

- `output/playwright/safe-bash-qa-desktop-initial.png`: desktop layout inspected; no obvious overlap.
- `output/playwright/safe-bash-qa-mobile-initial.png`: mobile layout inspected; QA-1 visible.
- `output/playwright/safe-bash-qa-mobile-terminal.png`: visually inspected duplicate mobile state; initial scroll interaction failed at CLI parsing, not in the app.
- `output/playwright/safe-bash-qa-help-error.png`: help regression evidence, visually inspected.
- `output/playwright/safe-bash-qa-binary-preview.png`: disabled binary editing and literal HTML output, visually inspected.
- `output/playwright/safe-bash-qa-mobile-dirty-reset.png`: unsaved-reset warning and original dialog design, visually inspected.
- `output/playwright/safe-bash-qa-mobile-final.png`: final requested copy and 390×844 layout, visually inspected.
- `output/playwright/safe-bash-qa-desktop-final.png`: final requested copy and 1440×1000 layout, visually inspected.
- `output/playwright/safe-bash-qa-mobile-dialog-final.png`: corrected reset-dialog styling, visually inspected.
- `output/playwright/safe-bash-qa-mobile-long-toast.png`: 240-character `.png` compact notification, visually inspected.
- `output/playwright/safe-bash-qa-desktop-long-toast.png`: matching desktop notification, visually inspected.

## Interim Source Inspection — 2026-09-01

- One-shot inspection found only `src/view.test.ts` and `tsconfig.json` in the package; no implementation was available to evaluate. Read the packaging plan without modifying it. No concrete app bugs established.
- View tests cover labels, tree/search helpers, and history, but do not establish DOM safety, upload collision behavior, binary preservation, completion, editor guards, or execution isolation; these remain browser QA priorities, not inferred defects.
- Tree helpers intentionally scope entries to `/home`; verify visible explorer scope is clear and uploaded/generated files remain discoverable. History tests promise draft restoration and exact command preservation; verify both through actual keyboard input.
- Packaging plan identifies unresolved engine/browser exports and reset behavior, plus relative asset paths for static hosting. At readiness inspect worker loading and engine capabilities; flag misleading runtime claims or main-thread execution risks immediately if found.
