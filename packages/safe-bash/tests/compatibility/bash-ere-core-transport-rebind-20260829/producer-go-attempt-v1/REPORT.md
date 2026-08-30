# ROOT producer GO — launch-contract STOP before execution

## Missing field

**STOP before producer launch:** `grant.independentProducerReview`.

The exact authorized executable at
`tests/compatibility/bash-ere-core-transport-rebind-20260829/producer.mjs:38`
unconditionally requires this field to contain a 40-hex independent producer-
review receipt. ROOT's current trusted build/package GO explicitly waives a new
preexecution review and requires independent actual producer/binding audit
afterward. The sealed executable has no branch representing that waiver.

ROOT's authorization is recorded faithfully in `ROOT-GO-RECORD.json`; a review
receipt was not invented, the producer commit was not relabeled as independent
review, and the sealed code was not altered. This is **not a demand for a new
preexecution review**. The missing binding is an explicitly authorized,
versioned waiver-aware launch contract that can represent the authorization
already given. Under ROOT's instruction to stop before an incompletely bound
command, the producer command itself was not launched.

## Authentication and preserved scope

- Authorized preparation commit: `c5a45fec840135ed38ac5533b8a15f1b64dafb2c`.
- Authenticated preseal SHA256:
  `02c98960983bfeffabf43ba11d5a594c498623c2befe3a06136c12d99d2dfd17`.
- All ten preseal-listed DATA/code files match their exact sizes and hashes.
- Derived composition remains `ff0c86a560da56b58437928c499ca7f5b9d25d70`.
- Source/PURE transport acceptance remains
  `f17d8dec11190ef40ecac6c175b208a2e29c7fbf`; actual private T1 remains pending.
- The intended `future-producer-v1` output root is absent; no fresh source
  materialization occurs. Live selected-Git-input/tool-origin reauthentication
  is not reached and remains required before any future compiler command.
- No old source/package/producer result, historical cap or sealed executable
  is modified. K08/PIPE/B35/public Node changes remain excluded.

## Actual work

One permission-restricted DATA admission helper reads the sealed contract.
It does not import producer code or start a child process. Producer invocations,
compiler builds, package producers, archive decodes, layout materializations,
product imports and Workers are **all zero**. Neither the single authorized
compiler attempt nor the single package-producer attempt is consumed.

No new package/archive/emit inventory/type-build result/final layout binding is
claimed. There is no producer-archive commit and no final-binding commit: this
commit is only an admission STOP receipt. The required archive-plus-producer-
receipt commit before first decode remains mandatory and unreached.

## Capture, resources and receipt

Direct capture begins in the first shell before external children at
2026-08-29T15:38:28Z; the authorized publication deadline is 15:58:28Z.
The DATA helper records the STOP at 15:39:57.534Z. All work is serialized, with
no live helper overlapping patch/metadata commands. Publication-inclusive known
roles are 18, below 48; conservative hierarchy is at most three. Only five new
files in this attempt directory are published. The final explicit-file byte
census records logical retained bytes; no RSS/Git-physical quota claim follows.

`STOP.json` SHA256:
`d5a9778ed12b245b744793c013285dc6a6107422cc18fbe129efdc66a25a1e15`.

The final atomic explicit-path commit binds this report, raw capture,
authorization record, admission helper and STOP receipt. Foreign staging is
preserved. No build/package authority is inferred for a changed preseal.
