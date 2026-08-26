import { readFileSync } from "node:fs";
import { runHoldoutProbe } from "./probes.js";

const request = JSON.parse(readFileSync(0, "utf8")) as { probe: string };
await runHoldoutProbe(request.probe);
console.log(JSON.stringify({ passed: request.probe }));
