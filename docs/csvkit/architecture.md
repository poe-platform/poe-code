# JavaScript engine boundaries

This is a proposed implementation contract, not an implemented SDK or a public
availability claim. packages/csvkit owns the domain engine. safe-bash owns the
command-family adapter, registry collision policy and host capability wiring.
Root package/export integration remains with the root integration owner.

The public execution/configuration specification is
[sdk-config-contract.md](sdk-config-contract.md). It defines proposed names,
ownership, operation settings and capability obligations without changing the
existing parser exports. [architecture-provenance.md](architecture-provenance.md)
records the source and repository inspection supporting these decisions.

The domain workspace owns grammar, codecs/dialects, typed tables and Decimal,
operations, JSON/GeoJSON/fixed/DBF/Excel adapters, SQL schema/dialect compilation,
query execution, database drivers and the Python REPL library bridge. Root CLI
and core only compose these packages. The fourteen names remain independent
executables; registration does not introduce a csvkit subcommand dispatcher.

## Invocation and SDK

The engine invocation takes an exact original executable name, owned raw argv
bytes and an explicit context. The context contains cwd, a virtual filesystem,
stdin byte source with default-input provenance, explicit terminal metadata,
awaited stdout/stderr byte sinks, exported environment, codec/locale/clock
services, cancellation, cooperative cleanup registration and finite budgets.
The SDK operation path takes typed validated settings into the same domain
operations; the argparse boundary alone owns argv errors and source quirks.

Copy retained byte fragments before advancing input. Admit sizes before copying
argv, decoded strings, tables or outputs. Await sink backpressure. Register
cleanup before acquiring iterators/codec/database/interpreter resources, close
admission during cleanup and share idempotent completion between finally and
host-triggered cleanup. Cancellation retains its provenance and partial effects;
it must not become an argparse error or an ordinary diagnostic status.

One declarative module per command specifies grammar, help/defaults, applicability
and the actual operation. One module per input/database provider specifies its
matching metadata and adapter. Derive inventories and dispatch from these
descriptors; adding a provider must not require provider-ID branches elsewhere.
Do not define placeholder commands that report success without doing their work.

## Reuse decisions from current public APIs

* The xan Scanner takes a byte delimiter and xan subcommand dialect. It has
  command-specific malformed quoting/CR handling, skips blank records and tracks
  byte limits. CPython CSV needs Unicode characters, physical lines, blank rows,
  quoting modes and character limits. Its reader is not selected for reuse.
* Xan selector accepts complement/prefix/suffix/occurrence selectors and negative
  indices; csvkit uses different numeric/name/range rules and diagnostics. Do not
  reuse that grammar or change its sealed historical tests.
* Xan Writer handles raw byte provenance, BOM quoting and byte delimiter rules.
  Its implementation emits CR bytes unchanged despite CR affecting raw reuse.
  Agate normalizes embedded CR to LF before serialization. Do not assume writer
  equivalence or import the internal writer as a public domain dependency.
* office-package publicly exports createZipCodec, createCompressionCodec and
  their bounded runtime/byte-source contracts. ZIP and gzip/raw-deflate can be
  qualified for reuse through those exports. It provides neither XLS BIFF nor
  openpyxl cached-cell interpretation, and its compression modes do not include
  bzip2, xz or zstandard. Those require dedicated qualified adapters.
* packages/ssconvert does not exist in this checkout. Its separate plan is not a
  dependency. Excel requires its own cached-value decoder or a real qualified
  public reader; it must not use formatted/recalculated Gnumeric values.
* safe-python exports PythonSession with budgeted synchronous exec/eval, input,
  output, warning callbacks and session-owned namespace/value handles. Inspection
  shows internal codec-library import support, not a public arbitrary module
  registration/library bridge. Its public options do not inject Agate objects,
  code.interact or IPython. Existing exports do not qualify csvpy. A real
  JavaScript Python-object/library port is still required; no CPython fallback.

## Selected database engine boundary

The current domain binding is explicitly initialized SQLite WASM 3.50.4,
selected through `createSqliteDatabaseProvider`. SQLite itself executes queries,
transactions and row iterators. Its source ID matches the primary reference;
its build flags do not. See `docs/specs/csvkit-sqlite.md` and the captured build
profile for configuration, actual VFS guarantees and explicit parity blockers.
The earlier Node 22.22.2/SQLite 3.51.2 memory probe remains historical evidence,
not the selected current product engine or a complete adapter qualification.

Persistent files require a SQLite engine with an authorized VFS or a deliberately
tested snapshot import/export protocol with explicit weaker guarantees. A host
filename passed to DatabaseSync is not an authorized virtual filename. Keep
network dialect compilation separate from connection transport. Drivers receive
explicit URL/endpoint/credentials through host capabilities, with no ambient
credential lookup or extension loading. Database write settings must support
create/no-create/create-if-not-exists/drop/overwrite/constraints/unique/prefixes,
hooks, batching and commit/rollback. Driver absence and host policy refusal are
observable divergences, not passes.

## Configuration and bounds

The selected SQLite WASM binding accepts an authorized synchronous random-access
VFS. Its supplied memfs adapter measures volume-lifetime persistence, rollback,
in-process lock contention and failure/authorization effects. This is not disk
durability, host filesystem atomicity or arbitrary SQL parity. Limits account
SQL/value/row/file bytes and VM work, without claiming a total WASM memory cap.
Network drivers remain explicit trusted capabilities.

The regex-execution public API exposes grep/rg/glob descriptors and bounded
workers, with separate ERE/BRE/expr profiles. None declares CPython re semantics.
Do not send csvgrep patterns through those grammars unchanged. Worker admission
and cleanup patterns may inform a domain-owned Python-regex service; syntax,
Unicode classes, flags, captures, search and errors require their own profile.

Configuration owns the selected frozen runtime profile, codec and locale
providers, clock, terminal metadata, database/interpreter capabilities, cleanup
and finite work/byte limits. Bounds cover raw input/output/argv, codepoints,
physical lines, rows/columns, retained table memory, joins/sort, regex work,
Decimal coefficient/exponent/work, ZIP members/inflation, SQL/result streams and
REPL sessions. Bounds are host/SDK settings, not invented compatible CLI flags.

The exported PYTHONIOENCODING value affects the compatible parser/input defaults
and output codec profile. Other process locale/timezone/terminal state is supplied
by services, not read from ambient global state. Database environment/credentials
are not inherited implicitly. Safe-bash should retain empty runtime dependencies
where possible; any qualified numeric/codecs/SQL dependencies belong to the
domain package and its explicit build closure.

README content must remain unpublished until permission for the concrete
usage/config/env draft. No product files or root integration have changed during
this architecture research. Engine selection is provisional until complete
semantic, transaction, VFS, cancellation and consumer qualification.
