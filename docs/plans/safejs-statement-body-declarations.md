# Unbraced statement-body declarations

Native comparisons validated accepted invalid function, class and lexical
declarations in unbraced statement bodies. Six matrix groups failed initially;
five controls passed. The matrix covers seven body contexts and six declaration
forms, plus native execution of valid if-function and var/block controls.

Statement-body parsing now rejects declarations that require a statement-list
position. Non-strict ordinary if-functions retain their existing explicit
legacy path; strict, async and generator if-functions remain rejected. Var
statements and declarations inside blocks remain valid. This general check
also preserves the newly tested prohibition on labeled functions as unbraced
bodies.

All 50 focused declaration/labeled-function/legacy-block tests passed. Package
TypeScript passed. The broader parser/runtime suite passed 1,432 tests (one
skipped); focused lint remains required.
The redundant with-body check was removed because the shared rule covers it.
This change is outside the frozen isolated
SafeJS unit run. Pushes and releases remain paused.
