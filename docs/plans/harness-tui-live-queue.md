# Harness TUI live queue and pipeline clarity

Started 2026-09-17 04:04 UTC. Work window: eight hours, through 12:04 UTC.

## Outcome

Pipeline and the other harness TUIs accept multiple follow-up messages during a run. Messages execute after their selected plan, in order, through the same configured agent. Users can append plans while the sequence runs. CLI and SDK callers can supply the same work without keyboard interaction.

The dashboard makes the current plan, pipeline phase, task, step, remaining tasks, and ordered plan/message queue visible. Agent activity is distinct from orchestration phase. Missing usage is represented as unavailable. Tool activity does not overwhelm readable agent messages.

## Work sequence

1. Capture the current terminal-pilot simulation and reproduce information gaps with focused tests.
2. Expose accurate ordered task/step snapshots from the pipeline package, including setup, plan reloads, completion, and failures.
3. Add a shared runtime queue with deterministic plan/message ordering, cancellation, failure handling, and same-agent execution. Keep orchestration in packages and wiring in the CLI/SDK.
4. Add an editable shared dashboard composer and visible queue. Preserve input during streaming, resizing, and plan transitions. Add plans through a discoverable action with validation.
5. Keep one dashboard alive through pipeline sequences; integrate the other harness TUIs and Gaslight. Document queue CLI/SDK parity.
6. Improve layout toward a quiet Codex-style conversation with readable task/plan navigation, meaningful activity, and compact metrics. Use the supplied 30-task, multi-plan, long-running setup screen as a regression scenario.
7. Measure rendering under bursts, long output, held scrollback, editing, and terminal resize. Fix demonstrated hotspots with tests.
8. Execute the Markdown terminal-pilot QA walkthrough at wide, normal, and small terminal sizes. Inspect screenshots. Run required package/root checks and regenerate design documentation.

## Behavior decisions

- Messages attach to an explicit plan and run FIFO after it succeeds, before the next plan. Adding a message never interrupts an active agent.
- Appended plans join the tail of the visible sequence. Validate before accepting them and preserve the current worktree and run configuration.
- Failure or cancellation stops automatic advancement and leaves pending work visible; never silently run dependent messages after a failed plan.
- Default follow-up agent/model come from the harness run, with all normal spawn middleware and cancellation handling.
- The composer is explicit about its target plan and submission behavior. Escape exits editing; Ctrl+C retains the documented forced-quit behavior.
- Use fake agents for all automated and terminal-pilot scenarios. QA remains a Markdown walkthrough, not an assertion script.

## Validation record

- Initial inspection: dashboard exposes only output and scalar statistics; no composer, task tree, or runtime queue. Pipeline creates/destroys the dashboard separately for each initial plan. Gaslight currently has no `--tui` flag.
- Supplied regression: two plans, 30 tasks, 7 completed, setup running for hours, long tool commands, zero usage, and no useful task/queue view.
- Baseline inspected: `out/harness-tui-live-queue/baseline-120x36.png`, captured with terminal-pilot.
- Codex source reference: `openai/codex` commit `16f59db96eaa260eb2863974e4e6dea6bcca6bb3`. Inspected `codex-rs/tui/src/exec_cell/render.rs`, `history_cell/plans.rs`, and `bottom_pane/chat_composer.rs`. Relevant patterns: concise Read/Search/List labels, in-place tool lifecycle, bounded output previews, checklists with distinct active/pending/completed states, explicit queue submission, and width-aware cached rendering. Reference checkout is temporary under `out`.
- Red/green progress tests reproduce and fix resumed task numbering and missing ordered snapshots. Snapshot records exclude prompts and detach step status objects from mutable runner state.

## Progress

- [x] Read repository instructions and terminal-pilot skill; inventory shared dashboard and harness entrypoints.
- [x] Baseline screenshots and failing behavior tests.
- [x] Pipeline progress snapshots.
- [x] Shared live work queue.
- [x] Composer and plan queue UI.
- [x] CLI/SDK integration across harnesses.
- [x] Visual and performance iterations.
- [ ] Required checks and final delivery record.

## First-hour checkpoint

