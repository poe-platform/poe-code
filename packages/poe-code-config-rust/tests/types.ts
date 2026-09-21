import * as own from "../dist/index.js";
import * as original from "@poe-code/poe-code-config";
const forward:typeof original=own;
const reverse:typeof own=original;
void [forward,reverse];
