# DOCX font flags and tab collection utility task

## Owned scope

This delegated task owns `run-properties.ts`, `paragraph-properties.ts`, and
`font-tabs.test.ts`. Shared schemas/types, style behavior, CLI integration and
commits belong to the coordinator. No README, host-I/O product code, native
runtime, downloaded fixture, network behavior or model implementation is added.

## Evidence and TDD

Read root instructions, format/shared CLI/SDK specifications and the API/test
audits and inventories. Inspected pinned tab-stop source for insertion order,
negative indexes and last-item removal. Original authored XML uses memfs.

Before implementation, `npx vitest run packages/docx/src/font-tabs.test.ts`
reported 28 failures and five passes (33 tests), after correcting the test's
namespace wrapper. All missing flags and collection mutations failed behavior
assertions. After implementation the three focused files passed 80 tests.
An additional malformed-tail-position regression failed before changing insertion
validation from short-circuit lookup to full collection validation. The resulting
37 new tests plus three existing run-property tests pass.

## Exact utility mappings and limits

The operation API uses camelCase, independently of the pending neutral model
snake_case properties. `allCaps`, `complexScriptEnabled`, `csBold`, `csItalic`,
`doubleStrike`, `emboss`, `imprint`, `math`, `noProof`, `outline`, `shadow`,
`smallCaps`, `snapToGrid`, `specVanish`, and `webHidden` map respectively to
`caps`, `cs`, `bCs`, `iCs`, `dstrike`, `emboss`, `imprint`, `oMath`, `noProof`,
`outline`, `shadow`, `smallCaps`, `snapToGrid`, `specVanish`, and `webHidden`.
`complexScript` already names the font-family slot; the flag therefore has the
explicit `Enabled` suffix on the operation surface. Existing bold, italic,
strike, hidden and RTL use the same original matrix of absent/true/false XML
crossed with requested true/false/null. Undefined leaves a property untouched;
null removes the direct element; false writes explicit off; true writes on.
Unknown properties, XML comments and untouched font values survive.

`tabStopAdd` takes a typed stop and inserts after existing equal positions, before
the first greater position, without reconstructing retained stops. Negative
positions and duplicate insertion positions are valid. Defaults are LEFT/SPACES.
Lengths use existing shared paragraph conversion, including twips. Strict LEFT
maps to start and deprecated LIST is rejected by the existing dialect policy.
`tabStopDelete` uses a zero-based signed index; negatives count from the end.
Missing indexes produce the existing utility unsupported-edit error category,
which is distinct from the pending model's JS RangeError contract. Removing the
last ordinary stop removes tabs; opaque comments/extension content survive in a
container when present. `tabStopsClear: true` removes the entire custom-tab
container; false leaves it untouched. Existing `tabStops` replaces all stops.

The utility baseline/superscript/subscript mappings remain unchanged: false
requests explicit baseline. The documented model setters instead remove only an
active matching mode and retain the opposite mode. This is an existing utility
versus model distinction; model setters must not be marked implemented by these
changes. Live Font getters, color object identity, tab objects/setters, iteration,
index lookup/slices, inherited element/part views, helpers and equality remain
pending. No underscore-prefixed public interface is reclassified as private.

## Agent QA procedure

1. Run focused original font/tab and paragraph operation tests.
2. Coordinator runs maintained package test/lint after shared schema integration.
3. Exercise public SDK and generated CLI flag/schema parity through original
   injected-I/O tests; inspect CLI help screenshots for exposed new flags.
4. Record owned files in atomic local commits, without staging unrelated work,
   pushing or releasing.

## Delegated live formatting follow-up

The coordinator expanded ownership to `formatting-model.ts` and its original
memfs test file. The earlier utility-only limitations above describe the first
stage, not the completed follow-up. Live Font, ColorFormat, RGBColor,
ParagraphFormat, TabStops and TabStop now share the utility run/paragraph
serializers and the existing bounded XML editor. An explicit FormattingXmlOwner
supplies getXml/setXml; optional part and identity values are supplied by the
package owner, never discovered from the host. Root integrates style package
loading, saving, public exports and typed batch routes.

