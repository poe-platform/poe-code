# Additive close-event correction (leaf implementer checkpoint)

The original baseline stays **57/60**, including its cleanup failure. The
product-free frozen diagnostic reproduced 1/20. Neither is rewritten. The five
original frozen files, every original evidence JSON, and supplementary freeze
remain byte-identical to `0a3fb6e`. No native expectations are regenerated.

The delegated user explicitly permits a corrected lab/product runner. `lab-v2.ts`
differs from `lab.ts` only by importing `closeResources` and replacing the three
close-body statements. Server request handling, idle checks and all expectations
are identical. The helper subscribes before destruction, awaits actual server
and socket close events (including connections delivered during shutdown), bounds
the combined wait at two seconds, retains the zero-socket assertion and adds a
non-listening assertion. It removes its own listeners/timer even on failure.
This is a fixture lifecycle correction, not a product-leak fix or acceptance.

SHA-256 identities:

- original lab: `74b2220af6ff9e49c88bce83f8f6b56569b83f72f790ee9cf492c16995a8399d`
- corrected lab: `dc0797d8134c69b4a167875ccaad41a559c316de1c596be0639e6023bfe4a9ce`
- close helper: `0924008f0bf372ef4f84448cdb4b2f223302797491717ed76f55aebeafad2ac3`
- original oracle: `b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7`

`product-v2.ts` adds only the corrected lab import and committed-source gate.
`supplement-v2.ts` adds only that source gate; its original source-hash checks
still validate the untouched supplementary sources against the native capture.
`evidence.ts` is untouched and still validates every original fixture hash.
No provenance exception is needed for the frozen files; these are separate
versioned runners with the explicitly described fixture-only delta.

`CURL_VERIFY_AFTER_HANDOFF` still identifies the authentic original handoff.
An additional `CURL_VERIFY_SOURCE_REVISION` accepts an explicit full committed
descendant revision. `source-gate.ts` checks the entire current network inventory
and each file's SHA-256 against that commit before product import. Omission
retains the original handoff restriction. `capture-v2.mjs` records before/after
source hashes and refuses overwrites; it does not loosen native expectations.

Validation: `cleanup-selfcheck.ts` passes 3 discriminating checks (destroy without
close stays pending, absent close times out, close without zero tracked resources
still fails) and 100 product-free failing-upload iterations, with zero requests.
`cleanup-v2.json` captures that run, source identities and stable baseline network
digest. The only subsequent helper edit annotates the close callback's existing
error type for Node typings; scoped `tsc --noEmit -p
tests/commands/network-stress/tsconfig.json` then passes. A later postfix capture
will include the final annotated helper identity. This is implementer evidence,
not the separately assigned final independent review.
