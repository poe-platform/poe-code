import { createXanCommand, createXanCommands, xanCommands } from './build/dist/commands/xan/index.js';
createXanCommand({ unknown: true });
createXanCommand({ limits: { unknown: 1 } });
createXanCommand({ limits: { maxWork: '1' } });
createXanCommand({ replace: undefined });
createXanCommands({ replace: 1 });
xanCommands({ limits: null });
createXanCommand().execute({});
