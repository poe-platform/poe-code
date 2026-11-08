# V8 real-host atime diagnosis inputs

Date: 2026-08-27

This directory diagnoses the failed v8 atime-control setup before any v9
fixture is frozen. The diagnostic is neutral host-filesystem code: it imports
only Node builtins and does not import, build, package, or execute candidate or
native `du` code.

The fixed three iterations are declared before execution. They are not retries
and are all retained whether they pass, fail, reproduce, or disagree. Each
iteration uses new files for these bounded probes:

- no-access checkpoints after `utimes`;
- a literal reconstruction of the v8 real-adapter setup and lstat resolution
  sequence (`realpath(root)`, `stat(root)`, and two file `lstat` calls);
- the same sequence after a completed earlier content read;
- configured-versus-canonical path device/inode identity;
- directory `readdir` and file `readFile` atime transitions; and
- fractional timestamp round-trip precision.

Every operation records raw bigint nanosecond stat fields. The runner removes
its unique scratch root in `finally`, records the post-removal ENOENT probe,
and writes a single JSON result outside scratch. It never seeks a passing
iteration and makes no assertion that every provider read must advance atime.

Immutable references inspected before authoring are listed in `INPUTS.json`.
The input commit must precede execution. Generated stdout, stderr, status and
JSON are committed later as diagnosis evidence, separately from any v9 freeze.
