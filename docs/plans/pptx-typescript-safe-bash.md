---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Original pptx utility — comprehensive PresentationML implementation
readiness: draft
setup:
  prompt: |
    Read root/scoped AGENTS.md and docs/specs/pptx.md. This is a stepless pipeline for an original TypeScript utility named exactly pptx with matching SDK and explicit safe-bash plugin. Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json, corpus-manifest.json and corpus-report.md. Account for all upstream parametrized cases and BDD examples through original tests or explicit reviewed semantic dispositions. Retain required MIT notices for derived material without product branding. Use TDD and fast memfs unit tests; follow scoped ownership/delegation. Downloaded files are disposable QA inputs only; reduce meaningful findings to small original regressions before cleanup. Work on main and preserve unrelated changes. Commit verified atomic improvements with explicit owned paths and relevant plan updates; do not push or release. README edits require permission; keep drafts in docs/pptx. Tasks execute in listed order. Override inherited automatic broad Git teardown.
    Reference-project names, links and attributions belong only in plans/research
    and required standalone legal notices. Never put them in product source, code
    comments, test names, fixtures, identifiers, CLI output or package branding.
    Adapt behavioral cases with original wording/assets; retain any required MIT
    notice separately for substantial derived material.
    Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Map every
    collected parametrized unit case and expanded BDD example; no handpicked subset.
    All applicable cases require original passing TS tests. Private Python mechanics
    may map to equivalent observable assertions with an explicit rationale. Difficult
    public behavior is not architecture-only; any deferral remains a visible gap and
    blocks parity claims.

    Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
    command/SDK contracts. Use plural resources (images, tables, properties), text
    replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
    The model SDK retains documented neutral method/property spellings; whole public
    API coverage includes inherited members, enums, collections, helpers and APIs
    without upstream tests. Read docs/pptx/upstream-api-audit.md and
    upstream-api-inventory.json; record exact JS language/security mappings and
    resolve documentation drift. Do not hide unsupported public APIs as private
    merely because a type name starts with an underscore. Reference-project names
    remain only in plans/research and legally required standalone notices; never in
    code, comments, tests, fixtures or CLI output.
teardown:
  prompt: |
    Verify completed tasks have maintained-check evidence and atomic Conventional Commits of explicitly staged owned paths. Do not stage unrelated changes or ignored fixtures; never use --no-verify or add co-authors. Report local hashes, actual feature support, complete upstream case dispositions, corpus edits, independent render/playback evidence, reduced original regressions and disposable cleanup. Update task states and Implemented Through only when verified. Do not push or publish; no blanket completion or conformance claims.
    Report complete upstream-case accounting and verify reference identities are absent
    from product code/comments/test names/fixtures/CLI. Preserve required standalone
    legal notices; no implicit exemption for substantial copied test material.

    Verify complete feature-to-command and documented-public-API registers, paired
    command ergonomics evidence and public SDK type/behavior tests before completion.
    No unexplained omissions or SDK-only public capability gaps.
