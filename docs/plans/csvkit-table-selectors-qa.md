# Table headers and selectors QA

1. Authenticate the csvkit 2.2.0 archive against the requested SHA-256 and read
   the helper, csvjoin and csvjson source call sites.
2. Reproduce exact signed-header matching failure in the original engine.
   Pin helper quirks before introducing generic table selectors.
3. Run in-memory domain regressions for alphabetic carry, literal quotes,
   Unicode digits, duplicate names, repeated selections, ranges, both open-end
   branches and offsets. Compare exact command stdout/stderr/status.
4. Have another agent stress the safe-bash adapter with injected capabilities;
   retain blockers for unimplemented Agate naming and geometry serialization.
5. Run maintained csvkit tests, workspace build closure and lint; run focused
   registered safe-bash tests and types after rebuilding domain declarations.
6. Inspect visual names output with an ad hoc screenshot. Purge owned temporary
   source/evidence under out after validation. Do not commit or publish.
7. Stress actual registered tools with Unicode decimal/digit/numeric names,
   empty/literal-quote headers, malformed ranges, names output across helper
   tools and alphabetic carry into aaa. Compare singleton invalid-name
   diagnostics separately for raw lists and Agate tuples, reproducing failures
   before correcting the shared engine. Check unchanged in-memory join inputs.
