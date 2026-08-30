# Immutable prereplay supplement

Recorded 2026-08-27 before the first candidate import/execution by this executor.
Authority is the fresh leaf assignment: root reports session17223 EXIT0,
prep93709 EXIT0 and binder82828 EXIT0, and delegates independent build/import
closure authentication to this executor. This is not a claim that root performed
that authentication. The exact exit timestamp was not supplied; do not invent it.

Independent pre-import authentication passed for both sealed candidate trees:
213 source, 15 test, 708 compiled files, 358 compiler inputs, 60 tool files,
12 restoration inputs, four configs, Node/compiler identities, API, contract,
26 captured run hashes, and every root-pinned ready/binding/manifest hash.
The original binding driver has a stale TMP-prefix restriction and requires root
to assert import-closure qualification which the assignment explicitly delegates
here. Round 1 changes only those provenance/location gates and permits separately
labeled diagnostic observation of unresolved records. No product semantics change.

## Public-profile qualification

S07 both records: nested `{kind:"value",value:{exitCode:141}}`, diagnostic empty.
S08 stdout-body-and-required-header-file: the same nested result and diagnostic.
Basis: S1 preserves existing public semantics; the authenticated inherited v1
curl catch/final return maps EPIPE to closedOutput/141 without a CurlError
diagnostic; literal context.invoke returns the command result. This is bounded
review of inherited error/invocation semantics, not inference from executing S1.

S11 caller-abort-before-late-io-rejection: public `{kind:"error",error:0}`;
operation `{aborted:true,reason:0}`. Basis: the frozen barrier waits for operation
abort before injecting late IO, S1 says first operation reason wins, and inherited
caller-public precedence preserves reason identity including zero. Exact frozen
script remains `set -o pipefail; precedence-probe | cat`.

S11 io-error-before-caller-abort remains BLOCKED. Frozen criterion says
"Cleanup must not mask an established failure"; proposed CONTRACT says
"An explicit finally close can replace a prior thrown error; close is not an
exception-precedence combinator." The IO fixture's finally may begin normal close
before caller abort; the declaration does not fix listener-detachment timing or
an operation reason for a failure merely thrown by command code. Public caller
rejection zero is separately bound; first-operation profile is not invented.

S08 required-body-file-and-stdout-writeout and
required-files-writeout-and-independent-stderr remain BLOCKED. Freeze requires
"required body-file, header-file, and writeout work" and "positive byte/content/status
observations, not merely missing abort flags." Proposed CONTRACT says
"stdout header/body/writeout publication remains separately scoped." Neither
establishes that a sink write attempt after its consumerClosed signal is the
required witness. No closed-sink delivery is demanded, no stdout writeout is
rerouted to stderr, and required file/header checks remain active in diagnostics.
Missing positive writeout evidence is not silently accepted as a pass.

Thus 17/20 parameter bindings are qualified, three remain strict BLOCKED;
all 12 logical cases/20 records are retained. Unresolved records run diagnostics
with their unchanged command/barrier, collecting actual public/closed/stage/byte
observations without converting them into passes. No extra logical records.
Diagnostic failures are reported separately from strict blocked acceptance.

Source/API/author tests/frozen inputs remain immutable. Original5 retains exact
assertions, commands, barriers, 1200ms inner and 3000ms/1MiB outer bounds. New5,
historical57+9 (including synthetic C9), and author-reference counts stay separate.
