#!/usr/bin/env tsx
/**
 * Basic layout: intro → info messages → resolved prompts → outro
 */
import { intro, outro, log, symbols } from "../src/index.js";

export function render(): void {
  intro("Configure");
  log.info("Configuring claude-code...");
  log.message("Provider\n   claude", { symbol: symbols.resolved });
  log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
  outro("Configuration complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  render();
}
