import assert from "node:assert/strict";
import { test } from "node:test";
import { availablePlugins } from "./plugin-catalog.js";
import { renderOpOutput } from "./cli.js";

const nativeHuman = "EXECUTABLE         NAME                  REQUIRED FIELDS\nakamai             Akamai                Client Secret, Host, Access Token, Client Token\nclaude             Anthropic             API Key\nargocd             Argo CD               Auth Token\naws                AWS                   Access Key ID, Secret Access Key\ncdk                AWS                   Access Key ID, Secret Access Key\nsam                AWS                   Access Key ID, Secret Access Key\neksctl             AWS                   Access Key ID, Secret Access Key\nawslogs            AWS                   Access Key ID, Secret Access Key\naxiom              Axiom                 Token, Organization\nbinance-cli        Binance               API Key, API Secret\ncachix             Cachix                Token\ncargo              Cargo                 Token\ncircleci           CircleCI              Token\ncivo               Civo                  API Key\ncline              Cline                 API Key\nwrangler           Cloudflare Workers    Token\ncrash              CrateDB               Host, Username, Password\ncrowdin            Crowdin               Token\nagent              Cursor                API Key\ndatabricks         Databricks            Host, Token\ndog                Datadog               API Key, App Key\ndescope            Descope               Project ID, Management Key\ndoctl              DigitalOcean          Token\nexercism           Exercism              URL, API Key, Directory\nexpo               Expo                  Token\neas                Expo                  Token\nfastly             Fastly                Token\nflyctl             Fly.io                Token\nfly                Fly.io                Token\nfossa              FOSSA                 API Key\ntea                Gitea                 Token, Host Address, User\ngh                 GitHub                Token\ncopilot            GitHub Copilot        Token\nglab               GitLab                Token\ngemini             Google Gemini CLI     API Key\nvault              HashiCorp Vault       Token\nheroku             Heroku                API Key\nhcloud             Hetzner Cloud         Token\nbrew               Homebrew              Token\nhuggingface-cli    Hugging Face          User Access Token\ninflux             InfluxDB              Host, Organization, Access Token\njunie              JetBrains Junie       API Key\nkaggle             Kaggle                Token, Username\nkiro-cli           Kiro                  API Key\nlacework           Lacework              Account, API Key ID, API Secret\nforge              Laravel Forge         Token\nvapor              Laravel Vapor         Token\nlinode-cli         Linode                Token\nlocalstack         LocalStack            API Key\natlas              MongoDB Atlas         Public Key, Private Key\nmysql              MySQL                 Password\nngrok              ngrok                 Authtoken\nohdear             Oh Dear               Token\nokta               Okta                  Token, Org URL\nopenai             OpenAI                API Key\noaieval            OpenAI                API Key\noaievalset         OpenAI                API Key\ncodex              OpenAI                API Key\nopencode           OpenCode              API Key\ntofu               OpenTofu              Depends on configured credentials\npd                 Pipedream             API Key\npsql               PostgreSQL            Host, User, Password\npg_dump            PostgreSQL            Host, User, Password\npg_restore         PostgreSQL            Host, User, Password\npgcli              PostgreSQL            Host, User, Password\npulumi             Pulumi                Token\ntwine              PyPI                  Token\nflit               PyPI                  Token\nhatch              PyPI                  Token\nrdme               ReadMe                API Key\nredis-cli          Redis                 Password\n-                  rediscloud            Account Key, User Key\nscw                Scaleway              Access Key ID, Secret Access Key\nsentry-cli         Sentry                Token\nsnowsql            Snowflake             Account, Username, Password\nsnyk               Snyk                  Token\nsrc                Sourcegraph           Token\nstripe             Stripe                Key\ntodoist            Todoist               Token\ntd                 Treasure Data         API Key\ntugboat            Tugboat               Token\ntwilio             Twilio                Account SID, API Key, API Secret\nupctl              UpCloud               Username, Password\nupstash            Upstash               API Key, Email\nvercel             Vercel                Token\nvsql               Vertica               Username, Password, Database\nvultr-cli          Vultr                 API Key\nysqlsh             YugabyteDB            Host, Username, Password\nzapier             Zapier                Key\nzcli               Zendesk               Subdomain, Email, Token\n";

function render(value: unknown, format = "human-readable"): string {
  return new TextDecoder().decode(renderOpOutput(value, { resource: "plugin", action: "list", args: [], flags: { format } }));
}

test("plugin list human output matches every row and column of the pinned native no-auth capture", () => {
  assert.equal(render(availablePlugins([])), nativeHuman);
});

test("plugin list JSON retains its exact availability projection without display-only fields", () => {
  const plugins = availablePlugins([]);
  const before = structuredClone(plugins);
  render(plugins);
  assert.deepEqual(plugins, before);
  assert.equal(render(plugins, "json"), JSON.stringify(before, null, 2) + "\n");
  for (const plugin of plugins) {
    assert.deepEqual(Object.keys(plugin), plugin.plugin_name === "rediscloud" ? ["source", "plugin_name"] : ["source", "name", "executable", "plugin_name"]);
  }
});

test("custom plugin display does not infer required fields from a matching registry executable", () => {
  assert.equal(render([{ source: "custom", executable: "aws", plugin_name: "AWS" }]),
    "EXECUTABLE    NAME    REQUIRED FIELDS\naws           AWS     -\n");
});

test("configured plugin display uses its supplied identity without guessing credential fields", () => {
  assert.equal(render([{ id: "custom", name: "Custom" }]),
    "EXECUTABLE    NAME      REQUIRED FIELDS\ncustom        Custom    -\n");
  assert.equal(render([]), "");
});