tasks:
  - id: pin-standards
    title: Pin PresentationML and extension schemas
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create docs/pptx/standards-coverage.md from actual ECMA-376 Part 1/2/3/4 and Microsoft extension sources. Pin revisions, schema hashes and real clauses for F01-F60; include DrawingML, chartEx, SVG, modern comments, media and timing namespaces. Distinguish Strict, Transitional and vendor extensions, list unsupported subfeatures, and map read/edit/preserve/reject evidence without claiming ISO certification.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: done
  - id: reconcile-documented-public-api
    title: Reconcile the whole documented public API
    status: done
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Reread the pinned API/user guides and published docs linked in upstream-api-audit.md. Complete the candidate RST/autodoc inventory with inherited/protocol/prose-only members, enum aliases, constructors, returned interfaces and read/write signatures. Resolve every source/docs mismatch with evidence. Do not treat the current candidate count as an exhaustive certificate or use the test suite as the only API inventory.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create docs/pptx/public-api-map.json with one row per documented member/value/protocol: source revision, target TS signature, arguments/defaults, getters/setters, return/ownership, errors, side effects, CLI route and original tests. Retain neutral public snake_case names rather than inventing parallel aliases. Apply shared async/iteration/index/null/unit/date/security mappings. Separate object-model names from common camelCase operation options. Full API coverage is the target; missing public behavior is not an accepted silent exclusion.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: map-all-features-to-commands
    title: Map every feature and API behavior to commands
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create docs/pptx/command-coverage.json mapping every format feature and documented SDK behavior to exact command paths, arguments, common options, operation IDs, schema/help and tests. Preservation-only content maps to inspection plus retention tests, not fake editing commands. Common edits need simple flags; advanced behaviors may use typed batch operations, never eval/dynamic arbitrary method invocation. Every public operation needs a discoverable CLI route.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Create or update docs/plans/office-cli-qa.md with side-by-side docx/pptx command recipes for creation, text reading/replacement, image list/replace/extract, table cells, properties, templates, batch, diff and capabilities. Include spaces/Unicode/--, stdin ownership, dry-run, in-place, shared resources, ambiguous and stale selectors, error recovery and help. Recipes are proposed until implementation executes them; keep QA in Markdown, not a runner script.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: audit-upstream-baseline
    title: Verify both pinned upstream test audits
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Read the existing pinned repository audit and full collected inventory for presentation tests and docs/docx/upstream-test-audit.md for shared OPC/XML/image behavior. Reproduce the documented environment if needed in isolated temporary checkouts; retain original collection failures and dependency resolution. Distinguish unit line/branch coverage from BDD and format coverage. Reuse existing results when hashes match; do not execute Python in the product.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: map-every-upstream-case
    title: Assign every upstream test variant a destination
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create docs/pptx/test-case-map.json with one row per collected parametrized node ID and expanded BDD scenario/example in upstream-test-inventory.json. Record source SHA, original behavior, target original TS test/task, equivalence rationale, status and evidence. All applicable behaviors must be adapted. Python-only mocking/class mechanics may map many-to-one to observable assertions with reasons; unsupported public behaviors stay explicitly deferred and prevent claims of full parity. No blanket skips, function-count shortcuts or silent deletion of difficult cases.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: resolve-cli-contract
    title: Define complete CLI grammar and SDK schemas
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Expand docs/specs/pptx.md with exact operations/flags/JSON schemas for all command families, including cardinality, selectors, units, stdin ownership, scope and output publication. Define null/empty/absent behavior, first/all matches, error contexts and defaults. Ensure each supported operation has a typed SDK equivalent and each preserve-only feature is labeled. Resolve basic chart, animation, geometry and SVG-fallback subsets explicitly before dependent implementation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      The common CLI decisions are already fixed in office-cli.md; complete only the
      format-specific grammar and shared register entries without renaming common
      paths/options. Replace old top-level replace/image/table/metadata vocabulary
      with text replace/images/tables/properties. Include schema and capabilities.
    status: open
  - id: audit-corpus
    title: Verify acquired presentations and feature gaps
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Audit actual downloads and hashes in docs/pptx/corpus-manifest.json, publisher/license evidence and measured parts/media/timing. Treat census as preparation, not product success. Keep large-profile/default-limit outcomes separate, source bytes immutable and QA copies disposable. Identify missing chart, SmartArt, comment, RTL/CJK, Strict, signature, media and unusual layout cases.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: fill-corpus-gaps
    title: Acquire additional varied presentations
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Find public decks from independent publishers for measured coverage gaps and actually download accessible files. Record landing/direct URL, hash, date, rights caveats, size and census; no access-control bypass or linked-resource fetching. Use bounded public HTTPS acquisition, at most two simultaneous transfers and a recorded total cache budget; exceptional large downloads require a named ceiling distinct from product defaults. Add original synthetic cases for unavailable features and never count those as real downloads.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: qa-procedure
    title: Write the presentation QA campaign
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create docs/plans/pptx-qa.md as an agent-executed Markdown procedure, covering create/read/edit, defaults and large profiles, multiple renderers, fonts, image comparison, notes, animation/media playback and cleanup. List deterministic mutations and expected unchanged slides/resources for each selected fixture. Separate structural, schema, rendered and application evidence. Every meaningful finding must be reduced into an original tiny unit regression before closure; never replace this procedure with a QA runner script.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: package-boundaries
    title: Define package and codec ownership
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inspect existing archive codecs and any docx implementation completed since this plan. Record minimal shared ZIP/OPC/XML boundaries in docs/pptx/architecture.md; no dependence on another plan being finished and no duplicate archive engines without evidence. Define explicit byte/VFS/publication capabilities, runtime dependency closure, browser/workerd requirements, and safe-bash plugin integration. Root remains wiring; do not broaden scope into a generic Office framework.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: original-fixture-primitives
    title: Build small original in-memory fixture primitives
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Author tiny decks about a seed library, coastal observatory and bicycle repair workshop, with original text and image bytes. Provide minimal parts, masters/layouts, grouped objects, charts, timings and optional malformed variants using memfs. Independent expected structures must not be generated by the code under test. Adapt upstream behavioral inputs without inheriting disk dependencies, fixture binaries or Python object-model ceremony.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: independent-assertions
    title: Build independent graph and XML assertions
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create narrow test helpers for part hashes, relationships, slide order, inherited properties and resource occurrence counts. Expected values must be declared independently rather than read back through the writer's own model. Add negative controls that deliberately corrupt IDs, omit media and change an untouched part so assertions prove they detect each defect. Keep helpers simpler than the implementation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: regression-reduction
    title: Define reproducible fixture reduction
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Document reduction steps in docs/plans/pptx-qa.md: isolate the smallest slide/part graph, replace all external text/media with original equivalents, retain the triggering structure, prove a failing test and fix. Map every meaningful finding to a permanent unit test plus source fixture hash/evidence; keep third-party assets out of regressions. Distinguish structural simplification from changes that remove the defect.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: package-sdk-shell
    title: Create the PPTX package and public SDK shell
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Add the minimal maintained TypeScript ESM workspace with strict types, declared exports, build/test routes and capability-injected byte APIs. No runtime dependencies unless repository policy explicitly permits a justified choice; investigate existing primitives first. Define typed operation/result/error/options contracts without dummy proxy layers or a second CLI implementation. Draft required package usage/config documentation in docs/pptx pending README permission.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: zip-reader
    title: Implement bounded ZIP reading
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Use or extract the verified existing codec for stored/deflated entries, descriptors, ZIP64 within ceilings and exact stream ownership. Test truncated headers, wrong CRC, local/central disagreement, duplicate names, declared/actual expansion mismatch, encryption and multi-disk rejection. Cover applicable upstream OPC reader cases through independent bytes, plus adversarial cases absent upstream.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: zip-writer
    title: Implement deterministic ZIP writing
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Write valid CRCs, sizes, local/central records and deterministic entry ordering with explicit compression policy. Reuse untouched member bytes where practical while preserving unmodified part payloads exactly. Test descriptors, empty entries, UTF-8 names, size boundaries, output ceilings and cancellation against an independent ZIP reader. Do not claim byte-identical container output after edits.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: opc-identity
    title: Implement OPC names and content types
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Parse content types and package URIs with standards-based normalization, explicit case/collision policy and no host path interpretation. Reject traversal, unsafe percent encoding, invalid duplicate overrides and wrong main-part kind. Test suffix/content-type disagreement and template/show distinctions. Cover upstream PackURI and content-type parameter variants.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: opc-relationships
    title: Implement relationship graph traversal
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Resolve relationships relative to their owning part, distinguish internal/external targets, enumerate reverse edges and traverse with visited sets. Relationship IDs are source-local. Preserve unknown relationship kinds; never fetch external targets. Test cycles, dangling references, aliases, missing rels, collision remapping and imported graphs with independently expected closures.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: xml-preservation
    title: Implement namespace-aware preserving XML edits
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Admit bounded XML with DTD/entities prohibited, preserve unknown attributes/subtrees/comments/processing instructions and meaningful whitespace, and edit schema sequences precisely. Use a parser and structured merge, never regex replacement. Test alternate prefixes, namespace shadowing, empty elements, escaping and exact untouched subtrees. Avoid a whole-part lossy serializer.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: strict-mce
    title: Implement Strict and MCE behavior
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Detect original namespace dialect, select understood AlternateContent branches by Requires and preserve all fallback/unknown branches. Honor ignorable/process-content requirements and reject unsupported must-understand content when appropriate. Test Strict decks, missing fallbacks, extension namespace aliasing and edits that would make alternate representations inconsistent. Never silently convert dialect.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: semantic-validator
    title: Implement semantic package validation
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Validate presentation main-part uniqueness, content types, relationship targets, slide IDs, shape ID scopes, masters/layouts, note associations and timing/connector references. Report schema validation separately from implemented semantic rules. Preserve unknown valid parts and reject known malformed required structures. Add independently malformed examples for every reported rule.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: budgets-cancellation
    title: Enforce cumulative resource budgets
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Apply spec ceilings to actual compressed/expanded bytes, nodes, depth, slides, shapes, graph copies, media and outputs. Merge/diff/batch share cumulative work ceilings; callers cannot exceed host limits. Test cancellation during read, inflate, parse, clone, validation and serialization with bounded yielding. No per-operation budget resets within a batch.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: publication
    title: Implement safe output publication
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Stage and validate before output, enforce force/in-place semantics and fingerprint checks, and use only declared adapter atomic/conditional capabilities. Reject unsupported in-place protection before writing. Multi-file operations need a transaction or explicit partial-output mode and manifest. Test input/destination preservation under failure, cancellation, stale writes and stdout transport errors.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: selectors
    title: Implement stable scoped selectors
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Build fingerprinted slide/part/object selectors with one-based CLI positions and explicit JSON coordinate systems. Names may be nonunique; reject ambiguity unless all is explicit. Preserve slide IDs across reorder and scope shape IDs by owner; support created-object handles in batch. Test shuffled filenames, duplicate names/IDs across slides, stale tokens and out-of-range selections.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: command-plugin
    title: Wire the explicit safe-bash PPTX plugin
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Add the command through maintained registration/export mechanisms, opt-in only, with collision preflight and SDK-backed execution. Honor existing byte streams, VFS root/capabilities and process cancellation. Test plugin absence/presence, multiple registrations, shell quoting, pipelines and actual .sh script invocation; no native shell fallback or ambient files.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: cli-json-help
    title: Implement CLI parsing and output contracts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement validated grammar, stable JSON envelopes/exit codes and clean stdout/stderr separation for binary/text/JSON outputs. Cover unknown options, schema keys, conflicting stdin, output modes, missing arguments and no matches. Use existing design-system wrappers for interactive surfaces; record screenshot QA for help and errors without snapshot tests.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: inspect-parts
    title: Implement deck and part inspection
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Expose ordered slides, master/layout/theme graph, part/media inventory, effective/explicit property distinctions, feature flags and stable identifiers. List unsupported content rather than omitting it. Validate counts on original multi-master fixtures and shuffled package entries; do not count notes/master shapes as slide-local shapes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: raw-xml
    title: Implement raw XML and validated replacement
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Expose bounded original XML bytes and explicitly labeled pretty output. XML-part replacement must parse namespaces and validate content type, sequence and graph before publication. Reject arbitrary part paths and dangling resources. Preserve unrelated parts exactly and test replacement that would invalidate signatures or dialect.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: new-deck
    title: Create minimal original presentations
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create valid macro-free presentation/template/show with explicit slide size, theme, master/layout graph and structured slide content. Produce deterministic authored defaults rather than copying upstream templates. Test independent reopening, empty/one-slide policy, required parts/content types and date metadata without ambient time.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: slides-add
    title: Add slides and apply layouts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Insert slides at validated positions, allocate IDs and bind an explicit layout/master. Populate matching placeholders by type/index without assuming universal title/body indices. Preserve layout defaults and reject ambiguous matches. Test blank/custom layouts, duplicated shape IDs on other slides and all insertion boundaries.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: slides-reorder
    title: Reorder rename and hide slides
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Mutate presentation order and visibility while retaining slide identity, notes, links, animations and unrelated parts. Names are labels rather than keys. Test reversed/nonconsecutive selections, hidden slides and exact slide-ID stability; list order must not follow filenames.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: slides-delete
    title: Delete slides with dependency checks
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inspect reverse references from custom shows, sections, links/actions, notes and extensions. Require explicit repair/remove policy for affected references; reject opaque unresolved targets. Remove only proven unreferenced owned graph parts and retain shared themes/media. Test deleting first/last/all-selected slides and shared resources.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: slides-clone
    title: Duplicate slides and their object references
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Clone slide-local shapes, notes and required dependent resources with deterministic fresh IDs and correct rels. Preserve or remap connector and supported timing targets; do not accidentally alias mutable notes or charts. Test shared versus clone-on-write resources and unsupported references that must reject copying.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: slides-import
    title: Import slides across decks
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Import full dependency closure and preserve source appearance by default. Remap part names/relationships/IDs and deduplicate only proven equivalent resources. Handle notes masters, layouts, themes and collisions between unrelated identically named resources. Test source/destination dimension conflict policy and exact unaffected destination hashes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: merge-split
    title: Implement bounded merge and split workflows
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Merge ordered selections from multiple decks and split into independently valid packages using import semantics. Charge combined budgets, resolve intra-deck navigation across selected boundaries explicitly and produce deterministic output manifests. Test publication failure/partial mode and missing referenced slides. Do not copy only slide XML.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: sections-shows
    title: Edit sections and custom shows
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create/rename/reorder/remove section and custom-show membership with stable IDs and extension preservation. Keep slide lists consistent on deletion and duplication. Test empty/duplicate names, hidden slides, repeated show entries where allowed and unsupported section extensions.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: presentation-settings
    title: Edit presentation dimensions and view settings
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inspect/edit supported slide/notes dimensions, orientation, numbering and slideshow options. Changing slide size must default to changing canvas only; scale-content is explicit and must handle group geometry or reject unsupported transforms. Preserve grid/view/print and vendor settings outside requested edits.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: master-editing
    title: Create and edit slide masters
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create and edit supported master shapes, text, backgrounds and layout associations under explicit shared scope. Report affected slides and retain local overrides. Test multiple masters, unattached layouts, shared themes and edits that change inherited versus explicit values.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: layout-editing
    title: Create edit and rebind layouts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Manage layout IDs, master associations, placeholders and supported layout properties. Applying a layout requires deterministic placeholder mapping and explicit handling of unmatched local objects. Test placeholder inheritance, missing type/index and preservation of local formatting; never silently drop content.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: theme-resolution
    title: Resolve themes and effective formatting
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Resolve explicit properties, placeholder/layout/master styles, theme references and color-map overrides with source provenance. Preserve unresolved tokens and no-flattening invariants. Test positive and missing-value inheritance cases, theme font variants, scheme colors and destination-theme changes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: theme-editing
    title: Edit themes and backgrounds
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Edit supported theme palettes/font schemes/style references and solid/gradient/picture backgrounds with explicit shared scope. Preserve extended effect lists and unsupported theme payloads. Test theme overrides, contrast-relevant color changes, missing image resources and one-slide versus shared updates.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: text-extraction
    title: Extract structural slide and notes text
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Emit paragraphs/runs/breaks/fields in defined shape-tree and slide-list order with scoped notes/layout/master selection. Retain Unicode and distinguish cached fields from ordinary text. Test groups, tables, hidden slides, placeholder duplicates and empty strings. Do not advertise structural order as visual reading order.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: text-replacement
    title: Replace text across runs
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement literal Unicode-safe search/replace across supported run ranges while respecting paragraph/field boundaries. Retain formatting and hyperlinks outside matches; inherit first affected run style for replacement unless overridden. Test multi-run matches, combining sequences, surrogate boundaries, zero matches, repeated matches and explicit first/all behavior.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: run-formatting
    title: Edit text run formatting
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement font size/typeface/language/color and supported emphasis, underline/strike, baseline, capitalization, spacing and highlight. Distinguish explicit false, absence and inherited values. Map every applicable upstream font/color parameter case to independent original XML expectations; preserve unknown run attributes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: paragraph-lists
    title: Edit paragraphs tabs and lists
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement alignment, margins, spacing, indentation, bullet/numbered levels and tabs with schema ordering and documented units. Preserve inherited defaults and local overrides. Test clearing values, zero versus omitted, mixed runs and RTL numbering. Do not calculate line wrapping.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: text-frame
    title: Edit text frame properties
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Support insets, anchors, columns, wrap, vertical text, rotation and autofit configuration. Preserve font and layout metadata without host measurement. Keep metadata-only autofit distinct from the supplied-metrics text-fit tasks; adapt upstream text-fit cases there, and retain all their relevant boundary semantics and record intentional divergence.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: portable-font-metrics
    title: Define explicit font metrics for text fitting
    status: open
    prompt: |
      Use docs/specs/pptx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/pptx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Define a pure injected font-metrics capability or bounded portable implementation sufficient for the tested text-fitting operations. Do not read host fonts or spawn renderers. Resolve glyph metrics, line breaking, missing glyph/font policy and bounded measurement before fitting. Map upstream font/layout cases to original deterministic metric fixtures; record any platform-specific behavior that cannot be identical.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: text-fit-parity
    title: Fit text with deterministic supplied metrics
    status: open
    prompt: |
      Use docs/specs/pptx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/pptx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Implement best-fit text sizing with supplied metrics, explicit margins/wrap/line-spacing/size bounds and a stable search algorithm. Adapt all upstream fit-text cases using original metric fixtures and an independent expected layout, including empty text, overlong tokens and missing fonts. Missing metrics must fail explicitly; metadata-only autofit is a separate operation. Validate application appearance in Markdown QA without promising pixel-identical fonts on every platform.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: unicode-layout-metadata
    title: Cover international text and fields
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Support RTL/CJK/vertical metadata, combining marks, emoji and complex-script font attributes in extraction and edits. Implement explicit slide-number/date/footer/header field cached-value policy using caller-supplied time. Test inheritance and mixed-script runs; no automatic font installation or field evaluation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: shape-create
    title: Create shapes and text boxes
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement documented preset shapes, text boxes, names/IDs, locks, title/description and basic fill/line properties. Validate geometry units and preserve schema sequences. Adapt upstream shape/preset/placeholder cases with independent original expectations, including absent and unsupported properties.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: custom-paths
    title: Support bounded custom geometry
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Define and implement a bounded path subset with validated moves/lines/curves, numeric limits and declared coordinate units. Preserve arbitrary existing custom geometry and formulas unchanged. Test malformed commands, unsupported formulas, winding and closure; reject edits requiring a geometry engine not provided.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: transforms
    title: Implement shape transforms
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Apply position/size/rotation/flip operations with integer EMU conversions and documented rounding. Preserve negative offsets, reject invalid sizes/nonfinite values and distinguish slide from group coordinates. Test rotation centers and transformations under nested groups with independently calculated expected coordinates.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: groups
    title: Implement group and ungroup operations
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Resolve group child offsets/extents and nested transforms, preserve world geometry within explicit tolerance and retain z-order. Remap affected connector/timing references or reject unsupported operations. Test nested scaled/rotated/flipped groups, zero extents, precision loss and original shape IDs.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: align-order
    title: Implement object alignment and ordering
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Support bring/send order, align/distribute and duplicate selections in explicit coordinate space. Deterministically handle ties and locked/hidden objects; reject ambiguous group/slide mixtures. Test exact object order, arithmetic and references after duplication, without relying on rendering alone.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: connectors
    title: Edit connector endpoints
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create and rebind connectors to valid object IDs and connection sites; distinguish attached endpoints from free coordinates. Define detach/remove policy when targets are deleted. Cover straight/elbow/curved support boundaries, nested groups and ID collisions; preserve unsupported connector geometry.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: drawing-effects
    title: Edit supported DrawingML styles
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement solid/gradient/picture/pattern fill subset, lines, alpha and simple shadows with theme references intact. Preserve complex effect DAGs, 3D scenes/materials and unknown effects without flattening. Test missing versus no-fill, mixed color representations, bounds and unsupported-effect round trips.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: tables-basic
    title: Create and edit presentation tables
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement grid dimensions, cell text, row/column sizes, table styles and supported borders/fills/margins. Distinguish physical cell XML from logical grid positions. Adapt upstream table parameter cases and test theme-linked formatting, empty cells and no-op hashes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: tables-merges
    title: Edit merged table structures
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement merge/split and insertion/deletion across spans with explicit conflict policy and rectangular validation. Maintain gridSpan/rowSpan/hMerge/vMerge semantics and text ownership. Test intersecting merges, merged-cell iteration, widths/heights and invalid nonrectangular operations using independent original cases.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-inventory
    title: Inspect image occurrences and resources
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      List source part/relationship, occurrence shape, inherited scope, hash, media type, size metadata, crop and alt text. Separate occurrences from unique media parts, including shared images and fallbacks. Test raster/vector/linked resources and images in masters/notes/backgrounds; never fetch links.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-insert
    title: Insert raster pictures
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Accept explicitly supplied PNG/JPEG/GIF bytes and validated content type, determine supported intrinsic dimensions without native decoding and allocate picture/media relationships. Require explicit sizing/fit when dimensions are unavailable. Test malformed signatures, dimensions, aspect ratios, alpha and decompression/pixel hazards.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-replace
    title: Replace individual and shared pictures
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement occurrence-local clone/rebind replacement by default and explicit shared-resource replacement with affected-occurrence report. Preserve crop/geometry/alt text according to explicit options, and avoid stale content types or relationships. Test the same image used on slides, masters and notes and cancellation before publication.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-geometry
    title: Edit crop and fit geometry
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement contain/cover/stretch, crop, rotation, flips, opacity and picture outline in deterministic units. Inspect and preserve legal extended crop values from existing files; editing policy must explicitly distinguish these from nonsensical zero-visible-area requests. Cover upstream negative/greater-than-one crop cases, zero dimensions and rounding with original inputs.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-vector
    title: Handle vectors and raster fallbacks
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Preserve EMF/WMF/TIFF/WDP and animated image payloads unchanged; expose honest capability inventory. Insert supplied SVG only with validated SVG namespace/relationship and supplied raster fallback; do not execute, fetch or transcode SVG. Test MCE branches, wrong MIME, external references, missing fallback and independent extraction hashes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: images-extract
    title: Extract original media bytes
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Extract selected image occurrences or unique resources using deterministic safe names and exact byte hashes. Enforce byte/output limits, collisions and adapter publication semantics. Never interpret embedded filenames as paths or render active formats. Test extraction of images in notes/layouts and duplicate resources without unintended deduplication.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: charts-read
    title: Inspect charts and their data graphs
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Enumerate chart/plot types, series/categories, axes, labels, styles, caches, formulas and workbook/external links. Identify authoritative versus cached data and unsupported extensions. Adapt applicable upstream chart/axis/series/point/legend tests into original assertions and preserve unrecognized chart XML.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: charts-create
    title: Create basic literal-data charts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement the contract's explicit bar/column/line/pie/scatter subset using consistent axes/series/category/value caches and styles. Require deterministic labels/IDs and preserve theme dependencies. Test empty/missing values, category ordering, scatter pairs and invalid series lengths with independently authored expected XML.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: charts-edit
    title: Edit supported chart values and styles
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Support the declared titles/legend/axis/series/point styling and literal-data changes without changing unrelated chart structure. Cover multi-series behavior, number formats, labels and bounds from upstream cases. Reject unsupported mixed/extended chart data edits; do not silently rebuild an advanced chart as a simpler one.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: chart-family-parity
    title: Cover all applicable chart families
    status: open
    prompt: |
      Use docs/specs/pptx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/pptx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Expand the basic chart contract from the actual upstream writer/test inventory: include category area/bar/column/line/pie/doughnut/radar and XY/bubble variants, stacked/percent-stacked forms, markers, number formats, multilevel categories and date-axis systems wherever upstream behavior applies. Cover every variant with original independent XML assertions. Preserve unsupported advanced/3D combinations explicitly; do not use an initial narrow chart shortlist to drop applicable tests.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: chart-workbook-data
    title: Create and synchronize chart data workbooks
    status: open
    prompt: |
      Use docs/specs/pptx.md and root/scoped AGENTS.md. Use TDD and small original fast memfs tests; keep product logic in its package and CLI backed by the SDK. Follow scoped ownership/delegation rules.
      Read docs/pptx/upstream-test-audit.md and upstream-test-inventory.json and the
      crosslinked counterpart audit for shared OPC/XML/image behavior. Keep all plans/QA
      procedures in docs/plans, and evidence/provenance in docs/pptx. No README edits.
      Downloaded documents and temporary cloned binary fixtures are disposable QA inputs,
      never shipped or canonical unit-test dependencies. Reduce meaningful cases into
      original in-memory tests before deleting QA fixtures.

      Provide a minimal bounded workbook data capability for generated chart data and supported edits of simple embedded category/XY/bubble sheets, including strings, number formats, ranges, series changes and 1900/1904 dates. Reuse an existing verified shared capability if present; no general spreadsheet/formula engine or native dependency. Keep worksheet cells, chart formulas and caches consistent. Reject complex formula-dependent changes before mutation; adapt all applicable upstream workbook writer/rewrite cases and expose unresolved gaps.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
  - id: charts-workbooks
    title: Enforce chart workbook consistency
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory embedded workbook dependencies and external formulas. Use the supported chart-data workbook capability for simple data edits. Reject only mutations that cannot synchronize workbook data, formulas and chart caches; permit unrelated chart styling only when safe. Tests must demonstrate no stale cache/workbook divergence and unchanged opaque workbook bytes. A future spreadsheet adapter requires explicit capability and separate parity evidence.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: charts-advanced
    title: Preserve advanced chart extensions
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Preserve combination/3D/chartEx charts, trendlines, error bars and extension resources through unrelated edits and slide import where IDs can be remapped safely. Inventory unsupported editing and reject unsafe remapping. Test opaque resource closure and exact unmodified part hashes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: smartart
    title: Preserve SmartArt dependency graphs
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory diagram data, drawing fallback, colors, styles and layout parts with correct relationship closure. Preserve original appearance resources on import and unrelated edits; full automatic layout is unsupported. Test shared diagram resources, missing graph edges and fallback-only cases without falsely exposing semantic editing.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: equations
    title: Read and preserve mathematical content
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Extract/inventory OMML and allow only validated caller-authored insertion supported by the contract. Preserve equations and fallbacks during text/slide operations. Test namespaces, malformed structures, math embedded in text and unsupported extensions; no formula renderer or evaluation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: media-read
    title: Inspect audio video and posters
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory embedded versus linked media, types/hashes, poster images, playback metadata, captions and timing associations. External targets remain inert. Cover upstream movie/media tests and files with multiple relationships to the same media. Report that metadata parsing does not prove playback.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: media-edit
    title: Insert and replace local audio/video
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement the declared media types using explicit supplied bytes/poster, valid content types and complete relationship graph. Preserve trim/loop/volume and timing settings according to options; do not transcode or autoplay in tooling. Test shared-resource replacement, wrong types, missing posters, size limits and imported media graphs.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: media-captions
    title: Preserve captions and media extensions
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Map supported caption/track schemas and preserve all unknown metadata during media replacement. Edit only independently validated fields; reject operations that would orphan tracks. Test language labels, multiple tracks, time ranges and extension fallback handling with tiny original fixtures.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: transitions
    title: Edit basic slide transitions
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement the declared cut/fade/push/wipe subset and explicit manual/timed advance metadata. Retain unsupported transitions and Morph extensions on unrelated edits. Test duration units, conflicting settings, sound relationships and removal of only requested transition nodes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: animations-read
    title: Inspect the animation timing graph
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Expose sequences, parallel nodes, effect/trigger types, target shape IDs, timing IDs and media interactions with bounded traversal. Preserve complex timelines and motion paths without execution. Test nested graph structure, missing targets, duplicate IDs, cycles and deterministic inventory ordering.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: animations-edit
    title: Edit bounded animations and simple triggers
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement the specified entrance/emphasis/exit subset and simple triggers with fresh timing IDs and valid target references. Preserve unsupported timelines and reject edits that cannot safely retarget them. Test object deletion/duplication/import, interdependent effects and semantic validation independent of UI playback.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: links-actions
    title: Edit links and internal navigation
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement ordinary hyperlinks and supported internal slide navigation with correctly scoped relationship/action attributes. Preserve unsupported launch/macros/OLE actions as inert data on reads and flag them for explicit sanitization. Test relative and external URLs, removed slide targets, custom-show links and safe merging.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: notes
    title: Create read and edit speaker notes
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Keep notes-slide associations, notes masters and speaker text distinct from slide-image/date/footer placeholders. Support original note text/shape edits and preserve unsupported note content. Adapt upstream notes cases and test slide duplication/deletion/import plus multiple notes masters.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: handouts
    title: Preserve handout and print settings
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory handout masters, notes page sizes and print/view properties; edit supported master text only under explicit scope. Retain unsupported placeholders and layout settings. Test slide operations that must leave handout resources unchanged and no renderer-based pagination claims.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: comments-legacy
    title: Edit legacy comments
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Create/read/update/remove legacy comments with correct author IDs, author indices, positions and explicit timestamps. Clean author entries only when proven unused. Test comments on imported/deleted slides, duplicate display names and unchanged unrelated annotation parts.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: comments-modern
    title: Preserve modern comment extensions
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory modern threads, authors/person identities, replies, mentions and reactions using pinned schemas where understood. Preserve opaque parts and associations; reject mutation needing unsupported identity remapping. Test modern/legacy coexistence and signature/protection interactions without downgrading comments.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: properties-tags
    title: Edit properties tags and custom XML
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement core/custom property types and supported presentation/slide tags with deterministic caller-supplied dates. Preserve unknown types, namespaces and custom XML associations. Adapt upstream property conversion/bounds cases and test duplicate names, empty versus absent and metadata sanitization boundaries.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: accessibility
    title: Inspect and edit accessibility metadata
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Support alt text, descriptions and documented decorative flags, and report missing/duplicate titles and structural object order. Do not claim accessibility certification, visual reading order or contrast accuracy without corresponding evidence. Test shared images with distinct alt text and metadata inherited from layouts.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: embedded-fonts-objects
    title: Preserve embedded content and fonts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Inventory/extract opaque OLE packages, controls, web extensions, font parts and 3D models without executing or recursively parsing them by default. Preserve relationship closure and exact bytes. Test active payload detection, safe extraction names and imports with unsupported object references.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: protection-signatures
    title: Enforce protected and signed package policy
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Detect macro content by parts/content types as well as suffix, encryption, signatures, protection and labels. Reject unsupported edits and support explicit complete signature-graph removal with effect reporting. Test disguised macro payloads, partial signatures and protected content; no bypass or false signature-validity claims.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: sanitize
    title: Implement explicit sanitization policies
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Remove only selected notes/comments/properties/external links/embedded resources with safe graph cleanup and a detailed retained-content report. Unknown hidden data prevents broad clean-file claims. Test shared resources, modern comments, actions and signature interactions; do not remove formatting accidentally.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: templates-bindings
    title: Bind typed template content
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Define non-executable typed JSON bindings for text/tables/images with explicit scope and cardinality. Validate all required/unknown/missing bindings before mutation. Test literal braces, Unicode, repeated names, structured values and preserved formatting; no arbitrary expressions or script evaluation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: templates-repeat
    title: Repeat slides from structured records
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Clone designated template slides through graph-aware duplication and bind each record with deterministic IDs/order. Support explicit shared-media versus isolated-instance policy and aggregate limits. Test zero/one/many records, notes/charts/images/timings and atomic failure on later invalid records.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: batch-dry-run
    title: Execute atomic ordered batches
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Implement complete upfront syntax validation, sequential semantic resolution, created-object handles and cumulative budgets. Dry-run returns effects including shared resources, signature removal and unsupported outcomes without publication. Test stale selectors, failure after earlier staged edits, cancellation and deterministic output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: diff
    title: Compare presentation structure
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Report ordered slide/text/property/geometry/media/relationship differences with stable IDs and explicit raw versus effective formatting mode. Hash media rather than decode/render. Test reordering versus replacement, identical data under different part names and unsupported opaque changes; equality result is data, not exit-code ambiguity.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: pack-extract
    title: Implement package extraction and repacking
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Expose bounded explicit package tools through the VFS, safe member names and validated content types/graphs. Preserve opaque resources and reject unsafe or incomplete repacks before publication. Test directory collisions, traversal, remote partial-output manifest semantics and unrelated-file preservation.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: sdk-live-object-model
    title: Implement live SDK objects and documented setters
    status: open
    prompt: |
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Implement the documented object graph and public properties/methods as the primary SDK, backed by the same domain primitives as command operations. Preserve documented getter side effects, returned object types, owner identity and invalidated handles. Test destructive text setters/clear separately from preserving text replace, and ensure read-only CLI inspection does not invoke creating getters. Avoid duplicate editors or a forest of forwarding alias functions.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Cover documented sequence/keyed lookup, length, iteration, bounds, negative-index/slice mappings and mutation protocols. Preserve sparse ID-keyed collections and null/false/zero distinctions. Implement all documented unit/color helpers, enum members/aliases and value conversions with original tests. Add cases for public members with no upstream unit test.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Make factories/save/input-admitting methods consistently async and in-memory model operations synchronous, using explicit bytes/streams/VFS capabilities. Define typed context time/author/metrics/cancellation defaults without ambient discovery. Preserve documented argument defaults where safe and record deliberate mappings. Test no value-or-Promise ambiguity, byte ownership, failures, stale publication and cancellation.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Cover public element/part and returned package-view behaviors that documentation exposes. Specify safe JS XML traversal/attributes/structured mutation and graph validation without importing an entire Python dependency API or bypassing limits. Map genuine private helpers separately; a documented underscore-prefixed return type is not automatically private. Test every exposed read/write behavior and publication invariants.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
  - id: sdk-placeholders-shapes-api
    title: Complete placeholder and shape object APIs
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Implement sparse idx-keyed placeholder lookup, rich picture/table/chart insertion returning graphic-frame/picture handles, stale placeholder invalidation and inherited geometry. Complete shape adjustments, freeform builder members, connector binding, group children and documented shape-ID allocation/turbo-add behavior with safety checks. Add original tests for every public property and method.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: sdk-chart-drawing-api
    title: Complete all chart and DrawingML API members
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Complete chart/title/legend/axis/gridline/tick-label/plot/series/point/data-label/marker objects and category hierarchy/date/numeric data builders. Cover gradient stops/angle, pattern/foreground/background, brightness and theme colors, line styles and shadow inheritance. Enumerate every getter/setter/default and chart variant from docs, not a handpicked chart subset. Reuse tested shared domain behavior.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: sdk-media-ole-api
    title: Complete image movie and OLE return interfaces
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Implement documented image blob/type/DPI/extension/name/hash/size metadata, movie/media-format/poster properties and OLE byte/icon/prog-ID interfaces. Support insertion from explicit inert bytes with no execution. Characterize all documented image formats and document any capability mapping. SHA-1 image metadata is compatibility data, not integrity identity. Test returned interfaces even when omitted from top-level API pages.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: upstream-package-parity
    title: Complete upstream package and XML case adaptation
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Reconcile all mapped OPC, package, URI, serializer, image-codec and XML utility cases against implemented behavior. Port every applicable parameter variant into fast original tests; map Python descriptors/mocks to observable engine assertions rather than reproducing internals. Record any intentional divergent validation explicitly and prove the safer or specified outcome. No unexplained inventory rows may remain for these families.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: upstream-drawing-parity
    title: Complete upstream text shapes and table cases
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Reconcile every text/font/paragraph/shape/placeholder/group/connector/picture/table case and BDD example with original TS tests, including missing values and nondefault bounds. A target test can cover multiple source rows only with explicit behavior equivalence. Identify layout-engine-only cases individually; do not quietly erase fit-text or crop semantics because the architecture differs.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: upstream-chart-parity
    title: Complete upstream chart media and deck cases
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Reconcile all chart axes/series/points/plots/legend/data-label/workbook and deck/notes/media/action/core-property cases. Preserve supported behavior and record each unsupported public edit as an explicit scope gap with tests and a follow-up requirement. Python API naming/private mock expectations may change; underlying applicable semantics must remain covered.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: bdd-adaptation
    title: Adapt every upstream BDD scenario
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Use the expanded scenario/example inventory to implement original SDK and safe-bash integration assertions for every applicable workflow. Preserve boundary values and expected behavior but author new text/assets and avoid slow disk/native/font dependencies in unit tests. Renderer-dependent scenarios belong in the Markdown QA plan with honest run status, not fake passes.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: security-adversarial
    title: Add original adversarial security cases
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Beyond upstream suites, test ZIP bombs, XML expansion, unsafe URIs, path collisions, graph cycles, giant media declarations, malicious SVG, disguised macros, output races and cancellation. Keep each input tiny and independently constructed. Prove zero implicit network/process/host-file access under denied capabilities.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: preservation-metamorphic
    title: Verify preservation and deterministic round trips
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Check no-op bytes, untouched part hashes, target-only edits, rename/reorder invariants, duplicate-then-delete behavior and deterministic serializations. Use bounded original fixtures with independent expected graph projections, including opaque extensions and shared media. Do not substitute generated expectations from the same engine.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: sdk-command-parity
    title: Verify complete SDK and shell parity
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Exercise each public command through the SDK and real safe-bash .sh scripts with quoting, pipes, stdin binary data and exit statuses. Verify plugin opt-in and memory/rooted-real/mock-remote adapters without capability leaks. Keep unit file mutations in memfs; actual remote/real workflows are explicit QA evidence.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: large-profile-qa
    title: Qualify large decks and media profiles
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Execute the named large-file campaign in docs/plans/pptx-qa.md using actual corpus bytes. Record default admission rejection separately from successful explicitly raised-profile reads/targeted edits. Measure limits, cancellation, peak memory and unaffected media hashes. Tiny high-compression and many-slide stress cases are original generated fixtures, not downloaded large documents.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: corpus-structural-qa
    title: Run structural QA on real presentations
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      For each selected corpus feature family, inspect then perform a deterministic targeted edit on an owned copy, reopen independently and compare graph invariants/untouched part hashes. Include multi-master merges, notes, shared images, charts and media when present. Log exact input/output hashes and operations; census alone does not count. Reproduce each defect as an original unit test through the responsible implementation task before closing it.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: corpus-render-qa
    title: Render and visually inspect presentation edits
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Use independent available renderers and the presentations skill when authoring/rendering QA outputs. Render input and edited output in the same environment, inspect slide screenshots/contact sheets and expected changed/unchanged areas including masters, groups, crop, tables, notes and font fallback. Record tool versions/fonts and unsupported features; no screenshot tests or claims based solely on thumbnails. Keep artifacts disposable.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: application-playback-qa
    title: Verify application interactions and media
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Execute the Markdown QA procedure in PowerPoint or another explicitly identified available application. Verify repairs/warnings, slide order, notes, custom shows, hyperlinks, transitions, animations, audio/video and captions where supported. Missing application/codec or unsupported behavior is unrun/limited evidence, never success. Do not install or silently invoke a player in the product.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: close-test-accounting
    title: Close complete test and feature accounting
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Audit test-case-map.json against the pinned full unit and BDD inventory: every source row must have evidence-backed disposition. All applicable cases must map to passing original TS tests; architecture-only mappings need a semantic rationale, and deferred public behavior remains visible and blocks parity claims. Reconcile F01-F60 standards coverage, corpus gaps and product-specific security tests; report actual statements/branches without treating coverage percentage as OOXML conformance.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: public-consumers
    title: Verify packaged public consumers
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Build packed package and root SDK/safe-bash consumers through declared exports in supported environments. Verify no accidental Python/native/editor/runtime dependency, node-only import leak or undeclared private module. Test opt-in registration and capabilities from public imports rather than source paths. Update owned package/export declarations only.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: simple-selector-ergonomics
    title: Implement simple selectors and direct edit flags
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Make routine edits work without XML IDs, fingerprints or JSON: scoped one-based paragraph/table/image selectors, logical cell coordinates and applicable slide/shape labels. Preserve safe fingerprint tokens for automation. Implement consistent first/all/occurrence and explicit shared-resource behavior, good ambiguity errors and destination/force/dry-run semantics. Run original paired SDK/CLI acceptance cases.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: schema-capability-discovery
    title: Expose exhaustive schemas help and capabilities
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Expose schema and capabilities commands from the actual declared operations and verified support levels. Generate matching help with selectors, scopes, limits, output semantics and edit/read/preserve/reject differences. Link every feature/API register row to a usable operation and test. Do not infer full editing from parser recognition or omit unsupported namespaces.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: cross-format-cli-conformance
    title: Verify cross-format command consistency
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Run the common contract cases against both available public adapters: identical common paths, option names, output envelopes, ordinary exit codes and diff 0/equal 1/different 2/trouble 130/cancel. Verify no singular image/table or metadata aliases, no top-level replace and no silent ignored flags. If the counterpart is not built, verify its declared schema and retain that runtime half as pending rather than claiming paired success.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Use TDD and fast original memfs tests; implement domain behavior in the format package with SDK-backed CLI. Follow scoped delegation and ownership.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Close public-api-map.json against reconciled docs, actual exports and original tests, including members absent from upstream tests. Execute original JavaScript equivalents of all guide workflows with unit/SDK/CLI evidence. Every supported behavior needs a CLI route; every language/security difference is explicit. Unsupported public members block full coverage claims; do not replace the denominator with the subset implemented.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
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
    status: open
    prompt: |-
      Work on pptx using root/scoped AGENTS.md, docs/specs/pptx.md,
      docs/specs/office-cli.md and docs/specs/office-sdk.md. Documentation/research only; do not implement product code in this task.
      Read docs/pptx/upstream-api-audit.md, upstream-api-inventory.json,
      upstream-test-audit.md and upstream-test-inventory.json. Preserve unrelated work,
      keep plans and agent QA procedures in docs/plans, and use docs/pptx for evidence.
      Downloaded publisher decks/documents and cloned binaries are disposable QA only;
      reduce meaningful cases into original small unit tests before cleanup. No README
      edits, ambient host I/O, native runtime or implicit network.

      Execute docs/plans/office-cli-qa.md against built commands, inspecting help/error screenshots via maintained tooling. Verify that common tasks are concise, selectors discoverable, errors actionable and advanced data supported without forcing JSON for simple edits. Fix validated usability defects through failing focused tests; no screenshot test suite or scripted QA replacement. Record unrun counterpart cases honestly.

      Apply docs/specs/office-cli.md and docs/specs/office-sdk.md as the shared
      command/SDK contracts. Use plural resources (images, tables, properties), text
      replace, common flags/selectors/JSON/exit statuses and schema/capabilities.
      The model SDK retains documented neutral method/property spellings; whole public
      API coverage includes inherited members, enums, collections, helpers and APIs
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit, explicitly staging only owned files and relevant
      plan updates. Never commit ignored fixtures, use --no-verify or add co-authors.
      No empty read-only commits. Report local hashes; do not push or release.
  - id: maintained-checks
    title: Run the maintained integration gates
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. Keep logic in packages/pptx or a justified shared codec; safe-bash adapters belong
      in packages/safe-bash/src/commands/pptx and root only wires public APIs. Follow
      scoped delegation/ownership rules. Use TDD, fast original memfs unit tests and
      independent assertions; verify the behavior through both SDK and CLI where exposed.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Run focused maintained checks first, then npm run build, npm test and repository-wide lint because package/root integration crosses workspaces. Use maintained declared workspace closure and uncached routes; root-only test:unit is not a substitute. Apply the repository environment/hook isolation rules and workflow lint when relevant; fix validated failures without reverting others' work. Record checks separately from corpus/application evidence.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: usage-and-visual-cli
    title: Document usage and inspect CLI screenshots
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Write docs/pptx/usage.md with create/read/edit, images, merge, templates and .sh examples; list exact public SDK imports, config limits, no hidden environment variables and unsupported features. Draft required package README content pending permission. Run maintained CLI screenshot tooling for help/errors/examples and inspect design-system consistency; do not add screenshot tests.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: cleanup-disposable-fixtures
    title: Delete completed disposable QA artifacts
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      After meaningful findings have small original passing regressions and no active campaign needs the source files, delete only manifest-listed owned downloads and enumerated outputs. Retain provenance/hashes/test mapping/concise QA evidence, mark deletion status and verify canonical tests pass without downloads. Do not delete unrelated caches or temporary upstream checkouts still needed by another campaign.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
  - id: completion-report
    title: Publish honest feature and validation evidence
    prompt: |
      Work on the proposed original TypeScript utility named exactly pptx using
      docs/specs/pptx.md, root AGENTS.md and applicable scoped AGENTS.md. This task changes documentation/evidence only; do not implement product code.
      Consult docs/pptx/upstream-test-audit.md and upstream-test-inventory.json. Account
      for every relevant upstream parametrized test and BDD scenario through original
      TypeScript cases; retain required license notices for derived material. Keep
      upstream identities in research/provenance, not product branding or test names.
      Use docs/pptx/corpus-manifest.json for disposable QA fixtures; never ship them or
      make unit tests depend on downloads. Reduce meaningful QA findings into small
      original regressions. No implicit host I/O, native runtime, product network or
      README edits. Keep all planning/QA procedures in docs/plans; draft usage docs in
      docs/pptx until README permission. Do not execute the whole pipeline from this task.

      Update the spec's Implemented Through only after inspecting the implementation at the actual verified commit. Report all F01-F60 support levels, upstream adapted/deferred/architecture-only case counts, original regression evidence, independent rendering/playback limits, cleanup and README dependency. Local commits are not remote delivery or releases; no push/publication is authorized by this plan. Do not declare full parity or OOXML conformance with unexplained gaps.

      After relevant maintained checks pass, commit each atomic improvement on main
      with a Conventional Commit. Stage only explicitly named owned files and relevant
      plan updates; preserve unrelated work. Never commit ignored QA fixtures, use
      --no-verify, add a co-author or create empty commits for read-only work. Report
      local commit hashes separately. Do not push or release.

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
      without upstream tests. Read docs/pptx/upstream-api-audit.md and
      upstream-api-inventory.json; record exact JS language/security mappings and
      resolve documentation drift. Do not hide unsupported public APIs as private
      merely because a type name starts with an underscore. Reference-project names
      remain only in plans/research and legally required standalone notices; never in
      code, comments, tests, fixtures or CLI output.
    status: open
