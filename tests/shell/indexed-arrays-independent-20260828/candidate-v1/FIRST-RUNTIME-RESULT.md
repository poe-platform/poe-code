# First actual array runtime review: scoped HOLD

2026-08-28. Type preseal `0f76165f`; runtime preseal `f8f740f4`.
Product c7dae6e884d1a144266dfc1bb80785bf007a667f, source/test candidate
50117fc54fdfd650e8f57e84b82ba21297ab8a0f, composed tree
d6c17f62d2d3062b5ab074044a86b8a455820373; exact full862 package
0fadca03da4e100c7dd5b7df0a25d321467f9f1f9fbd288ebcc4456746945d26.
No raw HEAD product overlay, rebuild, native or private-engine execution.

## Versioned typing, independently executed

- Public-v2 plus the unchanged other eight cases: **9/9** admission expectations
  match. This is a new versioned result, not a rescore of187c7c51.
- Original public fixture separately remains the exact exit2 TS2322/TS2722
  negative countercontrol: **1/1**. Original fixture bytes are unchanged.
- Accepted-baseline root/command/shell declarations compare byte/mode-identically
  before dispatch. All concrete paths, compiler argv, raw traces and prelaunch
  finite app/tool censuses are preserved. No generic parent permission or
  fallback widening; exact npm closure is unchanged and not executed.

## Actual runtime observations

Six pre-import app/package guards pass: exact positive, missing root module,
changed root mode, extra app entry, symlink entry and wrong package digest.
Physical negatives are restored and exact censuses verified before product load.
The worker imports the actual bare public package and emitted runtime, validates
77 defaults, and records **212 distinct actual file loads**, including private
array modules and the terminal observer. Source-build means the preserved exact
package emitted by the reproduced269-input build, not tsx execution of TS.

Requested semantic cohort33 yields **27 complete observations:26 pass,1 fails**.
O11 is incomplete; O12–O16 never start. No whole-cohort pass ratio is asserted.
The worker exits13 for unsettled top-level await; runner and coordinator exit78.
The missing summary is rejected, not promoted to success from earlier PASS rows.
Dependent holdouts, operations, mechanical cases, installed/moved repetitions
and all semantic mutants remain unexecuted. No mutant kills are claimed.

### Product finding S06: extra empty argv

Frozen input, with registered argv/status capture commands:

```sh
a=(); b=(); __array_value "${a[@]}${b[@]}"; __array_status "$?"
```

Project-frozen expected invocation args: `[]`; actual: `[""]`. The guest produces
empty stdout/stderr and exit0, but the exact argv assertion fails. The S06 body
and all field/state expectations are unchanged. Terminal observer wrappers are
not installed until O11, so they cannot cause S06. This is a concrete mismatch
against the ratified left-to-right splice vector, not a new native comparison.

Source localization: parser.ts:306 introduces a quote-opening empty text part;
runtime.ts:3716 marks quoted text present. The aggregate path does not remove
that presence when both aggregates are empty. A correction must preserve S08's
genuinely explicit quoted-empty field, not suppress every empty quoted field.
The parser/runtime implementation is read-only here; root should route a narrow
regression-backed author fix rather than change S06.

### O11 safety stop: reviewer observer defect, not product-cleanup proof

`terminal-adapter.mjs:19` uses `monitor.store.bindings.get('a')` as if it were an
IndexedBinding. Actual bindings.ts:170–188 defines a NamedBinding wrapper; the
typed getter `store.get('a')` unwraps it. Accessing `binding.values` in the
observer therefore can throw before the original owner.close is called. The
observer has already retained that owner; its finally-disposal then waits for
the never-started completion. This source-level observer defect is sufficient
to explain the observed unresolved await and violates transparent forwarding.
The hidden intermediate TypeError was not printed by the worker; no unwrapped
O11 replay has occurred, so this is not labeled a product leak or accepted O11.

Proposed narrow observer-v2: use the actual typed store getter; catch and retain
observer-capture errors separately, **always** forward original close once with
unchanged receiver/arguments/return/throw identity; report observation errors only
after the actual close has been forwarded and settled. Preseal synthetic controls
for capture failure, original-close failure and exact completion identity, then
a bounded actual O11 continuation plus remaining unobserved cases under the same
package/tools/guards. No observer fix or retry has been made in this checkpoint.
Original unsafe run remains immutable, and root must authorize its continuation.

## Capture integrity and cleanup

`FIRST-RUNTIME-01.json.gz.base64` retains all ten type outputs, every runtime
observation/load/diagnostic, exact manifests/GO, negative guard captures and final
append-aware stage census. Prior package capsule remains the exact artifact
reference. Encoded SHA256:
`c84e205b07dc5c472650bc468c278ab99877dec63cdc0c5c8040c4bfacc7f995`;
decoded SHA256:
`0c2bbc09b0a291ba9b4a3eeb623857b12deae2b9691daa460fc52ea973908d08`.

All10 type children plus runtime runner/worker are closed, their12 process groups
absent. O11 in-process invocation retirement is **not proved** by OS process
reaping. Package/source/app/tool files remain unchanged; after preservation and
reread/integrity checks, only `public-v2-app-5xarxw` is removed. No active owned
validation child, source edits, foreign staging changes or full-gate claims.
Historical DOTGLOB/STACK/native/array-design qualifications remain unchanged.
