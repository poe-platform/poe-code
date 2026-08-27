# Exact repair result v1

Candidate: `fbbe1ef793b7434871403125efbeb46624a8e081`.
Historical independent candidate: `6747227230cd770379148552d471621717b766d7`.

- Original12: 12 pass / 0 fail in isolated mode; same 12 in moved mode.
- Nearby4: 4 pass / 0 fail in isolated mode; same four in moved mode.
- Types: exact original positive source/strict build and moved declaration checks
  exit 0. Exact six negative rows produce TS2322/TS2740/TS2740/TS2322/TS2739/TS2322
  at lines 2–7, exit 2, in both modes. No missing imports or extra diagnostics.
- Prior mutants: 3/3 compile and fail candidate-passing H01/H08/H10 assertions.
- Repair counterfactuals: 2/2 compile and fail candidate-passing original
  H04b/H07b assertions. Only those records run for the two targeted controls.
- Sealed replay: identical results; not a new cohort or historical rescore.
- Original historical 10/12, prior controls, freezes and evidence remain untouched.

Exact helper emitted/moved JS SHA-256:
`ef09ed467282c95ef729be71999b9945e7b16ddfaf90c1bc3d2688d30c138d13`.
Exact helper emitted/moved declaration SHA-256:
`67b90043f40ef0c5a53ae0be912351cb05f51707523ca4a3ae4e7d8b9f432e65`.
They match author artifact identities, but are independently generated here.

Raw TAP, compiler diagnostics, process commands/environment/module paths, copied
input memberships, tools, mutants and removal logs are in evidence-v1/ and
replay-v1/. No infrastructure failure is counted as a mutant kill. The driver
reports collection completion separately from candidate status in summary.json.
Author suites were not rerun. No Runtime/Shell/public seam or Stage 2 gate exists.
