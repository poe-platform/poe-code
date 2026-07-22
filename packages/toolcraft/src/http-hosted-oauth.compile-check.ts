import type { HostedOAuthStorage } from "./http-hosted-oauth.js";
import { hostedOAuth } from "./http-hosted-oauth.js";

interface Services {
  skylight: { credential(): Promise<string> };
}

declare const ignoredStorage: HostedOAuthStorage<string>;
const ignoredRevocationObserver: NonNullable<
  HostedOAuthStorage<string>["onGrantRevoked"]
> = async (grant) => {
  const ignoredSubject: string = grant.subject;
  void ignoredSubject;
};
void ignoredRevocationObserver;

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
    services({ credentials, identity }) {
      const ignoredSubject: string = identity.subject;
      const ignoredClientId: string = identity.clientId;
      const ignoredScopes: readonly string[] = identity.scopes;
      const ignoredResource: string = identity.resource;
      const ignoredIssuer: string = identity.issuer;
      void ignoredSubject;
      void ignoredClientId;
      void ignoredScopes;
      void ignoredResource;
      void ignoredIssuer;
      return { skylight: { credential: () => credentials.read() } };
    }
  }
});

void ignoredHostedOAuth;
void ignoredHostedOAuth.assertProductionReady();

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
