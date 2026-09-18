# wkhtmltopdf completion contract and outstanding delivery gates

Task `engine-wkhtmltopdf` is incomplete. This continuation adds only the pure
completion contract to the existing private command workspace, preserving the
pre-existing parser and unrelated edits.

## Accepted source contract

`src/lib/utilities.cc` at commit
`024b2b2bb459dd904d15b911d04c6df4ff2c9031` was retrieved and inspected directly.
Its `handleError` gives nonzero error codes precedence over success, maps HTTP
404 to exit 2 and HTTP 401 to exit 3, retains HTTP descriptions (including unknown
codes with an empty description), and interprets network codes as 1000 plus a Qt
enum value. False success with zero code gets an unknown-error diagnostic. The
researched batch branch bypasses this helper and uses success alone.

`conversionOutcome` exposes these distinctions as typed structured data. Network
symbols must be supplied explicitly from a separately qualified profile: no host
Qt introspection, implicit enum mapping or native execution is introduced.
Nonnegative int32 codes and bounded ASCII enum names are checked admission
deviations. No I/O, renderer resources or streams are acquired by this pure API.

Original tests failed on the missing public export before implementation. The
workspace's 20 tests then passed, covering single-job status precedence, symbolic
network diagnostics, unknown failure, batch distinctions and input admission,
alongside the existing parser controls.

## Blocking prerequisites and next execution order

1. Qualify first-party HTML5, CSS cascade/selectors, fonts/shaping, images and box
   layout, with original failing engine tests and independent flex/grid gates.
   Current Pandoc uses external `parse5`; current PDF rendering uses `pdf-lib`,
   fontkit and pako, and its table model explicitly excludes spans. These were
   validated against current manifests and sources during this continuation.
   Existing paragraph pagination work must be reused where qualified; a second
   simplified renderer does not satisfy the task.
2. Build the accepted rendering closure, VFS identity-aware resource admission,
   cancellation/deadlines, work/retained-byte budgets, invocation cleanup and
   bounded byte-stream output. Physical/logical/outline counters, links and TOC
   convergence remain separate engine controls. No such gate passes here.
3. Follow the authoritative package-pattern prerequisite order before integration:
   canonical leaf contracts, actual command definition, safe-bash composition and
   subpath export, guarded bundling and isolated packed consumers with runtime
   identity and declarations intact. The safe-bash export is still absent.
4. Qualify byte CLI encoding and CLI/SDK parity, patched-Qt binary/profile and
   unsupported-feature rejection. The supplied completion name is profile data,
   not evidence that a native Qt profile has been qualified.

No CLI visual behavior changed, so screenshots are not applicable to this pure
completion API. No package publication, push or release is performed. Missing
engines and artifact integration block completion of the requested task.
