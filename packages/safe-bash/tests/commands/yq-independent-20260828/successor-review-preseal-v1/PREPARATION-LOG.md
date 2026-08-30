# Static preparation history

Date: August 28, 2026

Owned scope is this new directory only. Old integration/runtime/consumer/actual
artifacts and foreign staging remain untouched. No product or proposed
executor/control/semantic/type/build code was imported or executed.

Static authoring failures, retained rather than erased:

1. An initial inline Node data-generation command failed parsing with
   `SyntaxError: Unexpected end of input`. It wrote no files and ran no jobs.
2. An in-memory data update addressed `SOURCE-PROOFS.json.rows` instead of its
   actual `designated` array. Earlier in-memory metadata changes in that command
   completed; the source-reference loop did not. The correct property was used
   in a later data-only update. No file or job was involved.
3. A large in-memory Markdown template failed parsing because backtick escaping
   was invalid (`No identifiers allowed directly after numeric literal`). That
   command did not execute. Markdown was subsequently authored with apply_patch.
4. The first static data checker invocation authenticated its selected Git bytes
   then failed because its inventory suffix omitted `recipe/`. The checker lookup
   was corrected; inspection also corrected frozen job key `id` and made overlay
   set comparison order-independent. No expectation or frozen fixture changed.

The sealed CMD-22 and artifact handoffs arrived before final freeze. Their exact
Git bytes and declared selected hashes/modes were authenticated read-only; no
adapter, predicate, fixture, extraction or validation module from those owners
was imported or called. The schedule includes one 30-second CMD-22 worker slot
for its 31 existing fixtures, increasing the draft from 334/23,595,000 ms to the
final 335/23,625,000 ms. This is explicit pre-execution proposal accounting, not
a reset, retry or extension of the consumed35da run.

Only static JSON/count/reference/hash/diff/specification checks are performed.
Their results belong in STATIC-CHECKS.json. They provide no product, semantic,
loaded-mutant, type, control or independent-review pass credit. Active owned
product/executor/control children: zero.
