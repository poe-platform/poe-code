# CSV writer implementation and QA

1. Inspect hash-verified Agate 1.14.2 csv_py3.py and frozen CPython 3.14.2 writer behavior.
2. Reproduce missing typed and dictionary writer behavior with failing in-memory byte regressions.
3. Implement invocation-owned writer counters and dialect snapshots; expose both writers through the SDK.
4. Independently stress registered safe-bash commands with multiline filtering, emitted ordinals, dialect isolation and exact output/status checks.
5. Run csvkit workspace tests, lint and selected maintained build closure; run focused safe-bash integration checks. Preserve explicit unsupported engine modes and unmeasured profiles.

Native reference capture is research only, never a canonical unit test or product fallback. Temporary source/evidence belongs in out and is removed after inspection. No README, Git staging, commits, pushes or publication.
