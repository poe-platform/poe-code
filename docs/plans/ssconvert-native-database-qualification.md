# Native database qualification

This manual procedure qualifies the Gnumeric 1.12.61 GDA plugin against an owned SQLite database and the public ssconvert host-query boundary. It does not qualify the frozen Linux optional profile, a general SQLite adapter, or an unmodified headless native CLI. Current results and source identities are in `docs/ssconvert/gap-resolution.json#reference.databaseLive`.

## Procedure

1. Authenticate the Gnumeric 1.12.61 and libgda 6.0.0 release archives against the ledger hashes. Build libgda with GTK UI in an isolated `out` prefix. Use Meson with `ui=true`, `experimental=true`, and `json`, `libsoup`, `sqlcipher`, `ldap`, `web`, `tools`, `help`, `doc`, and `examples` disabled. Keep library and plugin runtime source unchanged.
2. For Darwin, relocate the isolated Vala, introspection, ISO data and GTKSourceView tooling. Include Homebrew's `share` directory in `XDG_DATA_DIRS`. Translate the three generated Ninja GNU `--export-dynamic` flags to Darwin `-export_dynamic` and resolve the generated GTKSourceView library path. Build and install. These are build adaptations, not a stock Linux reference build.
3. Compile the original `plugins/gda/plugin-gda.c` against the existing native Gnumeric, libgda and libgda-ui. Use the authenticated private `gnm-i18n.h` and `dead-kittens.h`, the installed `gnumeric-features.h`, and the original `gnumeric` gettext domain. Generate untranslated manifests from the original XML templates. Load the module through `GNUMERIC_PLUGIN_PATH`. The native `--lib-dir` option did not select this overlay.
4. Give GDA an isolated provider directory through `GDA_TOP_BUILD_DIR`. On this Darwin build its scanner expects `.so`: use owned symlinks to the real SQLite provider dylib and Homebrew SQLite dylib, with `LD_LIBRARY_PATH` identifying the latter. Do not modify the library implementations. Initialize `GdaConfig` with explicit owned `user-filename` and `system-filename` properties before any default config construction. Use memory-backed GSettings and the native schema directory.
5. Create the table and row below using SQLite. Define the `ssconvert-owned` DSN with provider `SQLite`, `DB_DIR` pointing to the owned directory and `DB_NAME=fixture`. Independently query the table through GDA and capture each actual GValue type before invoking the plugin.
6. Initialize Gnumeric with GTK enabled and activate `Gnumeric_gdaif`. In an owned native capture process, use `function_call_with_values` on the original plugin. Observe its real `Database Connection` dialog; capture and inspect its window before sending the ordinary accept response. Do not replace the dialog, connection routines or result conversion. Run the queries below and record scalar types, values and attached formats. Repeat with the 1904 workbook epoch, rejecting the first dialog and accepting the next. The initial rejection must return the connection error; later calls must reuse the accepted connection.
7. Inspect actual database file descriptors before acquisition, while connected, after `go_plugin_deactivate`, and after `gnm_shutdown`. Independently reopen the database to inspect effects. Reset the owned fixture before the candidate run. The native write probe is permitted only on this disposable fixture.
8. Run public `createEngine().convert` with `createDatabaseFunctions` and an explicit `node:sqlite` host closure using `DatabaseSync(..., { readOnly: true })`. Register cleanup with `host.context.own` before acquisition, cache only within that context, and close before settlement. Use SQLite's parsed `sourceSQL` boundary to reject the second statement before execution. Refuse non-selection statements before execution. Convert this cohort using the metadata and observed mapping below; this fixture closure is not a shipped or generally qualified database adapter.
9. Compare complete scalar values and number-format strings under both epochs. Exercise both normal completion and cancellation immediately after the first query: cancellation must publish zero bytes and release the connection. Independently attempt a write through the candidate SQLite read-only connection and confirm refusal and unchanged row count. Preserve the deliberate read-only policy difference from native.
10. Record compact results and remaining scope in the ledger. Purge owned sources, binaries, fixtures, logs and screenshots after inspection. Do not commit raw capture helpers or generated evidence.

## Fixture and checks

Table `typed` has these columns, in order:

| Column | Declared type | Input | Observed native GValue / spreadsheet value |
| --- | --- | --- | --- |
| i | INTEGER | 42 | gint / number 42 |
| s | SMALLINT | -123 | gint / number -123 |
| big | BIGINT | 9007199254740993 | gint64 / exact decimal string |
| r | REAL | 1.25 | gdouble / number |
| f | FLOAT | 2.5 | gdouble / number |
| b | BOOLEAN | 1 | gboolean / TRUE |
| d | DATE | 2024-01-01 | GDate / 45292 or 43830, format `[$-f8f2]m/d/yy` |
| t | TIME | 12:34:56 | GdaTime / 0.5242592592592593, format `[$-f4f2]hh:mm` |
| ts | TIMESTAMP | 2024-01-01 12:34:56 | GDateTime / blank in this profile |
| n | NUMERIC | 123.45 | gdouble / number |
| txt | TEXT | hello, newline, world | gchararray / unchanged string |
| bin | BLOB | bytes 00 01 FE | GdaBinary / literal `\000\001\376` string |
| nil | TEXT | NULL | GdaNull / blank |

Call `EXECSQL` with `SELECT * FROM typed` twice, then `READDBTABLE` with `typed`. Follow with an empty selection, a missing table, `SELECT 1; SELECT 2`, the owned `DELETE FROM typed` probe, and `SELECT count(*) FROM typed`. All function calls use the owned DSN and empty username/password.

Observed on 2026-09-25: the first native run used one dialog; the rejection/retry run used two. Database handles were 0 before, 1 connected, 0 deactivated and 0 after shutdown. The native 1900 write probe deleted the row, then returned `Statement is not a selection statement`. An independent SQLite read confirmed zero rows. Source `libgda/sqlite/gda-sqlite-provider.c:1216` opens with `SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE` despite the requested GDA read-only option. This behavior must not be copied into the host contract.

The public SDK matched 42 native scalar/error observations per epoch. Four additional checks covered the write refusal and preserved count across both epochs. All four SDK operations opened and closed one real SQLite connection; the two cancellation operations published no bytes. The normal operations exercised eight formula requests each. The owned native dialog screenshot was inspected. No product code changed for this qualification.

## Remaining work

Qualify the exact isolated Linux optional profile and plugin inventory; wider database providers and GValue types; malformed/date/time/encoding/boundary results; authentication, transactions and cancellation during real work; public CLI/Shell and installed-package execution with live adapters; and publication. The synchronous fixture closure does not prove preemption of an in-flight database query. Preserve the distinct native headless first-connection limitation. The broad database family remains open.
