# Intl intrinsic mutation accounting

## Validated defect

RelativeTimeFormat and DisplayNames were installed and assigned intrinsic identities,
but omitted from the Intl constructor/prototype mutation-tracking registration.
Measuring retained budget values after assigning a 2,000-character string to a
prototype property reported zero growth for these two constructors, compared with
2,007 units for Locale, Collator, NumberFormat, and ListFormat.

## Change

Register both constructors with the existing intrinsic mutation tracker. Keep the
existing accounting and snapshot identity mechanisms unchanged.

## Verification

- First reproduce the omission with a focused test: two failures, four controls passing.
- Check retained growth for both prototype properties and prototype-method properties.
- Check that deleting the added property releases its retained charge.
- Run focused Intl and intrinsic/snapshot tests, scoped lint, and the SafeJS build.
- Commit and push this fix separately, then monitor publication without blocking other work.
