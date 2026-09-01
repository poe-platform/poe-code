# Brace-expansion audit cleanup

The September 1, 2026 dependency audit reports one high-severity vulnerable
package, with three advisories affecting the locked 5.0.6 copies:
GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, and GHSA-rgw5-rvv9-x895.

Update only the three existing 5.x lockfile entries to 5.0.9, the patched version
already used by glob. Preserve the 1.x and 2.x consumers and every parent version.
Registry metadata confirms the tarball integrity; existing dependency ranges
accept the update. No blanket override or dependency major upgrade is needed.

The lockfile-only audit reports zero vulnerabilities after the update. Before
delivery, synchronize the installed dependencies and run the affected build,
lint, and unit routes. Keep this separate from test scheduling changes.

Fresh `CI=true npm ci --no-audit --no-fund` installs successfully in eight seconds
without warnings. The installed-tree audit reports zero vulnerabilities at every
severity. All 118 focused Braintrust, schema/codegen and markdown-reader tests pass.
