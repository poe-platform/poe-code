# Null-prototype data snapshots

Named RegExp capture groups exposed a concrete checkpoint failure: explicit null
object prototypes were rejected as unsupported prototype links. Preserve these
ordinary data objects through runtime snapshots, public dumps, replay graphs, and
internal clones using an optional, strictly validated sandboxNullPrototype marker.
Older data without the marker keeps its prior semantics. Structured cloning still
produces ordinary object prototypes; arbitrary custom prototype graphs remain out
of scope for this atomic improvement.

Validate cycles, single-use objects, corrupted marker values, structured cloning,
and named-capture checkpoint aliases. Run maintained SafeJS tests, lint/types, build,
and the named-groups integration harness with a viewed CLI screenshot. Commit this
reusable prerequisite separately from named-group support and push each to main.
