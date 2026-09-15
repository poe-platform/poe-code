# URI lexical admission

Comparing the shared validator with the SDK's standard URI format validator reproduced acceptance of raw Unicode, C1 controls, angle brackets, and braces. Nine maintained cases reproduced globally illegal URI characters; three additional valid percent-encoded cases preserve legitimate identifiers.

Reject non-ASCII raw characters and globally illegal URI punctuation before URL parsing. Unicode resource paths remain representable by percent-encoded URI values. Apply the same shared owner to metadata URI formats, resources, roots, and subscriptions rather than adding independent parsers.

Evidence: /tmp/mcp-uri-lexical-rfc-red.log and /tmp/mcp-uri-lexical-rfc-green.log. Run the full core/client protocol gate, maintained client closure, and consumer/schema checks after this final lexical correction. This check validates URI identifiers; it is not network origin or DNS policy.
