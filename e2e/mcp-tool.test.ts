import { describe, it, expect } from 'vitest';
import { useContainer } from '@poe-code/e2e-docker-test-runner';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');

// The MCP server command - using npx to run the published package
const MCP_SERVER_COMMAND = 'npx';
const MCP_SERVER_ARGS = ['tiny-stdio-mcp-test-server', 'serve', 'word-of-the-day'];

interface AgentMcpTestConfig {
  name: string;
  configPath: string;
  configKey: string;
  format: 'json' | 'toml';
  /** Extra args to pass to spawn command (e.g., tool permissions) */
  spawnArgs?: string[];
}

const agents: AgentMcpTestConfig[] = [
  {
    name: 'claude-code',
    configPath: '/home/poe/.claude.json',
    configKey: 'mcpServers',
    format: 'json',
    // Claude requires explicit tool permission for MCP tools
    spawnArgs: ['--allowedTools', 'Bash,Read,mcp__tiny-stdio-mcp-test-server__word_of_the_day'],
  },
  {
    name: 'codex',
    configPath: '/home/poe/.codex/config.toml',
    configKey: 'mcp_servers',
    format: 'toml',
  },
  {
    name: 'opencode',
    configPath: '/home/poe/.config/opencode/config.json',
    configKey: 'mcp',
    format: 'json',
  },
  {
    name: 'kimi',
    configPath: '/home/poe/.kimi/mcp.json',
    configKey: 'mcpServers',
    format: 'json',
  },
];

function buildMcpServerConfig(format: 'json' | 'toml', configKey: string): string {
  if (format === 'toml') {
    return `
[${configKey}.tiny-stdio-mcp-test-server]
command = "${MCP_SERVER_COMMAND}"
args = ["tiny-stdio-mcp-test-server", "serve", "word-of-the-day"]
`;
  }

  if (configKey === 'mcp') {
    // opencode uses a different shape: type "local" with command as array
    return JSON.stringify({
      'tiny-stdio-mcp-test-server': {
        type: 'local',
        command: [MCP_SERVER_COMMAND, ...MCP_SERVER_ARGS],
        enabled: true,
      },
    });
  }

  return JSON.stringify({
    'tiny-stdio-mcp-test-server': {
      command: MCP_SERVER_COMMAND,
      args: MCP_SERVER_ARGS,
    },
  });
}

describe.each(agents)('MCP tool integration: $name', ({ name, configPath, configKey, format, spawnArgs }) => {
  const container = useContainer({ workspaceDir: repoRoot, testName: `mcp-${name}` });

  it('uses word_of_the_day MCP tool and returns Bumfuzzle', async () => {
    // Step 1: Configure the agent
    const configResult = await container.exec(`poe-code configure ${name} --yes`);
    expect(configResult).toHaveExitCode(0);

    // Step 2: Add tiny-stdio-mcp-test-server to agent's MCP config
    if (format === 'json') {
      // Read existing config, add MCP server
      const existingConfig = await container.fileExists(configPath)
        ? JSON.parse(await container.readFile(configPath))
        : {};

      const mcpConfig = JSON.parse(buildMcpServerConfig(format, configKey));
      existingConfig[configKey] = {
        ...existingConfig[configKey],
        ...mcpConfig,
      };

      await container.writeFile(configPath, JSON.stringify(existingConfig, null, 2));
    } else {
      // For TOML, append the MCP server config
      const existingConfig = await container.fileExists(configPath)
        ? await container.readFile(configPath)
        : '';

      const mcpToml = buildMcpServerConfig(format, configKey);
      await container.writeFile(configPath, existingConfig + '\n' + mcpToml);
    }

    // Step 3: Spawn the agent with a prompt asking for word of the day
    const prompt = 'What is the word of the day? Use the word_of_the_day tool to find out. Only respond with the word and its definition.';
    // Use -- to separate poe-code options from agent-specific args
    const extraArgs = spawnArgs ? ' -- ' + spawnArgs.map(arg => `"${arg}"`).join(' ') : '';
    const spawnResult = await container.exec(`poe-code spawn ${name} "${prompt}"${extraArgs}`);

    // Step 4: Verify the response contains Bumfuzzle
    const output = spawnResult.stdout + spawnResult.stderr;
    expect(output.toLowerCase()).toContain('bumfuzzle');
  });
});
