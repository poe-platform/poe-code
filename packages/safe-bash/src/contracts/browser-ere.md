# Browser/core shell ERE conditions

The browser/core shell supports its existing `[[ value =~ pattern ]]` ERE
condition. This matcher executes in the shell's current JavaScript realm. It
does not obtain a worker boundary or hard resource isolation from the dormant
browser regex-transport override in the bundler.

For this condition, a match returns status 0 and a nonmatch returns status 1.
Invalid syntax or an unsupported character profile returns status 2. The
runtime maps an ERE limit failure to status 3; this is distinct from invalid
syntax and does not assert that an ordinary expression exhausts default limits.
Captures and quoted pattern segments retain the existing shell behavior.

The matcher uses ERE state/work admission and cancellation checkpoints. These
are not a total JavaScript heap bound, an independent thread, or a guarantee of
preempting arbitrary synchronous host work. Caller cancellation remains
cancellation rather than being reclassified as a regex syntax or limit result.

This shell condition is separate from Node-only command packs and their regex
worker transports. It does not make those command packs available through the
browser/core entry.
