import { defineGroup } from "@poe-code/cmdkit";

export const inspectorGroup = defineGroup({
  name: "inspector",
  description: "Inspector commands.",
  scope: ["cli", "mcp", "sdk"],
  children: []
});
