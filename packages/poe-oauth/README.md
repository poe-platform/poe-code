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

### Caller-managed callback

Applications that own their HTTP callback route can compose the same authorization and exchange
primitives without starting a listener, opening a browser, or reading terminal input:

```ts
import crypto from "node:crypto";
import {
  createOAuthAuthorizationUrl,
  exchangeOAuthCode,
  generateCodeChallenge,
  generateCodeVerifier,
  validateOAuthAuthorizationCallback
} from "poe-oauth";

const clientId = "your-client-id";
const redirectUri = "https://app.example.com/oauth/callback";
const state = crypto.randomBytes(32).toString("base64url");
const codeVerifier = generateCodeVerifier();

const authorizationUrl = createOAuthAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge: generateCodeChallenge(codeVerifier)
});

// Redirect the user to authorizationUrl. In your callback route:
const code = validateOAuthAuthorizationCallback({
  callbackUrl: new URL(request.url, redirectUri),
  expectedState: state
});
const result = await exchangeOAuthCode({
  clientId,
  redirectUri,
  code,
  codeVerifier
});
// result.apiKey, result.expiresIn
```

Keep `state` and `codeVerifier` private, bind them to the initiating user session, and discard them
after one callback attempt. `validateOAuthAuthorizationCallback` rejects missing or mismatched state
before returning an authorization code.

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

The caller-managed helpers accept optional `authorizationEndpoint`, `tokenEndpoint`, and `fetch`
overrides. Redirect URIs may use hosted HTTPS callbacks or local HTTP loopback callbacks.

## Environment Variables

This package does not read public environment variables.

## Check auth

Verify an API key and fetch the associated identity:

```ts
import { checkAuth } from "poe-oauth";

const identity = await checkAuth({ apiKey: "sk-poe-..." });
// { email: "user@example.com", balance: 1500 } | null
```
