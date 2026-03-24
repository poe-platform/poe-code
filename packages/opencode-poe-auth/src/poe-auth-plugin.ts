import type { Hooks, PluginInput } from "@opencode-ai/plugin";
import open from "open";
import { createOAuthClient } from "poe-oauth";

const CLIENT_ID = "client_728290227fc048cc9262091a1ea197ea";

type AuthHook = NonNullable<Hooks["auth"]>;
type OAuthMethod = Extract<AuthHook["methods"][number], { type: "oauth" }>;
type AuthOauthResult = Awaited<ReturnType<OAuthMethod["authorize"]>>;

function getExpiry(expiresIn: number | null): number {
  if (expiresIn == null) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Date.now() + expiresIn * 1000;
}

async function authorize(): Promise<AuthOauthResult> {
  const client = createOAuthClient({
    clientId: CLIENT_ID,
    landingPage: {
      title: "Connected to Poe via OpenCode",
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
      const result = await authorization.waitForResult();

      return {
        type: "success",
        access: result.apiKey,
        refresh: result.apiKey,
        expires: getExpiry(result.expiresIn)
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

        if (auth.type === "api") {
          return { apiKey: auth.key };
        }

        if (auth.type !== "oauth") {
          return {};
        }

        if (auth.expires < Date.now()) {
          throw new Error("Poe API key expired. Run `opencode providers login` again.");
        }

        return { apiKey: auth.access };
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
