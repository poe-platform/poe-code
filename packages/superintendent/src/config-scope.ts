import { defineScope } from "@poe-code/poe-code-config";

export const superintendentConfigScope = defineScope("superintendent", {
  plan_directory: {
    type: "string",
    default: "",
    env: "POE_SUPERINTENDENT_PLAN_DIRECTORY",
    doc: "Custom directory for Superintendent plan documents"
  }
});
