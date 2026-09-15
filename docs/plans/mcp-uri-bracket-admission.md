# URI bracket admission

The final RFC URI differential check compared shared URI admission with the SDK's Ajv URI format. Seven raw bracket cases were accepted by the WHATWG URL parser despite violating generic URI component syntax, including URN paths, HTTP paths, query/fragment values and implicit HTTP authorities.

Seven fast regression cases failed before the fix. Raw square brackets now require an explicit authority and the parsed IPv6 host position, with exactly one bracket pair. IPv6 hosts, credentials/ports and percent-encoded brackets remain supported. This uses the existing URL parser and component inspection, with no regular expressions or new dependencies.

Red evidence: /tmp/mcp-uri-bracket-admission-red.log. Differential evidence: /tmp/mcp-final-uri-format-differential.log. Green evidence: /tmp/mcp-uri-bracket-admission-green.log. Repeat the complete protocol/OAuth source gate and final affected build/artifact checks after the change.

The existing WHATWG parser is stricter than generic RFC URI syntax for some scheme-specific cases, such as ports outside the HTTP numeric range. These changes do not certify a complete RFC parser or add support for every obscure URI form.
