# Contextual arrow parameters

Native execution validated that non-strict ordinary arrows may use await,
yield and let as single unparenthesized parameters. SafeJS rejected all three
before the change: three regression groups failed while six reserved-context
controls passed.

Single-parameter arrow detection now applies the same contextual identifier
eligibility as binding parsing. Tests include escaped spellings and compare
guest execution with native results. Strict, generator and async restrictions
are retained and tested.

All nine focused tests and package TypeScript passed. The broader parser and
dynamic-function suite passed 1,269 tests, with one skipped. Focused lint
passed. This work remains local; pushes and releases are paused.

An async-arrow followup reproduced five additional failures for as, of, async,
yield and let parameters (12 controls passed). Async single-parameter lookahead
now uses the same identifier eligibility; binding parsing still enforces the
async await restriction and inherited strict/generator restrictions. Tests
include ordinary/escaped spellings and guest execution compared with native
results. Expanded validation is running. This followup is outside the frozen
isolated unit checkout.

The first async-lookahead repair passed 15 tests but exposed two failing
await-rejection controls. The single-parameter binding path had not installed
async grammar, unlike the parenthesized path. It now does so explicitly;
ordinary and escaped await must both remain forbidden. All 17 expanded tests
now pass, along with package TypeScript. The broader parser/runtime suite passed
1,382 tests (one skipped);
the consolidated focused lint check also passed. Later parser followups have
their own pending validation.
