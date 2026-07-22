import type { HostedOAuthStorage } from "./http-hosted-oauth.js";
import { hostedOAuth } from "./http-hosted-oauth.js";

interface Services {
  skylight: { credential(): Promise<string> };
}

declare const ignoredStorage: HostedOAuthStorage<string>;

const ignoredHostedOAuth = hostedOAuth<string, Services>({
  publicUrl: "https://calendar.example/mcp",
  storage: ignoredStorage,
  provider: {
    name: "Skylight",
    login: { fields: ["email", "password"] },
    async connect({ email, password, signal }) {
      const ignoredEmail: string = email;
      const ignoredPassword: string = password;
      const ignoredSignal: AbortSignal = signal;
      return {
        accountId: ignoredEmail,
        credential: `${ignoredPassword}:${ignoredSignal.aborted}`
      };
    },
    services({ credentials }) {
      return { skylight: { credential: () => credentials.read() } };
    }
  }
});

void ignoredHostedOAuth;

const ignoredRedirectHostedOAuth = hostedOAuth<string, Services>({
  publicUrl: "https://calendar.example/mcp",
  storage: ignoredStorage,
  provider: {
    name: "Skylight",
    services: ({ credentials }) => ({
      skylight: { credential: () => credentials.read() }
    })
  },
  advanced: {
    interaction: {
      paths: ["/oauth/skylight/callback"],
      start: () => Response.redirect("https://login.example/authorize"),
      handle: async ({ complete }) =>
        complete({
          transactionId: "transaction-id",
          accountId: "account-id",
          credential: "provider-session"
        })
    }
  }
});

void ignoredRedirectHostedOAuth;
