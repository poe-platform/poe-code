# Strict destructuring object-environment bindings

Native comparison reproduced array and object defaults deleting their target
global binding. Strict JavaScript throws ReferenceError and leaves the binding
absent; the local dynamic-runtime work recreated it with the assigned value.
The initial regression run failed both identifier-target cases and passed the
two property-target and two non-strict controls.

PatternContext now carries strictness. Identifier assignment to a retained
object-environment reference checks that the binding still exists before a
strict write. Member-expression assignment remains ordinary property writing,
and non-strict identifier assignment can recreate the property. Existing
reference serialization is sufficient: bindIdentifier already distinguishes
identifier references from member-expression targets after restoration.

The focused interpreter/pattern/global-object/with/assignment run passed 143
tests. Snapshot tests suspend both identifier and member defaults at yield,
then verify original and restored execution. Snapshot checks, TypeScript and
lint are pending. The already-running isolated root validation does not
include this follow-up; keep its evidence separate and verify the follow-up
before delivery. No release is claimed for this local fix.

The snapshot/reference-validation run passed all 16 tests, including original
and restored execution for the new cases. Package TypeScript also passed.
Focused lint passed. The frozen candidate is intentionally unchanged
while its root checks execute.
