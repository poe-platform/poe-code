# yq root final adoption v1 — additive decision seal

Status: **ROOT FINAL DELTAS ADOPTED; DIFFERENT YAML PRE-CODE FREEZE
REQUIRED; NO IMPLEMENTATION AUTHORITY** (2026-08-28).

## Authority and precedence

Effective precedence is immutable b311 initial profile, then the sealed 5783
final contract, then only this additive root adoption. The exact bases are
`b311c2364ceca13daab4086dfb21157b9b8ae856` and
`5783b8e03912f7774d2a86ba1dae9de778121273`. The latter's README and
`contract.json` were authenticated at that full revision as SHA-256
`14cee48cac1803f92432b4f7df8f3311514b12277357805945bd11156e8646ff` and
`1b2cf2740586d6847286d5a28788beb748d09e8b2181f02e6476d3b7634cefb8`.
All earlier choices remain immutable except where the decisions below expressly
resolve or supersede a pending condition. `adoption.json` is normative where
this handoff is abbreviated.

`adoption.json#/rootDecisionQuotes` reproduces the seven controlling user
decision excerpts exactly; the readable clauses below bind only those deltas.

## Resolved grammar deltas

Quoted content adopts YAML 1.2.2 production 2 `nb-json`: TAB plus
U+0020–U+10FFFF, subject to the actual single-/double-quote and escape grammar.
There is no blanket `c-printable` filter inside quotes and no new reject list.
Thus raw DEL, C1, U+FFFE, and U+FFFF are not rejected merely for being those
characters. Outside quoted content, every prior grammar restriction is unchanged.

This is qualified alignment, not a claim of literal unmodified `nb-json`
support: fatal UTF-8 decoding, well-formed Unicode scalar validity, and the
explicit no-unpaired-surrogate policy remain mandatory. Malformed/out-of-range
escapes and other already-malformed quote/escape grammar remain syntax errors.
Exact escaped-code-point cases must be independently frozen against those
settled rules; this adoption invents neither an escape production nor another
character policy.

Anchor names may be reused. Every definition event, including reuse, increments
the per-document anchor-definition counter; definition 1,024 is allowed and
definition 1,025 fails `LIMIT_MAX_ANCHORS_PER_DOCUMENT`. The counter is not map
size. At each event a new definition record immediately becomes that name's
active most-recent-preceding binding. Completion marks that record only: it
never restores an older record or overwrites a newer binding.

An alias resolves only the active record. If it is pending, the alias is refused
under the existing current-node/cycle rules; it never falls back to an older
completed record to conceal the refusal. A deep copy already produced by an
earlier alias retains its earlier value. Completed-anchor validation, deep-copy
semantics, forward/current/cycle refusals, cross-document isolation, cumulative
alias-reference counting, and all other prior limits remain unchanged. This is
not permission for broader alias cycles or representation sharing.

## Other adopted checks and finite binding

The 5783 three-factory shape, replace-only plugin option, absence of public
limits/DI, and private-session API role are root-approved. Their exact signatures,
validation, lifecycle, accounting, and bindings remain subject to a different
review against the sealed contract; no public query/session/limits API is added.

Version stdout is exactly `virtual-bash restricted YAML profile\n`: 37 UTF-8
bytes, SHA-256
`68ebf73287a74c37f4f2c532cb8f3e53a697b07982fbf2293bebb5e0e5b2b5bb`.
The unchanged exact help is 501 UTF-8 bytes, SHA-256
`97238372eed5e2358540baadbb7e5eac1c81d14dde163a1b7fd05d9048521f65`.
A different review must confirm those fixed help bytes list only supported
commands, flags, and restrictions accurately. Neither string claims native or
Mike Farah parity.

All 54 entries at `final-contract-v1/contract.json#/diagnostics/catalogue` are
adopted as the finite binding within its settled selection, status, framing,
reserve, fallback, and raw-failure rules. This adds no behavior. Root's anchor
reuse makes `ALIAS_DUPLICATE_ANCHOR` unreachable; it remains reserved, with code,
category, and status unrenumbered, until the different review reconciles that
obsolete condition. `INPUT_YAML_SYNTAX` still covers genuinely malformed
quote/escape/character grammar, not a narrow quoted-printable filter. No other
catalogue entry is removed, repurposed, or newly activated.

## Final handoff

A different YAML reviewer must now perform the pre-code freeze: exact grammar
and escaped-scalar cases; anchor-record/counter cases; the factory/private API
details; help-byte accuracy; catalogue reconciliation; and independent numeric
literal/range, depth, and Budget-mapping verification. Reading the sealed
numeric source reference is not that proof. Root may route that review, but this
leaf launches no reviewer and grants no code-go.

The separate length protocol at
`debfdd8b42930d8c5f1c0301897e4eeaa68e0979` still awaits Plato and is unchanged.
No interpreter, source, parser, runtime, plugin/index, export, test, dependency,
old artifact, or length artifact was edited. Source implementation, test,
product, native/reference, and dependency-change counts are all zero.
