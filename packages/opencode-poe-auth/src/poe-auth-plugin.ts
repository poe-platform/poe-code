import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import open from "open";
import { createOAuthClient } from "poe-oauth";

const CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea";

type AuthHook = NonNullable<Hooks["auth"]>;
type OAuthMethod = Extract<AuthHook["methods"][number], { type: "oauth" }>;
type AuthOauthResult = Awaited<ReturnType<OAuthMethod["authorize"]>>;

function getExpiry(expiresIn: unknown): number {
  if (expiresIn === null) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn < 0) {
    throw new Error("Poe API key has invalid expiration metadata. Run `opencode providers login` again.");
  }

  return Date.now() + expiresIn * 1000;
}

function requireApiKey(value: unknown): string {
  const apiKey = typeof value === "string" ? value.trim() : "";
  if (apiKey.length === 0) {
    throw new Error("Poe API key is missing. Run `opencode providers login` again.");
  }
  return apiKey;
}

async function authorize(): Promise<AuthOauthResult> {
  const client = createOAuthClient({
    clientId: CLIENT_ID,
    landingPage: {
      title: "Connected to Poe",
      body: "You can close this tab and return to OpenCode."
    },
    openBrowser: async (url) => {
      await open(url);
    }
  });

  const authorization = await client.authorize();

  return {
    url: authorization.authorizationUrl,
    instructions: "Complete authorization in your browser. This window will close automatically.",
    method: "auto",
    callback: async () => {
      const result = await authorization.waitForResult() as unknown;
      const resultRecord = isObjectRecord(result) ? result : {};
      const apiKey = requireApiKey(getOwnEntry(resultRecord, "apiKey"));

      return {
        type: "success",
        access: apiKey,
        refresh: apiKey,
        expires: getExpiry(getOwnEntry(resultRecord, "expiresIn"))
      };
    }
  };
}

export async function PoeAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "poe",
      async loader(getAuth) {
        const auth = await getAuth();
        if (!isObjectRecord(auth)) {
          return {};
        }

        const authType = getOwnString(auth, "type");
        if (authType === "api") {
          return { apiKey: requireApiKey(getOwnEntry(auth, "key")) };
        }

        if (authType !== "oauth") {
          return {};
        }

        const expires = getOwnEntry(auth, "expires");
        if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= Date.now()) {
          throw new Error("Poe API key expired. Run `opencode providers login` again.");
        }

        return { apiKey: requireApiKey(getOwnEntry(auth, "access")) };
      },
      methods: [
        {
          label: "Login with Poe (browser)",
          type: "oauth",
          authorize
        },
        {
          label: "Manually enter API Key",
          type: "api"
        }
      ]
    }
  };
}

export default PoeAuthPlugin;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnEntry(record: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? (record as Record<string, unknown>)[key]
    : undefined;
}

function getOwnString(record: object, key: string): string | undefined {
  const value = getOwnEntry(record, key);
  return typeof value === "string" ? value : undefined;
}
