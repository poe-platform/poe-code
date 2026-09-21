import { defineScope } from "./schema.js";

export const planConfigScope = defineScope("plan", {
  plan_directory: {
    type: "string",
    default: "docs/plans",
    env: "POE_PLAN_DIRECTORY",
    doc: "Directory where planning documents are stored"
  }
});
