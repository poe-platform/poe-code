# Initial permission-path failure

The initial verifier was not committed before its run. Its full command records,
stdout/stderr and outcome are retained as `initial/*` in the raw envelope; no
pre-run source hash is claimed for that initial verifier. The following exact
two-line author correction records how its form differs from committed
`ef283a64:verify.mjs`; this is a reconstructed source delta, not an independently
authenticated original-source capture.

```diff
-import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,cpSync,rmSync,existsSync} from 'node:fs';
+import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,renameSync,cpSync,rmSync,existsSync,realpathSync} from 'node:fs';
-const root=mkdtempSync(join(tmpdir(),'combined77-stage2-proof-')),source=join(root,'source');mkdirSync(source);
+const root=realpathSync(mkdtempSync(join(tmpdir(),'combined77-stage2-proof-'))),source=join(root,'source');mkdirSync(source);
```

Node resolved `/var` to `/private/var` outside the literal permitted directory.
The initial packed consumers never executed product cases. No permission flag,
product file, fixture expectation or source-denial check was removed. The final
successful run used a new temporary directory and the committed corrected
verifier. Initial47 passing source cases and the subsequent permission failure
remain separate from the fresh68-case affected-fixture success.
