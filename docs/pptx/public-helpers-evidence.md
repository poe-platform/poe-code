# Public value helper evidence

Authority: [SDK contract](../specs/office-sdk.md),
[CLI contract](../specs/office-cli.md), [format contract](../specs/pptx.md),
[pinned API inventory](upstream-api-inventory.json),
[pinned test inventory](upstream-test-inventory.json), and
[language/security decisions](api-language-mappings.md).

## Verified changes

The existing immutable RGB value now checks numeric bracket positions and reports
`IndexError` / `index-out-of-range`. Numeric brackets remain zero-based;
negative positions are accepted only through `at`. Invalid `at` positions use
the same error category. Supported slices preserve exclusive ends, direction-aware
omitted bounds, negative normalization, clamping and frozen snapshots; invalid
steps use `ValueError` / `invalid-value`.

Existing color model views return `MSO_COLOR_TYPE` and `MSO_THEME_COLOR_INDEX`
symbol values. Theme setters convert validated enum values to XML tokens through
the shared enum definition. Non-theme colors return `NOT_THEME_COLOR` (zero);
absent color still throws. Return-only enum sentinels, unknown numbers, strings
and null are rejected before changing XML. Operation records keep their existing
string color tokens. Both the text color and shape color live views use the same
color definitions. The former `ColorPropertyAccessError` export is an alias for
the common `PropertyAccessError`, preserving the existing spelling without a
second error category.

The complete seven-class unit implementation already existed. The existing
[length case ledger](length-case-map.json) records 56 public class/member rows
and all 13 pinned unit cases. New original cases supplement it with safe integer
edges, positive/negative half rounding, zero normalization, unsafe converted
values and absence/type/nonfinite rejection in every helper. No change to unit
rounding or object-to-number coercion was needed. Numeric range failures now use
the documented `ValueError` category for both lengths and RGB channels.

## Original test evidence

`public-value-helpers.test.ts` began with 48 cases: 32 passed and 16 failed
(6 numeric bracket bounds, 5 checked lookup error categories, 5 slice error
categories). Implementation made all 48 pass. Two additional preimplementation
regressions proved absent colors did not use the shared property error class and
model color properties returned raw strings instead of documented enum values.
Both then passed. These added cases cover public protocols without dedicated
pinned unit tests; they do not claim a larger suite's missing coverage is complete.

The focused suite covers `public-value-helpers`, `length`, `font-color-cases`,
`drawing-accounting` and `shapes`. The final focused run passed all 292 cases in five files (371 ms total, 87 ms
test bodies). A separate red/green regression established numeric range failures
previously used `OfficeError`, then passed with `ValueError`. Targeted ESLint
passed for the edited color/model/test source before the final numeric error
refinement. Maintained package checks belong to the coordinator receipt.

All inputs are original scalar values and small in-memory XML strings. There is
no filesystem I/O in these cases, so no memfs adapter is necessary; no publisher
content or cloned binary is copied. No product host I/O, network or native runtime
was added. New helper behavior changes no CLI output. This bounded receipt is not
whole-public-API coverage, and does not erase other unsupported inventory rows.

## Completed helper type/error mapping

Nine additional original regressions first failed (51 prior cases passed), proving
wrong constructor/parse types were conflated with invalid numeric or hexadecimal
values. All seven unit constructors and every RGB channel now reject nonnumeric
input with the common `TypeError` / `invalid-type` class. RGB `from_string` uses
the same category for nonstrings, and uses `ValueError` / `invalid-value` for
malformed hexadecimal strings. Null, undefined, false, zero, empty structures and
bigint inputs are distinguished without implicit coercion. Finite/range checks
remain value errors; no separate parsing implementation was introduced.

General color-operation validation retains its existing OfficeError category;
this receipt covers the documented helper constructors and explicit new index,
numeric-range, slice and unavailable-property mappings above.

## Final integration validation

`npm test --workspace=pptx`: 201 files, 5,903 tests passed.
`npm run lint --workspace=pptx`: ESLint, source and test TypeScript passed.
`npm run build:workspaces -- --workspace=pptx`: selected dependency closure passed.
These checks ran on the working tree, including preserved unrelated changes;
they do not claim whole-public-API completion.
