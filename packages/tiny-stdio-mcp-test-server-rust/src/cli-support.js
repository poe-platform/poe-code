import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-stdio-mcp-test-server-rust.node');
export const SERVE_TOOL_NAMES=Object.freeze(native.fixtureTools().map(tool=>tool.serveName));
export function isServeToolName(value){return SERVE_TOOL_NAMES.includes(value);}
export const getNextSpawnCount=native.fixtureNextSpawnCount;
