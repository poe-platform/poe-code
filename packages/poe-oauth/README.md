# poe-oauth

OAuth client and auth verification for the Poe API.

## OAuth

PKCE-based OAuth flow with local callback server:

```ts
import { createOAuthClient } from "poe-oauth";

const client = createOAuthClient({
  clientId: "your-client-id",
  openBrowser: async (url) => {
    /* open url in browser */
  },
  readLine: async () => {
    /* read manual paste from terminal */
  }
});
// Defaults to https://poe.com/oauth/authorize and https://api.poe.com/token
// Override with authorizationEndpoint / tokenEndpoint if needed

const authorization = await client.authorize();
// authorization.authorizationUrl — URL to open in browser
const result = await authorization.waitForResult();
// result.apiKey, result.expiresIn
```

### Landing page

Customize the browser page shown after successful authorization:

```ts
const client = createOAuthClient({
  clientId: "your-client-id",
  landingPage: {
    title: "All set!",
    body: "You can close this tab and return to your IDE."
  }
});
```

Defaults to "Connected to Poe" / "You can close this tab and return to your terminal." when omitted.

## Configuration Options

- `clientId`: Poe OAuth client id.
- `authorizationEndpoint`: optional authorization endpoint override.
- `tokenEndpoint`: optional token endpoint override.
- `openBrowser`: callback used to open the authorization URL.
- `readLine`: callback used for manual code-paste fallback.
- `landingPage`: success page copy for the local callback server.

## Environment Variables

This package does not read public environment variables.

## Check auth

Verify an API key and fetch the associated identity:

```ts
import { checkAuth } from "poe-oauth";

const identity = await checkAuth({ apiKey: "sk-poe-..." });
// { email: "user@example.com", balance: 1500 } | null
```
