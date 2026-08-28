import {createGitCommand,createGitCommands,gitCommands} from "/Users/kjopek/Workspace/safe-bash/tests/commands/git-independent-20260828/m1a-continuation-v11/RUN-01/work/physically moved app/node_modules/virtual-bash/dist/commands/git/index.js";
import type {CommandDefinition,VirtualShellPlugin} from "/Users/kjopek/Workspace/safe-bash/tests/commands/git-independent-20260828/m1a-continuation-v11/RUN-01/work/physically moved app/node_modules/virtual-bash/dist/contracts/index.js";
const command:CommandDefinition=createGitCommand({replace:false,discoveryBoundary:"/repo"});
const family:readonly CommandDefinition[]=createGitCommands();
const plugin:VirtualShellPlugin=gitCommands();void [command,family,plugin];
