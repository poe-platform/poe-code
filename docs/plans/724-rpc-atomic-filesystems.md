# Issue 724: RPC-backed atomic filesystem integration

## Validated gap

Current ZIP publication requires owned staging, extraction additionally requires
atomic directory metadata, and csplit requires conditional file mutation.
Bounded writes, exclusive creation, and atomic rename alone cannot satisfy these
contracts. Do not replace explicit capability failures with client-side fallbacks.

## Delivery

- Document the existing server-side operations, capability declarations, scoped
  identity and revision encoding, original commit receipts, cancellation, lost
  responses, conditional cleanup, and admission limits.
- Publish a portable, opt-in conformance case factory at
  `@poe-platform/safe-fs/testing/atomic`, with isolated injected filesystem
  fixtures and no ambient host/network access.
- Exercise the suite against memory and deliberately broken adapters; exercise
  actual ZIP extraction and csplit through a serialized loopback adapter.
- Validate Node, browser and scoped-package consumers and preserve the normal
  shell and filesystem safety contracts.

The actual Poe agent-service server is outside this repository. This delivery
provides its supported integration contract and reusable conformance tests,
not an assertion that its production RPC service has already been upgraded.
Service-side race/fault injection and deployment remain integration acceptance.

## Verification and release

Use focused filesystem and archive tests, maintained type/build/package routes,
native Info-ZIP comparison for the separate issue 723, and packed public
consumers. Commit and push each atomic issue separately, verify remote main,
close validated issues, and monitor root and scoped releases through publication.
