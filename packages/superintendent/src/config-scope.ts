import { defineScope } from "@poe-code/poe-code-config/core";

export const superintendentConfigScope = defineScope("superintendent", {
  tui: {
    type: "boolean",
    default: false,
    env: "POE_SUPERINTENDENT_TUI",
    doc: "Enable the Superintendent dashboard by default for terminal TTY runs"
  }
});
