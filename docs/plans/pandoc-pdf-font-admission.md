# Packaged font admission and license packaging

Engine follow-up: the supplied font helper accepts an admission callback, invoked with the base64-derived byte length before decoding or byte allocation. This permits Pandoc to reserve shared retained/binary budgets without repeating asset sizes. A new public helper test failed (zero admitted bytes), then passed after implementation.

Include MIT engine LICENSE and SIL font OFL.txt in package files. No README changes. Add original one-pixel PNG byte coverage and oversized decoded-dimension rejection in memory; no host fixtures or mutations.

Verified: six engine tests; engine ESLint and production/test typechecks; selected Pandoc workspace build closure (which includes pdf).
