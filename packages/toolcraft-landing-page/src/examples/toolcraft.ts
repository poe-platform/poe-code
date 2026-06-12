import type { LandingPageView } from "../render.js";

const GREET_SOURCE = `import { defineCommand, S } from "toolcraft";

export const greet = defineCommand({
  name: "greet",
  description: "Say hello",
  params: S.Object({
    name: S.String({ description: "Who to greet" }),
    loud: S.Optional(S.Boolean({ default: false }))
  }),
  handler: async ({ params }) => ({
    message: params.loud
      ? \`Hello, \${params.name}!\`.toUpperCase()
      : \`Hello, \${params.name}\`
  })
});`;

const QUICKSTART = `# 1. Install
npm install toolcraft

# 2. src/bin.ts — point the binary at your root group
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";

await runCLI(root, { version: "0.1.0" });

# 3. Run it — flags, --help, and exit codes come from the schema
mytool greet --name world`;

export const TOOLCRAFT_LANDING_PAGE: LandingPageView = {
  title: "toolcraft — tools for agents and humans",
  description:
    "Define a command once. Get a typed CLI, an MCP server, and a typed SDK from the same source.",
  name: "toolcraft",
  headline: "Define a command once.",
  headlineHighlight: "Run it everywhere.",
  tagline:
    "Create tools for both agents and humans. One definition becomes a typed CLI, an MCP server, and a typed SDK — same handler, no duplication.",
  accent: "#2563eb",
  install: "npm install toolcraft",
  repoUrl: "https://github.com/poe-platform/poe-code",
  docsUrl: "https://github.com/poe-platform/poe-code/tree/main/packages/toolcraft",
  useCases: [
    {
      title: "Consolidate a folder of scripts",
      description:
        "Wrap each one-off script as a defineCommand — keep its imports, fetch calls, and file I/O. The tree grows file by file; retire the old entrypoints when you're ready.",
      example: `// each script becomes one command file
export const root = defineGroup({
  name: "ops",
  children: [backup, migrate, cleanup]
});`
    },
    {
      title: "Give agents safe tools",
      description:
        "Add MCP scope to the commands that are safe for agents. They surface as tools in Claude Desktop and other MCP clients, with destructive ones gated behind approval.",
      example: `defineGroup({
  name: "issues",
  scope: ["cli", "mcp", "sdk"], // visible to agents
  children: [list, label, close]
});`
    },
    {
      title: "Adopt an existing MCP server",
      description:
        "Proxy an upstream server with defineGroup({ mcp }): pull in a subset of its tools, rename them to dotted paths, and expose them under your own tree — no rewrite.",
      example: `defineGroup({
  name: "github",
  mcp: { transport: "stdio", command: "github-mcp-server" },
  tools: ["create_issue", "list_issues"],
  rename: { create_issue: "issues.create" },
  children: []
});`
    },
    {
      title: "Generate a client from OpenAPI",
      description:
        "Point toolcraft-openapi-generate at an OpenAPI document to scaffold commands from the contract, with a --check drift guard for CI.",
      example: `toolcraft-openapi-generate --input openapi.json
toolcraft-openapi-generate --check  # CI drift guard`
    },
    {
      title: "Call your tools from code",
      description:
        "Other packages and tests reach the same operations in-process through createSDK — typed, no subprocessing, no second adapter to maintain.",
      example: `const sdk = createSDK(root);
const { message } = await sdk.greet({ name: "world" });`
    },
    {
      title: "Approve risky operations",
      description:
        "Gate prod deploys and destructive actions on a human approval — sync or async, routed through Slack, osascript, or your own provider — from any surface.",
      example: `defineCommand({
  name: "deploy",
  humanInLoop: {
    mode: "async",
    message: ({ params }) => \`Deploy \${params.target}?\`
  },
  handler: async ({ params }) => release(params.target)
});`
    }
  ],
  example: {
    source: GREET_SOURCE,
    surfaces: [
      { name: "CLI · runCLI", code: "$ mytool greet --name world --loud" },
      { name: "MCP tool · runMCP", code: 'greet({ name: "world", loud: true })' },
      { name: "SDK · createSDK", code: 'await sdk.greet({ name: "world", loud: true })' }
    ]
  },
  features: [
    {
      name: "Typed params & JSON Schema",
      description:
        "One S.Object schema drives CLI flags, MCP input schemas, and SDK types — with Static<> inference."
    },
    {
      name: "Declared secrets",
      description:
        "Name env-backed secrets per command or group; missing required ones fail with a UserError before the handler runs."
    },
    {
      name: "Preconditions",
      description:
        "Declare requires checks — auth, API versions, environment — that run before any handler, on every surface."
    },
    {
      name: "Dependency injection",
      description:
        "Inject DB clients, loggers, or fetch wrappers once at the boundary; every handler receives them in context."
    },
    {
      name: "Output renderers",
      description:
        "Return raw values, then add per-format rich, markdown, and json renderers for richer CLI output."
    },
    {
      name: "Group inheritance",
      description:
        "Set secrets, scope, preconditions, or approvals on a group once — every descendant command inherits them."
    }
  ],
  quickstart: QUICKSTART,
  includeJs: true
};
