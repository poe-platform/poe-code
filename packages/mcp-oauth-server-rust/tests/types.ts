import { createInMemoryAuthorizationServerStore, createAuthorizationInteractionSecurity, verifyAuthorizationInteractionCsrf } from "../dist/index.js";
import type { AuthorizationServerStore as ReferenceStore, AuthorizationInteractionSecurity as ReferenceSecurity } from "../../mcp-oauth-server/dist/index.js";
const store: ReferenceStore = createInMemoryAuthorizationServerStore();
const security: ReferenceSecurity = createAuthorizationInteractionSecurity({ randomToken: () => "opaque", maxAgeSeconds: 600 });
const verified: boolean = verifyAuthorizationInteractionCsrf({cookieHeader:security.setCookie,submittedToken:security.csrfToken});
void store;void verified;
