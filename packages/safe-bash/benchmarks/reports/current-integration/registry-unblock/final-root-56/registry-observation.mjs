import { agentCommands, createAgentCommands, createMemoryFileSystem, Shell } from '../src/index.ts';

const definitions = createAgentCommands().map(command => command.name).sort();
const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
try {
  const initialized = await shell.exec(':');
  const installed = shell.commands.list().map(command => command.name).sort();
  console.log(JSON.stringify({ kind: 'observation-not-full-registry-pass-oracle', definitions, installed,
    definitionCount: definitions.length, installedCount: installed.length, initialized }));
  process.exitCode = initialized.exitCode;
} finally {
  await shell.dispose();
}