- Pipeline CLI now keeps one dashboard for a live sequence. Multiple messages target individual plans; additional plans append during execution. SDK exposes runPipelineSequence and createRunQueue, including initialization and one worktree context.
- Codex source JSONL schema inspection revealed missing file_change/web_search events and discarded failure states. Regression tests now cover those, full command inputs, and shared ACP failure metadata.
- Real production CLI was exercised through terminal-pilot with fake-codex on an isolated PATH. Two follow-ups were queued for plan one, one for plan two, and a third plan appended. The sequence completed successfully. Inspected production-queued-140x36.png.
- A second actual CLI run at 80×24 verified invalid-path feedback with preserved drafts, the compact task/plan view, and Ctrl+C cleanup (exit 130). Inspected production-invalid-80x24.png and production-queue-80x24.png.
- Checks: toolcraft-design 1,870 tests; agent-spawn 588 tests before shared runner addition; pipeline command 97 tests; selected pipeline and agent-spawn build closures pass; root build TypeScript check passes.
- Local commit 51bdf006e records streaming terminal input, Unicode and bracketed paste fixes. No push or release.
- Remaining visual issues: compact queue acceptance feedback, navigation/overflow markers for long task lists, concise final sequence summary including follow-ups, bounded raw details, and more realistic action simulation. Gaslight and other harness integration still in progress.

## Second-hour checkpoint

- Pipeline, Gaslight, Ralph, and experiment have CLI/SDK sequence integration. Real terminal-pilot walkthroughs completed with manually advanced fake Codex processes, including live messages and appended plans. Experiment uses an isolated Git fixture and now excludes every selected plan and journal from its commit scope.
- Input feedback, hidden draft targets, complete task-list scrolling, sidebar overflow, unavailable usage, paused-state markers, and bounded raw details are implemented and covered by focused tests. Long output wrapping now tracks accumulated width; local stress results improved from paint p95 5.92 ms/input p95 27.47 ms to 3.44 ms/21.06 ms.
- Action summaries now recognize common read/search pipelines, git grep/ls-files, combined sed edit options, and output redirects. Full details remain available. Tool lifecycle markers work without color.
- New Superintendent runtime sequence and eight tests pass. CLI integration remains: preserve its pause, editor, and log controls; run one dashboard/worktree through initial and appended plans; use the builder for follow-ups. The existing `commands/run.ts` currently owns a separate dashboard and duplicates headless/TUI execution. Shared conversation dashboards accept custom browse hints/keymaps so Space can pause while p opens plan input.
- Checks: design 1,885 tests before the latest two control tests (focused 20 passed afterward); agent-spawn 611 tests; harness-tools 257 tests; shared lint passes. Design documentation generation completed successfully. The broad root tsconfig check exhausted Node's default heap; use the maintained `tsconfig.build.json` check and normal repository lint/build routes instead of treating the all-files developer config as the build check.
- Local commits: 509a22080 (conversation dashboard), cc94425b7 (shared queue/controller), 957e3190f (structured action presentation), in addition to 51bdf006e (terminal input). No push or release.

### Superintendent and queue review

- Completed the real Superintendent CLI simulation: three plans, seven messages, 16 manually advanced fake Codex invocations, exit 0. Both terminal sizes and the final summary were inspected.
- Fixed namespaced workflow action recognition, ignored failed/cancelled workflow transitions, and preserved the active round through pause/resume. Workflow recognition is committed locally as 7a77cea89.
- Multi-plan previews are read-only; successful, stopped, failed, and cancelled sequences now have distinct summaries. Failed follow-ups retain the execution worktree. Focused regression tests and the 389-test package route passed before the final worktree regression; that regression passed separately.
- Validated and fixed hidden active messages in long queues, task counts lost behind long action labels, absolute workspace paths in full lists, and legacy action colors overriding the quiet conversation style.

### Fourth-hour verification and action polish

- Gaslight, Ralph, and experiment integrations are committed. CLI summaries count only completed messages; cancelled Gaslight queues report pending work; dry-run previews place follow-ups beneath each plan.
- Compared shell classification with Codex's `codex-rs/shell-command/src/parse_command.rs`. Arbitrary sed scripts and script files now remain general Run actions. Simple print ranges retain Read labels. Generic MCP names become readable phrases, such as `Get pull request · github`.
- Completed action runs now fold to an earlier-action count and the latest two actions. Details mode reveals the original commands. Errors, cancellations, active tools, and user messages remain distinct.
- The 80-column walkthrough exposed a missing current step and clipped Quit control. Both are fixed and covered by focused regressions. Inspected folded and expanded output at 80×24 and 140×36.
- Maintained checks passed: design 1,896 tests, agent-spawn 628 tests, Gaslight 68 tests, Ralph 102 tests, experiment 174 tests, combined CLI summary/help 285 tests, and selected SDK/CLI tests. Normal `npm run build` passed all 72 declared workspace builds plus root stages. `npm run lint` passed 14,252 configured files, root types, contract checks, and workflow lint.
- Full test validation remains in progress. The first broad pass identified stale help/session expectations and an archived-plan test dependency; focused reruns pass. A screenshot preparatory build overlapped a later test build and invalidated generated artifacts; that pass was stopped, normal build restored serially, and the screenshot command rerun successfully. Do not run builds concurrently with the final test pass.
- Latest production Pipeline walk: one task, two repeated follow-ups, another already-complete plan appended while a message ran, and its two follow-ups all completed in order. Queue summary: `2/2 plans · 4/4 messages`, exit 0. Its final generic `Nothing to run` line is misleading after queued messages and needs refinement.
- Further review: large work-list rendering, current-work focus when opening the full list, concise custom harness hints, and final preview/summary phrasing.

