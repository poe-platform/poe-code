import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';
import { resolveMcpFixtureCommand } from '../e2e/mcp-fixture.js';

describe('MCP agent fixture command', () => {
  it.each(['env', 'sandbox'] as const)('uses the built CLI directly on the %s host', (backend) => {
    expect(resolveMcpFixtureCommand(backend)).toEqual({
      command: process.execPath,
      args: [fileURLToPath(new URL('../packages/tiny-stdio-mcp-test-server/dist/cli.js', import.meta.url)), 'serve', 'word-of-the-day'],
    });
  });

  it('preserves the installed executable inside Podman', () => {
    expect(resolveMcpFixtureCommand('podman')).toEqual({
      command: 'tiny-stdio-mcp-test-server', args: ['serve', 'word-of-the-day'],
    });
  });

  it('connects and calls the real built fixture without workspace bin links', async () => {
    const client = new Client({ name: 'offline-fixture-regression', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({ ...resolveMcpFixtureCommand('env'), stderr: 'pipe' }));
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('word_of_the_day');
      expect(await client.callTool({ name: 'word_of_the_day', arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'Bumfuzzle - to confuse or fluster someone' }],
      });
    } finally {
      await client.close();
    }
  });
});
