# SQL option user-edge validation

Reviewed 2026-09-18 against the live, uncommitted working tree. This bounded
review does not establish complete csvkit compatibility.

The existing reference-only CPython 3.14.2 environment was authenticated again:
the interpreter SHA-256 and all 19 frozen runtime distribution versions matched
reference-profile.json, including csvkit 2.2.0. The inspected released
csvkit.cli.parse_list calls ast.literal_eval and catches only ValueError.
Two initial capture calls used incorrect pair shapes and produced harness
ValueErrors; they were discarded as invalid observations before test authoring.

Correctly shaped reference observations:

| Option source | Reference value |
| --- | --- |
| `'hello' ' world'` | `hello world` |
| `u'hello' r'\n'` | `hello\n` (literal backslash) |
| `r'a' u'b' 'c'` | `abc` |
| `['a' 'b', ('c' 'd',)]` | list containing `ab` and tuple containing `cd` |
| `{'x' 'y': 'a' 'b'}` | dictionary mapping `xy` to `ab` |
| `('a' #comment` followed by physical LF and `'b')` | `ab` |
| `'a' + 'b'` | original raw expression |
| `'a' #comment` followed by physical LF and `'b'` | SyntaxError, invalid syntax, line 2 |

Both new canonical tests failed with the original unsupported-literal refusal
before the code change. The bounded parser now concatenates adjacent string
tokens without evaluating operators, names or calls. Each string fragment
consumes work. Existing frozen adjacent-string data was preserved; its former
blocker assertion and argv/SDK exclusion were replaced by measured acceptance.
Top-level multiline diagnostics, bytes/complex/Ellipsis literals and unqualified
escape/warning profiles remain explicit blockers.

Current checks:

- csvkit maintained workspace tests: 4008 passed, 1 skipped, 6 TODOs, 77 files.
- csvkit maintained lint: ESLint, product and test TypeScript checks passed.
- Selected csvkit and safe-bash workspace build closures passed, uncached.
- All 61 CSV-related safe-bash command test files: 1934 passed, 1 skipped,
  1 TODO, zero ordinary failures. The TODO is the declared Unicode-duration
  Agate diagnostic difference; it is not an accepted compatibility observation.
- Maintained safe-bash integration discovery/guard checks: 109 passed.
- ESLint for the newly registered SQL lifecycle test and integration guard passed.
- Maintained safe-bash source/test and public-consumer typechecks passed across
  26 current consumer groups; expected negative declaration cases were rejected.
  This is type qualification, not external driver runtime acceptance.
- The compiled public Shell path was rendered and visually inspected. Both
  engine-option and execution-option string tokens produced the expected CSV
  labels and values, with readable output and no clipping.

Independent lifecycle review is recorded in sql-lifecycle-user-review.md.
No README additions, staging, commit, push or publication actions were taken.
Only review-owned temporary output is purged after reducing the evidence here.
