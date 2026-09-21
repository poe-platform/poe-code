import * as own from "../dist/index.js";
import * as original from "@poe-code/poe-code-config/core";
const forward:Pick<typeof original,keyof typeof own>=own;
const reverse:typeof own=original;
void [forward,reverse];
