---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Original docx utility — comprehensive OOXML implementation
readiness: draft
setup:
  prompt: |-
    Read docs/plans/docx-typescript-safe-bash.md, root AGENTS.md and scoped AGENTS.md before executing. This is an ordered implementation pipeline for an original TypeScript utility named exactly docx, its matching SDK and an explicit safe-bash plugin. docs/specs/docx.md is the sole format contract; docs/specs/office-cli.md and office-sdk.md govern shared command/SDK behavior. Resolve recorded wording drift before product code; this plan does not create a competing specification.

    Run tasks in listed order. Record current main branch, status and index; preserve unrelated edits and staging. Assign explicit owned paths before edits. For substantive safe-bash work, root delegates investigation/implementation/verification to leaf workers, assigns the integration/export owner, and coordinates Git. Independent review uses a different worker. Delegation within the current task does not authorize starting later tasks out of order. Follow packages/safe-bash/AGENTS.md, guarded paths and exact literal integration-input registration; preserve historical seals.

    Read docs/docx/corpus-manifest.json and corpus-report.md and both upstream test/API audits and inventories. Acquisition/census and reference passes are preparation only. Product operations and adaptations remain unverified until original TS tests pass. Keep all case identities/provenance in research and required standalone legal notices; product source/comments/tests/fixtures/identifiers/output contain no reference identities, copied code or binary assets. No native build/runtime dependency, ambient host I/O or implicit network; QA-only independent tools never enter product/build dependency closure.

    Use failing tests before code, original small memfs fixtures, maintained uncached checks and bounded capability I/O. Research and usage drafts belong in docs/docx; every plan/QA procedure belongs in docs/plans. Do not edit README files without explicit permission. Keep downloaded QA inputs only in the disposable ignored cache while a campaign needs them; reduce findings before owned cleanup.

    This setup overrides inherited setup. Per-task statuses select implement and, where appropriate, test only; never select inherited commit/release steps. Task prompts own verified atomic Conventional Commits of explicit owned paths on main. No blanket staging, co-author, ignored-file commits, hook bypass, push or release. The explicit teardown overrides automatic Git teardown. Do not mark implementation, parity or product QA complete from preparation evidence.
teardown:
  prompt: |
    Report completed versus pending docx specification families, actual maintained
    checks, corpus outcomes, reduced original regression tests, visual evidence and
    disposable fixture cleanup. Never equate downloaded/parsed files with passing
    product QA or claim full OOXML conformance from a subset. Update task states and
    Implemented Through only when verified. Report pending README permission honestly.
    Verify each completed task has its atomic Conventional Commits of owned paths
    and relevant plan updates. Commit any remaining verified task-owned changes using
    the same rules; never create an empty commit or include unrelated or ignored files.
    Report local commit hashes separately from any future remote-main delivery or
    release publication. Do not push or publish.

    Report complete upstream-case accounting and verify reference identities are absent
    from product code/comments/test names/fixtures/CLI. Preserve required standalone
    legal notices; no implicit exemption for substantial copied test material.

    Verify complete feature-to-command and documented-public-API registers, paired
    command ergonomics evidence and public SDK type/behavior tests before completion.
    No unexplained omissions or SDK-only public capability gaps.
