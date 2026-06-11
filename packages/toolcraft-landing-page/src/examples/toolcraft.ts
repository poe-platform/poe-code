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

const QUICKSTART = `npm install toolcraft toolcraft-schema

# src/bin.ts — one root, every surface
import { runCLI } from "toolcraft/cli";
import { root } from "./root.js";

await runCLI(root, { version: "0.1.0" });`;

export const TOOLCRAFT_LANDING_PAGE: LandingPageView = {
  title: "toolcraft — tools for agents and humans",
  description:
    "Define a command once. Get a typed CLI, an MCP server, and a typed SDK from the same source.",
  name: "toolcraft",
  headline: "Define a command once. Run it everywhere.",
  tagline:
    "Create tools for both agents and humans. One definition becomes a typed CLI, an MCP server, and a typed SDK — same handler, no duplication.",
  accent: "#a200ff",
  install: "npm install toolcraft toolcraft-schema",
  version: "0.0.4",
  repoUrl: "https://github.com/poe-platform/poe-code",
  surfaceCount: 4,
  useCaseCount: 6,
  surfaces: [
    {
      name: "CLI",
      description: "argv parsing, --help, kebab/snake flags, and exit codes via runCLI.",
      example: "mytool greet --name world"
    },
    {
      name: "MCP",
      description: "A JSON-RPC stdio server with auto-generated tool schemas via runMCP.",
      example: "mytool mcp   # stdio server"
    },
    {
      name: "SDK",
      description: "Typed, in-process function calls via createSDK.",
      example: 'await sdk.greet({ name: "world" })'
    },
    {
      name: "OpenAPI",
      description: "Generate toolcraft commands straight from an OpenAPI document.",
      example: "toolcraft-openapi-generate --input openapi.json"
    }
  ],
  useCases: [
    {
      title: "Consolidate a folder of scripts",
      description:
        "Wrap each one-off script as a defineCommand — keep its imports, fetch calls, and file I/O. The tree grows file by file; retire the old entrypoints when you're ready."
    },
    {
      title: "Give agents safe tools",
      description:
        "Add MCP scope to the commands that are safe for agents. They surface as tools in Claude Desktop and other MCP clients, with destructive ones gated behind approval."
    },
    {
      title: "Adopt an existing MCP server",
      description:
        "Proxy an upstream server with defineGroup({ mcp }): pull in a subset of its tools, rename them to dotted paths, and expose them under your own tree — no rewrite."
    },
    {
      title: "Generate a client from OpenAPI",
      description:
        "Point toolcraft-openapi-generate at an OpenAPI document to scaffold commands from the contract, with a --check drift guard for CI."
    },
    {
      title: "Call your tools from code",
      description:
        "Other packages and tests reach the same operations in-process through createSDK — typed, no subprocessing, no second adapter to maintain."
    },
    {
      title: "Approve risky operations",
      description:
        "Gate prod deploys and destructive actions on a human approval — sync or async, routed through Slack, osascript, or your own provider — from any surface."
    }
  ],
  example: {
    source: GREET_SOURCE,
    surfaces: [
      { name: "CLI", code: "mytool greet --name world --loud" },
      { name: "MCP", code: 'greet({ name: "world", loud: true })' },
      { name: "SDK", code: 'await sdk.greet({ name: "world", loud: true })' }
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
      name: "Human-in-loop approvals",
      description:
        "Gate destructive commands on sync or async approval, routed through Slack, osascript, or your own provider."
    },
    {
      name: "MCP proxy",
      description:
        "Adopt an existing MCP server: pull a subset of its tools into your tree and rename them to dotted paths."
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
    }
  ],
  quickstart: QUICKSTART,
  includeJs: true
};
