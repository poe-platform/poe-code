import { S, defineGroup } from "toolcraft";
import { bearerTokenAuth, defineApiCommand, defineClient } from "./index.js";

export const generatedWidgetListCommand = defineApiCommand({
  name: "list",
  scope: ["cli", "mcp", "sdk"] as const,
  params: S.Object({}),
  handler: async () => ({ ok: true })
});

export const widgets = defineGroup({
  name: "widgets",
  children: [generatedWidgetListCommand]
});

const clientWithGeneratedGroup = defineClient({
  name: "manual-group-client",
  baseUrl: "https://api.example.com",
  auth: bearerTokenAuth({
    serviceName: "manual-group-client",
    envVar: "MANUAL_GROUP_CLIENT_TOKEN"
  }),
  commands: [widgets]
});

const clientWithGeneratedLeaf = defineClient({
  name: "manual-leaf-client",
  baseUrl: "https://api.example.com",
  auth: bearerTokenAuth({
    serviceName: "manual-leaf-client",
    envVar: "MANUAL_LEAF_CLIENT_TOKEN"
  }),
  commands: [generatedWidgetListCommand]
});

void clientWithGeneratedGroup;
void clientWithGeneratedLeaf;
