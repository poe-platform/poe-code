# csvlook implementation and QA

1. Inspect the existing descriptor, injected engine, typed loader and safe-bash registration. Preserve unrelated changes and staging.
2. Capture csvkit 2.2.0 / Agate 1.14.2 reference source, config and exact stdout/stderr/status under the frozen CPython 3.14.2 C/UTC profile. Keep temporary capture tooling in out.
3. Add failing in-memory differential tests before implementing typed fixed-width output, precision, limits and line numbers.
4. Run maintained workspace test/build/lint checks and focused safe-bash tests. Have a different agent independently stress and fix the implemented command using in-memory tests.
5. Inspect terminal output through an ad hoc screenshot. Record measured coverage and explicit remaining blockers in docs/csvkit; remove owned temporary evidence. Do not commit or publish.
