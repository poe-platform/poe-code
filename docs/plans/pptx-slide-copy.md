# Slide copying

Implement the focused F07 duplicate operation; do not execute the wider pipeline.
Root owns slide-copy.ts, its original tests, package exports and this plan/research.
The command worker owns command-engine.ts, command-schema.ts and command copy tests.
The adapter worker owns scoped safe-bash pptx acceptance. Preserve unrelated work.
Commit explicitly owned files locally on main; no README edits, push or release.

## Behavior

Copy selected slides in supplied order at an explicit one-based insertion position.
Allocate deterministic fresh slide, shape, relationship and dependent-part identities.
Preserve connector sites and supported shape timing/build targets by remapping IDs.
Clone notes, charts and embedded chart workbooks per copied slide; share layouts,
masters, themes and media. Remap notes backlinks and slide self-links. Reject unknown
relationships, conditional/extension content and references without a proven mapping.
Retain all original slide/resource bytes and do not create notes on read/copy when absent.
All I/O is admitted bytes/capabilities. This byte-operation SDK does not claim the
pending live object model, cross-deck import, chart mutation or image replacement API.

## TDD and verification procedure

1. Add original memfs SDK and CLI cases and observe missing-operation failures.
2. Implement graph copy; independently inspect ZIP members and namespace-aware XML.
3. Exercise resource isolation, shared assets, target remapping, collisions,
   repeat selection, unsupported graphs and limits. Reduce concrete QA findings.
4. Run maintained pptx test/lint/build closure and scoped safe-bash acceptance;
   run guarded repository ESLint for the owned adapter test. Do not run pipeline.
5. Verify SHA-256 before admitting selected manifest-listed disposable corpus bytes.
   Attempt copy with explicit ceilings; record successful edits or exact conservative
   rejections. Do not ship/download fixture bytes or claim rendering from ZIP inspection.
6. Capture actual command help and results through the maintained screenshot runner,
   inspect PNGs, and record exact ignored artifact paths.
7. Review/stage owned files plus this plan; Conventional Commit locally only.

## Research receipt

The pinned case/API audit contains no whole-slide duplicate operation. Adjacent
connector creation and video-timing cases are broader than preservation by copying;
placeholder cloning cases concern creation from a layout/master. The supplemental
slide-copy-case-accounting.json retains exact source rows and explicit dispositions.
No upstream identity appears in product source/tests. Original implementation and
assets require no added derived-code notice; existing standalone research notices
remain applicable to retained provenance.

J01 async byte admission, J02 independent byte ownership, J03 explicit one-based
selection rather than model indexing, J05 safe integer IDs, J06 capability-only I/O,
J07 inert external links, J08 neutral errors, and J09 consistent relationships apply.
No model snake_case member, inherited member or underscore-prefixed type is hidden.
The audit's historical “implementation not started” text describes model parity;
the new command/byte operation is documented separately without changing that claim.

## Execution receipt

The initial SDK/command/adapter runs failed because copying was unavailable.
Original regressions now verify fresh deterministic IDs, connector sites and timing
shape targets, isolated notes/chart/workbook resources, shared media/layout/master
parts, source-part byte preservation, repeat-copy collisions, Strict namespaces,
ordered selectors, stale tokens, bounds and output publication. Review reproduced
and fixed mutable chart XML hidden behind an image relationship and relative
slideshow actions whose meaning would change. Relationship/content-type mismatches
and unresolved action/extension references now reject copying.

The selected maintained build closure passed. Package ESLint and both source/test
TypeScript checks passed. The new domain suite has 10 fast original tests; command
suite has 10. Scoped safe-bash acceptance has 58 passing tests, including byte SDK
parity, independent IDs/order, in-place output, dry-run and binary pipeline behavior.
All test files and assets are original; fixture writes stay in memfs.

## Disposable corpus and visual QA receipt

Verified manifest SHA-256 before read for CERN-intro-2025-v2.pptx (slide 16,
62ab3f5c42e7a967af1f4cfc07cede3909a88b6c75f8432231e83a6e8d17e134) and
data-visualization-course.pptx (slide 13,
ce874bc9782258175b84f5e438123552b78c993e0add9015f35d8ca2dd5c45d2).
Both attempts returned unsupported-edit without publication. Independent ZIP/XML
inspection found DrawingML extension lists with DPI/creation-identity payloads.
The original extension-rejection regression represents that boundary; these are
conservative failures, not successful real-world copying or rendering claims.
No fixture download, host-runtime product dependency or published output was added.

Captured actual engine help, successful authored-deck dry-run and missing-selector
error, then rendered through npm run screenshot. Both PNGs were visually inspected:
readable, unclipped output. Disposable ignored artifacts are exactly
.cache/pptx-corpus/qa-slide-copy-{help,result,error}.txt and
.cache/pptx-corpus/qa-slide-copy-{help,result}.png. No binary fixture enters Git.

Final maintained package run: 27 files, 809 tests passed. Rebuilt public package
exports and reran all 58 focused safe-bash tests successfully. Maintained package
lint (ESLint and both TypeScript projects) passed. Root guarded ESLint passed with zero errors and warnings across its 11,870
configured inputs. No complete repository test or pipeline run is claimed.

## Local delivery

One atomic feature commit contains the owned implementation, paired acceptance
cases, research/usage draft and this receipt. The local hash is reported in chat
and Git history. No push, remote-main verification or release was attempted.
Unrelated changes and all ignored QA fixtures remain outside the commit.
