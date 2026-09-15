# Modern MCP cache metadata validation

Twelve failing tests reproduced discovery and tools/list accepting negative/fractional/string/missing TTLs and invalid/missing cache scopes. The official 2026-07-28 JSON Schema requires nonnegative integer ttlMs and private/public cacheScope for cacheable results.

Share method classification and cache validation in the protocol module. Servers retain conservative defaults for omitted author hints; reject explicit invalid values as internal errors. Clients reject malformed remote cache metadata before state changes or result exposure, and never downgrade a recognized malformed modern discovery result to legacy initialization.

Focused client and server checks are running. Update historical fake modern cacheable responses to carry required fields, then full client/server/consumer validation. Unknown custom methods remain extension-compatible.
