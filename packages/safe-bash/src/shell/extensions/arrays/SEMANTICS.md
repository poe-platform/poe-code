# Indexed array-key expansion

`arraysExtension()` explicitly enables `${!name[@]}` and `${!name[*]}`.
It declares `syntax: { arrayKeys: true }` and the matching runtime identity;
it installs no builtins. The default shell neither imports this leaf nor enables
these expansions. This is an indexed-key increment, not full Bash array support.

## Capture and composition

The shell captures syntax before its first parse, without reading legacy name,
factory or runtime-identity fields or creating instances. Legacy field capture
and validation remain after successful initial parsing, input preparation and
readiness/environment validation; all definitions are checked before any factory.
An extension's syntax getter is read once per execution. Its declaration
is validated and frozen; factory mutations cannot change subsequent parses or
forks. Different extensions may declare the same capability: the union enables
it once. Duplicate extension names and duplicate builtin names remain errors.

The capability must be an own, positive `arrayKeys: true` data property in a
plain declaration object. Unknown properties, accessors and false/nonboolean
values are rejected. Runtime extensions cannot activate the parser's separately
declared `&`/`!` syntax: background jobs are not implemented by this increment.

Captured syntax follows incremental execution, eval, source, function bodies,
interpreters, script files, command substitutions, heredocs and shell-input
units. Forks retain the captured definitions and normal instance lifecycle.

## Values and resources

Keys come from the canonical indexed binding in numeric order, including sparse
indices up to 4294967295 admitted by the incremental writer. A set scalar has
key `0`, including an empty scalar; an unset variable or empty indexed binding
has no keys. Enumeration does not mutate cells, readonly attributes or local
scope restoration. Ordinary assignment bounds are unchanged.

Quoted `@` expands to separate fields; quoted `*` joins using the first IFS
character (first byte in the C profile). Unquoted forms obey Bash's key-specific
joining and splitting, including empty and non-whitespace IFS. Empty IFS gives
unquoted `*` a space-joined field but quoted `*` an unseparated join. Scalar
assignment/here-string contexts have separate native-tested `@` joining rules.
Heredoc key expansions join with spaces regardless of IFS. Literal quotes in
heredoc bodies remain literal. Mixed scalar/member/key heredoc fragments retain
canonical bytes through budgeted concatenation. Raw IFS bytes survive ordinary
expansion and here-string construction without conversion through replacement
characters. Text-only heredocs retain the existing small-input allocation path.

Enumeration, ordering, copied values and output use the existing shared array,
value and output ledgers. Root cancellation and awaited extension cleanup retain
their existing precedence. There is no host-shell execution in the implementation.

## Qualification boundary

The source tests use an explicitly selected and SHA-256-authenticated GNU Bash
5.2.37 oracle. Native-only comparisons skip when both oracle prerequisites are
absent; supplied invalid prerequisites fail. Host-independent checks still run.
Native here-string/heredoc witnesses define a bounded shell `emit` function in
place of the test VFS byte-copy command; the expansion fixtures are unchanged.

General indirection, associative arrays, wider ordinary assignments, additional
array grammar, control-name changes and jobs remain outside this increment.
The separate optional build exports `arraysExtension()` from its optional entry.
Compiled-consumer tests verify matching public runtime identity. Default builds
exclude this leaf, and both workspace and root package inventories exclude its
artifacts and the optional entry. This does not establish a published optional
package. Mapfile/read leaf integration remains separately coordinated work.