tasks:
  - id: pin-ooxml-standards
    title: Pin standards and build a schema-level coverage register
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Use primary ECMA-376 sources: Part 1 fifth edition 2016, Part 2 fifth edition
      2021, Part 3 fifth edition 2015, Part 4 fifth edition 2016. Pin MS-DOCX and
      relevant DrawingML/Office-extension revisions separately. Consult actual sections
      and schemas; do not invent clause numbers or treat SDK documentation as the
      normative standard. Write docs/docx/standards-coverage.md mapping every F01-F50
      family in the specification to namespace/schema types, intended read/edit/
      preserve/reject behavior and tests. Cover OPC, WordprocessingML, DrawingML,
      OMML, VML, MCE, Strict/Transitional, annotations, forms, settings and opaque
      parts. Record unsupported subfeatures explicitly rather than claiming full
      ISO certification. Standards downloads are research references, not fixtures
      from another implementation. Do not revise proposed status to implemented.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
  - id: reconcile-documented-public-api
    title: Reconcile the whole documented public API
    status:
      implement: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Reread the pinned API/user guides and published docs linked in upstream-api-audit.md. Complete the candidate RST/autodoc inventory with inherited/protocol/prose-only members, enum aliases, constructors, returned interfaces and read/write signatures. Resolve every source/docs mismatch with evidence. Do not treat the current candidate count as an exhaustive certificate or use the test suite as the only API inventory.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: define-mirrored-js-api
    title: Define the complete mirrored JavaScript API
    status:
      implement: done
    prompt: |
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create docs/docx/public-api-map.json with one row per documented member/value/protocol: source revision, target TS signature, arguments/defaults, getters/setters, return/ownership, errors, side effects, CLI route and original tests. Retain neutral public snake_case names rather than inventing parallel aliases. Apply shared async/iteration/index/null/unit/date/security mappings. Separate object-model names from common camelCase operation options. Full API coverage is the target; missing public behavior is not an accepted silent exclusion.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.

      The current 331 records across 39 documentation files are a candidate starting set, not a closed denominator. Record exact async factory/save/input admission signatures; sync live property/model behavior; trailing typed source-spelled keyword options versus camelCase operation options; zero-based sequence lookup, at/slice/iteration/length versus keyed lookup and one-based CLI selectors; null/undefined/false/zero; safe integer units/rounding; enum symbols/aliases; Uint8Array ownership; UTC Date precision; neutral type/value/index/key errors; explicit time/author/fonts/VFS capabilities; safe element/part views and invalidated handles. Include inherited, returned, underscore-prefixed public types, prose-only workflows and untested APIs. Record documentation drift comment_id/timestamp versus id/date without inventing aliases. Dispositions are implemented, planned, language-mapped, security-mapped, documentation-error or unsupported; only passing evidence closes behavior.
  - id: map-all-features-to-commands
    title: Map every feature and API behavior to commands
    status:
      implement: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create docs/docx/command-coverage.json mapping every format feature and documented SDK behavior to exact command paths, arguments, common options, operation IDs, schema/help and tests. Preservation-only content maps to inspection plus retention tests, not fake editing commands. Common edits need simple flags; advanced behaviors may use typed batch operations, never eval/dynamic arbitrary method invocation. Every public operation needs a discoverable CLI route.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: paired-cli-acceptance
    title: Write paired ergonomic command acceptance cases
    status:
      implement: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create or update docs/plans/office-cli-qa.md with side-by-side docx/pptx command recipes for creation, text reading/replacement, image list/replace/extract, table cells, properties, templates, batch, diff and capabilities. Include spaces/Unicode/--, stdin ownership, dry-run, in-place, shared resources, ambiguous and stale selectors, error recovery and help. Recipes are proposed until implementation executes them; keep QA in Markdown, not a runner script.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: verify-python-test-baseline
    title: Verify the pinned document test baseline
    status:
      implement: done
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Documentation/research only; do not implement the product in this task.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Use the already cloned python-docx repository and recorded commit/results; crosslink the python-pptx audit for shared OPC behavior. Reproduce only if evidence or source changes, using the documented isolated environment. Preserve initial dependency failures and successful unit/BDD coverage denominators. Do not turn Python into a runtime dependency.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: map-all-upstream-tests
    title: Map every document test variant
    status:
      implement: done
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Documentation/research only; do not implement the product in this task.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Create docs/docx/test-case-map.json with one row per unit node ID and expanded BDD scenario/example in the inventory. Record source commit, behavior, target original TS test/task, equivalence rationale and status. Every applicable case must be adapted. Many-to-one mappings need semantic evidence; Python-private mechanics may be architecture-only, but missing public document functionality remains a visible gap and cannot count as complete parity.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      The current pinned inventory has 1,609 distinct collected unit variants and 650 expanded BDD examples: account for all 2,259 rows, not only files/functions/templates. Preserve unit node_id; use source_file + line + expanded name for BDD identity, recording example identity if needed to disambiguate. Verify no duplicate, missing or orphan mapping rows by set comparison to parsed inventory. Each row records owning ordered task, original target test path/title, semantic assertion and expected edge values, disposition/rationale, red evidence before implementation and passing result/source revision. Many-to-one targets must show each variant's invariant is exercised. Keep this crosswalk in research so upstream identities never enter product tests. Every feature task must select and write all of its assigned failing cases before implementing that behavior; later adaptation tasks close residual gaps rather than postponing TDD. Architecture-only dispositions are limited to genuinely private mechanics; observable public behavior requires original passing TS assertions.
  - id: reconcile-upstream-contract
    title: Reconcile upstream behavior with the DOCX contract
    status:
      implement: done
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Documentation/research only; do not implement the product in this task.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Audit all discovered public semantics against F01-F50, including table logical grids/merged cells, section/header linkage, style inheritance, comments, image characterization, numbering, hyperlinks and rendered page-break metadata. Extend the proposed contract/tasks for applicable missing behavior rather than dropping tests because an initial plan omitted them. Preserve spec-based differences with explicit original acceptance cases; Neutral documented method/property spelling is retained under office-sdk.md; private Python wrapper identity may map to observable behavior with an explicit rationale.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      Resolve specific current docx.md wording drift in the authoritative proposed spec before code: section 1's prohibition on deriving tests from another suite conflicts with section 11 and the user-authorized original behavioral adaptation; section 9's allowMissing conflicts with shared allowEmpty/--allow-empty, and its multiple-match wording must require exactly one of --first/--all/--occurrence for text replace. Separate the CLI's explicit pixel-to-EMU 96-DPI convention from the model API's documented native-image DPI/default sizing. Preserve Status: Proposed and Implemented Through: Not applicable until actual implementation evidence exists. Do not treat these stale phrases as permission to drop cases, add aliases or change shared semantics.
  - id: finalize-command-contract
    title: Resolve the complete CLI and SDK command grammar
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Refine the single authoritative docs/specs/docx.md with an exhaustive grammar
      for create/inspect/validate/text/xml, editing families, graphics/review/forms,
      batch/diff/extract/pack and help/version. Define arguments, JSON operation
      schemas, typed results, stable errors, selectors, scopes, defaults and precedence.
      Utility name is exactly docx; reject obsolete conflicting aliases while retaining shared text/text get, --help/-h, --version and -o discovery/output aliases. Resolve positional
      input versus stdin, --ops-json/--ops-file, --output/--in-place/--force, shared
      resource intent and raw/JSON conflicts. Specify real defaults, supported JSON
      keys, empty/null/absent handling and stale-location fingerprints. Keep standards
      facts separate from product choices. Do not create a competing contract.md.
      Map every public operation to F01-F50 and independent acceptance evidence.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      The common CLI decisions are already fixed in office-cli.md; complete only the
      format-specific grammar and shared register entries without renaming common
      paths/options. Replace old top-level replace/image/table/metadata vocabulary
      with text replace/images/tables/properties. Include schema and capabilities.
    status:
      implement: done
  - id: audit-downloaded-qa-fixtures
    title: Audit the downloaded disposable fixture inventory
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Start from docs/docx/corpus-manifest.json and corpus-report.md, and the actual
      files already downloaded under .cache/docx-corpus. Recompute hashes, inspect
      cache provenance and confirm publisher/license restrictions before reuse.
      Do not redownload existing matching files unnecessarily. Classify each fixture
      by actual paragraph/table/media/field/section/OMML/annotation counts, namespace
      profile and expected admit/reject outcomes. Cached page counts are not rendered
      page measurements. Preserve the recorded 32 MiB XML census rejection separately
      from the explicitly raised-profile census of the large annex document.
      These files exist only for QA and may be deleted after the campaign. Keep
      manifest/evidence and reduced original unit tests; never add full public reports
      to canonical tests or the product package. Identify exact corpus gaps.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
  - id: fill-corpus-feature-gaps
    title: Find additional QA documents for uncovered structures
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Use the manifest's actual feature census to find missing real examples,
      particularly comments/revisions, Strict markup and meaningful RTL/CJK text; chart inventory/preservation already has nine chart parts in the second inventory volume. Check
      linked/shared graphics, footnotes and form controls. Research authoritative
      public publishers and actually download suitable files where available. Record
      source/landing URL, license evidence, SHA-256, date and measured structure;
      public availability is not universal redistribution permission. Keep binaries
      in the ignored disposable cache; download at most two concurrently, 256 MiB
      per transfer and 1 GiB total with bounded redirects/timeouts/public HTTPS only.
      Never fetch linked resources, activate objects or bypass access controls. Record
      unavailable sources honestly and use small original authored examples for gaps;
      generated fixtures must not count as downloaded real-world documents.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
  - id: author-original-unit-fixtures
    title: Author small independent unit fixtures
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create original in-memory documents using community garden handbooks,
      observatory maintenance logs, museum catalogs and multilingual equipment lists.
      Vary runs, paragraphs, stories, tables, lists, fields, sections, images and opaque
      extensions. Use original wording and authored image bytes; do not copy product code, fixture bytes or report passages. Adapt the inventoried behavioral boundaries with independently authored wording/assets and retain substantial-derivation notices separately. Canonical fixtures remain small and deterministic,
      with no network, external binaries, LLMs or host scratch files. Build only the
      minimal fixture helpers needed, with explicit valid/invalid variants. Record
      F01-F50 coverage and keep downloaded report bodies out of these tests.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      For new artistic fixture images or motifs follow root artwork instructions: use the supplied reference or GPT-Image-2.5-Sunburst first, inspect/iterate and preserve prompts/references; report unavailable model access rather than substituting. Technical image-format header/pixel fixtures are non-artwork and may be authored deterministically in memory. Never call image generation from canonical tests.
    status:
      implement: done
      test: done
  - id: independent-structure-assertions
    title: Build independent package and structure assertions
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement small test-only assertions independent of the editor's read path for
      ZIP integrity, part payload hashes, XML namespaces, relationships, content types,
      numbering/styles and scoped IDs. Parse JSON; check absence over complete output;
      verify actual image bytes and table values rather than tag presence or filenames.
      Exercise assertion failures so malformed outputs cannot pass trivially. Compare
      unedited parts exactly and dirty parts structurally. Avoid recreating a second
      full editor in test helpers. Document which checks are schema/semantic/visual.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: fixture-reduction-workflow
    title: Define how QA findings become tiny regressions
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Write docs/plans/docx-regression-reduction-qa.md as agent-executed Markdown.
      For each meaningful behavior or failure observed in a downloaded QA fixture,
      isolate the involved parts/relationships, construct a new minimal document with
      original content and the same structural condition, demonstrate a failing
      unit assertion, then fix and retain the regression. Preserve failure category,
      selector semantics and data-loss conditions without copying report text/images.
      Record fixture ID/hash, concise finding, reduced test path and verification
      result. A finding cannot be closed merely because the big file later passes.
      No canonical test may require the disposable corpus after cleanup.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
  - id: shared-zip-read
    title: Expose a bounded shared ZIP reader
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inspect existing safe-bash archive/zip-format.ts and compression primitives.
      Reuse a suitable portable public codec, otherwise extract the smallest coherent
      reader/writer boundary into private packages/zip without pulling shell logic
      into packages/docx or duplicating ZIP code. First preserve existing archive
      behavior with tests. Implement bounded central/local entry admission, methods,
      flags, CRC, actual expansion, duplicate names, path safety and byte ownership.
      Runtime compression must remain incremental/cooperative; no unbounded synchronous
      convenience replacement. Maintain scoped owners and guarded input inventories.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      First inspect the current packages/zip, packages/docx, shared XML and package/export declarations; prior plans are not evidence these packages are missing or need reimplementation. Establish the smallest original TypeScript ESM package boundary, maintained build/test/type checks and original default-template ownership as needed. Keep shell adapters thin and runtime/native dependencies absent; no host compression fallback. Draft the required package README under docs/docx pending explicit permission. Delegate any substantive safe-bash extraction/refactor to an assigned leaf owner, with independent existing-archive behavior review, and preserve current public archive semantics.
    status:
      implement: done
      test: done
  - id: shared-zip-write
    title: Implement deterministic bounded ZIP writing
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Write supported stored/deflated entries through the shared codec with explicit
      ordering, deterministic metadata policy, checked sizes, output admission and
      backpressure. Preserve unedited payload bytes, not necessarily compressed bytes.
      Bound serialized metadata, copies and compression output. Reject unsupported
      flags and inconsistent sizes before publication. Keep existing safe-bash ZIP
      behavior unchanged with focused regressions; do not move unrelated TAR logic.
      Test empty parts, binary payloads, large entry counts, output failure and abort.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: zip64-and-format-admission
    title: Handle bounded ZIP64 and unsupported containers
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Add checked ZIP64 read support to the shared DOCX admission path for archives
      within configured actual size/count limits. Validate extra fields, 64-bit size
      conversions, descriptors, local/central agreement and malformed offsets. Do not
      allocate from unchecked metadata. The writer may remain ZIP32 while its limits
      fit; reject oversized output clearly. Detect multi-disk, encryption, legacy
      binary Word, macro-enabled and invalid OPC containers. Admission must not depend
      only on filename extensions or mark a size-limit rejection as corruption.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: opc-package-graph
    title: Implement the OPC package and relationship graph
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Build ordered package parts, defaults/overrides and owner-relative relationships.
      Resolve the main document using the root relationship rather than a fixed path.
      Implement OPC URI normalization, percent-encoding and target semantics with
      explicit collision rejection; external targets remain inert data. Validate
      missing required parts, duplicate relationship IDs and dangling internal targets.
      Allocate new IDs in the correct scope. Preserve unknown content types and parts
      on unrelated edits. Test nonstandard main-part paths and shared resources.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: namespace-xml-read
    title: Implement bounded namespace-aware XML parsing
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Use suitable existing safe-fs XML primitives or extend their minimal parser
      boundary without regex processing. Preserve namespaced elements/attributes,
      comments, processing instructions, CDATA semantics and ordered children needed
      for faithful edits. Support admitted XML encodings with explicit lossless policy;
      reject invalid bytes, DTDs/entities and unbound prefixes. Bound depth, nodes,
      text, attribute counts and work. Test UTF-8/UTF-16 BOMs, alternate prefixes,
      xml:space, surrogate chunk splits and denial of external resource resolution.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: loss-preserving-xml-write
    title: Implement dirty-part serialization and opaque preservation
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Track edited nodes/parts and serialize only dirty parts while retaining exact
      unedited uncompressed payloads. Keep namespace bindings, unknown attributes,
      comments, processing instructions and significant whitespace. Do not flatten
      unknown wrappers or discard unsupported descendants because a parser omitted
      them. Reject a mutation when faithful preservation cannot be established.
      Test no-op round trips, edits beside opaque nodes and mixed-content boundaries;
      ZIP metadata differences must not obscure unintended part changes.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: markup-compatibility
    title: Implement MCE and alternate-content preservation
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement a declared understood-namespace profile for mc:Ignorable,
      MustUnderstand, ProcessContent, PreserveElements/Attributes and AlternateContent
      where applicable to the standard. Select the correct read branch; preserve
      unselected branches and required namespace declarations on output. Refuse an
      affected edit if synchronization of fallback/choice representations is not
      supported. Test SVG/raster fallbacks, unknown namespaces and required unsupported
      features with explicit typed outcomes, not silent removal.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: strict-transitional-dialects
    title: Support Strict and Transitional DOCX dialects
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Detect Strict versus Transitional from namespaces/content relationships, not
      extensions. Map supported semantic operations to the appropriate dialect while
      preserving the input dialect and opaque compatibility markup. Reject mixed or
      invalid structures with precise diagnostics. New documents take an explicit
      output dialect with a documented default. Do not automatically normalize legacy
      VML or rewrite an entire document to another dialect. Use original paired
      Strict/Transitional fixtures for every supported editing primitive.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: package-semantic-validation
    title: Validate package-wide semantic invariants
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement bounded validation of required parts/roots, relationship/content-type
      agreement, style and numbering references, note/comment/bookmark/revision IDs,
      drawing IDs, field balance and table grids. Report part/location and stable
      codes. Separate malformed package errors from valid unsupported features and
      from resource limits. Validate staged edits before serialization/publication.
      Publish an honest profile of schema and semantic checks; independent verification
      must not merely invoke the same validator again and call it full conformance.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: limits-and-work-accounting
    title: Implement invocation-wide resource and work budgets
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement trusted finite ceilings from the spec for compressed/expanded bytes,
      XML, retained buffers/copies, entries/media, matches, inserted nodes, tables,
      batch operations, work and output. CLI/SDK operation options can lower but never
      raise host ceilings. Charge both inputs to diff, all steps to batch and copies
      before allocation. Invalid limits fail before acquisition. Yield cooperative
      work at bounded intervals; document that counters are not RSS isolation. Test
      at/over limits with small fixtures rather than giant bombs or slow timeouts.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: streams-and-cleanup
    title: Integrate byte streams cancellation and owned cleanup
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Use injected byte sources/sinks and existing safe-bash readBytes/writeBytes
      contracts. Retain owned copies before producers reuse buffers; await sinks and
      propagate backpressure/AbortSignal. Register cooperative cleanup before resource
      acquisition, close admission on cleanup and await owned pending work. Preserve
      borrowed signal provenance and late rejection handling. Test source/sink errors,
      abort at each phase, repeated cleanup, siblings and direct contexts without
      optional hooks. No host fs/process fallback.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: safe-file-publication
    title: Implement exclusive and conditional document publication
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Require exactly one output or in-place mode for publishing mutations; output - is binary stdout. Dry-run requires no output and validates any proposed destination; creation requires output. New outputs are
      exclusive; overwrite needs force and in-place is explicit replacement intent.
      Resolve per-path capabilities and alias identity using actual VFS contracts.
      Stage and validate before publication; reject missing guarantees or unknown
      destructive aliases. Never emulate atomic replacement with delete-then-write
      or an exists-then-write race. Preserve source and preexisting outputs on every
      pre-publication failure. Test mounted/read-only/remote-like capabilities in memfs;
      report partial new stdout/extraction effects honestly.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      For multi-file extraction require adapter transactions or explicit allowPartialOutput/--allow-partial-output with precise published-file manifests. Unknown alias identity or absent conditional/staged guarantees refuses destructive publication. Force never authorizes an input alias or bypasses protection, limits or validation.
    status:
      implement: done
      test: done
  - id: document-locations
    title: Implement stable selectors and stale-edit detection
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Define typed part/story/paragraph/run/table/cell/image/annotation locations with
      a document revision fingerprint. Reject stale locations, ambiguous matches and
      out-of-range coordinates before mutation; expose explicit occurrence/all and
      allowEmpty options consistently. Logical locations must not leak parser object
      identity or depend on pretty printing. Mutation results include updated locations
      and counts. Test shared parts, repeated text, edited revisions and namespace
      prefix changes without confusing byte identity with displayed strings.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: sdk-live-object-model
    title: Implement live SDK objects and documented setters
    status:
      implement: done
      test: done
    prompt: |
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Implement the documented object graph and public properties/methods as the primary SDK, backed by the same domain primitives as command operations. Preserve documented getter side effects, returned object types, owner identity and invalidated handles. Test destructive text setters/clear separately from preserving text replace, and ensure read-only CLI inspection does not invoke creating getters. Avoid duplicate editors or a forest of forwarding alias functions.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
      Complete the public object surface over the domain behavior already implemented
      by earlier feature tasks. Reuse/extend those live types instead of creating a
      second editor or placeholder implementation.
  - id: sdk-collections-values
    title: Implement complete collections units colors and enums
    status:
      implement: done
      test: done
    prompt: |
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Cover documented sequence/keyed lookup, length, iteration, bounds, negative-index/slice mappings and mutation protocols. Preserve sparse ID-keyed collections and null/false/zero distinctions. Implement all documented unit/color helpers, enum members/aliases and value conversions with original tests. Add cases for public members with no upstream unit test.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
      Complete the public object surface over the domain behavior already implemented
      by earlier feature tasks. Reuse/extend those live types instead of creating a
      second editor or placeholder implementation.
  - id: sdk-async-capabilities
    title: Implement consistent async I/O and context mappings
    status:
      implement: done
      test: done
    prompt: |
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Make factories/save/input-admitting methods consistently async and in-memory model operations synchronous, using explicit bytes/streams/VFS capabilities. Define typed context time/author/metrics/cancellation defaults without ambient discovery. Preserve documented argument defaults where safe and record deliberate mappings. Test no value-or-Promise ambiguity, byte ownership, failures, stale publication and cancellation.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
      Complete the public object surface over the domain behavior already implemented
      by earlier feature tasks. Reuse/extend those live types instead of creating a
      second editor or placeholder implementation.
  - id: sdk-xml-package-views
    title: Expose bounded documented XML and package views
    status:
      implement: done
      test: done
    prompt: |
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Cover public element/part and returned package-view behaviors that documentation exposes. Specify safe JS XML traversal/attributes/structured mutation and graph validation without importing an entire Python dependency API or bypassing limits. Map genuine private helpers separately; a documented underscore-prefixed return type is not automatically private. Test every exposed read/write behavior and publication invariants.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
      Complete the public object surface over the domain behavior already implemented
      by earlier feature tasks. Reuse/extend those live types instead of creating a
      second editor or placeholder implementation.
  - id: command-registration
    title: Register the explicit docx safe-bash plugin
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement createDocxCommand(options) and docxCommands(options), following
      CommandDefinition/VirtualShellPlugin patterns and collision preflight. Keep the
      command opt-in and preserve default inventories. Add truthful public exports
      poe-code/docx and poe-code/safe-bash/commands/docx with runtime/type parity and
      no root business logic. Test actual Shell/registry dispatch and configured
      replacement, not only handler stubs. Follow scoped integration ownership and
      literal input registration without changing historical seals.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      Root assigns the packages/safe-bash/src/commands/docx owner and separate root package.json/export integration owner before changes; leaf workers do substantive scoped work and report exact owned files/checks. Keep virtual-bash private and its runtime dependencies empty. Register new integration tests by exact literal path in packages/safe-bash/scripts/integration-inputs.test.mjs; preserve default command inventories and authenticated historical inputs. Inspect actual ZIP/XML public exports before wiring packages/docx; proposed import names are not availability claims. Verify packed runtime and declaration consumers, package contents and browser/worker closure before advertising them.

      Verify docx is absent from agentCommands/createAgentCommands before explicit plugin registration and present only after opt-in; assert actual dispatch, collision refusal and deliberate replacement. Workers do not stage or commit without explicit root assignment.
    status:
      implement: done
      test: done
  - id: argument-and-json-parsing
    title: Implement command arguments and versioned JSON schemas
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement the original grammar/schema defined in docs/specs/docx.md. Validate
      unknown keys, types, selectors, output modes, -- handling and conflicting stdin
      consumers before I/O. Preserve shell byte provenance and reject invalid text
      encodings. Use the same types/validation for SDK, CLI and batch. Define literal
      argument dispatch with no eval or secondary shell parsing. Test quoted JSON,
      Unicode paths, leading dashes, empty/absent/null options and binary stdin/stdout.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: simple-selector-ergonomics
    title: Implement simple selectors and direct edit flags
    status:
      implement: done
      test: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Make routine edits work without XML IDs, fingerprints or JSON: scoped one-based paragraph/table/image selectors, logical cell coordinates and applicable slide/shape labels. Preserve safe fingerprint tokens for automation. Implement consistent first/all/occurrence and explicit shared-resource behavior, good ambiguity errors and destination/force/dry-run semantics. Run original paired SDK/CLI acceptance cases.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: help-errors-and-output
    title: Implement coherent help results and diagnostics
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Generate help and schema output from one maintained operation declaration;
      version comes from real metadata. Report only implemented capabilities at early
      milestones. Preserve statuses, JSON shapes, diagnostic limits and binary output
      separation; escape terminal control sequences in human output through the design
      system. Use no direct chalk/clack imports. Integrate terminal progress only where
      appropriate and never pollute streams. Inspect ad hoc help/error screenshots via
      the maintained screenshot-poe-code route; do not add screenshot tests.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: inspect-and-validate-commands
    title: Expose document inventory and validation reports
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement docx inspect/validate with SDK parity: parts/sizes, content types,
      relationships, properties, features, dialect, annotations, protection, media
      and structural counts. Distinguish cached page metadata from rendered pages;
      font references from installed fonts; signatures from verified signatures.
      Provide deterministic JSON and bounded human summaries plus profile warnings.
      Test original minimal/complex/invalid documents independently and verify no
      mutations or implicit linked-resource access.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: story-text-extraction
    title: Extract visible text across document stories
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement body/header/footer/footnote/endnote/comment/text-box scopes with
      explicit deterministic ordering and shared-part deduplication. Preserve logical
      paragraph, cell/row, tab and break separators. Support final/original/all review
      views without mixing deleted text or field instructions into default output.
      Return structured segments with locations/formatting context. Test multilingual,
      RTL/CJK, combining characters, nested tables, hidden text policy and fields;
      never perform visual-order reshaping or invent text for drawings/equations.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: xml-part-access
    title: Expose raw XML pretty output and validated part replacement
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement explicit XML part selection with raw bytes or bounded pretty display.
      Support a deliberate replace-part operation using validated XML bytes, namespace
      and package invariants, output publication rules and preserved unrelated parts.
      Reject non-XML parts, ambiguous selectors and invalid encodings. Never use
      regex replacement or strip significant whitespace. Raw output is byte-exact;
      pretty output is documented as display serialization. Test malformed fragments,
      unknown namespace content and dangling relationships before publication.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: create-documents-and-templates
    title: Create new DOCX and macro-free templates
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create minimal valid packages and populate supplied templates from typed
      structured content. Support explicit DOCX/DOTX and Strict/Transitional output
      kind with correct content types, roots, relationships and required paragraphs.
      Expose explicit page/style/theme settings rather than relying on a hidden
      application template. Do not accept executable template code. Tests reopen
      new documents independently and verify deterministic package structure,
      empty documents, Unicode and output-conflict preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: run-aware-replacement
    title: Implement literal replacement across formatting runs
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Map logical paragraph text to runs and compute nonoverlapping left-to-right
      matches from original selected text. Match across formatting runs but respect
      field/object/revision/container barriers. Preserve unmatched run fragments and
      properties; inherit first-match formatting unless explicit formatting is given.
      Handle empty replacement, xml:space, tabs/newlines, Unicode and checked offsets.
      Require exactly one of first/all/occurrence even for one match; missing mutations fail unless allowEmpty is explicit.
      Test exact text and formatting, not merely the presence of replacement words.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: run-formatting
    title: Implement direct character formatting
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement scoped edits for bold/italic/underline/strike, font references, size,
      color/theme/highlight, baseline/superscript, hidden text and language. Distinguish
      unset/remove from explicit false/default values. Split runs only when necessary,
      preserve style inheritance and unrelated direct properties, and merge only
      semantically equivalent adjacent runs. Validate units/enums and preserve complex
      script/RTL/CJK properties. Test exact affected ranges and untouched structure.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: paragraph-formatting
    title: Implement paragraphs spacing tabs and breaks
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement paragraph insertion/editing with alignment, indentation, before/after
      spacing, line spacing, tab stops/leaders, borders/shading, outline level,
      keep-with-next/keep-lines/widow controls and page/column breaks. Preserve section
      properties and required container paragraphs. Define inline versus block
      insertion splitting without dropping suffix text. Validate units and negative
      value rules per schema. Test mixed run formatting and nested-table contexts.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: styles-and-headings
    title: Implement styles inheritance and heading levels
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inspect/create/edit/reuse paragraph, character and table styles, defaults,
      linked styles, basedOn/next relationships and Title via heading level 0 and headings 1-9. Detect style cycles
      and missing references. Do not overwrite a user style merely because its name
      matches a desired built-in heading. Allocate collision-free IDs deterministically;
      preserve unedited latent/style metadata. Test inherited versus direct properties,
      numbering references, linked styles and an original conflicting-style template.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: sdk-style-and-format-api
    title: Complete all style and formatting API members
    status:
      implement: done
      test: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Implement inherited character/paragraph/table style properties, latent-style defaults/individual entries, style visibility/priority/locking, next/base styles, all documented Font flags and tab-stop insertion/deletion/clear. Include Title via heading level 0, built-in style aliases, tri-state values and style-name lookup semantics. Every API row and source case must map to original tests.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: themes-and-font-resources
    title: Preserve themes fonts and language resources
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Expose theme/font-table inventory and supported typed theme-reference updates.
      Preserve embedded font bytes, obfuscation metadata, theme colors/fonts and
      language-specific references when unrelated content changes. Do not install,
      download or rasterize fonts; availability/licensing is not inferred from a font
      name. Validate references and report unsupported embedded font mutation clearly.
      Test theme inheritance, missing resources and unknown extension retention.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: sections-and-page-settings
    title: Implement sections margins columns and page metadata
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Edit page size/orientation, margins/gutter, columns, section start type,
      page-number metadata and first/even/odd policies with proper section ownership.
      Preserve final body sectPr and paragraph-owned section breaks. Explicitly model
      inheritance and prevent a local change from altering following sections
      unintentionally. No pagination/rendering claim. Test portrait/landscape switches,
      continuous/next-page breaks, columns and headers across multiple sections.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: headers-and-footers
    title: Implement shared and section-specific header footer edits
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Read/create/edit/delete default/first/even header/footer stories with explicit
      link-to-previous and shared-versus-local intent. Clone/rebind a shared part for
      one-section edits; retain resources referenced elsewhere. Keep section and
      relationship/content-type rules valid. Reuse text/table/image operations in
      these stories. Test multiple sections referring to one part, inherited bindings,
      missing stories, page-number fields and source preservation on failed edits.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: multilevel-numbering
    title: Implement lists restarts and numbering definitions
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create/edit multilevel ordered/bulleted lists with bounded nesting/items,
      start/restart overrides, numbering style relationships and abstract/instance ID
      scope. Preserve picture-bullet resources and unsupported numbering schemes
      without guessing. Reuse existing definitions only when semantics match.
      Test numbering collisions, restarts, nested paragraphs, mixed styles and
      unrelated list preservation; verify numbering graph rather than tag existence.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: table-construction
    title: Create formatted tables and validate grids
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create bounded tables with explicit rows/columns, grid widths, optional repeated
      header rows, borders/shading, margins, row splitting/height and required cell
      paragraphs. Support typed nested content using existing insertion primitives.
      Validate the whole request before edits and preserve surrounding section data.
      Test empty cells, Unicode, nested tables, fixed/auto widths and aggregate cell
      limits with independent XML/grid assertions.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: table-cell-updates
    title: Implement table selection cell edits and row column changes
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inspect logical table coordinates and edit selected cells/rows/columns using
      locations or unambiguous anchors with documented 1-based indexing. Distinguish
      value replacement from formatting and explicit grow/insert/delete operations.
      Preserve unrelated cells and table/row/cell properties; reject invalid anchors
      and out-of-bounds edits before publication. Test inserted rows/columns, headers,
      nested tables, bookmarks/fields in cells and exact value preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: merged-cell-operations
    title: Implement merged-cell resolution merge and split
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Map gridSpan and vMerge continuations to owning logical cells. Define selection
      of covered coordinates and reject ambiguous writes by default. Implement explicit
      merge/split only when the selected rectangle and content policy are valid;
      preserve displaced content according to an explicit join/distribution option,
      never silently discard it. Validate resulting grid and continuation markers.
      Test horizontal/vertical/nested spans, row deletion through spans and malformed
      merges using tiny original fixtures derived from QA findings.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: hyperlinks
    title: Implement internal and external hyperlink operations
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create/edit/remove hyperlinks while preserving label runs and owned-part
      relationships. Allow documented inert schemes such as https/http/mailto and
      internal anchors; reject dangerous or malformed schemes. Never fetch links.
      Define removal as unwrapping visible label versus deleting content explicitly.
      Handle shared relationships, escaped targets and target fragments. Test body,
      headers, table cells, existing styled links and external-resource nonexecution.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: bookmarks-and-locations
    title: Implement bookmark ranges and reference-safe updates
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inspect/create/rename/remove bookmark ranges with checked ID/name uniqueness,
      legal boundaries and explicit reference-update policy. Detect stale locations,
      missing ends and overlapping/crossing structures. Rename updates supported
      internal links/REF/PAGEREF references or rejects when unsafe; removal cannot
      silently strand references. Preserve unrelated fields and annotations. Use
      original multi-run and table-contained ranges for regression coverage.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: field-structure-and-results
    title: Implement nested fields and displayed result editing
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Parse simple and complex begin/separate/end fields across runs with a stack,
      including nested fields and split instruction text. List kind/instruction/result
      and locations; set displayed results of supported selected fields without
      executing instructions. Preserve formatting and update/lock flags unless
      explicitly changed. Malformed/unsupported selections fail before edits.
      Test merge fields, header/footer fields, nested REF/PAGE and exact preservation
      of instructions rather than checking output via the same reader only.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: toc-captions-and-crossrefs
    title: Create TOCs captions and cross-reference fields
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create/edit bounded TOC, PAGE, NUMPAGES, REF, PAGEREF and SEQ structures,
      caption labels and referenced bookmarks using typed options. Preserve field
      instruction/result distinction and explicit dirty/update flags. Do not claim
      cached page numbers or TOC results were recomputed by a layout engine. Support
      static label text where requested. Test field nesting, sequence collisions,
      bookmark renames and preserved existing TOC content outside selected edits.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: footnotes-and-endnotes
    title: Implement notes references and separators
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Read/insert/edit/delete footnotes/endnotes with references, separators,
      continuation separators and correct reserved/allocated IDs. Respect section and
      document numbering/restart rules. Removing one reference must not delete shared
      or otherwise referenced content unexpectedly. Reuse story editing primitives.
      Test multi-paragraph/table/image note bodies, duplicate/missing IDs, reference
      renumbering policies and preservation of required separator entries.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: classic-comments
    title: Implement classic comment ranges and bodies
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Create/read/edit/delete comments with explicit author/initials/time, correct
      range start/end and reference markers, comment parts and content types.
      Support text spanning runs without corrupting overlapping bookmarks or field
      boundaries; reject unsafe ranges. Keep comments separate from visible document
      text by default. Test range/body consistency, deleted anchors, multiple comments
      and exact preservation of unrelated annotations.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: sdk-table-section-review-api
    title: Complete table section and review object APIs
    status:
      implement: open
      test: open
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Cover omitted row cells versus empty cells, repeated logical cells across merges, nested ordered content, section iteration and linked first/even/default headers/footers. Complete rich comment containers and metadata/range semantics, hyperlink traversal and rendered-page-break fragments. Correct source-guide typos via the audit; do not invent id/date aliases when the verified API uses comment_id/timestamp.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: modern-comment-extensions
    title: Preserve modern and threaded comment metadata
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Identify current MS-DOCX comment/thread/people extension parts and IDs from the
      pinned standards register. Inventory and preserve them on unrelated edits.
      Implement only verified synchronization needed when a classic comment is edited
      or removed; reject an affected operation if modern metadata would become
      inconsistent. Do not silently downgrade threaded comments. Test extension parts,
      unknown newer attributes, replies/resolution metadata and deterministic refusal.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: revision-read-views
    title: Implement final original and annotated revision views
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Interpret inserted/deleted/moved text and property revisions for final/original/
      all read views, keeping instructions and removed text out of default text.
      Return revision IDs/authors/times and supported versus opaque types. Preserve
      review markup on ordinary unrelated edits. Detect unsafe boundaries before
      replacement/removal. Test split runs, nested revisions, deleted paragraphs and
      move pairs; unknown revision types are not silently accepted or flattened.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: tracked-text-edits
    title: Create tracked text insertion and deletion
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Provide explicit track-changes options for supported text edits using required
      caller author/time and correctly scoped IDs. Preserve original and final views,
      formatting and deletion-text element semantics. Do not insert nested unsupported
      review structures or silently edit inside existing revisions. Keep ordinary
      untracked edits distinct. Test tracked insertion/deletion/replacement across
      runs, metadata validation and exact reversible visible text.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: accept-reject-revisions
    title: Accept and reject supported selected revisions
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement explicit accept/reject for supported text and formatting revisions,
      with exact selection/all controls and an operation report. Validate all selected
      revision types first and apply atomically to the staged document. Unsupported
      move/table/section revisions must fail the affected operation with no partial
      acceptance. Preserve comment/bookmark/field ranges and required containers.
      Test original/final equivalence, mixed supported/unsupported selections and
      repeated accept/reject behavior without pretending it is universally reversible.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: content-control-values
    title: Implement content control inspection and filling
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inspect/fill supported plain/rich-text, checkbox, choice, date and picture SDTs.
      Respect tags/IDs, placeholder state, control/content locks and typed value rules.
      Use unambiguous control selection and explicit all behavior. Preserve properties,
      unsupported controls and external data bindings until supported synchronization
      is requested. Test empty values, choice rejection, date formatting, picture
      controls, nested controls and locked-state refusal using original forms.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: repeat-controls-and-bindings
    title: Implement bounded repeat controls and data binding
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement supported repeating-row/section expansion and explicit custom-XML
      binding synchronization from typed records. Validate template boundaries,
      namespace mappings and IDs before cloning; remap bookmarks/comments/drawings
      and relationships correctly per repeated item. Use a documented bounded binding
      selector subset, never arbitrary XPath/eval or silent detachment. Reject
      unsupported bindings/locks. Test count ceilings, empty arrays, duplicate keys,
      multiple controls bound to one value and invariant preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: custom-xml-and-glossary
    title: Preserve custom XML glossary and ancillary document parts
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory custom XML/items/properties, glossary/building blocks and ancillary
      resources. Preserve byte-identical unedited parts and their relationships.
      Permit only explicitly supported typed custom-value edits through the binding
      contract; raw XML replacement goes through full validation. Do not delete
      unknown parts as unused just because ordinary body traversal cannot see them.
      Test custom namespace data, building-block relations and no-op preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: typed-document-properties
    title: Implement core extended and custom properties
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Read/set/remove typed metadata with validated dates/numbers/booleans/strings,
      correct property names/IDs and missing-part creation. Do not update unrelated
      created/modified timestamps or cached page counts automatically. Remove only
      explicitly selected data. Preserve unknown custom types unchanged and reject
      unsupported mutations. Test document/template properties, Unicode/escaping,
      custom ID collisions and exact unrelated metadata preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: image-inventory-extraction
    title: Inspect and extract inline floating and shared images
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Report each drawing occurrence separately from each media resource: story,
      location, relationship, actual media type/bytes/hash, extents, crop, rotation,
      flips, wrapping, z-order and alt/decorative metadata. Handle inline, anchored,
      VML and alternate/fallback forms without decoding unsupported formats. Extract
      exact original bytes through bounded VFS publication, never render or fetch.
      Use the actual image-heavy QA fixtures and original shared-reference unit tests.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: raster-image-insertion
    title: Insert PNG and JPEG with correct dimensions and alt text
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Validate PNG/JPEG/GIF/BMP/TIFF signatures and bounded dimension/DPI headers under F32 and the complete public API map; reject
      extension/type mismatch and oversized/overflow dimensions. Insert inline
      DrawingML with correct media/content type/relationship/drawing IDs. Accept
      checked unit values and explicit aspect-ratio policy. CLI dimensions accept shared physical units only; implicit pixels/px are rejected. Omitted CLI/model dimensions use native per-axis DPI with independent 72-DPI fallback. Require/allow alt text and decorative intent according to schema.
      Test original authored images, alpha PNG, portrait/landscape JPEG and placement
      in body/table/header/note without rasterization dependencies.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: sdk-image-format-api
    title: Implement bounded image metadata and sizing API
    status:
      implement: done
      test: done
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Reconcile every accepted source image format and tested header/DPI/size behavior, including GIF/BMP/TIFF beyond PNG/JPEG. Implement bounded characterization, the sole contract's physical native aspect ratio/native-size defaults and original file/stream equivalents under explicit VFS capabilities. Add all missing API edge cases; no imported binary test fixtures or external decoders at runtime without policy-compliant explicit design.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: image-occurrence-replacement
    title: Replace one image occurrence or an explicitly shared resource
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Select by location/owner relationship rather than filename. For occurrence
      replacement clone/rebind the media resource so other references keep their
      bytes; shared replacement requires explicit intent. Preserve dimensions,
      anchor/crop/wrap/alt properties unless changed. Update content types and safe
      resource cleanup only when no references remain. Test one media part referenced
      multiple times across stories and different types with equal file names;
      verify exact bytes and graph changes independently.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: done
      test: done
  - id: floating-image-layout
    title: Edit floating image geometry crop rotation and wrapping
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement schema-valid anchored-image properties: relative horizontal/vertical
      frames, offsets/alignment, wrap modes, distances, overlap/behind-text/z-order,
      crop, rotation/flips and aspect lock. Preserve unchanged layout metadata and
      alternate representations. Validate units/ranges and reject combinations whose
      representations cannot be kept coherent. No rendered-coordinate accuracy claim.
      Test figures in the downloaded reports only for QA; reduce layout issues to
      small original unit cases and inspect representative rendered page images.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: svg-and-image-fallbacks
    title: Preserve vector formats and support explicit SVG fallback insertion
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Keep EMF/WMF/WDP/GIF/BMP/TIFF/SVG resources inert and byte-identical on unrelated
      edits. Handle MCE/SVG-plus-raster fallback relationships as a coherent occurrence.
      For explicit SVG insertion require bounded safe XML without scripts, DTD/entity
      or external references and a supplied validated raster fallback; do not fetch
      or rasterize. Reject incomplete replacement of linked representations. Test
      existing SVG/EMF/WDP cases from QA and retain authored tiny fallback regressions.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: shapes-and-text-boxes
    title: Inspect shapes and edit supported text-box stories
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory DrawingML/VML shapes, grouped objects, text boxes and watermark-like
      headers without flattening them. Reuse bounded text operations inside supported
      text-box story containers while preserving geometry, grouping, wrapping and
      alternate branches. Reject affected geometry or unsupported compound edits.
      Test legacy and current forms, nested text boxes, duplicate fallback text and
      shared headers. No shape renderer or automatic DrawingML-to-VML conversion.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: charts-and-workbooks
    title: Inspect charts and preserve embedded workbook relationships
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory chart parts, chart types, series labels/cached values, externalData,
      embedded workbooks and style/color resources. Provide structured read results
      with cached-data labels; preserve all chart/workbook bytes on unrelated edits.
      Do not present workbook/formula edits as supported unless their consistency can
      be proven by a separate explicit contract. No formula engine, external refresh
      or rendering. Test charts in original small documents and use real corpus only
      for QA; verify untouched workbook hashes and relationship graphs.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: smartart-and-diagrams
    title: Preserve SmartArt diagrams and extension graphics
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory diagram data/layout/style/color parts, drawing relationships and
      unknown graphics extensions. Preserve them on unrelated text/metadata/image
      edits; reject mutation of unsupported diagrams with precise locations. Never
      remove apparently unused parts based only on body traversal. Test an original
      minimal relationship graph and a separately sourced QA example if available.
      Make preserve-only behavior explicit in help and standards coverage.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: omml-equations
    title: Inspect preserve and explicitly insert validated OMML
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory inline/display equations and math properties. Preserve original OMML
      on ordinary text replacement and expose explicit bounded validated OMML fragment
      insertion/replacement at safe locations. Reject malformed math trees, external
      resources and XML namespace misuse; do not imply LaTeX conversion or evaluate
      expressions. Use the manifest-pinned nz-ghg-inventory-2025-vol-1 (45 OMML expressions) as QA input only and
      retain small original fraction/matrix/subscript fixtures for unit coverage.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: embedded-objects
    title: Inspect preserve and explicitly extract inert embedded objects
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory OLE/package embeddings, relationships and preview images. Preserve
      bytes and previews on unrelated edits and support bounded explicit extraction
      to VFS paths. Never activate, execute, import into host apps or fetch linked
      objects. Report macro/protected/unknown content without exposing secrets.
      Test preview/shared-resource graphs, embedded workbook bytes, missing targets,
      unsafe extraction paths and exact output limits.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: settings-and-protection
    title: Respect document settings protection and locked structures
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Read/preserve compatibility settings, update-field behavior, font embedding
      metadata, read-only/edit protection and locked content controls. Implement only
      explicitly permitted settings edits; protected or unsupported affected content
      must fail before publication. Do not crack passwords, bypass document rights
      or install fonts. Keep package-level supported/unsupported diagnostics distinct
      from host filesystem permission errors. Test ordinary edits around protected
      regions and preservation of unknown settings.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: signatures-and-explicit-removal
    title: Detect signatures and require explicit removal before editing
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Inventory OPC signature origin/relationship/part structures without claiming
      cryptographic validity. Default mutations reject signed packages. Provide a
      separate explicit strip-signatures operation that removes the complete signature
      graph/content-type entries safely and reports exactly what changed before any
      other requested edit. No automatic signature regeneration, misleading validity
      claim or dangling parts. Test multiple signatures and failure preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: range-and-structure-removal
    title: Implement exact range removal with reference preservation
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Remove selected text/ranges/structures with explicit endpoints and marker
      inclusion. Validate cross-paragraph/story/cell/field/revision boundaries before
      mutation. Preserve surviving text properties, section breaks and required empty
      paragraphs. Handle bookmarks/comments/notes/shared media with explicit update
      or rejection policies; delete resources only if the full graph proves them
      unreferenced. Test exact retained content, not reduced word counts.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: deterministic-dummy-text
    title: Generate seeded dummy text without privacy claims
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Replace explicitly selected visible text using a required seed and documented
      word/whitespace/structure policy. Preserve formatting, field instructions,
      relationships and nontext data unless separately selected by another operation.
      No wall clock, global random, network or external generator. Clearly state
      this is not anonymization. Test deterministic repeatability, non-Latin text,
      empty stories, limits and unchanged hidden metadata/images.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: explicit-sanitization
    title: Implement selective sanitization with an exact effect report
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Provide explicit enumerated actions for selected metadata, comments, supported
      revisions, external link bindings and embedded objects; no broad undocumented
      scrub-all promise. Validate combinations/unsupported review structures first,
      then apply through existing operations to a staged document. Preserve original
      until publication and report retained categories/gaps. Do not claim comprehensive
      privacy or recoverability removal. Test exact effects, reference cleanup,
      protected regions and mixed failure rollback.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: ordered-batch-operations
    title: Implement typed ordered batch edits with one publication
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Accept a versioned ordered array of typed operations shared with the CLI/SDK,
      with stable operation IDs and bounded counts. Reject unknown keys, invalid
      syntax, duplicate IDs, eval/callbacks and dual stdin consumers before edits.
      Parse/decompress once; resolve semantic selections against staged state and
      publish once after final validation. Any later failure discards the unpublished
      result. Charge budgets across all operations. Test field-to-placeholder-to-table,
      images/metadata and invalid last-step preservation.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: data-driven-template-expansion
    title: Expand templates from bounded typed records
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Add bounded record-driven template filling via supported literal placeholders
      and content controls, including repeated rows/sections. Use typed values and
      explicit templates, no executable expression language or arbitrary code.
      Validate record schemas, duplicate/missing fields, cardinality and inserted
      node/media budgets before publication. Remap IDs/relationships per repetition
      and preserve unrelated template content. Test empty and multilingual records,
      nested repeats within declared limits and post-expansion reference integrity.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: semantic-document-diff
    title: Compare package payloads and semantic document structures
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Implement package-part payload, semantic XML and logical text/structure modes
      with explicit selected scope. Ignore ZIP compression/order/timestamps in payload
      mode; semantic XML ignores prefix spelling/attribute order but preserves
      meaningful whitespace/order/values. Do not normalize arbitrary IDs to hide
      changes. Return bounded changes and statuses 0 equal/1 different/2 trouble.
      Use bounded algorithms and account both input packages. Test repacks, images,
      annotations, table changes and unchanged sources.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: safe-docx-extraction
    title: Extract admitted document parts into owned VFS destinations
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Validate the full archive namespace before any extraction, including excluded
      members. Support all/media-only selection and optional XML pretty output with
      explicit destination. Reject traversal, duplicates, links, ambiguous aliases and
      preexisting collisions using actual VFS contracts. Prefer exclusive owned trees;
      report possible partial new output on I/O/abort and clean only proven-owned
      resources. Never recursively remove preexisting user directories. Test exact
      bytes, read-only/mounted destinations and unsafe excluded entries.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: validated-docx-packing
    title: Reconstruct a DOCX from an explicit virtual directory
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Admit an explicit sorted VFS inventory, reject symlinks/unsupported kinds and
      output inside the input tree, validate OPC/XML graph then write using shared
      staged publication. Do not strip text whitespace from pretty XML or import
      ambient host files. Preserve opaque parts and output kind/dialect. Test
      extract-edit-pack, Unicode names, missing relationships, conflict and abort.
      Independently reopen output and compare all unaffected payloads.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: schema-capability-discovery
    title: Expose exhaustive schemas help and capabilities
    status:
      implement: open
      test: open
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Expose schema and capabilities commands from the actual declared operations and verified support levels. Generate matching help with selectors, scopes, limits, output semantics and edit/read/preserve/reject differences. Link every feature/API register row to a usable operation and test. Do not infer full editing from parser recognition or omit unsupported namespaces.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: adapt-upstream-opc-xml-images
    title: Adapt all OPC XML and image cases
    status:
      implement: open
      test: open
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Adapt every mapped package/URI/content-type/serializer/XML/image-characterization case, including all parameter variants, into independent original memfs tests. Preserve logical edge values but replace copied assets/snippets. Mock architecture cases must become observable invariants where possible; retain required notices separately. Reconcile every row in these families with a passing target test.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: adapt-upstream-text-style-document
    title: Adapt all text style and document cases
    status:
      implement: open
      test: open
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Cover every mapped document/paragraph/run/font/style/section/header/footer/hyperlink/page-break/comment/settings case and boundary. Express them through typed SDK behavior and original exact XML assertions, not Python private proxy classes. Test inherited/absent/explicit-false values, IDs, Unicode and shared header relationships. Add missing applicable behavior rather than silently deferring it.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: adapt-upstream-tables-bdd
    title: Adapt all table and BDD workflow cases
    status:
      implement: open
      test: open
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Cover every grid/row/column/cell/merge case and all expanded BDD scenarios with original unit/SDK/safe-bash tests. Account for grid-before/after, spanning cells, content preservation and invalid merge shapes. Keep renderer-only behavior in explicit Markdown QA when necessary and report its run status. Each upstream case row needs independent passing evidence or a specific justified semantic disposition.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: malformed-input-adversarial-review
    title: Verify hostile ZIP XML and document graphs
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Use an independent verifier where scoped instructions require one. Write tiny
      original adversarial fixtures for bad headers/CRC/sizes/descriptors, duplicate
      parts/IDs, encoded traversal, DTD/entities, namespace tricks, malformed fields,
      tables, review ranges and invalid relationships. Verify finite actual resource
      bounds and no implicit host/network activity. Preserve failures with small
      regressions before fixes. Do not count unsupported profiles as successful edits
      or weaken historical tests to obtain passes.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: lifecycle-adversarial-review
    title: Verify cancellation aliases budgets and publication failures
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Exercise abort and errors at every acquisition/read/parse/edit/serialize/publish
      phase, producer chunk reuse, backpressure, late errors and overlapping cleanup.
      Test byte/entry/node/work/match/batch/output ceilings at and over boundary,
      including both diff inputs and media copies. Verify aliases across mounts,
      unknown identities, read-only and conditional-write conflicts. Source/preexisting
      output must remain intact before successful publication. Mock transport results
      do not prove deployed S3/WebDAV behavior.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: large-document-profiles
    title: Measure large-document scaling and trusted profiles
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Use the measured corpus, including the 40,415,536-byte main XML annex, to assess
      configured default ceilings and an explicit trusted large-document profile.
      Measure wall time and observed memory separately from byte counters; identify
      superlinear growth through bounded controls. Preserve default over-limit results,
      then qualify raised limits without silently weakening defaults. Use original
      reproducible stress fixtures for missing size regimes, never giant unit tests.
      Record profile/machine/runtime and per-stage metrics in docs/docx/performance.md.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      Record the distinction between census and product ceilings: ordinary seed inspection used 512 MiB expanded and 5 million XML nodes, whereas the proposed product defaults are 256 MiB and 2 million. Exercise default rejection and explicit large-profile success through actual public SDK and Shell, including at least two successful large/dense round trips plus targeted edits. Do not label generated inputs as downloaded or claim the unfulfilled two-input 20 MiB/100 MiB acquisition regime.
    status:
      implement: open
      test: open
  - id: corpus-text-structure-qa
    title: Execute real-report text table field and structure QA
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Write and execute docs/plans/docx-corpus-structure-qa.md against manifest-pinned
      disposable downloaded files. For each admitted file perform inspect/text,
      unchanged round trip and a selected real edit based on its measured structures:
      metadata, split-run text, table cells, fields, sections or notes. Validate final
      package independently and compare untouched parts/source hashes. Distinguish
      pass/reject/fail/unrun and default/large profiles. At least two large/dense cases
      must successfully round-trip and edit. Every meaningful finding becomes a small
      original unit regression; full reports are not retained as permanent tests.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
  - id: corpus-image-qa
    title: Execute image-heavy and floating-figure QA
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Write and execute docs/plans/docx-corpus-image-qa.md using actual media census:
      Wales easy-read documents, illustrated reports and files with SVG/EMF/WDP
      fallbacks. Verify extraction hashes, one-occurrence/shared replacement, inline
      insertion, dimensions/alt text, anchored layout/crop changes and preservation
      of unsupported graphics. Open/render available representative outputs to inspect
      images, wrapping, clipping and fallback behavior separately from XML validity.
      No external linked-image downloads. Reduce findings to authored tiny media/unit
      fixtures before deleting disposable corpus/output files after QA.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
  - id: independent-ooxml-interoperability
    title: Validate outputs against independent OOXML tooling
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Choose an available independent standard/schema validator or test-only Open XML
      SDK consumer, pin its version and run against original representative outputs
      and selected disposable corpus edits. This is test infrastructure, never a
      runtime dependency or a build of another CLI implementation. Record validator
      profile/unsupported extensions; schema success is not visual correctness.
      Keep structural assertions authoritative for required invariants and classify
      validator discrepancies rather than relaxing checks indiscriminately.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: behavior-and-coverage-audit
    title: Audit F01-F50 behavior and measured code coverage
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Map each specification family and public operation to original tests proving
      supported edits, preservation/rejection boundaries and failures. Require a tiny
      regression for meaningful QA findings. Measure new DOCX/shared-ZIP/adapter code
      with explicit line/branch denominators; aim for 90%/85%, justify real platform
      exceptions and inspect uncovered mutation/error paths. No TODO/skip inflation
      or mirrored implementation assertions. Downloads/large QA remain separate from
      fast uncached maintained unit tasks.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: public-consumer-and-shell-qa
    title: Verify packaged SDK and actual virtual-shell workflows
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Test built public imports/types, explicit plugin collisions, CLI/SDK parity,
      quoted args, JSON stdin, binary pipelines/redirection and stored .sh files.
      Exercise actual Shell dispatch/status/pipefail/cancellation, not private-source
      shortcuts. Verify all needed emitted code/types/assets in the package, with no
      QA downloads/oracle dependencies included. Browser/workerd exports require
      actual full-closure tests or honest unavailable conditions. Preserve maintained
      literal test inventories and build guards; no blanket exclusions.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
      test: open
  - id: audit-upstream-test-completeness
    title: Verify complete upstream test accounting
    status:
      implement: open
    prompt: |
      Use docs/specs/docx.md and root/scoped AGENTS.md. Documentation/research only; do not implement the product in this task.
      Read docs/docx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/docx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Reconcile the complete pinned unit/BDD inventory against test-case-map.json and actual original TS test results. No unexplained rows or blanket exclusions; all applicable behaviors need evidence. Distinguish architecture-only substitutions, intentional spec differences and deferred public functionality. Deferred public behavior blocks parity claims. Supplement upstream coverage with original security, preservation and large-file cases; coverage percentage is not OOXML conformance.

      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates. Preserve unrelated work; never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits. Do not push or release.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: cross-format-cli-conformance
    title: Verify cross-format command consistency
    status:
      implement: open
      test: open
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Run the common contract cases against both available public adapters: identical common paths, option names, output envelopes, ordinary exit codes and diff 0/equal 1/different 2/trouble 130/cancel. Verify no singular image/table or metadata aliases, no top-level replace and no silent ignored flags. If the counterpart is not built, verify its declared schema and retain that runtime half as pending rather than claiming paired success.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: whole-api-acceptance
    title: Verify the entire public API and examples
    status:
      implement: open
      test: open
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Close public-api-map.json against reconciled docs, actual exports and original tests, including members absent from upstream tests. Execute original JavaScript equivalents of all guide workflows with unit/SDK/CLI evidence. Every supported behavior needs a CLI route; every language/security difference is explicit. Unsupported public members block full coverage claims; do not replace the denominator with the subset implemented.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: ergonomic-cli-qa
    title: Execute paired command usability and help QA
    status:
      implement: open
      test: open
    prompt: |-
      Work on docx using root/scoped AGENTS.md, docs/specs/docx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Execute agent QA and permit only validated usability fixes, with a failing original test before code and maintained verification.
      Read docs/docx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/docx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Execute docs/plans/office-cli-qa.md against built commands, inspecting help/error screenshots via maintained tooling. Verify that common tasks are concise, selectors discoverable, errors actionable and advanced data supported without forcing JSON for simple edits. Fix validated usability defects through failing focused tests; no screenshot test suite or scripted QA replacement. Record unrun counterpart cases honestly.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: visual-cli-and-document-qa
    title: Inspect CLI and representative document page screenshots
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Write and execute docs/plans/docx-visual-qa.md with actual supported commands.
      Use screenshot-poe-code for help/text/JSON/errors and inspect images; no screenshot
      tests. Use an available documented renderer via the applicable document skill
      for representative edited outputs with images, tables, sections, lists, notes,
      comments/revisions and RTL/CJK when available. Inspect repair warnings, wrapping,
      page breaks, clipping and missing graphics. Record app/version and unverified
      cases honestly. Visual checks are QA only; turn meaningful defects into small
      structural unit tests before fixture cleanup.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
  - id: cross-workspace-release-readiness
    title: Run maintained build lint and unit routes
    prompt: |
      Implement only the bounded task below for the original TypeScript docx utility.
      Read docs/specs/docx.md, the root AGENTS.md and any scoped AGENTS.md. Product
      logic belongs in packages/docx or a minimal shared codec; safe-bash adapters
      belong in packages/safe-bash/src/commands/docx and root only wires exports.
      Keep CLI/SDK parity, original names and original tests. Use failing tests before
      code and memfs for unit-test mutations; adapt external behavior cases with original data. No native
      reference build, ambient host I/O or product networking.
      Downloaded files are disposable QA fixtures only. Reduce meaningful findings
      to small original unit regressions independent of downloads. Preserve unrelated
      work and historical evidence; run maintained checks for the changed scope.

      Because shared codecs/packages and root exports cross workspaces, run npm run
      build, npm test and repository-wide maintained lint after focused checks pass.
      Use declared workspace dependency closures and uncached maintained routes;
      root-only test:unit is not a substitute. Do not create unit tests for workflows;
      use lint:workflows if changed. Resolve validated failures without reverting
      others' changes. Verify packed consumers and runtime closure, but do not push
      or publish. Report build, unit, lint and consumer evidence separately.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      This task is a local integration gate, not release authorization. Run after all SDK, case adaptation, schema/selector, ergonomic and whole-API corrections, so evidence qualifies the final owned revision. For virtual-bash use maintained npm test --workspace=virtual-bash and test:contracts where contracts changed, plus npm run typecheck:all --workspace=virtual-bash for build/source/tests/strict consumers. Root ESLint uses npm run lint:eslint with only supported flags, no path operands/direct ESLint bypass. verify:release:whole and launcher-v3 are retired, not passing gates. Use maintained build/workspace closure declarations, not fixed task counts or root-only test:unit. Scope SAFE_BASH_TEST_RG, SAFEJS_LOCAL_ROOT, S3_HTTP_EXPORTS_REVISION and FULL_GATE_ROOT to the virtual-bash unit child; clear repository-local Git hook variables in children using git rev-parse --local-env-vars without changing the parent or private/global Git config. Preserve guarded ownership receipts; report unavailable prerequisites honestly.
    status:
      implement: open
      test: open
  - id: usage-and-support-documentation
    title: Document truthful usage schemas and feature support
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      Update docs/docx/usage.md, standards-coverage.md and acceptance-matrix.md with
      verified imports/commands and each feature's actual read/edit/preserve/reject
      level. Document all options, schemas, limits, environments (prefer none), output
      safety, cached fields/pages, image formats, protection, signatures and runtime
      availability. Keep corpus provenance only in QA evidence. Draft required package
      README content in docs/docx; apply README changes only with explicit permission,
      otherwise report pending documentation. Do not claim full OOXML/Word compatibility
      or implemented status without the required evidence.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
  - id: retire-disposable-qa-fixtures
    title: Delete disposable QA files after preserving useful regressions
    prompt: |
      Work on the proposed original docx utility using docs/specs/docx.md and root
      AGENTS.md. Do not implement product code or change README files in this task.
      Keep all planning/QA plans in docs/plans, durable specifications in docs/specs,
      and evidence/manifests in docs/docx. Adapt external behavioral test cases into original tests; do not copy branding
      or binary fixtures. Downloaded documents are disposable QA inputs, not shipped
      assets or canonical unit tests. Do not push or release.

      After the corresponding QA campaign finishes, audit its findings and ensure
      each meaningful behavior/bug has a small original deterministic unit regression
      or explicit unresolved disposition. Retain source URLs/hashes, feature census,
      concise results and test links; do not retain full copyrighted passages or images
      inside regressions. Verify canonical unit tests work without the corpus.
      Then delete only manifest-listed downloaded QA fixture files and owned generated
      outputs in the dedicated disposable cache, or retain them only while another
      explicit campaign still needs them. Never delete unrelated files or broad parent
      directories. Record cleanup counts and retained evidence; raw fixtures need not
      be kept indefinitely and never ship with the product.

      After the task passes its relevant maintained checks, commit each atomic improvement
      with a Conventional Commit on main. Stage only owned files explicitly, include
      relevant plan updates, preserve unrelated changes, and never commit ignored QA
      fixtures, use --no-verify or add a co-author. Do not create empty commits for
      read-only work. Report local commit hashes; do not push or release.


      Reference-project names, links and attributions belong only in plans/research
      and required standalone legal notices. Never put them in product source, code
      comments, test names, fixtures, identifiers, CLI output or package branding.
      Adapt behavioral cases with original wording/assets; retain any required MIT
      notice separately for substantial derived material.


      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/docx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status:
      implement: open
