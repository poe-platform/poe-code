# Accepted: separately versioned native-only qualification

Date: 2026-08-27. Direct independent reviewer, different from author Heisenberg.
Exactly one authorized 16-row native replay and one focused-control execution
occurred. No source, package, type, 128-regression or full-cohort rerun occurred.

## Static review

Accepted overlay `d71d0789410a907107a8ab75d15cf93ddd8fe0e5` against pristine V9
`1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`; candidate context remains
`9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`.

The patch changes exactly one strict-diagnostic predicate:

```js
/invalid.*block|block.*invalid/iu.test(stderr)
```

becomes:

```js
stderr === "du: invalid -B argument 'invalid-value'\n"
```

The success matcher, timeout/spawn-error guards, nonzero status rule, expected
stdout, 16 inputs, sanitized per-row environments, order, budgets and all other
driver bytes remain unchanged. This exact diagnostic qualification is for the
pinned GNU du 9.7/C-locale/fixed-invalid-value profile, not arbitrary GNU errors.
The new predicate requires the complete program prefix, quotes, value and LF.

All three diagnostic captures authenticate to report `d53b003b`, its immutable
raw table and exact 40-byte SHA-256:
`927dbaaabbcd6f07c69e90d54e68af1d9f353275c4455837191ea77460d77009`.

## Explicit base and patched bindings

- Original V9 manifest SHA-256:
  `474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2`.
- Base native driver: 6,204 bytes, SHA-256
  `e537055e0b7516e2a2ddcd520f5197625334d2493b1b238d82b99edc94fd7def`.
- Declared patch SHA-256:
  `b5d837a790fdefd15beb27267c8ec9ef1c7e128d97463de5887b01516732c6c1`.
- Patched native driver: 6,212 bytes, SHA-256
  `e7c62a3c7976163c684f68f63efd2a95f0b7ea43481a887a5bcd32832b35b9eb`.
- Native oracle SHA-256:
  `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`.

PRE authenticates the 23-file pristine V9 tree, seven-file native overlay,
manifest/patch/new-file identities, capture provenance and both historical
evidence seals. Node v22.22.2, Git, native oracle and immutable process supervisor
were hash-bound before execution. Reviewer scripts have a pre-execution binding.

The prior compact archive supplied the authenticated V9-plus-lineage bytes.
All 23 archived fixture identities were checked, including the unchanged lineage
harness. Only four native runtime files were restored: driver, process manager,
oracle identity and environment table. No family copy, product materialization
or TypeScript artifact was created. `git apply --check` and `git apply` changed
only the native driver. Full selected inventories were verified before patch,
after patch and after execution. The original manifest authenticates pristine
bytes only; **the native-overlay manifest authenticates the patched driver**.

## Observed execution

| Check | Result |
| --- | --- |
| Focused predicate controls | 14/14: 3 captured positives and 11 negatives |
| Literal native success rows | 13/13 |
| Exact strict native rejections | 3/3; status 1, empty stdout, exact 40 stderr bytes |
| Separately versioned native table | 16/16; 0 mismatches; driver exit 0 |
| Input/environment/order audit | All 16 rows independently match unchanged frozen cases |
| Actual cwd / payload | Every native spawn uses the owned scratch cwd; locked 1,500 bytes remain exact |

The 11 negatives cover wrong success status, nonempty stdout, unrelated
diagnostic, wrong quoted value, wrong program prefix, missing LF, extra LF,
leading whitespace, timeout, spawn error and wrong-base hash rejection.
They are predicate/admission controls, not extra native semantic rows.

## Closure and preservation

All **19 roots/process groups** are absent: 17 oracle processes (version plus
16 rows), one native-driver process and one focused-control process. All settled
naturally; no timeout or forced termination occurred. The three owned runtime/
scratch/temporary directories are ENOENT. Five files were preserved in a compact
gzip data archive and every payload was verified. No loose TypeScript or AGENTS
files remain, and no AGENTS copy occurred.

POST exactly matches PRE for tools, original fixtures, native overlay, captures
and historical seals. Both existing data archives and all old evidence remain
byte-unchanged. This evidence is confined to the new native-predicate-d71d0789
subdirectory; no source/configuration/private files are written.

**Historical native 13/16 remains unchanged.** The old success-only tail remains
unrun; standalone post-failure verification remains standalone. This native-only
16/16 is a new versioned qualification, not a composite old full-gate pass.
Root's existing scoped DU-module/purity acceptance is neither rerun nor expanded.
O060 remains deferred; V2-V3 delta remains permanently unproved; original V9's
40 markers with exit 1 remain rejected. No public/default DU, whole-gate,
full-native or registration claim is made.

Remaining blocker within this exact native-only qualification: **none**.
Public integration and all other prerequisites remain root's separate decision.
