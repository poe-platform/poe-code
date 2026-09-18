# behavior-wkhtmltopdf diff review

Status: **open; completion blocked**. Reviewed the current private workspace's
parser, switch/settings model, status mapping, page accounting and resource loader.
Existing contributor edits and acceptance documents were preserved.

## Validated and fixed findings

- Resource chunks were retained using `slice()`. A mocked producer yielding reused
  Node `Buffer` chunks reproduced corrupted output because `Buffer.slice()` is a
  borrowed view. The new failing test expected `[1, 2, 3, 4]` and received four
  nines. Copy with `new Uint8Array(chunk)` after existing allocation admission.
- Cancellation during successful lease cleanup allowed the individual resource
  read to resolve, leaving unreturned output charged. The new failing test
  reproduced the missing rejection. Check cancellation after cleanup, preserve
  the original falsey reason, and release output accounting through the existing
  failure path. Lease closure remains exactly once.

Both fixes add no abstraction, runtime dependency, host access or renderer.
Tests use memory streams and mocked capabilities. No CLI visual behavior changed.

## Unresolved findings

These remain completion blockers, rather than accepted deviations:

- `src/index.ts` exports component APIs only. No actual command handler or
  first-party HTML/CSS/font/shaping/image/paged PDF engine is implemented.
- `packages/safe-bash/package.json` has no `./commands/wkhtmltopdf` export.
  Private implementation/declaration bundling and isolated installed-consumer
  runtime identity have not been demonstrated.
- VFS identity enforcement and network redirect/TLS authorization are delegated
  to trusted supplied capabilities, with mocked routing tests only; no concrete
  adapters are qualified.
- Ordered input rendering, anchor geometry, bounded TOC convergence, supplied
  XSLT profile, PDF output accounting/staging/publication and CLI/raw-byte SDK
  equivalence remain open.
- The pinned patched-Qt binary profile, native numeric/encoding controls and
  visual PDF compatibility remain unqualified. Source research and pure page
  accounting do not satisfy renderer compatibility.

Retain all 122 switch dispositions and the existing open acceptance cells. Do
not expose incomplete component support as a functioning PDF command or publish
the private command package. No commit, push or release was performed by this
review.

## Affected verification

- `npm run test:unit --workspace=safe-bash-command-wkhtmltopdf`: 49 passed.
- `npm run lint --workspace=safe-bash-command-wkhtmltopdf`: ESLint and both
  source/test typechecks.
- `npm run build:workspaces -- --workspace=safe-bash-command-wkhtmltopdf`:
  selected maintained workspace build.

## Current CLI/SDK wiring review (2026-09-18)

The earlier component-only findings above describe the earlier candidate. The
current diff now includes a real CommandDefinition, plugin factory and shared
CLI/SDK executor in the private command workspace, an opt-in Safe Bash subpath,
and qualified private runtime/declaration packaging. Default registration remains
unchanged. The contracts extraction preserves one canonical runtime owner rather
than introducing a command-to-Safe Bash dependency cycle. No proxy-only helper,
provider-specific branch, external runtime dependency or host executable fallback
was added by this review.

Two additional issues were reproduced with failing memory-only tests and fixed:

- Help and version ignored `maxOutputBytes`. Check allocation-free UTF-8 length
  before encoding/writing information output. Over-limit information now rejects
  with status 1 and deterministic stderr, without publishing stdout bytes.
- Renderer close failure short-circuited invocation cleanup. A failing renderer
  close plus a gated owned stderr write reproduced cleanup settling before the
  admitted write finished. Drain renderer retirement, the resource run and both
  output operations with allSettled before surfacing cleanup failures. Existing
  falsey cancellation, producer ownership and exact-once closure controls pass.

Affected verification after the fixes: command unit suite **71 passed**; command
ESLint and source/test typechecks passed; maintained selected workspace build
passed. Guarded-build tests **356 passed** and package-safe tests **143 passed**
against the reviewed wiring. An ad hoc screenshot of normal help and output-bound
rejection was inspected; temporary review evidence was purged from `/out`.

Completion remains blocked by the open qualification findings: no first-party
HTML/CSS/font/shaping/paged-PDF renderer is supplied, no TOC/XSLT or anchor-geometry
engine is qualified, and no pinned patched-Qt execution profile establishes
rendering or numeric/encoding compatibility. Injected renderer mocks demonstrate
adapter behavior only. The prior installed-consumer evidence and failed broad
`npm test` run remain recorded in safe-bash-wkhtmltopdf-wiring.md; this focused
review did not rerun the complete installed-consumer or repository-wide suites,
and does not turn that broad failure into a pass. No commit, push, release or
private-package publication was performed.
