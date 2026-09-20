import * as native from '../dist/index.js';import * as sdk from '@poe-code/agent-skill-config';
type Subset=Pick<typeof sdk,keyof typeof native>;const original:Subset=native;const compatibleNative:typeof native=sdk;void[original,compatibleNative];
