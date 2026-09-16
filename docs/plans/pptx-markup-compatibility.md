# PPTX namespace and compatibility interpretation

Own `packages/pptx/src/compatibility.ts`, `compatibility.test.ts`, the internal
namespace/markup inspection additions in `xml.ts`, the two compatibility error
codes in `errors.ts`, this plan, and `docs/pptx/compatibility.md`.

Implement a bounded internal view over the preserving XML codec. Detect the
original Strict/Transitional presentation or drawing namespace. Resolve MCE
prefix lists by each element's bindings; select the first understood Choice,
otherwise Fallback, otherwise no content. Keep all lexical representations.
Apply inherited Ignorable and ProcessContent; reject unsupported MustUnderstand
and nonignorable namespaces on processed content. Preserve unknown branches.
Reject edits changing alternate representations until synchronized editing exists.

This is one foundation task, not execution of the whole pipeline. No public
presentation SDK or safe-bash pptx command exists yet; the delegated adapter
inspection confirmed no exposed behavior to exercise through CLI. Do not expose
an incomplete model API or add adapters merely for this internal task.

## Verification procedure

1. Add original fast byte/memfs cases and observe failures before implementation.
2. Implement interpretation without host I/O, runtime processes or network.
3. Check both original dialects, aliasing/shadowing, no fallback, inherited rules,
   malformed controls, selected versus ignored content, and inconsistent edits.
4. Run maintained pptx tests, lint and selected workspace build closure.
5. Use one hash-verified manifest fixture for disposable structural no-op QA;
   reduce meaningful findings into original unit cases. No visual CLI changes or
   rendering claims, fixture commits, README changes, pipeline run or push.
6. Commit only the named owned files on main with a Conventional Commit.

## Accounting

Consulted both complete inventories, both audit reports, `xml-case-map.json`,
the public API mapping and J01–J10 decisions. The 72 XML source variants already
have exact dispositions in the XML supplement; the complete case ledger retains
all 2,700 unit variants and 973 BDD scenarios. No source scenario establishes
Strict/MCE adversarial semantics (as the audit explicitly records). These new
original standard-driven cases supplement that baseline; no upstream row or
public API obligation is promoted by internal compatibility support. The 45
public element members, including inherited/underscore-prefixed types, remain
deferred owned-view obligations under J09. No external implementation or asset
is copied; existing standalone legal notices remain untouched.

## Results

- TDD first failed because the new interpreter did not exist. Later standards
  cases produced five failures for wildcard handling, unselected-branch required
  support, ignorable branch siblings and wrapper attributes. A further failing
  regression established the ignored-handle mutation guard before its fix.
- Final maintained `npm run test:unit --workspace=pptx -- --reporter=dot` passed
  all 364 tests in 11 files, including 37 original compatibility cases, in 1.26 s.
- `npm run lint --workspace=pptx` passed ESLint and both production/test typechecks.
- `npm run build:workspaces -- --workspace=pptx` rebuilt the declared two-package
  closure successfully. No whole pipeline was run.
- Structural corpus QA used the first manifest deck, verified before/after as
  SHA-256 `885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
  All 35 XML streams retained exact bytes on inspection and no-op edits; unrelated
  root-attribute edits retained dialects (18 Transitional roots, 17 neutral).
- The initial census profile correctly refused two attribute namespaces absent
  from the manifest's element-namespace list: officeDocument relationships and
  XMLSchema-instance. Explicitly including these resolved the refusal. This is
  a QA profile correction, not evidence of semantic understanding of every
  manifest namespace or a product defect requiring a code change. The original
  required-attribute rejection case already guards that boundary.
- Strict and UTF-16 evidence comes from original in-memory unit cases, not this
  Transitional corpus deck. No fixture was changed, downloaded or committed;
  no screenshot/rendering evidence is claimed for this nonvisual internal layer.
- SDK/CLI exposure was independently inspected by the delegated read-only worker:
  neither the presentation model nor a pptx command exists. Public model, CLI,
  all inherited API obligations and BDD coverage remain deferred, not promoted.
- No reference implementation/material was copied. Research/legal notices and
  unrelated work remain untouched. README, root wiring and safe-bash unchanged.

The implementation supports element/attribute inspection, URI-resolved MCE
selection and conservative edit rejection. Application-defined extension-element
suspension, schema validation and synchronized alternate editing remain explicit
limits; this commit does not establish full F03/F04 or whole-product conformance.
