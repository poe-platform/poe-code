# pptx independent assertions

Scope: the `independent-assertions` milestone only. Do not execute the remaining
pipeline. The pre-existing modified pipeline plan is preserved; this companion
plan is the owned completion record.

## Ownership and procedure

Root owns `packages/pptx/tests/assertions.ts`, its test, this plan and the two
companion documents under `docs/pptx`. Root AGENTS.md applies. No scoped AGENTS.md
exists under `packages/pptx`; no adapter/shared/root implementation is changed.
No delegation requirement applies to these paths.

1. Consult the format and shared office contracts, both test/API audits and
   inventories, existing case/API registers, language/drift decisions, original
   fixture primitives and disposable corpus manifest.
2. Declare expected values and corruption controls before authoring the helpers.
   Run the focused maintained root Vitest configuration red, then implement only
   the assertion primitives needed by the tests. Keep file mutations in memfs.
3. Check exact part hashes, owner-local relationships and target existence,
   presentation-list order, supplied XML inheritance sites and embedded image
   occurrence counts. Exercise shared resources, differing filename/order,
   absence versus explicit values and namespace lookalikes.
4. Join every inventory row to its exact case-ledger pointer/identity/file/line
   and every source API identity to the target register, retaining parameter
   variants, BDD examples, inherited members and undocumented-by-tests APIs.
   Record test-support links without marking product behavior implemented.
5. Run scoped Vitest, ESLint, strict TypeScript, Prettier and diff checks. Review
   the owned files, stage explicit paths and commit once on main. Do not push.

## Contract and independence

All five assertions consume only an explicitly supplied memfs volume and root.
Expectations are literal caller declarations, never a writer/model readback.
The fixed SHA-256 vector is for authored bytes `abc`. XML expectations specify
IDs, targets, namespace-qualified paths and values separately from input markup.
Relationship and slide checks read raw XML through the existing low-level
namespace parser, without calling a presentation writer, model or resolver.

Relationships compare exact edges independently of serialization order and
check internal target files. Slides compare ordered identities, relationship IDs
and resolved part names, rejecting duplicate/dangling IDs. Embedded image
occurrences count XML references per owner, so three references to one part are
three occurrences, while two equal-byte parts remain distinct resources.
Inheritance asserts the entire declared nearest-first chain, then the first
present raw value and source part. Explicit `0` and empty string remain present.
A flattening corruption is detected even when its effective value is unchanged.

These are small structural test helpers, not an OPC validator, production
inheritance engine or image renderer. Inheritance selection is supplied by the
caller; it does not discover placeholder matches, themes, defaults or relations.
Image counting covers embedded DrawingML blips in explicitly supplied owners;
linked images fail visibly, and MCE alternatives are not resolved. The helpers
use Transitional namespaces, simple authored part paths and expanded packages.
They do not promise Strict, ZIP, URI-admission, schema or visual conformance.
Node assertion/hash/path utilities are test-only and perform no host file I/O.
No native process, ambient capability, network, download or product export exists.

## Provenance and coverage

[The receipt](../pptx/independent-assertion-evidence.json) binds the consulted
inputs and full inventory joins. All 2,700 unit variants and 973 BDD examples stay
in the case ledger; all 2,407 source API records stay in the 2,424-row target map.
Relevant source groups are linked as future consumers, with every row retained.
These helpers discharge no source product behavior and grant no architecture-only
waiver. Future adapters must retain each exact parameter/example and use original
arrange/action/expected assertions; the current 25 helper tests are supplemental.

Existing J01–J10 mappings and drift resolutions remain authoritative: neutral
model spellings, live ownership, explicit collection rules, immutable enum/XML
metadata, safe units/UTC dates/tri-state absence, async byte admission, explicit
metrics/time, neutral errors, bounded views and shared operation schemas. Test
helper functions are not new SDK aliases. Shared CLI plural resources, `text
replace`, selectors/JSON/exit statuses/schema/capabilities remain unchanged.
The original audit statements about unimplemented product behavior still hold.
No newly discovered documentation drift requires a spec change in this milestone.

No source assertions, code, prose or assets were copied into the helper suite.
Existing standalone MIT notices remain research inputs; no new substantial
derived material requires another notice. Reference identities occur only in
research. Corpus manifest metadata was consulted without opening, downloading,
shipping, mutating or deleting any corpus binary. These are original adversarial
controls, not claims of reduced real-corpus QA findings.

## Validation and delivery

The initial red run failed to import the missing `./assertions.js` module.
The final focused run passed 25 helper tests plus all 33 existing fixture tests;
the helper tests completed in 28 ms. Negative controls reject changed untouched
bytes, missing media, duplicate/dangling IDs, incorrect slide order/counts and
flattened inheritance. Scoped ESLint and strict TypeScript pass. Scoped Prettier
and `git diff --check` pass. All exact case/API identity joins pass.

No SDK/CLI is exposed, so paired execution, screenshots, build, archive roundtrip,
renderer and playback checks are inapplicable to this test-only milestone and
unrun. Full repository checks and the remaining pipeline are unrun. No README,
public branding, workspace registration or package shipping configuration changes.
Usage is drafted in `docs/pptx/independent-assertions.md`.

Only the five owned files enter one local Conventional Commit. Unrelated work,
including pre-existing untracked contracts/research, remains untouched. A local
commit is the only delivery authorized here; no remote delivery or release.
