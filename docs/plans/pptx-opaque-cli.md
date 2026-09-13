# Opaque resource command delivery

Implement the bounded opaque package inventory/extraction surface in `packages/pptx`;
the safe-bash adapter continues delegating to the explicitly supplied command SDK.
The root coordinator owns command-engine registration, public exports and Git.

The command subset is `objects list`, `objects extract --part PART`, and `fonts list`.
Objects use shared scope and fonts use presentation scope; shape/slide/token selection
is not advertised. Extraction publishes exact payload and relationship-part bytes
under deterministic generated names, with original part mappings in the manifest.
The adapter requires explicit partial-output authorization because it does not
provide an atomic multi-file transaction. Preserve all supplied source bytes.

## Implementation and regression procedure

- Write original memfs fixtures with a binary compound-file signature, an embedded
  font part and a relationship-owned preview; no downloaded assets or host I/O.
- Establish unsupported-route failures before adding the command implementation.
- Exercise active-content inventory, safe names and exact closure bytes through
  the command SDK. Independently hash expected bytes with Node crypto in tests.
- Exercise explicit partial-publication failure, complete output-byte budget
  admission and output-count ceilings before writes. Validate emitted inventory
  results against published schemas.
- Exercise the real Shell adapter, including actual MemoryFileSystem publication,
  quoted directory arguments and unsupported imported object references.
- Run maintained package lint and focused tests, then capture and inspect human
  help through the maintained generic screenshot command without predev.

## Evidence

Initial command SDK run: three failures with unsupported operation, before wiring.
The later explicit output-count regression failed with usage status 2 before
parser admission and handler ceiling enforcement were added. Final focused command
SDK run: seven passing tests. Maintained `npm run lint --workspace=pptx` passed
(ESLint, source typecheck and test typecheck). Root owns final maintained package
suite, selected build closure and guarded safe-bash lint evidence.

Final `node --import tsx --test
packages/safe-bash/tests/commands/pptx/opaque-objects.test.ts`: five passing cases,
including actual publication of three exact closure files and prepublication
rejection of an unsupported object reference during import.

Disposable visual QA output: `.cache/pptx-corpus/opaque-command-help.png`, captured
through `npm run screenshot -- --no-header -o ... node --input-type=module -e ...`
using the built public command SDK. The inspected image for `pptx help objects list`
shows readable usage, scope, partial-output and preservation limits with exact
`pptx` naming. The first attempt with incomplete `help objects` produced no usage;
the supported complete command path was then captured. No screenshot or binary
fixture is committed, and no full pipeline, push or release was run by this worker.

The upstream test/API audit and inventories were consulted for opaque-package,
font and returned-object obligations. Detailed individual upstream identities and
remaining model API obligations belong to the parallel research accounting work;
these bounded command cases do not establish whole-public-API parity. The corpus
manifest is the authority for disposable external QA fixtures; this worker used
only original in-memory assets and did not download or execute any corpus payload.
