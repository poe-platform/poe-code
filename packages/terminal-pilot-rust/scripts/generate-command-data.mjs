// Development-only declaration seed. Rust owns admission, dispatch plans and output policies.
import {writeFileSync} from 'node:fs';
import {createTerminalPilotGroup} from '../../terminal-pilot/dist/commands/index.js';
import {createTerminalPilotMCPGroup} from '../../terminal-pilot-mcp/dist/index.js';
const base=createTerminalPilotGroup().children.filter(command=>command.scope.includes('mcp'));
const group=createTerminalPilotMCPGroup();
const commands=base.map(command=>({...command,mcpResultSchema:group.children.find(candidate=>candidate.name===command.name).result}));
writeFileSync(new URL('../src/commands.json',import.meta.url),JSON.stringify({commands},null,2)+'\n');
