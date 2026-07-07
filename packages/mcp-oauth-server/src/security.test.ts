import { describe, expect, it } from "vitest";

import {
  createAuthorizationInteractionSecurity,
  verifyAuthorizationInteractionCsrf
} from "./index.js";

describe("authorization interaction security helpers", () => {
  it("uses host-bound HttpOnly secure cookie defaults", () => {
    const security = createAuthorizationInteractionSecurity({
      randomToken: (() => {
        const values = ["csrf-secret", "state-value", "nonce-value"];
        return () => values.shift()!;
      })()
    });

    expect(security.csrfToken).toBe("csrf-secret");
    expect(security.state).toBe("state-value");
    expect(security.nonce).toBe("nonce-value");
    expect(security.setCookie).toBe(
      "__Host-mcp_oauth_csrf=csrf-secret; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax"
    );
  });

  it("accepts only the exact CSRF cookie and submitted token", () => {
    expect(
      verifyAuthorizationInteractionCsrf({
        cookieHeader: "theme=dark; __Host-mcp_oauth_csrf=csrf-secret",
        submittedToken: "csrf-secret"
      })
    ).toBe(true);
    expect(
      verifyAuthorizationInteractionCsrf({
        cookieHeader: "__Host-mcp_oauth_csrf=csrf-secret",
        submittedToken: "tampered"
      })
    ).toBe(false);
    expect(
      verifyAuthorizationInteractionCsrf({
        cookieHeader: "__Host-mcp_oauth_csrf=csrf-secret-extra",
        submittedToken: "csrf-secret"
      })
    ).toBe(false);
  });
});
