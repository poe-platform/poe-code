import { describe, it, expect, beforeEach } from 'vitest';
import { useContainer, shellQuote, resolveBackend } from '@poe-code/e2e-test-runner';
import { resolveMcpFixtureCommand } from './mcp-fixture.js';
import { resolveE2eModel, resolveE2eModelEnvironment } from './runtime-models.js';

interface AgentMcpSpawnTest {
  name: Parameters<typeof resolveE2eModel>[0];
  expectSpawnSuccess: boolean;
  spawnArgs?: string[];
}

const agents: AgentMcpSpawnTest[] = [
  {
    name: 'claude-code',
    expectSpawnSuccess: true,
    // Claude requires explicit tool permission for MCP tools.
    spawnArgs: ['--allowedTools', 'Bash,Read,mcp__tiny-stdio-mcp-test-server__word_of_the_day'],
  },
  {
    name: 'codex',
    expectSpawnSuccess: true,
  },
  {
    name: 'opencode',
    expectSpawnSuccess: true,
  },
  {
    name: 'goose',
    expectSpawnSuccess: true,
  },
];

const mcpConfig = shellQuote(JSON.stringify({
  'tiny-stdio-mcp-test-server': resolveMcpFixtureCommand(resolveBackend()),
}));

describe.each(agents)('spawn --mcp-config: $name', ({ name, expectSpawnSuccess, spawnArgs }) => {
  const container = useContainer({ testName: `spawn-mcp-${name}` });

  beforeEach(async () => {
    const installResult = await container.exec(`poe-code install ${name}`);
    expect(installResult).toHaveExitCode(0);
  });

  it('uses tiny MCP server and validates output', async () => {
    const configResult = await container.exec(`poe-code configure ${name} --yes`);
    expect(configResult).toHaveExitCode(0);

    const model = resolveE2eModel(name);


    const prompt = 'Call the word_of_the_day tool and return only the exact tool output.';
    const extraArgs = spawnArgs
      ? ` -- ${spawnArgs.map((arg) => shellQuote(arg)).join(' ')}`
      : '';
    const modelEnv = Object.entries(resolveE2eModelEnvironment(name, model))
      .map(([key, value]) => `${key}=${shellQuote(value)}`);
    const command = [...modelEnv, `poe-code spawn --mode yolo --model ${shellQuote(model)} --mcp-config ${mcpConfig} ${name} ${shellQuote(prompt)}${extraArgs}`].join(' ');
    const spawnResult = await container.exec(command);

    if (!expectSpawnSuccess) {
      expect(spawnResult).toFail();
      expect(spawnResult).toHaveStderr('does not support MCP servers at spawn time');
      expect(spawnResult).toHaveStderr('claude-code, codex');
      return;
    }

    expect(spawnResult).toHaveExitCode(0);
    const output = `${spawnResult.stdout}\n${spawnResult.stderr}`.toLowerCase();
    expect(output).toContain('bumfuzzle');
  });
});