steps:
  implement:
    prompt: |-
      Execute only this task under its complete prompt. Follow failing-tests-before-code and its owned commit rules; keep later tasks pending.

      {{prompt}}
  test:
    prompt: |-
      Verify only the task below against its acceptance requirements and maintained scoped checks. Inspect actual outputs and prior red/green evidence; reproduce any new defect with a failing original memfs test before fixing. Commit only verified task-owned corrections as atomic Conventional Commits. Preserve unrelated work and index entries; no push, release, README edits or broad staging. Report checks and gaps; do not rerun implementation blindly or claim unavailable QA passed.

      {{prompt}}
finalization: pending
---

# Comprehensive docx implementation pipeline

The utility is named **docx**. Its original TypeScript engine and typed SDK expose
safe inspection, creation and editing through an explicit safe-bash plugin.
This draft is grounded in [the proposed specification](../specs/docx.md), which
contains the F01-F50 standards/feature matrix, and the [actual QA fixture
manifest](../docx/corpus-manifest.json). It is not a request to start execution.

## Scope

107 separately reviewable tasks cover standards/schema research;
OPC/ZIP/XML/MCE and Strict/Transitional; text/formatting/styles/themes; sections,
headers/footers; lists and merged/nested tables; links/bookmarks/fields/TOCs/
notes; comments/revisions/controls; metadata; inline/floating/shared/vector
images; shapes/charts/SmartArt/equations/embedded objects; protection/signatures;
batch/template workflows; comparison/validation/extraction/packing; budgets,
publication and conformance evidence.

