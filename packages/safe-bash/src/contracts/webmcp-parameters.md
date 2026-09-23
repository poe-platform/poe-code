# WebMCP call parameters

`webmcp-call NAME --params JSON` accepts a JSON object and defaults to `{}`.
Before parsing or accessing the browser, parameters must fit all of these limits:

- 1 MiB of UTF-8 JSON, or the configured `maxCommandBytes` when smaller.
- 10,000 JSON values and property names combined, including repeated keys.
- 64 nested object or array containers, including the root object.

Limits apply to registered and missing tools alike. Exceeding a limit raises
`PlaywrightResourceLimitError`; malformed JSON retains native syntax errors.
These input limits are independent of page-provided metadata and output limits.
