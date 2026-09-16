# pptx original fixture primitives

Scope: `original-fixture-primitives` only. This completes the fixture milestone,
not the proposed presentation engine or the full pipeline. The pre-existing
pipeline-plan edits are preserved. This companion plan records the work without
staging someone else's plan changes.

## Ownership and procedure

The root agent owns independent assertions, this plan, research evidence, usage
draft and Git integration. The delegated fixture author owns only
`packages/pptx/tests/fixtures/decks.ts`. There were no applicable scoped
instructions under the new `packages/pptx` directory; no safe-bash adapter was
changed. Root and shared format/CLI/SDK contracts were consulted.

1. Read the specification, API and source-case audits/inventories, language
   mappings, package-boundary decision and disposable corpus manifest.
2. Write the fixture contract first and run it red before authoring the helper.
   The first run failed because `./decks.js` did not exist. Extend the independent
   assertions before inspecting the implementation, using agreed authored values.
3. Author three expanded OPC graphs in separate memfs volumes, with fixed text,
   IDs, geometry, chart values, theme data, explicit timestamps and BMP pixels.
   No ZIP writer, product editor or expected-result generator is involved.
4. Check namespace-aware XML, exact part/relationship inventories, target closure,
   local identity, nested transforms, chart point order and axis references,
   timing targets, theme list cardinalities, BMP headers/pixels, deterministic
   bytes and volume independence. Assert each negative variant changes only its
   intended part and has its named defect.
5. Run the maintained root Vitest configuration with the exact fixture test path,
   scoped ESLint/Prettier and strict TypeScript compilation of the owned TS files.
   Verify source-case and API identity joins, inspect the staged diff and commit
   explicitly named owned files on main. Do not push or release.

## Delivered fixture contract

Each story has 14 files and one slide: seed library, coastal observatory and
bicycle repair workshop. Text and four-color 2-by-2 BMP bytes are original.
Each graph contains package/content-type relationships, core properties,
presentation, master, blank layout, theme, slide, picture, two nested groups,
a clustered column chart with literal category/value data and an entrance
visibility timing node. Group coordinates deliberately differ from slide
coordinates. Relationship IDs are local and IDs repeat across independent owners.

The five optional defects are missing layout XML, an image relationship pointing
to a missing part, duplicate shape identity, a missing timing target, and an
unterminated slide root. All five are exercised for all three stories. A negative
variant is an input for later rejection tests; passing a fixture assertion is not
proof that an unimplemented editor rejects it.

`valid` means the authored baseline passes these structural checks. No XSD,
PowerPoint, independent renderer or playback qualification was run. Charts are
literal-data fixtures with no workbook; they do not establish workbook-backed
creation/editing. The title is an ordinary text box, not a title placeholder.
Blank layout/master scaffolding does not establish placeholder inheritance.
No ZIP archive, image decoder, package SDK or command implementation is introduced.

## Coverage and documentation boundaries

The research receipt in `docs/pptx/original-fixture-evidence.json` binds the
consulted inventories and verifies every one of the 2,700 unit and 973 expanded
BDD identities against its existing ledger row, including parameter variants.
All 2,407 public API records remain joined to the existing 2,424 target records;
no inherited, underscore-prefixed, enum, helper or untested API is excluded.
The 2,057 parameter-bound rows and 643 unparameterized rows remain visible.
All source behavioral cases remain unexecuted in TypeScript: these 33 fixture
checks do not discharge source API behavior, SDK/CLI parity or conformance.

Reusable input families are mapped in the receipt, with every row in each chosen
source file retained by ledger pointer. Values and expectations for future
behavioral cases must still honor each exact parameter/BDD example rather than
using the fixture's sample values as a substitute. No source test assertion,
binary, private proxy, template or object-model ceremony was copied.
Required existing standalone notices remain in research; no substantial copied
material was introduced that requires a new derived-material notice.

The shared CLI remains plural resources, `text replace`, common selectors,
versioned JSON and errors. The model retains neutral documented spellings,
async byte I/O, live ownership, explicit absence and collection distinctions.
Existing J01–J10 mappings and documented drift resolutions remain authoritative.
Fixture helper names are test scaffolding, not new public SDK aliases. There is
no exposed SDK/CLI behavior to pair-test or screenshot in this milestone.
Usage stays in `docs/pptx/original-fixtures.md`; no README or public export changed.

The corpus manifest was consulted as metadata only. No publisher fixture was
read, downloaded, changed, shipped or deleted. No corpus QA finding is claimed;
the negative fixtures are original adversarial inputs. No fixture bytes are
written to host disk at test runtime. The test directory is not included in the
root package's explicit shipped file list and has no package/export manifest.

## Validation and delivery

Passed: 33 original tests through the maintained root Vitest configuration;
scoped ESLint; strict TS compilation; scoped Prettier; `git diff --check`;
complete source/API identity joins; product test-source branding scan. The
fixture test body completes in 88–105 ms in the recorded runs; no latency
threshold test or timeout relaxation was introduced. Strict compilation found
and resolved a test-only memfs `TDataOut` narrowing issue.

Only fixture helper/tests, the usage draft, research receipt and this plan enter
the atomic local commit. Existing unrelated/untracked research and specifications
are left untouched. The receipt marks which consulted inputs are untracked so
it does not imply they are present in the commit. Full repository tests/build,
archive roundtrip, renderer, playback and SDK/CLI execution are unrun and are
not inferred from the focused checks. Remote delivery/release are unauthorized.