Preserve-only features have explicit requirements and tests. The plan does not
promise a Word page-layout engine, formula calculation, macro execution or
cryptographic signature validation. It cannot be declared complete with an
undisclosed passing subset. Every feature family has a read/edit/preserve/reject
level; independently verified behavior determines the shipped support table.

## Actual QA fixtures

Documents are already downloaded under the ignored `.cache/docx-corpus`
directory. See [the census and source report](../docx/corpus-report.md) for actual
sizes, embedded media, paragraphs, tables and profile gaps. Includes long
illustrated reports, an equation-bearing appendix, a table-heavy technical
inventory and accessible documents with many inline/floating graphics.

**These are disposable QA fixtures, not permanent unit fixtures.** Use them for
real-world qualification, preserve original bytes during each campaign, then
delete downloads and owned outputs after QA. Meaningful behaviors and defects
must survive as small original deterministic in-memory unit tests. The manifest,
checksums, concise results and reduced regressions survive cleanup. No downloaded
binaries ship in the package or become a dependency of the fast unit suite.

Large-file runs are separate explicit QA profiles. A measured XML-size admission
failure is not a corruption finding. Raising a trusted QA ceiling is recorded
separately and does not silently change product defaults. Cached page metadata
is not proof of rendered pagination. Original generated stress files remain
clearly distinguished from downloaded real documents.

