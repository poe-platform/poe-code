# poe-oauth

OAuth client and auth verification for the Poe API.

## OAuth

PKCE-based OAuth flow with local callback server:

```ts
import { createOAuthClient } from "poe-oauth";

const client = createOAuthClient({
  clientId: "your-client-id",
  openBrowser: async (url) => { /* open url in browser */ },
  readLine: async () => { /* read manual paste from terminal */ }
});
// Defaults to https://poe.com/oauth/authorize and https://api.poe.com/token
// Override with authorizationEndpoint / tokenEndpoint if needed
// Customize the browser landing page with landingPage: { title, body }

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
