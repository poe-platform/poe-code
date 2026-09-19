# DBF user edge QA

Use the frozen CPython 3.14.2 hash-required dependency lock and reference environment to observe exact stdout, stderr, status and unchanged named files. Keep native fixtures and tooling under out; native programs are reference tooling only.

1. Exercise unfamiliar version bytes, declared record widths, record starts inside headers and beyond EOF, active/deleted/unknown separator bytes, and truncated character records.
2. Exercise zero-width character, number, float, date, null-flag and varchar fields, and ignored common inference, locale, encoding and header flags.
3. Freeze the observations in docs/csvkit, replay them through the shared engine with memfs, and reproduce any mismatch before changing product code.
4. Have a different agent stress scalar and memo parsing through actual safe-bash Shell, retaining original failing regressions before fixing validated bugs.
5. Run maintained domain tests/lint, the selected safe-bash workspace build closure, focused Shell regressions and maintained integration-membership checks. Inspect an ad hoc screenshot of DBF CSV/error output through an explicitly bound plugin host.
6. Record measured cases and remaining blockers separately. Purge owned temporary fixtures, logs and screenshot assets. Preserve unrelated edits and staging; do not commit or publish.