## Execution and completion

All 107 tasks are ordered and self-contained. The configured pipeline steps are selected per task: documentation/research uses `implement: open`; code and behavioral verification use `implement: open` and `test: open`. No task selects `commit` or `release`. Each task
prompt includes implementation or documentation, appropriate validation, and atomic
Conventional Commits of explicitly staged owned files on main. Setup and teardown
are explicit. Commit instructions remain inside owned task prompts. Explicit implement/test overrides prevent generic inherited instructions from broadening ownership. The configured automatic Git teardown is replaced by the plan's explicit teardown.
Do not push or release. This edit does not start execution of the plan.

Run focused maintained checks per task, then full maintained build/unit/lint and
public-consumer checks for the cross-workspace integration. Use schema/semantic
assertions, original small tests, real Shell scripts/pipelines and separate
corpus/visual evidence. Missing renderers, unsupported profiles and unrun cases
are reported as such. README additions remain subject to repository permission.

## Reference isolation

Reference projects may be named and crosslinked in this plan and research evidence.
They must never be named in product source, code comments, identifiers, test names,
fixtures or CLI output. Original fixtures preserve behavioral boundaries; legally
required attribution for derived material belongs in standalone notices.

Related plan: [pptx](./pptx-typescript-safe-bash.md).
Related audits: [presentation](../pptx/upstream-test-audit.md) and
[document](../docx/upstream-test-audit.md).

