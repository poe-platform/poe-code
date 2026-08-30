# Initial archive verifier failure

Command: `/opt/homebrew/bin/python3 benchmarks/reports/current-comparison-20260827/measurement/verify-archive.py`

Exit 1 before extracting any member:

```text
Traceback (most recent call last):
  File "/Users/kjopek/Workspace/safe-bash/benchmarks/reports/current-comparison-20260827/measurement/verify-archive.py", line 69, in <module>
    assert header == expected_header(record), f'noncanonical/nonregular/unexpected member: {record["path"]}'
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: noncanonical/nonregular/unexpected member: aligned.json
```

The initial manual-header verifier expected ASCII octal zero plus NUL for device-major/minor fields. The stdlib USTAR writer correctly leaves these unused regular-file fields as eight NUL bytes each. The verifier is corrected to require these canonical zero-filled unused fields; content/hash/type/name checks are unchanged. The original archive is not regenerated or altered. This is an archival verifier implementation error, not a measurement or product failure.

Initial verifier source SHA-256: `69f1a0972e3e6eb376212b8992aef210484733969a689735a627bced3055b9a0`. The correction removes the assignment of ASCII octal device fields and changes only the intent receipt filename to preserve the first receipt.

`ARCHIVE_VERIFY_INTENT.json` remains unchanged. Its owned extraction directory `/private/tmp/safe-bash-measurement-archive-verify-3loaf30t` is retained empty. The corrected verification uses a separate intent receipt; no original measurement artifacts are changed.
