# Function / PIPESTATUS native preparation

Status: Proposed. Implemented Through: Not applicable.

This packet is SOURCE/DATA preparation, not runtime authority. Fixed preparation
window begins 2026-08-29T12:26:43Z and ends 12:51:43Z, including publication.
Limits: 56 known OS starts, peak 3, capture 64 MiB, working files 256 MiB.
Instruction reads are context-only. Existing startup capture precedes helpers.

## Finite helper preseal

`prepare.mjs` is a DATA-only helper: syntax check, then one execution. It admits
the previously captured Git batch by blob hash before decoding each member;
selects the exact preflight-v2 tree members, obtains them in one Git batch and
checks every blob before decoding. It stream-hashes known tools without decoding
executables. It admits retained GNU source using the plan's recorded SHA256,
size and regular-file identity, then writes only selected source excerpts.
It materializes all 26 proposed scripts byte-exactly, without expected goldens.
It does not import any materialized module or execute Bash/native/product code.
At most two further DATA helper processes may seal/check the eventual proposal;
no fixture children or approval request are allowed.

Finite reads: original plan, matrix, bindings; nine owner modules and their JSON
assets and control result; nine GNU text files listed by the plan, at most 3 MiB
aggregate; pinned Bash/Node/env/zsh tool metadata and stream hashes only.
All Git requests are exact stored object IDs from scoped trees, never HEAD.
The new program manifest records retained legacy IDs, no rescore or silent drop.
F06/P15 require a separate failed-lookup disposition; F05 needs an explicit owned
regular-file effects rule. Empty stdin applies to every request.

No original grant, root receipt, expiry or native acceptance is copied as current
authority. Initial tool-shell startup remains trusted host behavior outside the
future child fresh-env/raw-capture qualification. No OS containment claim.