---

# Comprehensive pptx implementation pipeline

The command is **pptx**: create, read and edit presentations with a TypeScript SDK
and an explicit safe-bash plugin. This is planning, not authorization to start
implementation. The authoritative proposed contract is [the specification](../specs/pptx.md).

125 ordered, self-contained tasks use scalar `status: open`. Implementation,
validation and atomic commit instructions live inside each task prompt; there are
no per-task steps and no push/release instruction.

The F01–F60 matrix covers packaging, Strict/Transitional/MCE, slide graphs, masters,
layouts, themes, text, groups, geometry, tables, images and fallbacks, charts and
workbooks, SmartArt, math, media, transitions, animations, navigation, notes,
comments, accessibility, security, templates, batch, diff and package workflows.
Preserve-only features remain explicit; this does not promise a native layout or
playback engine.

## Test inspiration and complete accounting

[The upstream audit](../pptx/upstream-test-audit.md) records pinned cloned sources,
actual test execution and coverage. [The inventory](../pptx/upstream-test-inventory.json)
retains every collected parameter variant and BDD scenario/example. Adapt all
applicable behavioral cases into original TypeScript tests, not a handpicked
sample. Record every source row's destination and rationale; Python-private
mechanics may map to observable semantics, but unsupported public behavior must
remain visible. Retain required notices for any derived test material.

