# Retryable scoped publication verification

## Validated failure

The September 17 executor release successfully submitted safe-bash 0.1.663 to
npm with provenance. npm explicitly reported that the package was still being
processed. The version endpoint continued returning 404 after the existing
verification window, causing the whole publishing job to fail. SafeFS and SafeJS
of that shared version were already visible. This is not evidence of a rejected
package, successful safe-bash availability, or a source/test failure.

## Change

Keep publication and exact registry availability verification as separate jobs.
The publish job outputs the exact submitted version; the dependent verification
job checks that value, without recomputing versions or publishing packages.
Rerunning failed jobs can therefore retry availability checks without creating
another version or republishing already accepted artifacts.

Allow up to 180 polls per package, bounded by a 45-minute job deadline. Retain
connect/request timeouts, no-cache requests, exact JSON version checks, and
failure when a package remains unavailable. Never treat npm's processing notice
as verified release success. The verification job needs no repository or OIDC
permissions.

Validate workflow syntax with npm run lint:workflows. No workflow unit tests are
added. Continue monitoring the exact submitted versions through registry
availability and successful verification.