## Consistent commands and complete JavaScript SDK

[The shared CLI contract](../specs/office-cli.md) fixes naming, selectors, common
flags, JSON, publication and exit semantics. [The SDK contract](../specs/office-sdk.md)
requires the complete documented public object API with neutral method/property
spellings retained and explicit JavaScript/sandbox mappings. The [API audit](../docx/upstream-api-audit.md)
and [candidate inventory](../docx/upstream-api-inventory.json) supplement the
full test inventory; untested public APIs still require original tests.

Acceptance includes a complete feature-to-command register, direct flags for
common workflows, schema/capabilities discovery, paired command recipes and
CLI/SDK equivalence. A candidate inventory is not proof of completed coverage.

## Preparation snapshot and execution dependencies

Prepared on 2026-09-13 from the actual JSON inventories and audits. No task is marked complete by this plan edit. Recheck these hashes when execution begins; document a changed baseline instead of silently reusing old coverage denominators.

| Input | SHA-256 |
| --- | --- |
| `docs/specs/docx.md` | `c9aaa6e6c78e761fa665ff3bc5a77e07244a3bc1a8406b7aec38c799ce2ee434` |
| `docs/specs/office-cli.md` | `cb5614e03c841f31d98efe4bcf2aabdb419926aa26775d17b401598d9a2d74ce` |
| `docs/specs/office-sdk.md` | `a73354b0e643eef159f9bda0cb9b096234fb34f0d224c3fbead5a92f38e673b9` |
| `docs/docx/corpus-manifest.json` | `6f044ed7ea327bef04fe71d07e3c79f2bb4f8e5fbfaa603154009c76f6348f81` |
| `docs/docx/upstream-test-inventory.json` | `14c609ceb775158cb36c0423d24678b4a3e9f09d429085730b28103a759ad797` |
| `docs/docx/upstream-api-inventory.json` | `2a24cf4475d4bccae0f2433d0b59dfd06fb55f964eae839459b2f93a74fdb919` |