## Disposable real-world QA

[The corpus manifest](../pptx/corpus-manifest.json) and [report](../pptx/corpus-report.md)
record actual downloaded decks and bounded structural inspection. Those are not
product test passes or visual verification. Keep downloaded bytes in the ignored
`.cache/pptx-corpus`, mutate owned copies, and delete only enumerated fixtures and
outputs after QA and regression reduction. Meaningful behaviors and defects must
survive in tiny original memfs unit tests independent of the downloads. QA is an
agent-executed Markdown procedure in docs/plans, not a committed runner script.

## Completion

Require complete case accounting, feature support evidence, maintained build/test/
lint gates, public consumers and independent visual/application checks. Report
unavailable renderers, fonts/codecs and unsupported features honestly. Package
README changes remain subject to repository permission; usage drafts belong in
docs/pptx. Report local commits separately from any later authorized remote delivery.

## Reference isolation

Reference projects may be named and crosslinked in this plan and research evidence.
They must never be named in product source, code comments, identifiers, test names,
fixtures or CLI output. Original fixtures preserve behavioral boundaries; legally
required attribution for derived material belongs in standalone notices.

Related plan: [docx](./docx-typescript-safe-bash.md).
Related audits: [presentation](../pptx/upstream-test-audit.md) and
[document](../docx/upstream-test-audit.md).

