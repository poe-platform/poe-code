# in2csv user edge QA

Use the frozen CPython 3.14.2 csvkit 2.2.0 installation only as a reference. Confirm installed dependency versions against docs/csvkit/reference-profile.json. Capture exact stdout, stderr and status for malformed fixed schemas and DBF numeric boundaries in docs/csvkit/in2csv-user-edge-reference.json; temporary reference inputs belong in out and are removed after capture.

Replay the observations in canonical memfs tests without native execution or host files. Reproduce failures before changing importers, then run the maintained csvkit workspace tests and lint. Independently replay workbook effects through safe-bash and run its selected build closure and focused shell tests. Record unsupported and unmeasured cases as blockers.
