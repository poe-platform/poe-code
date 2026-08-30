# Source and API review

Assigned immutable candidate: `28cfe0f2cdc9b82c940523fce7d6fc08dacaeb94`.
Feature commits: core `a3febbee84e2c1c871376a9d5d30baddb96dae68`, wrappers
`8991abc3a520a3fef0e3544adc1e2508bed66a51`. Core author evidence is `7f25a6de`.
The verifier owns only this new directory. Production, contracts, author tests,
package/export files, and root configuration are read-only.

## Every feature production/contract hunk

The diff from the core parent to the frozen candidate changes seven `src` files,
74 added lines and three removed lines. There are no package, dependency,
root-export, command, SafeJS, or compiler-config changes in that diff.

- `src/contracts/filesystem.ts`: one optional readonly number property. Existing
  structural implementations need not supply it. Adding an optional property can
  legitimately affect consumers of `Required<FileStat>`, exhaustive key lists,
  or exact serialized-object goldens; this is not a claim of byte-identical stat
  objects. Readonly is a TypeScript contract, not a runtime object freeze.
- `src/contracts/filesystem.md`: 58 lines define provider-reported per-entry
  semantics, known zero versus unknown, validation, no size/I/O-size fallback,
  platform restrictions, wrapper forwarding, and limited accounting meaning.
  Identity, lease, transaction, ABA, rmdir, and allocation exclusivity are not
  strengthened by the metadata.
- `src/fs/real/allocation.ts`: six-line, platform-gated conversion. It checks
  primitive number, safe integer, nonnegative count, and safe product separately.
  The largest permitted block count is `17592186044415`; the next count produces
  `9007199254740992`, which is representable as a Number but is **not safe**.
- `src/fs/real/index.ts`: imports the conversion and conditionally adds one field
  to the existing stat mapping. No native call, extra read, traversal, exception
  conversion, signal boundary, or identity source is changed. Missing/invalid
  allocation cannot turn an existing failing stat into success.
- `src/fs/readonly/index.ts`, `src/fs/mount/index.ts`, and
  `src/fs/overlay/index.ts`: named property extraction plus conditional inclusion
  in each existing metadata snapshot. Named getters and nonenumerable properties
  work; unrelated provider fields are not spread. Undefined is omitted and zero
  is retained. An invalid custom provider report is a provider contract violation;
  faithful wrappers are not advertised as validating hostile host JavaScript.

## Unchanged behavior reviewed

The snapshot helpers still preserve all existing named stat fields, including
the exact opaque `identityScope` reference. Routing and `compareEntry` resolution
are unmodified. Mount constructor composition is static; “dynamic mount” tests
mean changing selected backing metadata/capability and synthetic-to-real backing
views, not inventing an add/remove-mount API. The mount snapshot-rmdir getter
retains the current backing profile. Read-only does not advertise the weaker
profile because it refuses rmdir delegation entirely; this is the explicitly
permitted refusal alternative, not a promotion to strong removal. Existing
author identity/comparison/rmdir cohorts are
replayed independently, not replaced with allocation-only assertions.

Overlay snapshots occur before the existing upper-entry object merge. Selection
still prefers the visible upper entry. Copy-up must use the upper report or
unknown, not carry forward the lower report or sum layers. `stat` and `lstat`
already pass `false` to the overlay operation's cleanup switch; allocation did
not add this behavior. They do not copy up or clean pending staging. Other reads,
including `readFile` and `readdir`, retain existing pending-staging housekeeping:
calling all reads “side-effect-free” would be incorrect.
Memory content reads also update access time. Copy-up reads lower content and can
therefore change lower atime, even through a read-only wrapper; content, identity,
mode, mtime and ctime are checked separately from that existing read effect.

Memory, S3, and WebDAV sources did not gain an allocation mapper. SafeJS's existing
`src/integrations/safejs/stats.ts` computes its own synthetic `blocks` from size;
that is outside this feature and is neither changed nor certified as physical
allocation by this review. No commands are altered or newly advertised.

## Author fixture changes, not historical rewrites

The wrapper commit extends readonly metadata fixtures with `allocatedBytes`,
including expansion from 64 to 128 optional-field combinations inside each
existing test. It extends overlay getter metadata and post-snapshot mutation
fixtures as well. Those are disclosed fixture changes, not unchanged historical
all-input evidence. This verifier replays the frozen versions, preserves their
bytes and older evidence, and does not update unrelated exact-object goldens.

The requested author populations are reported separately: core allocation,
legacy contracts/Real, and wrapper allocation/regression. The 425 wrapper tests
already include the allocation tests; a separate allocation subtotal must not be
added to 425. Permutations, native observation rows, and repetitions under mutants
are not additional product tests, nor evidence of whole-product superiority.
