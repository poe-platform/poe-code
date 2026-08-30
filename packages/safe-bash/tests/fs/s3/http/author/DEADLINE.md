# Standalone credential deadline correction

After source checkpoint e2082b3, a standalone process awaiting a credential
provider that never settles exited 13 with Node's unsettled-top-level-await
diagnostic. The request deadline was unreferenced and no socket existed yet.
This was a real deadline/lifetime defect, not a provider limitation.

The exact new regression is retained in `unit/errors.test.ts`. It launches only
a test child Node process; no product subprocess or runtime dependency is added.
`deadline-baseline.json` preserves **66/67**, including the child exit13 diagnostic.
The source change removes only `timer.unref()` from `request.ts`; cleanup still
clears the timer after completion/cancellation. `deadline-fixed.json` records
**67/67** and strict scoped TypeScript success with stable input hashes. The
child now prints `RequestTimeout` and exits0. Initial66/66 evidence is unchanged.

Request source SHA-256 after correction:
`33e2232404d05c08db2ccce200b6ca1d10af36f6a72f197e196fe1fa3f5ba618`.
Transport source remains
`ce19e4a347d50d84fb87b993c862717fc57fed183b584bc4b0ca04bcecb3a728`.

Raw baseline SHA-256:
`03e0d6f76b5633fa24097a56f0a4a83ede87d338b0b418c8ee8841df1bf34415`.
Raw fixed SHA-256:
`2ad7c1ff9a581f5ace8de32cd03ae1749c28b6afac6b34e114bb2d427353e712`.

## Service acceptance remains separate

The independent service worker's fresh e2082b3 replay reported **17/18** with the
explicit MinIO form-encoding profile. Existing-target same-view copy and LIST now
pass. Mounted missing-target copy is still blocked before HTTP fallback because
the frozen adapter requires `conditionalCopy` for exclusive copy. The author
direct-filesystem Shell test does not cover that mounted dispatch gate. Its green
result must not be substituted for the required independent positive.

Root was asked to route a narrow adapter seam or resolve the method-level
capability semantics. This leaf does not modify frozen S3 source, promote native
conditional COPY/DELETE, or weaken the original required expectation. No final
service acceptance or whole-product/typecheck claim is made here.
