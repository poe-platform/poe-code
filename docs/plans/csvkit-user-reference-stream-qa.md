# csvkit frozen-case stream user QA

1. Replay explicitly selected historical csvkit 2.2.0 cases without changing
   their input, argv, stdout, stderr or status. Include historical failures.
2. Exercise csvcut, csvgrep, csvclean, csvstack, csvjoin, csvsort and csvlook
   through executable argv and independently declared SDK settings.
3. Use every two-chunk input split and a reusable single-byte producer with
   empty chunks interspersed. Use memfs for named inputs, including two-pass
   reopen workflows. Assert exact output bytes, status, unchanged file bytes
   and namespace, and finalization of each acquired iterator.
4. Run maintained uncached domain tests, lint and the selected build closure.
   Coordinate independent safe-bash lifecycle stress; retain limitations and
   unresolved reference attribution rather than counting this as full parity.
5. Record source/corpus hashes and outcomes under docs/csvkit. Preserve unrelated
   edits and staging; do not add README content, commit, push or publish.
