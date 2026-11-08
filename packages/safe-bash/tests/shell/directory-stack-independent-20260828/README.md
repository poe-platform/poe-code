# Independent directory-stack precode freeze

Owner: the delegated DIFFERENT reviewer, not author Poincare. Scope is this new
directory only. `freeze-v1/CONTRACT.md` defines the author-facing acceptance
obligations; `cases.json`, `proofs.json`, and `controls.json` are declarative data,
not product tests. `verify.mjs` performs read-only fixture/Git integrity checks.

ROOT's policy in the August 28, 2026 assignment ratifies R1–R4. The author's
durable ratification, exact post-window base, candidate, ROOT GO and runtime
ownership-window release remain unprovided gates, not inferred approvals.

No native execution, product execution/import, build, type compilation, provider
request or implementation-body inspection is part of this freeze. Original
author native34+4, virtual0of34 and separate native-only grammar8 remain history.
Accepted CD evidence is authenticated by reference, not rerun or rescored.

Run the explicit static verifier from the repository root:

```
node tests/shell/directory-stack-independent-20260828/freeze-v1/verify.mjs
```

After sealing, use `--commit FULL_FREEZE_COMMIT` to authenticate every frozen
member against Git as well. Future results belong in a separately authorized,
uniquely named sibling; never overwrite this freeze or its static attempts.
