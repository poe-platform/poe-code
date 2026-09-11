# Inherited private-name validation

Guest eval needs to validate references against the caller's private environment.
The validator currently starts without any outer declarations, which rejects
such references even when the caller's class has declared them.

Accept an optional read-only set of inherited names and copy it into an outer
validation scope. Keep ordinary parsing unchanged, keep each nested class's
declarations local, and never mutate the supplied set. This changes validation
only; it does not itself expose eval or grant access to private field values.

Use a native direct-eval example and ASTs parsed from real class source to check
inherited references, absent/incorrect contexts and unchanged input sets. Run
private-class parser regressions, TypeScript and focused lint before committing.

Evidence: the inherited-reference test fails with the original validator while
the two isolation controls pass. After adding the context, all 86 focused tests
pass across private-name, private-class, eval grammar and eval budget coverage.
TypeScript and focused lint pass. This is an independent parser prerequisite;
the guest eval intrinsic and runtime integration are still pending.
