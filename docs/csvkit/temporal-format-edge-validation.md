# Temporal format and offset validation

Frozen CPython 3.14.2 stdlib observations and hash-required csvkit 2.2.0 reference
CLI observations reproduce two current-code regressions: consecutive format
spaces were consumed separately, and sorting rejected offsets with seconds or
microseconds. The exact engine regression then exposed an additional incorrect
mixed-aware/naive diagnostic for such offsets. Failing canonical tests preceded
each fix; all canonical execution uses memory-only input and injected services.

Under LC_ALL=C, LANG=C, TZ=UTC, UTF-8 non-TTY pipes and 80 by 24 metadata:

| Command arguments (csvsort -y0) | Input data after header d | Exact stdout after header d |
| --- | --- | --- |
| --date-format `%Y  %m  %d` | 2024 02 29; 2023 12 31 | 2023-12-31; 2024-02-29 |
| --date-format `%Y<U+0085>%m<U+0085>%d` | 2024<U+0085>02<U+0085>29 | 2024-02-29 |
| --datetime-format `%Y-%m-%d %H:%M:%S%z` | 2024-01-01 00:00:00+00:00; 2024-01-01 00:00:00+00:00:00.000001; 2024-01-01 00:00:00-00:00:01.000001 | 2024-01-01T00:00:00+00:00:00.000001; 2024-01-01T00:00:00+00:00; 2024-01-01T00:00:00-00:00:01.000001 |

Semicolons separate rows in this table; actual bytes have LF row endings,
including the final row. All three native commands return status 0, empty
stderr and no file effects. The domain engine tests assert these exact bytes
and status with filesystem operations configured to throw on use.

Full strptime, implicit date NLP, locale and command-suite acceptance remain
separate blockers. See temporal-user-edge-validation.md for independent Shell
stress and the remaining hypothesis-scan mismatch; finite regressions do not
certify all temporal input.

## Final current-worktree checks

- Maintained csvkit workspace unit route: 33 files, 1,640 passes, six TODOs.
  Five TODOs are existing encoding gaps; one records duration hypothesis parity.
- Maintained csvkit ESLint/product/test TypeScript route: passed.
- Uncached selected csvkit build closure: passed (office-package and csvkit).
- Uncached selected safe-bash build closure: passed (ten declared builds).
- All csvkit Shell integration files: 179 passes, zero failures/skips, one
  original differential TODO. TODOs are not passes.
- Maintained integration-inputs discovery tests: 109 passes, zero failures.
- Compiled public `@poe-platform/safe-bash`, its commands/csvkit export and
  `poe-code/csvkit` ran the exact fractional-offset regression successfully.
- Actual registered command output for repeated format whitespace, offset
  microseconds, implicit month-date whitespace and Unicode duration units was
  rendered and viewed: readable, unclipped output, all status 0. Owned PNG purged.

An initial independent refusal test omitted required host bindings; it failed
integration and source/test typechecking, then was corrected before the final
integration run. The full safe-bash maintained typecheck was rerun after that
correction; source/tests and public-consumer groups pass. No broader repository
unit gate, full Bash runtime acceptance or release qualification is claimed.
Independent reference evidence was reduced and its owned venv/helpers/logs
purged. Unrelated source/staging/output was preserved. No README, staging,
commit, push or publication action was taken.
