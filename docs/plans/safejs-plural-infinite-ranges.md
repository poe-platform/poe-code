# Portable plural ranges with infinite endpoints

## Validated defect

The private plural engine rejects every non-finite range endpoint. ECMA-402 2025
ResolvePluralRange rejects NaN, but permits positive and negative infinity.
Thirty native comparisons across en, fr, ar, ru and sl fail before the fix;
four NaN rejection controls already pass.

After removing the guard, 28 native comparisons agree and two French cases
differ. Investigation confirmed that French other/one has no explicit CLDR range
entry and LDML specifies the end category as the default. Range categories are
implementation-dependent in ECMA-402. This difference is not a validated defect;
tests now assert the preserved CLDR-based results explicitly, including one for
French infinite-to-one ranges, rather than treating Node as the sole oracle.

## Change

Use the maintained parsed-source generation step to replace the validated
non-finite guard with a NaN guard. Leave plural categories and range mapping
unchanged, including locale-specific results for infinite-to-finite ranges.
Reject a changed dependency guard shape rather than silently patching it.

## Verification

Regenerate ignored private backend files, then run generation, plural,
NumberFormat, bundling and locale-formatting tests. Run scoped lint and maintained
build, and probe supported Node engines before a separate commit and main push.
This remains a prerequisite for the missing public Intl.PluralRules API.

Reference: https://tc39.es/ecma402/2025/#sec-resolvepluralrange
CLDR fallback: https://unicode.org/reports/tr35/tr35-numbers.html#Plural_Ranges
