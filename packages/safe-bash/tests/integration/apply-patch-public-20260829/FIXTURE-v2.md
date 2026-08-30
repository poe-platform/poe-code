# Exact post-run fixture correction, not another author run

The sole author run on derived e83d6c48 is retained: public27/28 per layout,
arrays12/12 and selected coherence18/18 per layout; maintained82/83 and moved
stream21/21. No product or resource failure is established by these four failed
assertions. Full build/package/type/control outcomes are separate.

## P05 reference domain

Original public.mjs compares the retained registry entry to the input `custom`
object. Selected contracts/command.ts:76 creates a frozen copy at registration,
before aggregate setup. The original reference is therefore not the registry's
identity. Preserve that exact failed assertion in public.mjs and the raw run.

NEW public-v2.mjs captures `commands.get('custom')` and
`commands.get('apply_patch')` before setup. Afterwards require the exact retained
custom registry object, unchanged custom execute function, and a different
apply_patch registry object. Count80 and top-level-true/nested-false options stay
unchanged. This strengthens the replacement control; it does not normalize or
change product behavior. All other27 cases are byte-identical.

## Maintained expected tail

The existing maintained stream-inspection file asserts79 and79 unique entries,
but its separate literal `definitions.slice(60)` expectation still ends at
timeout. Append only `apply_patch` to that list. The new default is explicitly
authorized; all earlier names/order, input, outputs and other tests stay unchanged.
This is a missed name-list migration, not a runtime fix or fifth new test scope.

## Status / proposed independent follow-up

Both corrections are SOURCE/DATA-justified but UNEXECUTED after correction.
No second build, install, product test or retry is authorized/performed here.
The new derived composition changes only this maintained test blob; every278
build input and the actual full898 package stays identical. The original one-shot
recipe and its failed results remain immutable. A versioned binding accompanies
the correction, never a rescore of e83d6c48.

Suggested different-reviewer checks: P05-v2 across the same three layouts;
retained-custom replacement mutant and apply_patch nonreplacement mutant;
current exact-tail case with a missing/extra-name mutant; immutable input/other
assertion comparison. None is credited as executed by this document.
