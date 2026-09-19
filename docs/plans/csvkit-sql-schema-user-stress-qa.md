# SQL schema independent user stress QA

Use actual registered `csvsql` commands through Safe Bash Shell, with injected UTF-8, locale, terminal and recording database ports. Keep canonical inputs and filesystem effects in memory; do not use native commands, network or real databases inside tests.

1. Inspect frozen profile, existing schema differential/stress tests and scoped instructions. Choose uncovered behaviors rather than duplicate the existing dialect inventory.
2. For research only, verify installed reference versions and measure schema-only exact stdout/stderr/status with CPython csvkit. For connected DDL, directly measure agate-sql `make_sql_table` and SQLAlchemy `CreateTable` with the frozen mysql compiler, without connecting a database.
3. Check NaN/infinities, tiny fractional values, signed zero, percent/quote/newline identifiers, blank/null distinction with and without inference, unconstrained MSSQL suffixes, unconstrained Oracle UNIQUE and headerless generated names.
4. Inject a mysql recording session. Check zero/negative multipliers, oversized minimums and 28-digit Decimal half-even rounding. Assert raw DDL whitespace and connect/begin/result-close/commit/close ordering.
5. Reproduce any new domain failure before requesting its fix from the root owner. Preserve pre-fix evidence; baseline successes are controls, not failing regressions.
6. Run `TSX_DISABLE_CACHE=1 node --import tsx --test packages/safe-bash/tests/commands/csvsql-schema-user-edge.test.ts` and focused ESLint. Root registers the literal test path, runs maintained build/test/typecheck coverage and inspects CLI screenshots.
7. Keep third-party dialects, real driver acceptance, other frozen profiles and unmeasured diagnostics explicit. No Git staging, commits, pushes or publication in this review.
