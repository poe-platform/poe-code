# Bounded XML part operations

Implement the requested XML inspection/replacement increment, without executing
the whole feature pipeline. Authority: `docs/specs/pptx.md`, shared office CLI/SDK
contracts, root instructions and the safe-bash scoped delegation rules.

## Ownership

- XML SDK worker: new `packages/pptx/src/xml-parts.ts`, original tests and public
  exports; coordinated validation changes only if necessary.
- Command worker: pptx command engine, schemas and their tests.
- Adapter worker: `packages/safe-bash/src/commands/pptx` and focused adapter tests.
- Root: integration review, this plan, research accounting, draft usage,
  disposable corpus QA, named staging and local commits on main.

Preserve unrelated edits, including the existing pipeline-plan modification and
untracked research files. No README edits, native product runtime, implicit host
I/O, product network, push or release. Test assets and assertions are original;
no reference implementation or binary asset is copied into product/tests.

## Behavior and acceptance

Expose exact bounded original XML bytes separately from explicitly labeled
formatted display. Select an existing canonical XML part, never create a part
from an arbitrary supplied path. Replacement parses namespaces and validates
content type, supported sequence constraints and graph consistency before
returning a publishable package. Preserve all unrelated decoded part bytes.
Reject signed, protected, macro-bearing, dangling or incompatible-dialect edits.
Unsupported validation profiles fail visibly; partial validation is not a full
OOXML schema or visual-fidelity claim.

Use the common `xml get` / `xml set` routes, dotted JSON operation IDs, explicit
selectors, bounded flags, dry-run and output publication semantics. The SDK is
the implementation used by the command engine. Safe-bash supplies only explicit
input/output capabilities and must reject publication it cannot protect.

## Agent-executed verification procedure

1. Demonstrate missing behavior with fast original failing tests before code.
2. Exercise raw-byte ownership, UTF encodings, malformed namespace XML, sequence,
   content type, signatures/dialect, missing relationships and unrelated-part
   preservation through the SDK. File-mutation tests use memfs.
3. Exercise public commands, schema/capabilities, JSON/status, dry-run and failed
   publication through the actual safe-bash adapter. Inspect help/error screenshots.
4. Run maintained pptx package tests/lint/build closure and focused safe-bash
   checks; review staged whitespace and formatting. Never run the whole pipeline.
5. Read the corpus manifest and verify a selected cached input's SHA-256 before
   disposable read/edit checks. Keep original downloads unchanged. Reduce any
   meaningful new finding into a small original regression before claiming it
   fixed. Record actual rejection when a fixture exceeds the supported profile.
6. Review exact upstream unit variants, BDD examples and public API obligations
   in a research supplement. Do not promote unrelated model APIs or claim parity.
7. Commit each coherent improvement using explicitly named owned files and
   report local hashes separately from remote delivery, which is not authorized.

## Coverage boundary

The inventories and historical audits describe research baselines. This increment
does not implement the whole live object model, inherited properties, enums,
collections, creation or semantic editors. Public `element`/`part` views remain
visible J09 obligations; bounded part operations are a foundation, not a reason
to classify underscore-prefixed types as private. Existing complete case/API
ledgers retain all deferred identities. A supplement will distinguish direct
original evidence from related workflows still requiring implementation.

## Verification receipt

The SDK, command engine and adapter each began with failing original tests for
the absent behavior. Subsequent regressions cover opaque namespace rebinding,
mixed-content formatting, removed resource bindings and a preexisting missing
resource ID inside opaque graphic content. The final profile intentionally
retains expanded element names/order, namespace declarations, namespaced
attributes, opaque payloads and resource bindings. Presentation and slide parts
are replaceable; other parts remain read-only. Strict replacement and original
UTF-16 bytes have positive cases. Parameterized content types already fail OPC
admission, so the suspected protection bypass was not validated; no unnecessary
content-type implementation change was made.

The first corpus-manifest entry matched SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
Raw inspection returned 1,710 original slide XML bytes and separately labeled
pretty display produced 2,393 UTF-8 bytes. Initial replacement failed on preserved
extension namespaces. An original `urn:original:future` extension regression
reproduced the failure, then passed after the validator adopted the existing
opaque extension/graphic-data policy. No additional namespaces are declared
understood merely to permit preservation.

