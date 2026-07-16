import { cursorAgent } from "@poe-code/agent-defs";
import { DEFAULT_CURSOR_MODEL } from "../cli/constants.js";
import { createBinaryExistsCheck, createSpawnHealthCheck } from "../utils/command-checks.js";
import type { ServiceInstallDefinition } from "../services/service-install.js";
import { createProvider } from "./create-provider.js";

const CURSOR_INSTALL_DEFINITION: ServiceInstallDefinition = {
  id: "cursor",
  summary: "Cursor CLI",
  check: createBinaryExistsCheck(
    "cursor-agent",
    "cursor-agent-binary",
    "Cursor CLI binary must exist"
  ),
  steps: [
    {
      id: "install-cursor-cli",
      command: "sh",
      args: ["-c", "curl https://cursor.com/install -fsS | bash"],
      platforms: ["darwin", "linux"]
    }
  ],
  successMessage: "Installed Cursor CLI."
};

export const cursorService = createProvider({
  ...cursorAgent,
  supportsStdinPrompt: true,
  supportsMcpSpawn: true,
  requiresProvider: false,
  manifest: { configure: [] },
  postConfigureMessages: [
    "Cursor needs no configuration files: cursor-agent keeps its own credentials. Run `cursor-agent login` once, then pick a model per run with `poe-code spawn cursor --model <model>`."
  ],
  install: CURSOR_INSTALL_DEFINITION,
  test(context) {
    return context.runCheck(
      createSpawnHealthCheck("cursor", {
        model: context.model ?? DEFAULT_CURSOR_MODEL,
        expectedOutput: "CURSOR_OK",
        hooks: context.hooks
      })
    );
  }
});

export const provider = cursorService;
