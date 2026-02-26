import { describe, it, expect } from 'vitest';
import { useContainer, shellQuote } from '@poe-code/e2e-docker-test-runner';

const mcpConfig = shellQuote(JSON.stringify({
  'test-server': {
    command: 'tiny-stdio-mcp-test-server',
    args: ['serve', 'word-of-the-day'],
  },
}));

describe('poe-agent spawn --mcp-config', () => {
  const container = useContainer({ testName: 'poe-agent-mcp' });

  it('runs poe-agent with MCP tools and captures tool exchange', async () => {
    const configureResult = await container.exec('poe-code configure poe-agent --yes');
    expect(configureResult).toHaveExitCode(0);

    const prompt = 'What is the word of the day?';
    const command = `poe-code spawn --mcp-config ${mcpConfig} poe-agent ${shellQuote(prompt)}`;
    const spawnResult = await container.exec(command);

    expect(spawnResult).toHaveExitCode(0);
    expect(spawnResult.stdout.toLowerCase()).toContain('bumfuzzle');
    expect(spawnResult.stderr.toLowerCase()).not.toContain('proxy');

    const requests = await container.requests();
    expect(requests.length).toBe(2);

    const summary = requests.summary();
    process.stderr.write(`Captured requests summary:\n${summary}\n`);
    const summaryRequestLines = summary.split('\n').filter((line) => line.startsWith('  ['));
    expect(summaryRequestLines).toEqual([
      '  [0] POST /v1/chat/completions (200)',
      '  [1] POST /v1/chat/completions (200)',
    ]);

    const expectedToolNames = [
      'read_file',
      'edit_file',
      'list_files',
      'run_command',
      'search_web',
      'mcp__test-server__word_of_the_day',
    ];
    const toolNames = requests.toolNamesAt(0);
    expect(toolNames).toHaveLength(expectedToolNames.length);
    expect(toolNames).toEqual(expect.arrayContaining(expectedToolNames));

    const requestsWithToolCalls = requests.withToolCalls();
    expect(requestsWithToolCalls.length).toBe(1);

    const firstRequest = requests.at(0);
    expect(requestsWithToolCalls.at(0)).toBe(firstRequest);
    expect(firstRequest).toHaveToolInRequest('mcp__test-server__word_of_the_day');
    expect(firstRequest).toHaveToolInRequest('read_file');

    const secondRequest = requests.at(1);
    const wordOfDayToolResult = requests.toolResultAt(1, 'mcp__test-server__word_of_the_day');
    expect(wordOfDayToolResult).toEqual(
      expect.objectContaining({
        content: expect.stringContaining('Bumfuzzle'),
      }),
    );
    expect(secondRequest).toHaveToolResult('mcp__test-server__word_of_the_day', 'Bumfuzzle');

    const poeBaseUrlResult = await container.exec('printenv POE_BASE_URL');
    expect(poeBaseUrlResult).toHaveExitCode(0);
    expect(poeBaseUrlResult.stdout).toBe('http://localhost:3456');
    expect(poeBaseUrlResult.stderr).toBe('');
  });
});
