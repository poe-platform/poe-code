import * as own from '../dist/index.js';
import * as sdk from '@poe-code/agent-mcp-config';
const compatible:typeof sdk=own;
void compatible;
const server:own.McpServerEntry={name:'example',config:{transport:'stdio',command:'node'}};
const options:own.ApplyOptions={} as sdk.ApplyOptions;
void own.configure('claude',server,options);
