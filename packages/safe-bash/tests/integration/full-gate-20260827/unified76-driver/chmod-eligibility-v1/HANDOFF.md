# Historical native eligibility v1 — author candidate, not release

## Exact bindings

- Author preseal: `6b959e54`; source/control candidate:
  `e35d83ca97f6aa4f32b2cb8542f5e711458f6aeb`.
- Different reviewer freeze: `17b9249a06c5d768409fea932ea7f44e36b63720`.
  Its40 proposed cases are not this author's15 executed groups and have not been
  executed or accepted here.
- Normalized DRIVER SHA256:
  `f192ca9330a440d33e49544e135a04305a48e84ce85858f902860aafa2ccd4f9`.
- Effective prospective profile SHA256:
  `fa6731eec6b41915f3f56affa9cdf29e7352a10e939bb0f1fe1b9d675caa7510`.
- Historical eligibility receipt SHA256:
  `519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6`.
- Fixed product remains `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; expected
  package `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
  No archive/materialization/build/pack occurred. Never build moving HEAD or
  author-source e35 as a substitute for the selected f5 product.

`SOURCE-CANDIDATE.json` binds41 shipping files, including DRIVER, to the e35
Git blobs and SHA256/lengths. Exactly five existing runtime files change:
admission, execute, policy, profile and run. Three new files are
historical-eligibility.mjs, ELIGIBILITY.json and maintained-prerequisites.mjs;
DRIVER is resealed. The other32 existing runtime bindings are unchanged.
Original raw PROFILE/receipt remain8c9363ea; the effective parsed profile adds
only `historicalEligibility`. This is a NEW qualified profile identity, not an
edit/rescore of the original strict profile. All632 canonical paths/bodies,
192 classifications,256 cleanup inputs,51 tool identities, bounds, frozen
helpers, projection/fence/routes and selected package inputs remain bound.

## Stable review APIs and setup

Under `unified76-driver/launcher-v3/`:

- `historical-eligibility.mjs`: `decodeEligibility(policy)`,
  `readHistoricalEligibility()`, `validateAuthorityRecord(record)`,
  `validateEligibilityProfile(profile)`, `requireEligibilityRelease(receipt, profile)`.
- `maintained-prerequisites.mjs`: `createPrerequisiteReceipt()`,
  `prerequisites({repository,source,temporary,environment,candidate,receipt,
  historicalEligibility,privateState})`; shipping supplies the frozen
  `privateState` callback within the existing inherited-route scope.
- `runPrerequisiteStages(input, stages, receipt?)` and
  `prepareOwnedGroup({directory,root}, operations?)` expose internal injection
  seams for synthetic controls, not a public product API or permission bypass.

Historical bytes authenticate before setup callbacks. Fresh stages retain order:
source authorities; metadata identity/profile verification and staging; archive
identity/profile; owned temporary group setup; byte identities/version staging;
private before, regular-file copy, private after/equality. Errors stop subsequent
stages; no catch/resume around the old frozen monolith. Fresh group setup creates
its own native-tmp and measures/normalizes member group/ACL, without invoking
fixtureAuthority or either denied admission probe. Its receipt is group-only,
not a capability pass. It does not reuse the old failed temporary path.

The existing outside private-final-sweep/private-finally scopes remain. A partial
private-copy error now retains its before token and progressively captured file
list so the outer finally can attempt its guard; failure remains failure. This
is source plus synthetic evidence, NOT execution of real private behavior.
Required group/source/archive/byte/private errors are not waived by history.

## Historical labels and raw runtime outcomes

NA-2755/NA-6755 are newly assigned IDs for exact mode records from55db52a4, not
newly run probes. ELIGIBILITY embeds only that compressed non-instruction data,
checks compressed/decoded hashes and complete records, and preserves the complete
original observations. Date is August28 and the11:01:53.330Z–11:02:47.868Z attempt
interval, not a per-probe timestamp. Labels are HISTORICAL,
UNSUPPORTED_HOST_OPERATION, native parity UNQUALIFIED, denial origin UNKNOWN.
There is no fresh capability claim,49/51 semantic result, or automatic test
attribution. See `ATTRIBUTION.md` for exact static case dependencies.

All14 phases remain ordered/eligible under unchanged strict setup/guard rules.
Raw canonical status/counts are retained without skips, filters or deductions.
Unexecuted phase observations remain NOT_EXECUTED. A synthetic clean all-pass
runtime receipt still returns exit1 and
`QUALIFIED_DIAGNOSTIC_UNQUALIFIED_NATIVE`; runtime problems retain
`HOLD_OR_QUALIFIED_RED`. Outer supervisor also requires matching inner verdict,
complete clean phase/worker receipts and status1 for the qualified diagnostic.
No path returns all-qualified/strict green under this historical profile.

Future release must bind the NEW driver/effective profile and additionally name:

```json
{
  "eligibilityProfile": "unified76-historical-file-authority-20260828-v1",
  "historicalEligibilitySha256": "519ac40f0239bf363586c5144bbe7f0f3c72c786f42abbc2d1d9ffb004ba2cf6",
  "acceptsUnqualifiedHistoricalNative": true
}
```

These are extra required fields, not a release receipt or token. Existing action,
candidate/package/public/independent seals and fresh ROOT authorization remain
required. No new release/launch packet or `--run` was executed or issued here.

## Actual author controls and limitations

Executed once with pinned Node24.11.1:

```sh
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --test --test-reporter=tap --test-timeout=15000 tests/integration/full-gate-20260827/unified76-driver/chmod-eligibility-v1/controls.mjs
```

Results:15 groups PASS,0FAIL/0SKIP/0TODO/cancelled, exit0. Raw stdout and empty
stderr identity are in `results-v1/REPORT.json` and `stdout.tap`. All stages use
in-memory synthetic callbacks; H12 uses the actual phase runner with an injected
fake supervisor, retaining a failed first phase and eligible independent second
phase. No native chmod/tool preflight/private/setup/build/gate executed. Synthetic
temporary files were removed by the test hook; capture root remains
`/tmp/unified76-eligibility-author-v1.6P5wI5`. No active test child remains.

The first metadata-capture script hit Git-show ENOBUFS on the large PROFILE file
before writing output; no candidate controls were repeated. The corrected capture
uses bounded direct-tree object IDs and computes local Git blob hashes, without
increasing buffers or repeating that large-output command. This separate capture
incident is retained in REPORT, not a product/control failure or gate attempt.

Old c222/55db remains consumed0/14. Its failed roots/raw captures are untouched;
original EPERM cause, E03.3 unsupported and prior bound-only A10/protection claims
stay separate. Current features/XAN are not injected. Source/control verdict is
AUTHOR ONLY pending Dirac's independent scoped review and any fresh ROOT release.
