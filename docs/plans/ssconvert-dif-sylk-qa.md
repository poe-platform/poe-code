# DIF and SYLK codec verification

Execute these steps as an agent; native utilities are a separate QA oracle.
Do not push, publish, edit READMEs or alter unrelated work.

1. Authenticate Gnumeric 1.12.61 archive SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Read released DIF and SYLK sources only under `out`. Capture actual oracle
   executable, dependencies, plugin inventory, locale and timezone.
2. Before implementation run original in-memory SDK regressions for DIF typed
   records and SYLK ID probing, sparse cells, styles and R1C1 formulas. Preserve
   failing evidence. Unit filesystem effects use memfs; no native children.
3. Audit header/data records, retained coordinate state, limits, value inference,
   quoting, escape sequences, dimensions, terminators and malformed diagnostics.
   For SYLK include C/P/O/F/W/NN/B/ID/E, matrix records, reference grammars,
   name placeholders and ignored fields. Test actual sheet scope and charset
   behavior independently of descriptor registration.
4. Implement declarative provider handlers in ssconvert using the shared engine,
   injected I/O, budgets and cancellation. Compare small original fixtures with
   native imports to XML/CSV and exports; cross-import both output directions.
5. Build the candidate, then assign a different agent to stress/fix codecs and
   command behavior with TDD. Root retains integration/export/Git ownership.
6. Run uncached selected workspace build, maintained package test/lint, and Safe
   Bash command checks covering SDK/CLI bytes, diagnostics, status, cancellation,
   namespace effects and replay. Record the scope of every check honestly.
7. Reduce verified coverage, source audit and every unsupported/unmeasured or
   residual mismatch to a durable receipt in docs/ssconvert. Remove owned
   temporary captures only after reduction; preserve other agents' output.
