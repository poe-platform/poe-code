# Frozen RegExp search: independent actual 13.0.6 review

## Decision and publication boundary

**SCOPED ACTUAL PASS / SCOPED READY** for the approved frozen-search actual-consumer checks. No unresolved product or evidence blocker remains within this finite scope. This is not universal RegExp, frozen-object, snapshot, native-graph or security approval.

This report is one new documentation path, absent at verified publication base `e0883bef8948a1e0cfeb9c10c50612b86c5723eb`. The reviewer fetched that exact commit into its isolated repository without changing its source checkout. Only this report belongs to the delivery patch; no production, test, README, skill or master-ledger changes are included. Root owns the later docs-only report/ledger publication and normal hooks/CI. No next source feature is authorized by this review.

All target work finished on August 30, 2026. Initial CPU release was `17:45:58.753Z`; the single authorized SDK receipt repair finished with direct exit 0, followed by CPU release at `17:49:52.416Z`. Owned target PIDs were quiescent at both release checkpoints and the final LIGHT identity check. No further target runs occurred during sealing.

## Exact artifact and private installation

- Actual package: `poe-code@13.0.6`; publisher-recorded publication time `2026-08-30T17:30:07.317Z`.
- Registry/tag commit: `e0883bef8948a1e0cfeb9c10c50612b86c5723eb`; source commit: `d49a6d29af7b4f548247278015d52e637a2030a8`. These release metadata claims come from the authenticated publisher receipt, not a fresh latest-version lookup. The archive package metadata itself has no `gitHead` field.
- Publisher delivery receipt: `/Users/kjopek/Workspace/poe-code-safejs-publish-rename/out/safejs-remediation/releases/frozen-search/final-delivery-receipt.json`, SHA256 `bc16ee779db63f6f4ac8a74646e84fa48697d89bb0a3e9774d489ea21360c4e4`.
- Retained `poe-code-13.0.6.tgz` in that publisher folder: SHA256 `cbc4673305ab349ad5ff0688334731d327f408a96916610f93e9bd422ea346e9`; SHA1 `78770d7909b4683256b1305e44e2346eb209bfd0`; SRI `sha512-VWGtbG5sPIcSB8SFUQHYemE8ymhYqMUaVNTkb/QwWYQtQn6ANuhJxd3gCa0trxJKCfyZCVUl0pweBQFySiXTFw==`. All three were independently verified against the retained bytes and receipt. This is not an independent signature/attestation verification claim.

The actual consumer is outside every checkout at `/private/tmp/poe-frozen-search-actual-1306.MVgfWL/consumer`, using Node `22.22.2`, npm `10.9.7`, Darwin arm64. Initial available capacity was approximately 2.1 GiB, rechecked near 2.0 GiB before installation, rather than assuming an older 2.9 GiB observation. Archive inspection found 3,551 safe regular members, 16,510,600 compressed bytes and 117,628,435 unpacked bytes, with no link/path-traversal member admitted.

Normal private installation exited **0**, PID `69951`. HOME, XDG directories, npm cache/config/prefix and TMP were private; CI, SKIP_SYNC_SKILLS, HUSKY and TERM overrides were absent. Scripts were explicitly enabled, not bypassed. The retained lifecycle log records Braintrust, esbuild and poe-code postinstall hooks. The distributed postinstall stub exists, but its source-only `scripts/sync-skills.ts` target does not, so normal hook execution did not synchronize live-home skills. The earlier preflight field `distributedSyncScriptPresent: true` names the stub, not that absent target; `installed-before.json` records this distinction explicitly. Dependencies were privately installed, not shared writable modules.

Selected byte identity was checked before execution and after all target work: **289 SafeJS SDK files**, **201 package-metadata records**, the installed poe-code package metadata and private consumer lock remain unchanged. Package metadata SHA256 is `d007714e6f11c113bcda8efdfdd72a31bdee75ed518af796325b11752981d7df`; consumer lock SHA256 is `6e5c520eda673b0ed49040b0bbb5932700b338fe3343b24294babdf4a02ac413`. The SDK files also match the publisher's prepublication pins and archive bytes. This does **not** certify every dependency file, unrelated bundle or the whole installation.

## Finite SDK and CLI results

The accepted prep manifest is `b63694770de397b7909830c512264eb729dcc4f8028e845ba7be50fc6864c590`. Its original thirteen recipes were extracted from the pinned reviewer execution document, SHA256 `b063a2d86aeaf0509564a95f56ed43ad7069110d6153d097b034d3756b3617c4`, and used unchanged with `maxSteps: 20000`.

