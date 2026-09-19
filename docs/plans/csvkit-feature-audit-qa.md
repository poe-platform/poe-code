# csvkit 2.2.0 source audit QA

This procedure qualifies research artifacts only. It does not implement or certify
JavaScript command operations. Preserve all existing files and staging; do not
commit, push, publish, modify product code or add README content.

1. Read root guidance and scoped safe-bash guidance. Record Git status. Acquire
   the PyPI csvkit 2.2.0 archive in an exclusively owned directory under `out`;
   require SHA-256
   `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
   Verify every existing source-manifest record against extracted bytes.
2. Acquire dependency source archives using the existing authenticated artifact
   URLs/hashes. Parse Python sources with CPython 3.14.2 AST, retaining qualified
   names, declaration locations, ordered control flow, errors and file hashes.
   Review all fourteen mains and shared CLI/cleanup/filter/converter code.
3. Install the existing hash-locked runtime closures into owned isolated 3.14.2
   and 3.9.6 environments. The latter is an unsupported diagnostic comparison,
   not a supported 2.2.0 runtime claim. Introspect every parser with empty argv
   under the exact reference environment. Reconcile aliases, actions, defaults,
   groups, arity, required values and quoting choices with the existing register.
4. Inventory all fourteen RST references and fourteen shipped manpages, common
   arguments and the full changelog. Compare option mentions with current parser
   applicability. Read usage, prose and examples, documenting stale help and
   source disagreements separately from parser syntax.
5. Census test-prefixed function declarations, qualified by enclosing class and
   function. Keep decorators and static test assignments. Reauthenticate every
   prior declaration/file hash. Distinguish declarations from runner collection,
   parametrized cases, nested helpers and executions. Assign each declaration a
   named blocker unless an actual original canonical test or isolated operation
   QA mapping has been independently verified. Record absent reader test archives.
6. Inventory full license/notice/author files, SQL dialect modules and their
   driver import hooks, the eight converters, all thirteen statistics and count,
   JSON streaming/table paths and Python shell modes. Separate shipped adapters,
   installed drivers, external plugins and measured services.
7. Perform isolated native observations under each frozen environment, with
   piped byte stdin and separate byte stdout/stderr/status. Exercise empty count,
   names validation, repeated null arguments, raw streaming with no-header mode,
   zero-coordinate GeoJSON, empty SQL query results, no-header grouped stdin
   replay, required fixed schema and unsupported format/sheet combinations.
   Use only owned source fixtures or inline data; no live databases, network
   drivers, interpreter sessions or product commands. Capture argv/input/profile
   with each observation; unknown/unmeasured paths remain blockers.
8. Validate JSON structure, exact command/format/stat inventories, unique test
   identifiers, source hashes and artifact cross-links. Reduce observations and
   findings into `docs/csvkit` before deleting only this pass's owned scratch
   directory. Verify prior documentation/product bytes and staged changes remain
   untouched. No repository build, unit suite or screenshots are implied by a
   documentation-only research audit.

Results and limits belong in `docs/csvkit/feature-audit-20260917.md` and its linked
machine-readable inventories. Extraction tools are disposable research tools,
not maintained scripted QA procedures or product tests.