## Consistent commands and complete JavaScript SDK

[The shared CLI contract](../specs/office-cli.md) fixes naming, selectors, common
flags, JSON, publication and exit semantics. [The SDK contract](../specs/office-sdk.md)
requires the complete documented public object API with neutral method/property
spellings retained and explicit JavaScript/sandbox mappings. The [API audit](../pptx/upstream-api-audit.md)
and [candidate inventory](../pptx/upstream-api-inventory.json) supplement the
full test inventory; untested public APIs still require original tests.

Acceptance includes a complete feature-to-command register, direct flags for
common workflows, schema/capabilities discovery, paired command recipes and
CLI/SDK equivalence. A candidate inventory is not proof of completed coverage.

## pin-standards completion evidence

Completed 2026-09-13 UTC. Documentation only; remaining 124 tasks stay open.

- Added [standards coverage](../pptx/standards-coverage.md) and
  [acquisition receipt](../pptx/standards-sources.json): all F01–F60 mapped to real
  clause/schema references, target edit/read/preserve/reject boundaries and
  unimplemented original acceptance obligations.
- Pinned four ECMA editions, MS-PPTX 25.0 and MS-ODRAWXML 34.0; verified six source
  hashes, archive-member hashes, 51 ECMA XSD members, 62 extension schema blocks
  and their raw HTML response hashes. Every XSD parsed as XML; no XSD compilation
  or product schema-validation claim. Complete extension section sets: 20 and 42.
