# Independent host-record replay prototype repair validation

## Verdict and exact scope

**READY for the exact Nash candidate; NOT READY for automatic current-main intake or release.**

Review completed on 2026-08-30. Author manifest SHA256 is `70229ed0eea1e00c5e7621efc772ec74f441e831d180b24ad5537d3b959c06f3`. Its actual source base is `e6b70989225781249f2cf395b927186894fad7c2` plus the previously approved localeCompare implementation prerequisite, not a complete checkout of released `eccffd2fa82e9c0540a37a48d70e494ca93b1886`. The author manifest explicitly preserves this distinction. A fresh independent source snapshot was created from that exact immutable base; its 127 non-test SafeJS source files match the frozen author workspace byte-for-byte after exact candidate intake.

The production change is one hunk in `packages/safejs/src/interp/values.ts`, three added lines replacing one. Required preimage SHA256: `cb26ac566eaed9ade10ff5bafdd5454104bae2b62b8f76792dc4f4936313ced5`. Exact candidate postimage: `2a03bb66157742d5c3aa6ea8b0b20725b8a71599398f65615762c9786b37b320`. No independent production repair or silent rebase was made.

At 2026-08-30T06:00:00.962Z the publisher's committed HEAD was `b16e7eeb20cdf56d726267de2b5fa5d356157278`; its committed values.ts SHA256 was `6de1b3c67dc4975cf86e260e67c389a6504fee41cf650754b66cbde1b2b323e9`. That does not match the candidate preimage. **Nash must perform the author integration, preserve Float/intervening changes, and freeze a new candidate for independent merged validation.** This report makes no claim about publisher working-tree changes, pipeline status, later String-helper composition or a new npm artifact.

## Genuine defect, not an observer waiver

The previous actual npm12.0.2 independent manifest `546e0f0e3d239a5b5a9537ab83dcd24c27c8f753e6e8e026464bb51f15372b8e` and both strict O15 fresh failures remain immutable. The earlier four literal expected-domain REDs also remain historical REDs. Nash's separate captured no-hook controls establish an additional semantic witness: `String(await ack())` returns native `[object Object]` on ordinary-record production, but the old completed capture replays as a genuine null-prototype record and throws TypeError, with zero host reissues. Canonical decoding faithfully follows the recorded flag; that does not excuse loss of the supported ordinary-record String behavior before recording.

I reproduced the author test against the exact unpatched values preimage: **one failure, one genuine-null control pass**. The failure is `Cannot convert object to primitive value` without replay observation hooks. Four independently authored clone controls gave **one failure, three passes** before intake. The preserved failure is mixed ordinary/null prototype loss, not relaxed graph comparison. Exact author intake then passes all six tests unchanged in assertion content.

## Static boundary review

The changed allocation at values.ts line619 is reached only after existing depth and accepted-kind handling and `isPlainObject`, which accepts exactly this realm's Object.prototype or null. In clone mode it retains which of those two prototypes was already present. Public `deepCopyToSandbox` still calls non-clone mode and normalizes ordinary input records to null. The helper does not graft Object.prototype onto a genuinely null record.

The clone path is used by the existing host outcome journal and structuredClone intrinsic. Native callable rejection, own-enumerable-data copying, error branding, map/set cloning, cycle memoization and depth/budget accounting are unchanged. The hunk neither invokes toJSON nor reads ordinary data accessors; its extra prototype lookup is on an already accepted plain record. Custom inherited prototypes and native function-valued data remain rejected in the bounded controls. These facts are not a security certification, arbitrary-prototype acceptance, proxy guarantee, or promise to preserve unsupported own metadata through every copy boundary.

Existing adjacent tests cover retained callbacks, argument digests, toJSON side effects, callback arity, data budgets, error snapshots, invalid snapshot/capability rejection, ordinary snapshot serialization, completed Map aliases, sparse array shape and completed/failure replay. The full O15 graph checks retain every key, descriptor, extensibility flag, primitive value and reference edge in their finite admitted domain. No symbol/accessor/native-function data is silently removed by that observer.

## Original O15 procedure and complete results

This Markdown is the agent-executed QA procedure, not an executable QA runner file. Exact program text, stdin, argv, source hash, environment, timing, limits and all output records are retained in the capsule.

1. Authenticate the previous independent manifest and its exact native, producer and strict fresh recipe/oracle copies. No original audit payload is read.
2. Run seed123 and seed42 native controls first with unchanged original source, inputs and anchors.
3. Select the exact candidate source public entry or freshly built public entry; execute one producer per seed and entry.
4. Restore each newly produced capture in a separate Node process using the existing strict public onReplay adapter, without normalizing acknowledgements or changing assertions.
5. Compare every original native output field, the full mixed-domain typed return graph, all RNG values and checks. Verify new host calls separately from the complete replayed host-event journal; do not fabricate fresh host events.
6. Compare entire producer/restored canonical replay journals, including call IDs, argument digests, policies, outcomes and lifecycle fields. Keep original lossy captures separate.

