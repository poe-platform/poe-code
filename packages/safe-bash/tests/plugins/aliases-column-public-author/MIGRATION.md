# Intentional registry fixture migration

The root-approved addition of egrep, fgrep and column changes the explicit
current name set from70 to73, and the custom-command replacement total71 to74.
Only these named additions/counts and the second registry test's title change.
Expected names remain independently enumerated, never derived from actual output.
No command behavior, workflow assertion or historical evidence is altered.

The prior fixtures and historical70-command results remain available at
0123c83d3aae72a15621acbb29a165b97b2c6ab6 and the frozen8670 package evidence.
This is a test migration accompanying new root integration, not a product bug fix
or a rescore of historical gates. Runtime/type acceptance is reported separately.

Two maintained public consumers explicitly routed by qualified-current-release
inventory also change70 to73: stream-five public-options and stream-inspection
consumer. The latter keeps its explicit ordered tail and appends only the three
new names. The current stream-inspection canonical public test changes only its
total/title. Existing workflows, type assertions, native data and historical
70-name captures remain unchanged. Attempt02 exposed two incompletely migrated
stream-inspection tests (61/63): the explicit tail and both custom-command
replacement totals also require the same three-name addition. Those exact
assertions now include egrep/fgrep/column and74 respectively; attempt02 remains
failed, with no package phase inferred. Old version-bound public audit fixtures are
not globally rewritten by searching for every occurrence of70.