### Fifth-hour verification and queue reliability

- Completed the work-list review: opening the list focuses the active message, task, or step; manual scroll remains stable; `f` returns to current work. Only visible rows are formatted. Local 120×32 renders improved from 38.59 ms to 0.47 ms median for 10,000 tasks, with deterministic tests proving hidden titles are not formatted.
- Footer shortcuts wrap at whole boundaries at 60 columns, including custom Superintendent controls. Already-complete Pipeline plans now use an explicit per-plan label; the actual CLI two-plan/two-message sequence finished with exit 0.
- Search labels retain multiple expressions, pattern files, attached options, and scope. Mixed shell actions remain general Run entries. Large shell payloads are not fully parsed for a 100-character label; the complete source stays in Details. A roughly 200 KB local sample dropped from tens of milliseconds to under 0.01 ms for summarization.
- Long queued drafts avoid unnecessary segmentation and reuse unchanged wrapping. A 100,000-character plain multiline draft improved from 26.7 ms to 0.004 ms median insertion and from 30.9 ms to 3.4 ms rendering before the additional layout cache. Manual 250-line Unicode paste, whole-grapheme deletion, live output, submission, and resizing passed.
- Codex `todo_list` and ACP `plan` updates now produce a separate agent checklist. It updates in place, preserves explicit statuses, limits the normal view to five nearby entries, and exposes the full list in Details and replay. Inspected 0/8 → 6/8 → 8/8 updates at 120×32 and 80×24 while harness progress stayed 7/30.
- Reproduced a late-submission race: asynchronous validation could outlast the final executing item and reject a plan submitted before completion. `enqueueValidatedPlan` now keeps the drain open while validation is pending, without delaying cancellation. Harness controller and Superintendent use it. The terminal-pilot walkthrough finished plan one during validation and then started the accepted addition as plan 2/2.
- Rejected input is printed after TUI shutdown, including rejections arriving after shutdown. Inspected the inline error and restored-terminal error message; terminal sessions exited 0 and were closed.
- Checks through these changes: 655 agent-spawn tests, 2,088 combined design/ACP-client tests, 655 combined harness-tools/Superintendent tests, and 115 dashboard/input tests passed. Focused ESLint and the design package TypeScript check passed. New API exports still need the final normal workspace build.
- Full committed-source verification runs in an isolated checkout at c910b2e4c. Its normal build passed. `npm test` passed 116,078 shared tests (2 skipped), Op and Python, the 320 safe-bash runner tests, and 32,369 safe-bash tests (86 skipped); the later safe-js task remains running as of 09:01 UTC. This checkout excludes later composer/checklist/queue fixes, which have focused coverage and require a final build/check pass.
- The earlier working-tree full pass found a readonly capability expectation and a metadata identity mismatch. The capability expectation was corrected and all 77 tests in its file passed. The metadata mismatch comes from unrelated uncommitted root-manifest edits; these were preserved, and committed-source verification uses a clean checkout instead of weakening the check.
- Latest local commits: d3770aeec (composer responsiveness), 215a83d89 (large action payloads), 71ad5ebbd (agent checklists), 4e17b00ba (in-flight plan validation), ee364b435 (visible rejected input after exit). No push or release.

### Sixth-hour review

