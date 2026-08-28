# Preparation history — August 28, 2026

The first data-only preparation exited 1 before candidate imports or execution.
`prepare.stderr.bin` preserves the raw assertion: the reviewer incorrectly
interpreted Git mode `100644` as proof of POSIX `0644` for historical evidence
captured as `0600`. Git authenticates executable classification, not all POSIX
permission bits. The correction authenticates Git bytes and executable class;
full live modes remain recorded in complete before/after guards and are checked
against explicit recipe/package seals. No foreign bytes or modes were changed.
The invoking zsh also exited 1 when assigning its read-only `status` variable;
this occurred after the Node process exited. No product case was run or retried.

The corrected preparation also exited1 before product import: a historical
negative-control scratch tree contains the intentional symlink
`runtime-v2/work/synthetic-Xhq6mh/fence-target/alias.mjs`. The complete historical
snapshot now records link text and full mode without following it. Executable
recipe and candidate trees still reject symlinks; source/package/core seals are
unchanged. `prepare-corrected.stderr.bin` preserves the raw failure. Continuation
reuses the already written identical root envelope and data-only recipe copy;
no product job or framework control is retried.