The test inventory contains **1,609 unit variants + 650 expanded BDD cases = 2,259 required dispositions** at commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7`. All adaptation statuses remain `unmapped_not_implemented`. The API inventory contains **331 candidate records across 39 documentation files**; inherited/protocol/prose/alias closure can increase that denominator. A coverage register is preparation, never passing behavior evidence.

The manifest lists **19 files, 142,217,570 compressed bytes and 655 stored media parts**. Every product status is `not_run_product_not_implemented`. The ordinary census profile allowed 512 MiB expanded/5 million nodes, above the proposed product defaults of 256 MiB/2 million; census admission must not be presented as default product admission. Volume 2's 40,415,536-byte XML required a separate 128 MiB XML profile rather than the 32 MiB default. Its 46,916 paragraphs, 44,985 cells, 698 vertical-merge markers and nine charts motivate original table/limit/preservation regressions. Volume 1 contributes 45 OMML expressions and five embedded objects; the easy-read fixture has 124 media parts, 29 floating drawings and 30 text-box containers.

Comments/revisions, Strict and meaningful RTL/CJK behavior remain evidence gaps. Language tags alone do not establish those workflows. Only one input exceeds 20 MiB compressed and none exceeds 100 MiB expanded: do not claim the earlier two-large-file acquisition target. At least two explicitly admitted large/dense inputs must actually round-trip and complete targeted edits before a scoped large-document claim; separately labeled original stress inputs cover missing size regimes. The Scotland template remains read-only pending rights review. The cache remains available for future campaigns; this planning edit does not delete it.

Execution order puts API mapping and contract reconciliation before product code; bounded ZIP/XML/OPC/publication before SDK and command construction; SDK primitives before feature use; all assigned source cases enter the owning feature's red/green cycle. Later adaptation tasks close any residual variants before adversarial/corpus acceptance. Selector/schema work precedes public consumers and paired QA. The final cross-workspace gate follows whole-API, ergonomic and visual corrections. No later task may begin merely because a worker on the current task is waiting.

A task closes only with owned-file changes, exact applicable case/API/feature mappings, verified checks and atomic local commits during execution. Preserve red/green evidence and distinguish structural assertions, actual SDK/Shell results, renderer evidence and unavailable cases. Deferred public APIs remain blocking gaps. A later product correction invalidates affected earlier evidence and requires scoped requalification before the final gate. README permission remains a separate documentation-delivery constraint; keep complete usage/config/environment drafts under docs/docx.