All ten O15 processes pass: **two native, four producer and four fresh restore**. Source and public built are different selected entrypoints, not an installed npm release. Each completed case retains exactly **54 shared LCG/UUID draws, final clock1006 and all ten anchors**. Every complete native output field matches; fresh new-host-event lists are correctly empty and their separately captured full replayed event lists match native. Each fresh case has 15 replayed events, zero reissued host calls and an exactly equal complete canonical journal.

Each producer and fresh return graph has **23 nodes: 16 null-prototype guest records, three Object.prototype host acknowledgements and four arrays**. All typed graph data and alias topology match the previously authenticated independent mixed-domain oracle. RNG and error graphs match completely. The literal finalAttempts comparison remains false under its old domain; only the previously approved expected-input-domain observer supplies its independent expected value. Raw acknowledgements and full outputs are never converted.

Original guest source SHA256 remains `0986c4485dbc6cfd7922143087ea053198118925a04aa44e5c1b5812f313b5dd`. Original seeds, initial clock1000, settings, localeCompare expressions, source/version markers and native oracle bytes are unchanged. Each workflow keeps a 12,000 ms external cap, 256 MiB V8 old-space setting and 16,777,216-byte output buffer. V8 old space is not a total-process RSS bound. No retries or deadline relaxation occur. Runtime label changes identify NEW candidate captures rather than falsely labeling them npm12.0.2.

## Semantic and old-loss controls

Six further finite source/built commands reuse the authenticated hook-free author String recipe: each entry produces and freshly restores `[object Object]`, with one original host call and zero fresh host calls. Two unchanged old12.0.2 lossy String captures still publicly reject with TypeError `Cannot convert object to primitive value`, zero host calls, at line1 column35. Those two old-capture outcomes are intentionally NONPASS semantic results; their unchanged rejection satisfies the negative control. Process exit0 is not misreported as functional PASS.

Four additional source/built commands reuse the existing genuine-null recipe: producer and fresh result retain null prototypes and exact label/accepted data. Fresh callback outcomes remain null and no host calls are reissued. No old flag is rewritten and no Object.prototype is grafted onto a null record.

There are **20 independent runtime processes** total: ten O15, six hook-free String controls and four genuine-null controls. Eighteen complete their expected positive behavior; two preserve the old-loss TypeError as required negative evidence. Full historical-capture compatibility, repair of already lost metadata and all future source combinations are not claimed.

## Tests, builds and configured checks

- Author-only baseline: 1 failed, 1 passed; independent-only baseline: 1 failed, 3 passed. Both logs are retained.
- Focused candidate: 6 passed. Scoped author set plus independent tests: 147 passed in ten files. Broader selected regression gate: 372 passed in 21 files. These counts overlap; they are not added as unique tests or called a full suite.
- A fresh forced `turbo run build --filter=@poe-code/safejs... --force --output-logs=errors-only` expanded through workspace dependencies to 67 successful build tasks, zero cached. This is not a fresh full-root CLI bundle. Source setup alone uses SKIP_SYNC_SKILLS=1 and TERM unset; no installed-package hooks or user-home sync are bypassed or claimed here.
- Configured `tsc -p tsconfig.build.json --noEmit` passes after builds. Supplemental TypeScript checks of both new package test files report zero diagnostics. Scoped ESLint passes for values.ts and the two test files.
- All five proposed publication files receive configured Prettier and strict whitespace checks. Only the independently owned test/report may receive formatting-only changes; all three author bytes remain exact.
- No CLI behavior is changed or exercised, so no CLI screenshots are claimed. No full suite, new actual released package validation or universal TypeScript-command success is inferred.

## Capture and required next checkpoint

The capsule proposes five publication files: exact author values.ts, author regression and author report, plus the independent four-test file and this report. Exact author preimages/postimages, absent identities for new files, all command records, full workflow outputs, input recipes, source/build hashes and authenticated prerequisite manifests are retained. The already-published locale implementation is a separate prerequisite, not a new publication delta.

The isolated source snapshot has no .git directory; no branch, reset, commit or push occurs. Its dependency tree is an independent APFS copy of owned dependencies with an identical package-lock, not another clone's mutable node_modules. No author clone, old capsule, original npm12.0.2 tar, README, SKILL, master ledger or publisher source is changed. Workflow children use an owned HOME; build/static commands inherited their tool environment and did not explicitly isolate HOME. No live skill sync was run, but incidental tool-cache writes outside the workspace were not monitored and a blanket zero-home-write certification is not made. No original audit/security payload read, guest external IO or provider call occurs.

Next: author-owned integration over the actual changed values preimage, independent merged checks preserving Float and this exact String witness, then publisher gates and a new actual-release validation. READY applies only to the exact frozen source candidate reviewed here, not those outstanding stages.

### Static comparison qualification

The first formatting-comparison helper used the TypeScript printer and returned exit1 because the printer preserves multiline layout from source nodes. That helper failure is retained, not called a passing AST check. The follow-up TypeScript scanner comparison proves all 814 non-trivia token kinds and texts identical before/after formatting (SHA256 `69072cc83dbab9c48129d0a76e3829de8a649a6b3ec4ad57cf88283fcef7e84c`); no test assertion or literal changes. REPL-only setup mistakes caused no workflow executions or changes to the candidate.
