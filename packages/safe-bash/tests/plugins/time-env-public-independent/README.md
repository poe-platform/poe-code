# Independent public integration review — August 27, 2026

Scope: review Curie's root/default/export-map integration at
`6ffe4f4f17637e44b55cc0455394513e8d6b94de`, **not independent review of the
underlying date/sleep/printenv semantics this reviewer previously authored**.
No product source or author assertion changes.

The unchanged author runner independently re-executed306 scoped source checks,
18 moved-packed checks twice, two adjacent consumers, six intentional negative
types and three fallback denials. New independently authored public integration
tests pass10/10, four negative type uses produce exactly TS2353/2322/2741/2322,
and three source/missing-runtime denial controls reject. Zero runtime skips,
cancellations or TODOs. Counts are separate, not aggregated into semantics proof.

The new tests inspect identical root/subpath factories and types, literal68
unique default names, optional capability absence, clock/timezone forwarding and
instance isolation, three atomic collision cases, top-level replacement authority
over nested JavaScript overrides, family limits, scheduler/chunk-limit forwarding
and cancellation reaching the injected timer. No native comparison is rerun.
Bare `%-N` virtual-clock and ICU/native profile differences remain unchanged.

Both isolated packs match the author's SHA256:
`1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e`.
The author replay source-tree hash is
`011f274582c14ba014704dda019bd01ba55c740bd0caf1ff964338c64fd26898`.
The new runner records each source byte/tool/package file hash, strictly compiles
a moved regular-file consumer, withdraws source, executes plain emitted JS and
rejects source read and missing runtime imports. It uses offline npm pack, copied
development tools, no private repository, runtime dependency, install or source
fallback. Product execution has no child-process permission; network is unused,
not claimed sandboxed. Owned scratch is removed in finally.

Reproduce with existing development tools and new output directories:

```sh
node tests/plugins/time-env-public/verify.mjs 6ffe4f4f17637e44b55cc0455394513e8d6b94de /tmp/time-env-author-replay-unique
node tests/plugins/time-env-public-independent/verify.mjs 6ffe4f4f17637e44b55cc0455394513e8d6b94de /tmp/time-env-independent-unique
```

`evidence/author-replay` and `evidence/holdout-final` preserve raw runs.
`evidence/holdout-first` retains the first runner failure: Darwin TMPDIR's `/var`
symlink caused Node permission denial before tests. Canonicalizing only the
owned temporary root fixed that harness setup without broadening permissions.
No product expectation changed. The three emitted denial processes deliberately
exit1; type-negative processes exit2, not successful runtime tests.

Release inventory work is separate in
`tests/integration/qualified-current-release-inventory`. These results do not
certify a whole gate, deployed services, native parity or overall superiority.
