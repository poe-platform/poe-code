# Resource URI normalization safety

Nine failing owner tests showed that WHATWG URL parsing alone accepts raw whitespace/control characters, backslashes and malformed percent escapes. These strings cannot be safely treated as unchanged resource identifiers. Four encoded/opaque valid cases passed.

Reject raw whitespace/control characters, backslashes and invalid percent escapes before absolute URL parsing. Keep shared server/client resource validation and subscription admission aligned. Six failing subscription checks reproduced the duplicated-parser gap before replacing those checks with the shared owner.

Verify URI template compatibility, protocol/resource results, subscription admission and cancellation. Preserve encoded paths and opaque URI schemes.

Three failing roots-result cases showed the same malformed identifiers passed the file scheme prefix check. Validate roots with the shared URI owner in addition to the required file scheme.
