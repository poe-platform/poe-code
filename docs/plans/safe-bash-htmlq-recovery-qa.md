# htmlq scope and recovery QA

Execute these steps against the final engine candidate. Development cross-checks
are independent evidence, not substitutes for the pinned html5ever oracle.

1. Run the private workspace unit route. Confirm the original controls for lists,
   late head tags, void end tags, headings, repeated attributes, nested buttons,
   forms, captions, colgroups, optgroups, cells and unknown end tags. Confirm
   cancellation, failed cleanup, budgets, ownership and byte-boundary controls.
2. Run the private workspace lint route, including source and test typechecks.
3. Build the explicitly selected `@poe-platform/safe-bash` workspace closure.
4. Cross-check the recovery fixtures with the checkout's development-only parse5
   dependency. Do not import it into the product or infer pinned native parity.
5. Bundle the private engine into a fresh Node VM realm supplied only with web
   encoding and cancellation primitives. Confirm host filesystem, process,
   network and executable capabilities are absent. Parse inert script/style and
   foreign markup, compare multiple byte chunkings, reject forged nodes, and
   check structured budget errors and exactly-once cleanup.
6. Generate public artifacts with the maintained safe-library packer. Run the
   maintained htmlq runtime and strict NodeNext declaration fixtures from an
   outside-checkout consumer containing only public generated artifacts. Check
   that the htmlq JS and declaration closure contain no private bare import.
7. Record passes, failures and unavailable cells separately. Remove task-owned
   temporary evidence. `/out` is read-only on this host; use ignored workspace
   `out/htmlq-engine-qa` for transient artifacts and logs.

CLI screenshots are inapplicable to these pure engine changes: no command
adapter or visible CLI behavior is introduced. CLI/SDK command equivalence,
pinned native reruns, actual browser/workerd runtimes, checkpoint/replay, full
HTML5 grammar/recovery and registry-installed publication remain unqualified.
Do not count the generated-artifact consumer as a registry installation.

## Execution receipt — 2026-09-20

Only `src/tree.ts`, `src/engine.test.ts`, the private package README and this QA
document were edited during this run. The engine, entity data, public export,
workspace manifests and packaging integration were already in the working tree.
Unrelated edits were preserved.

Twenty original memory-stream tests were added. Eighteen failed before repairs;
two independent negative controls already passed. The final private workspace
unit route passes all 53 tests with zero failures, skips or timeouts. Unit tests
create no files and invoke no external runtime capability or native oracle.

Passed:

- `npm run lint --workspace=safe-bash-command-htmlq`, including both typechecks.
- Maintained selected safe-bash build closure, followed by the selected htmlq
  build against the final source; shared machine cache retained.
- Development-only parse5 cross-checks for the enumerated recovery fixtures.
  These independently support the expected standard behavior, not pinned native
  equivalence or complete HTML5 conformance.
- Node VM realm with web encoding/cancellation primitives, without process,
  require or fetch: inert script/style preservation, foreign DOM, five byte
  chunkings, forged-node rejection, input budget and exactly-once cleanup.
- Maintained safe-library artifact generation. An outside-checkout consumer
  linked only the three generated public artifacts; maintained htmlq runtime and
  strict NodeNext declaration fixtures passed. An AST walk of the eight-file
  htmlq runtime/declaration closure found no bare private imports. This is
  generated-artifact consumption; npm tarball/registry installation was not run.
- `git diff --check`.

Resolved verification failures: cross-realm byte admission initially rejected
the VM's web encoder output. An original failing test reproduced it; intrinsic
typed-array branding now admits cross-realm Uint8Array while rejecting other
views, spoofed tags and proxies. Another original failing test proved shadowed
`byteLength` could bypass input admission; accounting now reads intrinsic byte
storage and cleanup still occurs on rejection.

Unavailable/unverified: pinned native reruns, actual browser/workerd engines,
registry installation/publication, complete HTML5 insertion modes and recovery,
CLI/SDK command equivalence, checkpoint/replay. Screenshots are inapplicable to
this pure engine increment. Repository-wide lint/build/unit routes were not run:
this run changed one private engine and documentation, and used its maintained
focused checks and the public consuming build closure. No bounded performance
claim or full HTML5 parity claim is made. `fullHtml5Parity` remains false, so the
complete requested engine task remains unfinished.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package publication. Task-owned generated artifacts and the
outside-checkout temporary consumer were purged after verification.
