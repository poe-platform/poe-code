# Indexed array keys, element operators and readonly declarations

`arraysExtension()` explicitly enables `${!name[@]}`, `${!name[*]}`, literal indexed
element `-`/`+` operators and indexed readonly declarations. It declares
`syntax: { arrayKeys: true, indexedElementOperators: true, indexedDeclarations: ["readonly"] }`
and the matching runtime identity; it installs no builtins. The default shell neither imports
this leaf nor enables these capabilities. This is not full Bash array support.

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

Indexed readonly support is a separate own data capability. Its declaration list
must be dense and contain only the single known head `readonly`; holes, accessors,
extra keys, duplicate heads and unknown heads are rejected. An absent or empty
list is omitted from the captured object. Naming an extension `arrays` or
declaring only `arrayKeys` does not enable indexed readonly declarations.

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

## Literal indexed element operators

The separate own, positive `indexedElementOperators: true` capability admits
`${name[1]-word}` and `${name[1]+word}` for existing literal-index selectors.
It follows the same capture and fork rules. An extension name, keys capability
or readonly declaration alone does not enable these operators; they remain
invalid in the default shell.

Non-colon `-` expands its operand only when the element is unset; `+` expands it
only when the element is set. Set-empty counts as set. Operands are lazy and
retain internal quoting, nested expansions and canonical bytes. Lookup uses
existing scalar/indexed bindings and index/value/allocation limits without
mutating the binding. Colon, assignment, error, pattern and substring operators
on elements, member/key operators, arithmetic/dynamic subscripts and associative
arrays are outside this increment. Ordinary assignment bounds remain unchanged.

## Indexed readonly declarations

The explicit capability enables `readonly -a` and indexed declaration listing.
Declarations use the existing canonical binding storage, readonly attributes,
local restoration, byte ownership and shared allocation limits.

Direct compound declaration operands are assignments during expansion. In the
qualified non-errexit input profile, attempts to overwrite a readonly binding
through those operands skip the remainder of the current command list; later
input units can continue. This is not an unconditional whole-script exit.
Quoted compound operands instead retain builtin argument handling and its
nonfatal failure behavior. An already-readonly scalar retains its scalar kind
when `readonly -a` is subsequently applied without an assignment. Rejected local
indexed shadows retain the `local:` diagnostic provenance and the outer binding.
These distinctions do not enable associative declarations or relax the existing
control-name, exported-binding or ordinary-assignment restrictions.

## Qualification boundary

Key-expansion source tests use an explicitly selected and SHA-256-authenticated
GNU Bash 5.2.37 oracle. Native-only comparisons skip when both prerequisites are
absent; supplied invalid prerequisites fail. Host-independent checks still run.
Native here-string/heredoc witnesses define a bounded shell `emit` function in
place of the test VFS byte-copy command; the expansion fixtures are unchanged.

Readonly qualification uses preserved GNU Bash 5.3 captures and separately
authenticated native reviews, including raw output bytes and exit status. Those
profiles do not replace the older key-expansion evidence or establish full Bash
array compatibility. Compiled public replay and independent review are separate
acceptance requirements.

Literal-element tests retain authenticated Bash 5.3 observations without new
native launches. Wait23 compares unchanged guest source/stdin with recorded
stdout/stderr/status in its C locale profile. Wait17 retains its guest source
inside an explicit owned VFS `{ ...; } 3</gate3 7>/control` descriptor envelope
with the recorded `WAIT_READY` gate payload. This is an IPC adaptation, not
identical native invocation, kernel scheduling or wait-entry timing. Neither
case upgrades the historical observation capsule to a general deterministic
golden or establishes full array/wait parity; jobs still require their separate
extension. Independent review and compiled/public acceptance remain separate.

General indirection, associative arrays, wider ordinary assignments, additional
array grammar, control-name changes and jobs remain outside this increment.
The separate optional build exports `arraysExtension()` from its optional entry.
Compiled-consumer tests verify matching public runtime identity. Default builds
exclude this leaf, and both workspace and root package inventories exclude its
artifacts and the optional entry. This does not establish a published optional
package. Mapfile/read leaf integration remains separately coordinated work.
