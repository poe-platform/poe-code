# csvkit encoding qualification

Use the hash-locked CPython 3.14.2 reference profile in docs/csvkit. Native
Python is an isolated research oracle, never a product dependency or fallback.

1. Create an owned scratch directory in out/csvkit-codec-qualification. Verify
   the interpreter hash and install the existing hash-locked dependency list.
2. Capture csvcut with named binary fixtures for UTF-8/sig, UTF-16/LE/BE,
   ASCII, Latin-1 and CP1252, including aliases, empty and malformed inputs.
   Capture PYTHONIOENCODING suffixes, unsupported codecs and BOM boundaries
   in CSV and non-CSV modes. Retain exact stdout/stderr bytes and status.
3. Reduce captures to docs/csvkit/encoding-reference.json. First replay through
   canonical in-memory tests and record failing behavior before implementation.
4. Implement finite explicitly injected JavaScript codecs. Replay each capture
   with whole buffers and one-byte fragments. Keep output codec differences,
   verbose trace identity and unported codec families explicit blockers.
5. Have a different agent stress the actual safe-bash plugin and cooperative
   cancellation. Root owns public exports and integration changes.
6. Run maintained domain build/test/lint and safe-bash focused integration and
   type checks. Expand maintained checks for shared infrastructure changes.
   Render and inspect an ad hoc diagnostic screenshot when CLI output changes.
7. Record outcomes and limitations in docs/csvkit, purge only owned scratch
   evidence, and preserve unrelated edits/staging. No README additions, commits,
   pushes or publication are authorized.
