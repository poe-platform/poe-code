import { writeFileSync } from "node:fs";
import { nativeDelivery, NativeHarnessError } from "./native-delivery.js";

for (const [name, options] of [
  ["original-25ms-events", { profile: "original-25ms" as const }],
  ["default-prefix-events", { readinessMs: 2000 }],
  ["line-buffered-prefix-events", { lineBuffered: true }],
] as const) {
  try {
    const evidence = await nativeDelivery(options);
    writeFileSync(new URL(`evidence/${name}.json`, import.meta.url), JSON.stringify({ failure: null, ...evidence }, null, 2) + "\n", { flag: "wx" });
  } catch (error) {
    if (!(error instanceof NativeHarnessError)) throw error;
    writeFileSync(new URL(`evidence/${name}.json`, import.meta.url), JSON.stringify({ failure: error.message, ...error.evidence }, null, 2) + "\n", { flag: "wx" });
  }
}
