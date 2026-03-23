# poe-oauth

OAuth client and API key validation for the Poe API.

## OAuth

PKCE-based OAuth flow with local callback server:

```ts
import { createOAuthClient } from "poe-oauth";

const client = createOAuthClient({
  clientId: "your-client-id",
  authorizationEndpoint: "https://poe.com/oauth/authorize",
  tokenEndpoint: "https://api.poe.com/token",
  openBrowser: async (url) => { /* open url in browser */ },
  readLine: async () => { /* read manual paste from terminal */ }
});

const authorization = await client.authorize();
// authorization.authorizationUrl — URL to open in browser
const result = await authorization.waitForResult();
// result.apiKey, result.expiresIn
```

## Check auth

Verify an API key and fetch the associated identity:

```ts
import { checkAuth } from "poe-oauth";

const identity = await checkAuth({ apiKey: "sk-poe-..." });
// { email: "user@example.com", balance: 1500 } | null
```

## API key validation

```ts
import { isValidApiKeyFormat, normalizeApiKey } from "poe-oauth";

isValidApiKeyFormat("sk-poe-abc123..."); // true
normalizeApiKey("  sk-poe-abc123...  "); // trimmed + validated
```