The corpus rerun changed only `cSld.name` on `/ppt/slides/slide1.xml`. Independent
SHA-256 comparisons of all 38 decoded members matched the expected replacement
and unchanged original bytes; output was 1,202,540 bytes. A validated no-op
returned the exact input archive. The original cached download retained its hash.
These are structural checks, not rendering, playback or visual-fidelity evidence.
No corpus bytes or QA outputs are staged.

Actual injected safe-bash CLI output was captured for help, labeled pretty XML
and a malformed-replacement error (statuses 0, 0 and 1), rendered using the same
`terminal-png` renderer as `screenshot-poe-code`, then opened and visually
inspected at `/tmp/pptx-xml-operations-qa.png`. Text and XML are readable without
clipping. The root configuration CLI does not directly register the injected
safe-bash command, so capture used its actual Shell/SDK entry points.

The research supplement `docs/pptx/xml-operation-case-map.json` retains 125 exact
package/parser unit identities (including both relationship-drop parameter
variants), six open/save BDD examples and 95 inherited/direct public element/part
obligations. Limited original-operation evidence is explicit; model factories,
save, relationship mutation and owned views are not promoted to implemented.
All remaining identities stay in the complete case/API ledgers. Historical
command-design notes now point to current executable discovery and usage rather
than claiming no implementation exists. The two XML command-register rows now
record partial direct implementation and exact evidence links while retaining
the broader proposed batch/model schemas as explicitly unimplemented design.

Independent review then demonstrated that accepted generic XML content-type
parameters could skip the resource scan: the same absent resource ID was rejected
under `application/xml` but admitted under `application/xml; charset=utf-8`.
Original regressions now cover both, and the scanner uses the parsed media-type
essence. This is distinct from the correctly rejected presentation-main type
parameters discussed above. Dry-run destination checks also now honor declared
`write:false` and `readOnly:true`; a real CLI/memfs regression first reproduced
the unexpected successful dry-run. Explicit shared-scope metadata reads close
the SDK/CLI parity gap for content-type and relationship parts without adding
metadata mutation or changing selector inventory.

Final focused verification passed 555 PPTX tests across 18 files, including 28
XML-part SDK cases and 18 XML command cases. The SDK test-only chunk size was
raised to avoid unnecessary cooperative timer turns, reducing its suite from
roughly seven seconds to four without mocking parser, archive or graph behavior.
The maintained package lint (ESLint and production/test TypeScript) passed with
zero warnings. The selected `virtual-bash` workspace build discovered and rebuilt
its declared five-workspace closure successfully.

The final built adapter selectors/inventory check passed all 42 tests, including
the XML publication matrices. Public `poe-code/pptx` and injected
`poe-code/safe-bash/commands/pptx` imports were exercised together: SDK replacement
and actual virtual CLI file publication produced the exact independently
specified replacement XML. Final help was captured and inspected again at
`/tmp/pptx-xml-help-final.png` after metadata usage was added.

Repository-wide ESLint completed with 11,855 configured files checked and zero
errors/warnings; its boundary/receipt guards remained enabled. Root type lint and
maintained workflow lint also passed. Safe-bash's maintained typecheck passed its
source/test compilation and all 26 current consumer groups, including expected
negative type failures. No runtime claim is inferred from those typechecks.
The full uncached `npm test -- --concurrency=4` route exited zero, including native
pre/post scripts and the two post-test lint stress cases. It discovered 74
workspaces, five build dependencies and 43 unit tasks with no exclusions. Missing
declared unit tasks were reported unavailable, never counted as passes. Results:
root/shared 23,919 passed and two skipped; shell-runner 499 passed; Python 29
passed; terminal-pilot 288 passed; safe-bash 37,704 passed and 823 skipped; SafeJS
28,932 passed and 47 skipped. No suite failed. This broad run began before the
last review refinements; the final 555-test PPTX run, 42-test adapter run, build,
lint and source/consumer checks above qualified those refinements afterward.

Final formatting, whitespace and exact research-identity checks passed. Only the
14 explicitly owned implementation/test/documentation files are authorized for
the local main commit. The local hash is reported separately in the completion
message. No push, release, README change or fixture publication is authorized.
