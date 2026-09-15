# Resolved approval artifact verification

## Entry gate

- Obtain the root's confirmation that all implementation owners, including Planck, are frozen.
- Use synthetic fixtures only. Do not discover private backend configuration or credentials.
- This is ordinary API and artifact verification, not a restart of the declined independent review.
- Do not publish, commit, or edit README files.

## Maintained checks

1. Run `npm run test:unit --workspace=@poe-platform/op` in a subshell with repository-local Git hook variables cleared using `git rev-parse --local-env-vars`.
2. Run `npm run lint --workspace=@poe-platform/op`.
3. Run `npm run build:workspaces -- --workspace=@poe-platform/op`.
4. Check whitespace for tracked changes and untracked package files without changing either.
5. Run `npm run lint:packages -- --json`; report actual failures without waiving README policy.
6. Save named logs under ignored `out/`; record exact outcomes rather than extrapolating prior results.

## Fresh artifact checks

1. Pack the frozen package using its maintained prepack lifecycle into ignored `out/`.
2. Install that exact archive into a fresh ignored consumer; record archive SHA-256 and installed package identity.
3. Exercise root SDK and Node entry-point imports, consumer TypeScript declarations, and the installed CLI's version/help.
4. Exercise resolved approval through the installed SDK with a synthetic object backend: grant, sanitized manifest, bound execution, final denial without output, and stale binding rejection after approval-time mutation.
5. Verify the installed CLI executes a synthetic explicitly configured module, not a workspace-source import.

## Manual CLI screenshot route

1. Use an inline terminal invocation, not a saved QA runner. Supply a synthetic trusted backend module as an explicit data URL if supported by the host loader.
2. The module exports a backend and the real `authorize`, `authorizeResolution`, and `approveResolved` callbacks. Restrict child environment to explicit synthetic configuration.
3. Print only the sanitized approval manifest and nonsecret event labels. Assert it contains neither synthetic private values nor a binding handle.
4. Use a read to an ignored output file so the screenshot contains no plaintext secret. Confirm the file does not exist before approval, then verify exact synthetic bytes after successful execution.
5. Capture actual installed CLI stdout/stderr, render it with `renderTerminalPng`, and inspect the generated PNG. Show resolution permission, sanitized target/output metadata, approval, and subsequent operation handoff in order.
6. Repeat with final approval denied: no backend execution or output file. Render and inspect this transcript too.
7. Report the screenshots as synthetic host integration evidence, not native authenticated prompt fidelity or cross-host atomicity proof.

## Handoff

Report source checks, archive checks, screenshot inspection, and unresolved policy failures separately. No local commit, remote delivery, or release is implied.

## Frozen checkpoint results

- Maintained package unit task: 684 passed, zero failures/skips/cancellations (`out/op-resolved-final-unit.log`).
- Maintained package lint and test typecheck passed (`out/op-resolved-final-lint.log`).
- Selected maintained workspace build passed (`out/op-resolved-final-build.log`).
- Whitespace check passed, including 77 untracked scoped files (`out/op-resolved-final-diff.log`).
- Package policy failed only `package-readme-required` for `packages/op/README.md` (`out/op-resolved-final-policy.log`). This gate remains open.
- Maintained prepack and fresh consumer installation passed (`out/op-resolved-final-pack.log`, `out/op-resolved-final-install.log`).
- Archive `out/op-resolved-final-pack/poe-platform-op-0.0.1.tgz` has SHA-256 `8c0f2aaf1a374094ba0322dc5b59ce838992c84cc92d754e6b324a06226bc245`; all 58 installed dist files match the frozen build, and the bin is executable (`out/op-resolved-final-artifact.log`).
- Installed SDK/Node imports and consumer declarations passed (`out/op-resolved-final-consumer-smoke.log`, `out/op-resolved-final-consumer-types.log`). Installed version/help both exited zero (`out/op-resolved-final-manual-corrected.log`).

### Original pending-approval regression

The installed SDK and Node CLI entry point each prepared `first-id`, paused in final approval, renamed that item, and assigned its original selector to `second-id`. Granting the pending approval then exited 1 with zero output bytes and zero operation executions. The unchanged controls exited 0 and returned `first-id`; denied controls exited 1 with no execution/output. See `out/op-resolved-final-consumer-smoke.log`.

The installed executable repeated the name reassignment through an explicitly configured synthetic module. It reported `Binding is invalid or no longer current`, exited 1, returned zero operation-output bytes, and never entered stale execution. See `out/op-resolved-final-bin-race.log`.

This supports the bounded resolved-identity gate for the cooperative object backend. It is not evidence of complete native parity, arbitrary adapter correctness, or atomic control of a host effect after invocation.

### Manual screenshots and capability boundary

- Inspected `screenshots/op-resolved-final-approve.png`: explicit resolution permission, sanitized target identities and output destination, absent file before approval, approval before backend execution, then exact synthetic output bytes verified off-terminal.
- Inspected `screenshots/op-resolved-final-deny.png`: the same sanitized manifest, denial, no backend execution, no output file. Neither transcript contains the synthetic private value or a binding handle.
- Raw transcripts: `out/op-resolved-final-approve-transcript.log` and `out/op-resolved-final-deny-transcript.log`.
- File-backed resolved approval remains unsupported: installed Node host reached the resolution grant, never reached final approval, exited 1 without output, and left the memfs seed unchanged (`out/op-resolved-final-capability-corrected.log`).
- Two initial manual fixture errors are retained, not counted as product regressions: the executable PATH omitted the Node directory (`out/op-resolved-final-manual.log`), and the memfs fixture lacked host package-version metadata (`out/op-resolved-final-capability.log`). Explicit Node PATH and injected version corrected these fixtures without production edits.

No implementation or README edits, commit, push, or publication occurred during this verification checkpoint.

## Subsequent bounded overwrite capability

The approved follow-up adds `NodeHostDependencies.confirmOverwrite`, using the exported `OpConfirmOverwrite` type from `host-contracts.ts` and the Node entry point. This is an injected host capability, not a new native CLI flag or automatic terminal UI. SDK file hosts can implement the same contract without consuming command stdin.

For a nonempty regular file without explicit force, only literal `true` permits chmod, truncation, and writing. The callback receives a frozen resolved-path intent and the operation signal, never the output bytes. Missing consent, denial/EOF, callback failure, and cancellation preserve existing bytes and mode. Force bypasses overwrite confirmation, not operation authorization. An absent or empty file retains the existing behavior.

The host retains its already-open file handle while awaiting consent; it does not reopen the path with truncation afterward. Tests cover path replacement, shorter replacement content, abort settlement, handle closure, and late consent without effects. This is not a new cross-host or OS-level atomicity guarantee.

Primary documentation describes confirmation suppression with force, while the document reference also says destinations must be absent or empty. Pinned 2.39.0 probes reached no overwrite prompt: authentication blocked normal/force cases in both TTY and non-TTY modes; all four output commands rejected `--no-input`. Exact native prompt wording, default answer, input descriptor, and authenticated EOF behavior remain unverified. Automatic TTY prompting remains host-owned; this capability does not establish full native prompt parity.

Evidence: `out/op-overwrite-evidence-summary.log`, `out/op-oracle/captures/overwrite-tty-matrix.log`, `out/op-overwrite-confirmation-red.log` (7 pass, 11 fail), and `out/op-overwrite-confirmation-scoped.log` (113 pass). This follow-up changes source after the earlier frozen archive; final package checks, fresh packing, and screenshots must wait for the next joint feature freeze.
