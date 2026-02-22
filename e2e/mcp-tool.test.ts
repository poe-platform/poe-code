import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

interface AgentMcpSpawnTest {
  name: string;
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
    expectSpawnSuccess: false,
  },
  {
    name: 'kimi',
    expectSpawnSuccess: true,
  },
];

function shellQuote(value: string): string {
  let quoted = "'";
  for (const char of value) {
    if (char === "'") {
      quoted += `'"'"'`;
      continue;
    }
    quoted += char;
  }
  quoted += "'";
  return quoted;
}

function buildSpawnMcpConfigJson(): string {
  return JSON.stringify({
    'tiny-stdio-mcp-test-server': {
      command: 'tiny-stdio-mcp-test-server',
      args: ['serve', 'word-of-the-day'],
    },
  });
}

describe.each(agents)('spawn --mcp-config: $name', ({ name, expectSpawnSuccess, spawnArgs }) => {
  const container = useContainer({ workspaceDir: repoRoot, testName: `spawn-mcp-${name}` });

  it('uses tiny MCP server and validates output', async () => {
    const configResult = await container.exec(`poe-code configure ${name} --yes`);
    expect(configResult).toHaveExitCode(0);

    const prompt = 'Call the word_of_the_day tool and return only the exact tool output.';
    const mcpConfigArg = shellQuote(buildSpawnMcpConfigJson());
    const extraArgs = spawnArgs
      ? ` -- ${spawnArgs.map((arg) => shellQuote(arg)).join(' ')}`
      : '';
    const command = `poe-code spawn --mcp-config ${mcpConfigArg} ${name} ${shellQuote(prompt)}${extraArgs}`;
    const spawnResult = await container.exec(command);

    if (!expectSpawnSuccess) {
      expect(spawnResult).toFail();
      expect(spawnResult).toHaveStderr('does not support MCP servers at spawn time');
      expect(spawnResult).toHaveStderr('claude-code, codex, kimi');
      return;
    }

    expect(spawnResult).toHaveExitCode(0);
    const output = `${spawnResult.stdout}\n${spawnResult.stderr}`.toLowerCase();
    expect(output).toContain('bumfuzzle');
  });
});