Initial model tests failed on missing module, then added behavior regressions
failed before the corresponding changes: missing/nonfunctional enum and length
accessors; invalidating tab handles on unrelated paragraph formatting; missing
color objects; at-least spacing overwritten by an absolute height; numeric tab
indexing and inherited bounded views. Model tests now cover all 20 neutral Font
flags and invalid coercion, exact source superscript/subscript false/null
semantics, direct font name/size/underline/highlight/color, paragraph lengths and
spacing rules, and tab movement/deletion/clear/live ownership.

The model uses `.at(index)`, readonly integer property indexing, iteration and
`.length`; `.delete(index)` supports negative indexes. TabStops intentionally has
no slice method, as required by the pinned sequence mapping. Live tab handles
survive unrelated paragraph edits and preserve extension attributes on changed
stops. Removed handles fail with RangeError. Other-owner XML changes affecting
the tab collection invalidate handles conservatively. Tab position movement uses
the bounded XML editor's parsed attribute patches and lexical subtree movement;
it does not reconstruct unknown stop metadata. Accessing paragraph.tab_stops
creates missing pPr as documented. All reads and setters are synchronous against
already admitted owner XML; publication remains the owning package's job.

Font baseline setters explicitly remove only their own active mode on false,
leave the opposite mode unchanged and remove either mode on null. Font size
accepts typed twips and converts through safe integer EMUs before invoking the
existing serializer. Color theme=null removes the complete direct color, unlike
the utility's theme-only reset operation; setting RGB removes theme transforms.
Color type is a symbolic MSO_COLOR_TYPE value. RGBColor is immutable, validates
integer components 0–255, supports hex construction and neutral tuple operations.

Element views are current parsed admitted XML nodes; part is only the injected
bounded package view or null. Equals compares explicit owner identity or the
owner adapter identity; tab equality additionally compares live collection IDs.
No unrelated public API row, constructor graph, helper family or batch operation
is promoted by these tests; the coordinator maintains the exact per-row evidence.

## Unit/enum values and source boundary reconciliation

Additional coordinator-owned expansion adds `formatting-values.ts`, its original
tests, and `formatting-model-boundaries.test.ts`. Callable immutable Length, Emu,
Inches, Cm, Mm, Pt and Twips retain typed value/unit transport plus explicit unit
accessors. They reject implicit numeric coercion and unsafe integer EMUs, round
halfway values away from zero once, and normalize only branded owned values at
model schema boundaries. Forged prototypes/accessor objects remain rejected
without invoking their getters. JSON contains only value and unit; no host state.

Frozen enum records contain only enum/name. Documented constant aliases share
canonical identity. Numeric and XML conversion helpers expose pinned factual
metadata, canonical declaration-order member lists, and explicit type/range
errors. Historical UNMAPPED XML sentinels remain research facts only: conversion
helpers reject them under M-ENUM, and model color setters reject them before any
owner mutation. INHERITED members without XML representation are
exposed as symbols but rejected by direct underline/highlight setters; null is
the accepted inheritance reset. This prevents malformed attributes being saved.

The original boundary suite crosses raw absence, empty property containers,
boolean spellings and setters, all baseline modes with true/false/null, all
representable underline/highlight symbols, font names/sizes, raw RGB/AUTO/theme
and cached RGB, every paragraph flag, alignment/indent/spacing state families,
line rules, and tab defaults/leader/alignment/movement states. Its first proper
behavior run reported six failures before code fixes. Fixes retain empty rPr
creation/removal side effects, read the historical highlight default token as
AUTO while writing schema-valid none, initialize a newly assigned theme's cached
RGB to 000000, read signed universal paragraph measures including leading zeros,
and add/remove leader attributes while preserving unrelated stop metadata.
The source's explicit 0 length assignment is represented as Twips(0); untyped
numbers remain rejected for geometry fields under the shared SDK contract.
