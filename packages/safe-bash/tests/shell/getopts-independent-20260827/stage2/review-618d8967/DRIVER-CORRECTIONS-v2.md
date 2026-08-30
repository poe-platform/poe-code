# Driver correction v2, before public-control execution

The initial committed public driver `16e6b988` used a nonexistent registry
`names()` method. Inspection of the actual committed declaration showed
`list(): readonly CommandDefinition[]`; use `list().map(command => command.name)`.
This is a reviewer API-shape defect caught before public-control execution, not
a product failure, a killed mutant or a relaxation of the no-getopts-plugin check.
The original driver remains in Git. PREPARATION-01 also corrects the prose count
of explicitly created empty directories from nine to eight; the enumerated
cleanup operation was already eight nonrecursive rmdir calls plus the parent.
