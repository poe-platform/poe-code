import { defineGroup } from "@poe-code/cmdkit";
import { builderGroup } from "./builder-group.js";
import { inspectorGroup } from "./inspector-group.js";

export const superintendentGroup = defineGroup({
  name: "superintendent",
  description: "Superintendent workflow commands.",
  scope: ["cli", "mcp", "sdk"],
  children: [builderGroup, inspectorGroup]
});