- Running actions show a small elapsed timer. Completed actions remain quiet, and held history freezes its displayed timer until Follow resumes.
- Delayed message acknowledgements preserve their original acceptance target while the next empty draft follows the current plan. Follow-up headers show the current plan's message position, such as `Follow-up 18/25`.
- Concurrent plan validation now retains submission order. A failing test reproduced a later, faster validation overtaking the first submission. All 267 harness-tools tests passed after the fix; rejected earlier submissions still release later valid work.
- Terminal-pilot exposed missing vertical draft navigation. Up/Down now use the displayed wrap width and preserve the desired column across shorter rows. Resizing resets that column; Unicode graphemes and tabs remain intact. Inspected multiline-up-after-100x28.png and wrapped-draft-up-80x24.png.
- Local 105,000-character Unicode-draft measurements found 21–23 ms median work for Left, Backspace, and Ctrl+W. Local grapheme lookup reduced those operations to 0.03–0.05 ms. A deterministic test bounds examined text instead of imposing a timing threshold. All 325 dashboard tests, focused ESLint, and the design TypeScript check passed. Inspected edits of a combined accent and joined emoji at 100×28 and 80×24.
- Full committed-source testing at c910b2e4c remains running. SafeJS had reported more than 1,090 test files without a reported failure as of 09:40 UTC. Current-head build, lint, and final CLI checks remain pending until this run finishes.
- That full run ended at 09:44 UTC with two SafeJS suites unable to import historical fixtures from removed planning directories; 1,431 files and 30,513 tests passed in that task, with 48 skipped tests. Repository history already held the exact fixture repairs. Reused c75f0499a and f89e3741b locally as 170f7a345 and 650c4ed84, preserving archived JSON bytes beside their tests. Both affected suites then passed all 36 tests. The full command still requires a successful rerun; the partial pass is not recorded as a completed gate.

### Seventh-hour review

- The normal current-source build, repository lint, and design-doc generation passed before the final action/reply refinements. Production Pipeline and Gaslight walkthroughs again completed targeted messages and appended plans in order. A simulated failed command retained later work and exited 1.
- Directory-prefixed reads and searches now show a concise action plus working directory, with raw source in Details. Codex's directory-aware command parser informed this refinement. Mixed commands and writes retain general Run labels. All 666 agent-spawn tests passed; 120×32 and 80×24 screenshots were inspected.
- Reproduced archived-plan follow-ups pointing to a removed file. Pipeline and Ralph results now include the actual archived path, and fresh follow-up agents receive that path. Queue history retains the submitted plan name. All 624 affected package tests passed.
- Agent replies now render Markdown through the existing design system. Cached formatting avoids repeated parsing during editing; only nearby Markdown blocks are formatted for a long live reply. Complete-render equivalence tests cover scrolling and footnotes; malformed streaming frontmatter falls back to readable source. All 1,944 design tests passed. Color, monochrome, narrow layouts, code indentation, and streaming input were visually inspected.
- A sustained session handled more than 60,000 updates over roughly 24 minutes, including held history, resizing, and queue submission, then restored its terminal. Timing captures during broad test load are recorded as observations, not performance baselines.
- The clean-checkout rerun passed 116,133 shared tests, the Op and Python tasks, 320 shell-runner tests, and 32,369 shell tests (86 skipped). SafeJS then exposed a 5-second timeout in a camera oracle batch. The batch now contains one sample while preserving every native and recorded comparison; all 18 focused tests passed. That already-failed full run was stopped. Final build and full committed-source validation are being restarted with the latest changes.
- Latest local product commits: b0695095a (directory-aware actions), 3de93bafa (archived plan references), b84d12904 (Markdown replies). The camera fixture repair is 2c9fd6777. No push or release.

### Final-hour verification

- The current-source normal build and repository lint passed. Design documentation regenerated without tracked changes. The clean-checkout full test at 2c9fd6777 passed 116,153 shared tests (2 skipped), Op, Python, 320 shell-runner tests, and 32,369 shell tests (86 skipped); SafeJS is still running.
- A final worktree review reproduced fresh follow-up prompts naming the original absolute source path in Pipeline, Ralph, and Experiment. Commit 15233e3cd uses the completed plan's execution path, retaining the original queue identity. All 534 affected package tests and focused lint passed. The final normal build and all eight SDK sequence tests then passed, including initial and appended worktree plans.
- The final combined Markdown/queue view passed at 120×32 and 80×24. Inspected final-markdown-queue-120x32.png and final-markdown-queue-80x24.png, then closed the terminal-pilot session. All five harnesses have completed production CLI walkthroughs with fake external agents.
- The broad run then reported one 5-second timeout among 1,027 independent regex comparisons. The unchanged complete file passed all 1,027 tests on focused rerun; the camera repair also passed in the broad run. No regex implementation or timeout was changed without a reproducible cause. The already-failed run was stopped, and current-head build plus clean-checkout verification at 15233e3cd is restarting without competing build/lint jobs.
