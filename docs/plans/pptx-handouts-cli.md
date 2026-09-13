# Handout CLI and SDK verification

Scope: the existing registered safe-bash notes test file and the PPTX settings
result schema. Business logic stays in the PPTX package; the adapter delegates
without new I/O authority. No README changes or downloaded unit fixtures.

## Acceptance procedure

1. Author an original package with a listed handout master, footer and slide-image
   placeholders, header/footer settings, independent notes page dimensions, print
   settings and a view-properties part at nondefault paths.
2. Inspect through the actual memfs-backed Shell and built public PPTX package.
   Check the handout list, owning print/view paths, exact literal settings and
   agreement with `readPresentationSettings`. Validate the JSON result against
   generated schema; inspection must leave input bytes unchanged.
3. Replace ordinary slide text, duplicate a slide and move it. Assert handout,
   print and view part bytes are unchanged after each operation. Independently
   parse presentation XML with Saxes to check notes dimensions.
4. Replace footer text under explicit `handout-master` scope. Check retained
   slide-image placeholder text and header/footer settings. Reject mixed slide
   and deck-level selection without publication.
5. Reject slide removal when opaque extension references cannot be resolved,
   preserving all input bytes; remove successfully in the known profile while
   retaining handout, print and view resources byte for byte.
6. Check capabilities describe print/view inventory and inspect actual command
   help/error output using the maintained generic screenshot route. The root
   CLI cannot address the explicitly injected virtual command directly.

## TDD evidence

The public-package inventory test initially failed because `handoutMasters` was
absent. After the domain build it reproduced a separate schema failure: valid
settings results containing print/view properties failed the closed result
schema. The capability assertion separately failed because its description only
promised retention. These failures precede their respective schema and root-owned
capability fixes. Lifecycle and explicit-scope tests pass without domain edits.

An additional original inspect-result schema assertion reproduced the omitted
handout list in the closed inventory schema; its declared required string-array
property now matches the SDK inventory. The complete registered notes test file
passed 9/9 against the rebuilt public package before this added assertion; the
final post-schema build receipt is recorded by the root owner.

Visual QA captured `.cache/pptx-handouts-cli.png` using
`npm run screenshot -- --no-header --output .cache/pptx-handouts-cli.png node --import tsx --input-type=module -e ...`
with an explicit in-memory Shell/command engine. Inspection showed that
`settings get --help` incorrectly rejected the option; the root integration owner
received this concrete finding. The mixed deck-level/slide scope error was
bounded and accurate. The screenshot remains disposable and unstaged.

Final verification: 9/9 registered notes/handout Shell tests passed (1.63 s),
including byte-identical public SDK/CLI explicit handout text replacement and
independent placeholder/layout assertions. `npm run lint --workspace=pptx`
passed. Scoped ESLint for the registered safe-bash test and owned diff whitespace
checks also passed. The rebuilt command help was recaptured and visually inspected at
`.cache/pptx-handouts-cli-final.png`: complete readable usage, print/view inventory
description, notes-size flags, publication controls and the clear deck-scope
selection error. No clipping or printed pagination claim was observed.

The test/API audit and inventories were consulted; exact provenance accounting
belongs to the root-assigned research receipt. These original integration cases
are additional F49 and shared command-contract evidence, not a claim of complete
object-model parity. Corpus inputs are governed by the manifest and are never
unit dependencies. No rendered pagination or printed-page count is asserted.
