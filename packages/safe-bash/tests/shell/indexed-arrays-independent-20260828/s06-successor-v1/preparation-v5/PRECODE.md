# Canonical composition admission repair — precode, 2026-08-28

Root authorized a narrow reviewer-harness repair after019f82b0. No new actual
candidate/build/compiler/layout run is authorized. That release remains spent;
old source/seals/receipts/grants stay unchanged. New code is additive in this
directory, within the independent reviewer scope only.

## Bound identities and mechanism

Keep candidate c0adae539c736db0e4023d401562ce958d9ebb00, derived composition
30f88590b66b88dc9694a56c85f1ee690f02218b,269 selected inputs, exact862 package
e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3 and the complete
33/22/16/P/AST/type/13-mutant scope. All original qualifications remain.

Stored baseline commit5137a74ec855a32d8a8860eb66b62eb44d11e290 has expected root
tree48e5ae39ce98e1c8e416bae77da40d88b75e1db5, already used by independent guard
candidate-v1/seal-admission-02.mjs (c290e6f1; SHA256
c1aeb7c00aed5c48050f13f5b4222acea37af08f9ba604df7e3bd069c641b02a).
That prior guard is a reference, not an executable to rerun (it has other
effects). Only its pure recursive grouping/serialization algorithm may be
copied as a reference. The new implementation will instead parse authenticated
flat ls-tree metadata and rebuild affected directory hashes bottom-up.

Source manifest bytes are bound to the existing SCOPE-BINDING-v2.json SHA256
ed7d15f4026bb81df52362956939236c7c5f04fb7285f6acc5f9e5ba803d84f3. Caller changes
cannot supply a replacement expected hash. Five literal stored source commits
are type-checked as commits. Per-commit selected path lists must exactly match
Git's ordered mode/type/blob/path records. All269 actual blob bodies must match
Git blob SHA1, SHA256, length and selected regular-file mode before build/import.

Read the stored base root's direct entries and recursively the src subtree's
metadata only. Reconstruct and verify all read tree hashes using canonical Git
ordering, modes, NUL separators, raw20-byte object IDs and tree headers. Preserve
unaffected root entries as opaque hashes. In particular AGENTS.md is only an
opaque mode/blob identity: never read/materialize its body. New source overlays
replace exact selected paths/modes; all untouched base entries remain. Final
composed root MUST equal the frozen30f identity; its presence in Git is not
required and no object is written. Do not substitute the projection-only tree.

## Finite metadata roles and budgets

Five commit type queries +one stored base commit/tree check +two base metadata
queries +five grouped source path/mode/blob queries +269 blob reads =282 Git
children for complete DATA admission. Actual future dispatcher additionally
reads one capsule =283 expected Git children. Unchanged300 Git ceiling and73
other children imply356 expected children, maximum373/374 including coordinator.
No cap increase:110-minute actual-run total including final cleanup/publication,
128MiB total capture,32MiB Git capture,512MiB work, concurrency1. No raw HEAD.

Metadata-only validation is separately bounded: one coordinator,282 expected
Git children/300 ceiling,180000ms including final publication/cleanup,10s per
Git child/16MiB per capture/32MiB total,64MiB retained DATA. It authenticates the
same Node22.22.2 and CLT Git binaries, uses the accepted whole controller and
known-reap rules, and never imports a candidate blob. Raw selected source bytes
may be recorded as DATA; no instruction-file body or whole history archive.
Executable source/tool seal must be committed before this metadata dispatch.

## Whole-admission DATA controls (presealed semantics)

One positive replays all282 authenticated metadata/blob responses. Each
negative changes one stated input, invokes the same whole admission entry,
requires refusal before its synthetic post-admission effect marker, and keeps
the original reason where the input throws. No product behavior is inferred.

| ID | Input / expected |
| --- | --- |
| C01 | All authentic inputs ->269 admitted sources, exact30f root |
| C02 | Caller changes manifest status ->reject before read |
| C03 | Selected metadata mode flip ->reject |
| C04 | Selected metadata path change ->reject |
| C05 | Selected metadata reordered ->reject |
| C06 | Selected metadata extra entry ->reject |
| C07 | Selected metadata missing entry ->reject |
| C08 | Selected metadata duplicate entry ->reject |
| C09 | Selected metadata blob ID change ->reject |
| C10 | Stored source object reports tag, not commit ->reject |
| C11 | Unknown base reference throws ->same reason; stop |
| C12 | Base root mode flip ->reject |
| C13 | Base root path change ->reject |
| C14 | Base root entries reordered ->reject |
| C15 | Base root entry added ->reject |
| C16 | Base root entry removed ->reject |
| C17 | Base metadata lacks terminal NUL ->reject |
| C18 | src directory object ID changed ->reject |
| C19 | Recursive base metadata missing descendant ->reject |
| C20 | Missing actual source blob throws ->same reason; stop |
| C21 | Same-size actual blob content flip ->reject |
| C22 | Actual blob length change ->reject |
| C23 | Selected source metadata claims directory ->reject |
| C24 | Actual blob replaced with invalid UTF8 bytes ->reject hash/size |
| C25 | Caller adds a self-authored expected manifest hash ->reject |
| C26 | Caller reorders selected input manifest ->reject before read |
| C27 | Caller inserts AGENTS.md selected input ->reject before read |
| C28 | Checkpoint throws before Git ->same reason; stop |

Independent reference/serializer controls T01–T08: empty tree; directory-slash
ordering vs dotted sibling; non-ASCII byte ordering; executable mode; opaque
AGENTS hash preservation; duplicate-name rejection; invalid mode/path rejection;
unknown or malformed object reference rejection. Literal input vectors and
their reference digests are sealed before running the new implementation.

Three finite loaded harness mutations: corrupt tree serialization (positive
must reject), bypass actual-blob validation (C21 must detect acceptance), bypass
fixed manifest byte binding (C02 must detect acceptance). Exact changed source
hash/load witnesses and designated predicates required, no loader-failure kills.
Positive companions precede/follow; no array mutants/product/native execution.
Synthetic replay coordinator180s,36 primary controls,3 loaded harness variants,
no real child processes or external callbacks. These are separate from282 Git
metadata children and never product passes.

Audit all remaining reachable runner/worker/type/guard imports for the same
derived-object lookup assumption. Historical standalone drivers remain frozen;
string identity comparisons are not Git object existence claims. New dispatcher
action execute-array-successor-v5 needs a fresh external root grant after
metadata/scoped review; none is created or exercised by this preparation.
