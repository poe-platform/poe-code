import * as native from '../dist/index.js';
import * as reference from 'tiny-stdio-mcp-test-server';
import {getNextSpawnCount,isServeToolName,type ServeToolName} from '../dist/cli-support.js';
const originalFunctions:Pick<typeof reference,'caesarEncrypt'>=native;
const nativeFunctions:Pick<typeof native,'caesarEncrypt'>=reference;
const originalServer:ReturnType<typeof reference.createTestServer>=native.createTestServer();
const compatibleNative:ReturnType<typeof native.createTestServer>=reference.createTestServer();
const count:number=getNextSpawnCount('1');
const input='encrypt';if(isServeToolName(input)){const tool:ServeToolName=input;void tool;}
// @ts-expect-error shifts are numeric
native.caesarEncrypt('hello','3');
void [originalFunctions,nativeFunctions,originalServer,compatibleNative,count];
