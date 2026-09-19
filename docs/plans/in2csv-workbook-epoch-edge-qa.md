# Workbook epoch boundary QA

1. Authenticate the frozen CPython executable and runtime distribution versions before native measurement.
2. Generate reference-only XLSX workbooks with raw serial caches around 1904-01-01 under both Excel epochs, time-only and date formats, numeric and ISO date cells, and heading/data positions. Capture exact stdout, stderr, status and exported files in docs/csvkit. Keep temporary scripts and workbooks in out.
3. Run the in-memory argv and SDK regressions against the original implementation and establish any mismatch before fixing it.
4. Run the maintained csvkit tests/lint and selected safe-bash build closure. Exercise the frozen fixtures through actual Shell execution, comparing bytes and filesystem effects.
5. Preserve unmeasured workbook semantics as blockers. Purge only task-owned temporary evidence. Do not stage, commit or modify README files.
