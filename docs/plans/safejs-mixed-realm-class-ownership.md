# Mixed-realm class restoration

## Evidence

After the closure fix, three same-source mixed-realm snapshot cases still
returned the wrong Array, Object and RegExp prototypes from class constructors.
Classes are captured separately from ordinary guest functions and their restore
path still used the root budget rather than their originating realm view.

The first test attempt invoked class constructors without the required property
access context and was not evidence of a runtime defect. Corrected tests invoke
`new C()` through a restored guest closure. Those three cases failed their
prototype-identity assertions while all six existing closure controls passed.

## Change

Class records now carry the same optional realm identity as guest-function
records. Serialization derives it from the class's registered function realm;
restoration constructs the class with that realm's shared-accounting budget view.
Single-realm records retain their historical shape. Malformed IDs are rejected.

## Qualification

The original nine cases pass after the fix. Additional coverage exercises public
and private field initializers, a derived class, repeated JSON round trips and
malformed class realm IDs. All 64 focused tests across five snapshot files pass
on both Node 22.23.2 and Node 18.20.8. TypeScript and focused ESLint pass.
The preceding full snapshot run (2,093 tests) predates this patch.

Active-generator ownership, arbitrary mixed-source transport and public
admission/replay boundaries remain separate work. This change does not establish
complete class conformance or a green full-package gate. No push or release is
authorized while the release hold remains in place.
