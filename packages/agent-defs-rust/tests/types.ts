import * as native from '../dist/index.js';import * as reference from '@poe-code/agent-defs';
const original:typeof reference=native;const compatibleNative:typeof native=reference;
const args:string[]|undefined=native.codexAgent.otelCapture?.args?.('http://127.0.0.1:4318',true);
// @ts-expect-error capabilities are a closed union
native.listAgentsWithCapability('unknown');
// @ts-expect-error telemetry content is boolean
native.codexAgent.otelCapture?.args?.('http://host','false');
void [original,compatibleNative,args];
