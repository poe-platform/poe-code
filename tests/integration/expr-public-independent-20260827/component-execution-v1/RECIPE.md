# Independent expr component execution v1

Authorization label: August 28, 2026. Original August 27 chronology is unchanged.
Latest root authority approves only the a0142c77/d4c894e9 component profile.
Accepted-DU75, original acceptance-gated consumer, HTML34, and whole76 remain HELD.
This recipe supersedes only the addendum's proposed P01 artifact reuse: P01 now
requires an independent build of all authenticated 357 selected Git inputs and
exact wholepack c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd.
An independently authenticated authorpack can support runtime evidence after a
failed build, but never a P01 pass. No engine audit, DU/HTML/TAP run or broad gate.

## Freeze and inputs

Run prepare.mjs read-only against candidate/tool inputs before committing this
entire explicit new file set. Preparation writes only owned manifests/adapters;
it does not build, import product, execute a consumer, or run controls. Preserve
preparation failures. Run run.mjs once only after an explicit-path freeze commit.
The runner verifies every recipe byte against that commit before execution.

Complete selected tree names, modes, blobs and SHA-256 come from the authenticated
handoff and are rederived with scoped git ls-tree/show, never a whole archive.
AGENTS entries are refused, never materialized or followed. Every source entry
must be a regular 100644 blob. Fresh materialization uses exclusive writes,
no symlinks, explicit modes and recursive pre/post manifests including new names.
No missing-input extension is permitted in v1; a versioned complete closure proof
and another freeze would be required. Runtime tooling is Node22/24, TypeScript,
Node types, undici types and npm; all tool files/modes and skipped npm .bin links
are authenticated. Only declared npm .bin symlinks are omitted from the copied
tool closure (direct npm CLI, no scripts or subprocess commands). No network,
runtime dependencies, ambient credentials, package installs or tool downloads.
Full tarball extraction is the equivalent of an offline dependency-free install:
all 834 authenticated regular members, not selected dist files.

## Adapter and qualification

consumer-component.mjs is the original consumer with exactly one replacement:
the false accepted-DU predicate becomes the explicit HELD component predicate.
All original case bodies/assertions, fixtures, variants and type fixtures remain
byte-identical. Per-case child isolation selects one exported fixture; it does
not edit its body. R01-R24 use that adapter. R25/R26 implement the frozen protocols.
The exact declared author observer and silent worker are copied, not its shellRun
helper. The independent guards bind every actual loaded file/hash, including
worker loads. Controls precede affected runs; a failed qualifier blocks its cases.

R25: ordinary positive before the 50/1000/max1 silent-startup case; exact status3,
empty output, expr diagnostic, online/zero ready/zero requests, product exit
before EXEC-only marker; disposal occurs only after that assertion.
R26: ordinary and held-reply release/withhold controls first. Two separately
signalled invocations use one real max2 definition; both genuine replies must be
held before cancellation. Direct reason identity, product retirement, concurrent
idempotent cleanup and live sibling are asserted. Repeat through real Shell and
agentCommands with two shell instances so disposing the first does not dispose
the sibling's owner. Each shell has its own command instance; direct boundary
is the shared-definition assertion. No observer terminates product workers.
Only transport-pending work is claimed, never CPU-computing cancellation.

Controls cover root export removal, subpath denial/restoration, existing-source
poison unguarded qualification then guarded denial, required worker module removal
then restored positive, six individual type-directive removals, combined six
diagnostics and broken expr declarations. Source poison is an owned source-path
sentinel, not a user source modification. Compiler traces must identify the
installed expr/root declarations. Actual child Node permissions permit only its
consumer and declared tools, not build/source/original moved paths. Negative
unguarded source poison intentionally omits that fence to prove execution.

15-second process bound, 120-second per runtime/layout context, 1 MiB total
captured output per child. Natural exit is separate from supervisory termination.
All first failures and unrun IDs are retained, no retry-to-green or product edits.
Build/source/tool/install manifests are checked for new entries as well as changed
bytes/modes. Generated work is retained under ignored work/; raw receipts,
manifests, tarball bytes (base64) and final reports are explicitly committed.
The nine original files and five admission files receive read-only checks only;
these checks and fixture validation never count as product passes.
