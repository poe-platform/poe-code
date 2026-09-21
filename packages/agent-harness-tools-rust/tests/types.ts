import * as own from "../dist/index.js";
import * as original from "@poe-code/agent-harness-tools";
const forward:Pick<typeof original,keyof typeof own>=own;
const reverse:Omit<typeof own,"resolveLoopAgent">=original;
void [forward,reverse];