| Surface                   | Unique coverage                          | Result and receipt                                                                                                |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SDK, canonical and legacy | 13 recipes × 2 aliases = 26 observations | 26/26 pass; one authorized repeat of these same 26 SDK observations has direct process exit 0                     |
| CLI, canonical and legacy | 13 recipes × 2 aliases = 26 invocations  | 26/26 pass; 22 direct exits 0 and four expected exits 1                                                           |
| CLI alias comparison      | 13 paired groups                         | 13/13 stdout/stderr byte-equality checks pass                                                                     |
| Numeric frozen replay     | 2 cases × 2 aliases                      | Four captures, four pending reconciliations, exactly four fresh completed-resume children; all four child exits 0 |

SDK totals are **26 unique plus 26 repeated observations, 52 executions**, not 52 unique cases. No CLI invocation, replay capture, reconciliation, provider call or fresh replay child was repeated for the SDK receipt repair. Both SDK aliases resolve to the same installed `packages/safe-js/dist/index.js`; no source checkout alias or CLI fallback was used.

Coverage includes frozen non-global hit/miss, global readonly rejection, caught outcomes/cursors, required writes from saved `-0`, `1` and `NaN`, and successful mutable global/non-global restoration of `-0`. SDK return comparison preserves exact numeric values and `Object.is` witnesses. CLI JSON necessarily represents `-0` as `0` and `NaN` as `null`; those wire representations are not substituted into the SDK oracle.

Native host TypeError instances and sandbox rejection records remain separate observable domains. Full raw errors, descriptors, messages and stacks are retained separately; only the qualified rejection kind/name is compared across those domains. A fulfilled interpreter failure is not accepted as a rejection. Expected CLI failures preserve exit 1, empty stdout, source-span diagnostics and the readonly-lastIndex message; no additional literal TypeError-heading requirement is imposed.

LIGHT auditing authenticated all **65 unique original assertion records**: 26 SDK, 26 CLI and 13 alias comparisons, with no duplicates or omitted IDs. Direct CLI receipts match the retained raw streams. Original assertion failures would enter the failure list and determine a nonzero requested process exit; none were recorded. In the SDK repair, equality and terminal count assertions occur outside the catch that observes guest rejection. An assertion cannot be mistaken for an expected guest error, and the repair PASS marker is emitted only after all 26 assertions. Its direct process exit is **0**, PID `79243`.

## Replay, optional heap and exact observable boundary

R1 uses a numeric-zero cursor on a frozen non-global regex; R2 uses the same source with the global flag and catches its required-write TypeError. Exact complete returns are respectively `[17, [0, true, true], ["return", 0], 0, true, true]` and `[17, [0, true, true], ["throw", "TypeError"], 0, true, true]`. Native async reference execution agrees. R2 is a guest-caught refusal, not an uncaught API rejection; the original S03/S04 SDK cases cover that separate channel.

Each initial capture performs one real host effect, then the outside caller uses public `dump(active, { mode: "replay" })` while that effect is pending. Capture is not requested inside the host callback and does not use default active dump. After completing the original effect with 17, the genuine completed journal supplies the reconciliation proof. The pending provider checks call ID, source hash, module ID, operation and argument digest and returns the value through the supplied public `context.toSandboxValue`.

For **each** of the four case/alias compositions: initial effects = **1**; intentional pending provider reconciliation calls = **1**; additional original effect-binding calls = **0**. Each fresh completed-resume child has **0 provider calls and 0 repeated effects**. Provider reconciliation is deliberately not described as zero calls or confused with a new execution of the original external effect. No separate pending `re-issue` policy case was added or universally certified.

Fresh child PIDs `74675`, `74676`, `74677`, `74678` each have exit 0, null signal, no spawn error, empty stderr and one matching completion marker. The child asserts full return, zero counters, exact graph comparison and unchanged input bytes before emitting that marker; its catch sets process exit 1 on any failed assertion. Parent receipts require the actual child status, not merely a printed PASS.

The initial replay observer incorrectly required a top-level `heap` field and exited **1**, PID `73927`, before any fresh child. The distributed serializer's `createDumpFile` in `snapshot/dump-format.js` emits `heap` only when it has entries. In these approved records, `heap` is absent; the other five selected fields are present. Absence is not replaced with an empty object or treated as serialized frozen-descriptor proof.

