import type { ConfigDocument } from "@poe-code/poe-code-config/core";

import { bootstrap, type Integrations } from "./index.js";

export async function loadIntegrations(
  config: ConfigDocument,
): Promise<Integrations | null> {
  if (config.integrations?.braintrust?.enabled !== true) {
    return null;
  }
  return bootstrap(config.integrations.braintrust);
}
