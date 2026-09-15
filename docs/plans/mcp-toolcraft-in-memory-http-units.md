# Toolcraft in-memory HTTP unit coverage

The maintained gate and prior Toolcraft suite reproduced HTTP unit failures from real loopback binding under the sandbox. These cases already use the tiny HTTP package's HTTP test helper. Install its existing in-memory fixture explicitly in four Toolcraft HTTP test files, keeping behavior/schema/OAuth/concurrency tests uncached and avoiding network sockets. Preserve actual network verification as a separate delivery requirement; do not count an in-memory run as TCP coverage.

The fixture's response destruction lifecycle was repaired separately with a one-stream recovery regression. Rebuild the helper package and run the maintained Toolcraft suite after the broader gate finishes. Additional fake-response lifecycle defects must be reproduced, not worked around by widening product capacity limits.

Four-file rerun passed: 69 checks in 7.50 seconds, without real sockets. Includes hosted OAuth login/persistence, SDK and tiny-client adapter behavior, stream capability, HTTP option forwarding and capacity recovery. Full Toolcraft maintained package suite remains to rerun.
