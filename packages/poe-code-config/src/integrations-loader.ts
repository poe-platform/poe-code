import { bootstrap, type Integrations } from "@poe-code/braintrust";

import type { ConfigDocument as PoeCodeConfig } from "./types.js";

export type { Integrations };

export async function loadIntegrations(
  config: PoeCodeConfig
): Promise<Integrations | null> {
  if (!config.integrations?.braintrust?.enabled) return null;
  return bootstrap(config.integrations.braintrust);
}
