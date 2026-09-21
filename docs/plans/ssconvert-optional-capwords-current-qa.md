# Optional capwords current candidate QA

Authenticate the original source archive under out against SHA-256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12. Inspect plugins/py-func/py_func.py: PY_CAPWORDS uses signature s and string.capwords. No Python subprocess belongs in the product or unit tests.

1. Run python-capwords.test.ts before implementing the port. Observe missing dispatch returning #NAME? rather than the expected string.
2. Execute the independently authored python-capwords-independent.test.ts, covering every ASCII codepoint, whitespace/control negative controls, punctuation/digits, typed errors/arity, optional namespace, cooperative cancellation and exact text/work limits. Keep Unicode explicitly unresolved.
3. Run the maintained ssconvert package tests and lint fresh, and the selected uncached safe-bash workspace build closure. After the build, run ssconvert-optional-capwords.test.ts through node --import tsx --test, verifying CLI/SDK bytes, original/checkpoint/replay, absent-provider namespace and preservation of input bytes.
4. Screenshot the actual built virtual command using the repository screenshot tool, inspect the image, and verify enabled/absent provider statuses separately. Do not add a root poe-code subcommand or screenshot tests.
5. Reduce current verification into optional-runtime-extension-coverage.json and reference-profile.json. Historical runs do not qualify changed bytes. Missing activated Python oracle, Unicode, percent-formatting, Perl date/substitution, database/FIFO services and external extension ports remain unresolved. Trusted provider closure execution is host authority, with cooperative budgets/cancellation; this work does not establish sandboxing or replay of arbitrary closures.

No pushes, publication, README edits or broad cleanup. Remove only current task scratch logs after reduction.
