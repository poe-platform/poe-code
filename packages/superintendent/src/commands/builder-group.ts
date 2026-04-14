import { defineGroup } from "@poe-code/cmdkit";

export const builderGroup = defineGroup({
  name: "builder",
  description: "Builder commands.",
  scope: ["cli", "mcp", "sdk"],
  children: []
});
