import * as native from "../dist/index.js";
import * as reference from "@poe-code/agent-hook-config";
type Subset=Pick<typeof reference,keyof typeof native>;
const original:Subset=native;const compatibleNative:typeof native=reference;
void [original,compatibleNative];