The corrected observer compares **own-key presence equality and exact deep contents** for every one of `bindings`, `heap`, `hostCalls`, `replay`, `promiseReplay` and `initialInputs`. It does not remove keys, strip fields, normalize graphs or change expected outcomes. The saved R1 canonical pending/original-completed/reconciled-completed captures were reused byte-for-byte; the correction did not invoke another provider or original effect. The other three compositions then ran once, and only the four approved children were launched. Continuation exit was **0**, PID `74674`. Same-domain serialized field equality is checked against the original completed capture, and capture hashes remain unchanged.

Readonly evidence is the guest's before/after `Object.isFrozen`, exact cursor/return and required-write refusal. Explicit replay can re-execute source freeze. Therefore these results do not claim that an independently restored regex node carries every original native frozen descriptor or that arbitrary capture modes preserve all native integrity state.

## Preserved failures, source-only witness and visual evidence

The original combined SDK/CLI Node process was PID `73147`. Its surrounding zsh wrapper exited **1** because `status` is readonly after the checks had finished. The **original combined Node exit remains UNKNOWN, not 0**. The raw JSON also retains a duplicate-summary-key reporting mistake: the `cli` record array displaced the CLI count summary, so counts are derived from the 26 direct records and assertion IDs. Neither raw artifact was overwritten. This shell receipt problem is distinct from the optional-heap assertion failure.

Root authorized exactly one SDK-only receipt repair. It repeated the unchanged pure SDK cases, with no budget, timeout or oracle adjustment, and captured exit 0 directly. The initial unknown/failed phases remain historical evidence rather than being rewritten as green. The initial source-author 6-fail/7-pass to qualified 4-fail/9-pass baseline history also remains preserved: its two host-error-instance versus rejection-record corrections are not additional product fixes.

The internal abrupt sentinel/no-finally witness remains **source-only**, not a newly executed actual public control. Its link to this artifact is the authenticated source/build identity, including published `string.ts` SHA256 `b657dacb191381fac83c2d7d6de258bb464b2758c3e8a8d4e7d5e35eecd93178`, and the retained independent source review. The product change is still only the two conditional `Object.is` cursor writes; this actual review introduces no flags, owner, accounting or public-option changes.

Two actual installed CLI outputs were rendered with the approved existing read-only publisher `renderTerminalPng` entrypoint, exit **0**, PID `74840`, and both PNGs were visually inspected. Canonical S01 shows successful JSON output; legacy S03 shows the expected source-span readonly failure. These are **noninteractive captured-output images**, not interactive TTY screenshots and not source CLI images relabeled as actual. No renderer build/install or publisher write occurred.

- Success PNG: `evidence/actual-poe-safe-js-S01.png`, SHA256 `3c289d09c3958ca09bd87ee0e59ed26e59b8247ff5c7c37e7bc6c71d2b736e1e`.
- Refusal PNG: `evidence/actual-poe-safejs-S03.png`, SHA256 `65711b79af22e3bb41617f3f4090cdc9189cca5a86007824d0a859dbfbdde557`.
- Renderer provenance receipt SHA256: `8fb63b444fb4483022edc32a212c6a8d046ad7b2fcdadd974465e35d1ccfcf85`; approved entrypoint SHA256: `6d7673aefc76bfa2fdc1e6d9824f653123721057257c5eab18581899d473eed7`.

**Three raw-cursor gaps and fourteen future-y observations remain OPEN and unactivated.** No new probe, native graph campaign, full suite, source build or O08/O09 implementation claim is included. Historical actual 13.0.5 and source review capsules remain immutable and separate from this actual 13.0.6 result.

## Delivery and retained receipts

Actual evidence, including raw failures, original and qualified child commands, unchanged captures, per-CLI streams, SDK repair receipts and PNGs, remains under `/private/tmp/poe-frozen-search-actual-1306.MVgfWL/evidence`. In particular, `light-receipt-audit.json`, `sdk-receipt-repair.exit`, `sdk-repair-cpu-release.json` and `final-light-identity.json` carry the coverage, direct-exit, release and selected-identity receipts. Large payloads are referenced, not recopied into the publication patch.

The new immutable delivery capsule is `out/safejs-remediation/frozen-search-independent-review/actual-13-0-6-scoped-final-20260830/manifest.json` in the reviewer repository. It records this report's exact postimage, absent preimage at the verified release base, one-path stock patch, configured format check after final writing, strict forward/reverse checks, retained evidence pins and a companion delivery receipt. Older capsules, including source review `a7511479...`, approved source-report format refresh `618b9129...` and actual 13.0.5 `d5fdfc1479...`, are not overwritten or superseded as historical results.