- Verified all 60 unique ordered feature rows, named ECMA types, local links,
  unchanged input-inventory hashes and maintained pipeline parser acceptance.
  Scoped Prettier checks pass for the two evidence files and this plan.
- All 2,700 unit variants, 973 BDD examples and 719 candidate API records remain
  unimplemented. No architecture-only dispositions or parity claims were added.
  All 12 corpus documents retain their prior unrun product/visual QA status.
- No product code, README, reference assets or legal notices changed. No corpus
  mutation or cleanup; standards inputs remain temporary research material.
  No runtime test, screenshot, rendering, playback, push or release occurred.
- Owned commit paths: this plan, docs/pptx/standards-coverage.md and
  docs/pptx/standards-sources.json. Local commit identity is recorded in Git;
  no remote delivery or release is implied. Next task: reconcile-documented-public-api.

## Documented API reconciliation evidence

Completed 2026-09-13 UTC as documentation research. See the [reconciliation
findings](../pptx/api-reconciliation.md), [language/security mappings](../pptx/api-language-mappings.md)
and [agent verification record](./pptx-api-reconciliation.md). All 719 original
candidate IDs remain; inherited/returned interfaces, constructors, separate
read/write signatures, collection protocols and enum aliases are now recorded.
The mixed record count is not a completeness or implementation certificate.

D01–D15 distinguish source annotation errors, guide typos, documented behavior
missing from source and deliberate shared-contract mappings. The next task is
`define-mirrored-js-api`: concrete TS declarations, per-operation schemas and
original acceptance evidence are still required. Source unit/BDD adaptation
statuses and corpus QA states are unchanged. No product code, README, fixture
cleanup, runtime execution, push or release occurred.
