# Strict reserved identifier references

Native comparisons validated that strict references to implements, interface,
package, private, protected, public and static were incorrectly accepted.
The initial regression run failed seven rejection groups and passed nine
controls.

Identifier reference validation now observes the active strict grammar in
ordinary expressions and object/destructuring shorthand. Strict eval and
arguments references remain valid; non-strict future-reserved identifiers and
explicit property/member names are retained. Binding-specific restrictions
on eval and arguments are separate from reference eligibility.

All 16 focused regression groups and package TypeScript passed. The broader
parser/runtime suite passed 1,370 tests (one skipped); focused lint passed.
This followup is outside the
currently frozen isolated unit run. Pushes and releases remain paused.
