# Preserve the extension cleanup hook's return contract

The detachable-owner-cleanup change exposed its internal detach function through
ExtensionContext.onCleanup, whose public contract returns void. Extensions should
not receive the internal capability to remove their teardown registration.

An initial shorthand-setup probe was invalid: setup must return an exports record,
not undefined. The rerun (89135) still failed after return-value suppression,
disproving that proposed compatibility regression. The corrected test uses a valid
setup returning `{}` and checks the cleanup hook's return value directly.

The public extension adapter now discards the internal handle. Internal
RunResources.add still returns it for rollback. Teardown behavior and cleanup
order are unchanged. This adapter is intentionally not a transparent proxy: its
return value is the compatibility boundary being enforced.

Validation: the corrected test failed against the committed implementation
(38909: an internal function was returned). With the adapter, all 65 focused
realm/resource tests passed in both the working tree (45230) and isolated candidate
(93441). All 1,321 candidate source/test blobs matched the staged tree. Package
TypeScript (37568) and scoped ESLint (25042) passed. No push or release is authorized.
