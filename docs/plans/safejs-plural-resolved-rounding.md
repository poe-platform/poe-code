# Portable plural resolved rounding options

## Validated defect

The private plural engine applies rounding settings but omits roundingIncrement,
roundingMode, roundingPriority and trailingZeroDisplay from resolvedOptions.
ECMA-402 2025 Table 30 requires those fields; Node 22 reports them. Six focused
regressions fail for defaults and non-default configurations.

## Change

Extend the existing parsed-source generator adjustment to copy these four
initialized internal fields into the resolved-options result in specification
order. Reject an unexpected resolvedOptions method/return shape. Do not edit
node_modules, commit generated outputs, replace host Intl, or change rounding
algorithms.

## Verification

Run generation, plural, portable NumberFormat, bundling and guest formatting
regressions, scoped lint and maintained build. Probe generated output on Node 18
and Node 24 before a separate commit and direct main push.

This fixes a prerequisite for public Intl.PluralRules; it does not add that guest
API or resolve the separately identified range and notation differences.

Reference: https://tc39.es/ecma402/2025/#sec-intl.pluralrules.prototype.resolvedoptions
