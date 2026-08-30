# Concrete integration conventions

Status: Implemented source, execution unrun; complements frozen interface v1
Implemented Through: This packet's subsequent implementation seal
Purpose: Fix type, mutant, tool and batch bindings without changing `runCase(api, caseId)`.

- Type fixtures use `api.compile("T01")` through `"T05"`. The parent writes the
  exact admitted `.mts.data` body to `${api.caseRoot}/${fixtureId}.mts`, replacing
  only `__GIT_ENTRY__` and `__CONTRACTS_ENTRY__` with this layout's absolute `.js`
  entries paired with guarded declarations. Normal strict TypeScript is a nested
  owned child; raw diagnostic stdout/stderr are returned unchanged. No `listFiles`
  lines are silently removed. This is explicit resolution/source binding, not a
  filesystem-read instrumentation trace. Public-root export remains a gap.
- T02–T05 deliberately expect compiler exit2. Both the compiler's nonzero exit
  and the peer's zero-exit assertion remain failures under the root invariant.
  Matching their exact diagnostics is labeled counterproof; it cannot green the
  review. No expected-error waiver or changed fixture is introduced. Eight such
  compiler outcomes across S/M are expected to make aggregate FAIL if reached.
- A sealed mutant supplies exact ordinary emitted-file SHA256 and replacement
  bytes/postimage SHA256. The parent creates an isolated complete 910-file copy
  from S-built or M bytes, replaces only that enrolled file and guards the full
  result. The worker must actually load it and perform its declared witness.
  Stock, mutant and restored outcomes retain separate roles and receipts.
- Source-only observations and unqualified codec adapters never enter worker
  batches. All resource/format row and variant links are preserved in manifests;
  two layouts are repeated environments, not twice as many unique obligations.
- Batches have fixed ordered IDs and one absolute shared timeout. A nonpassing
  case ends that child. Its unstarted tail is explicitly UNRUN; it is not retried
  in a new child. Other independent batches may start only after full guards,
  capture completion and known retirement. Grouping therefore trades fault
  isolation granularity for the approved all-descendant cap, visibly.
- Node, npm, TypeScript and declarations use this packet's fresh exact tool map.
  npm's source map includes twelve symlink observations; its regular materialized
  projection excludes precisely those links. Source and destination hashes differ
  by design. No tool version command or current product import is used to prepare
  this map. A preload denies process creation/network and constrains CJS resolution
  to the copied tool root; it is not a hostile-JavaScript sandbox or native census.
- One metadata child + one build compiler + one offline npm install + ten type
  compiler descendants are reserved before counting all peer worker batches.
  The previous 168-outer/179-total proposal is not executable here. Final batching
  and exact counts await sealed peer manifests, not guessed inventories.
- All caps include cleanup. Cancellation is requested before TERM/KILL, with a
  fixed 5-second retirement reserve inside the current case/batch deadline.
  Source/setup/import and parent guard time remain in the single global origin;
  per-case events do not pretend to isolate all setup costs from product work.

Preseal preparation has imported no candidate, peer module, compiler or runner
body and launched no target controls. Peer reads before their seals are interface
inspection only, not authenticated execution inputs. Direct peer messaging was
unavailable; the committed ABI and `/tmp` handoff are the coordination channel.
