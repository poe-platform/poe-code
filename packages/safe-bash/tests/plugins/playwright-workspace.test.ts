import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializePlaywrightWorkspace } from '../../src/playwright/workspace.js';
import type { PlaywrightInvocation } from '../../src/playwright/invocation.js';

test('workspace install preserves gitignore and copies canonical skills only into VFS', async () => {
  const files = new Map([['.gitignore', 'existing']]);
  const directories: string[] = [];
  let output = '';
  const invocation: PlaywrightInvocation = { args: [], env: {}, signal: new AbortController().signal,
    workspace: { cwd: '/work', home: '/home/agent', async mkdir(path) { directories.push(path); }, async exists(path) { return path === '.git'; } },
    async write(text) { output += text; },
    async readArtifact(path) { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return new TextEncoder().encode(files.get(path)); },
    async writeArtifact(bytes, path) { files.set(path!, new TextDecoder().decode(bytes)); },
  };
  await initializePlaywrightWorkspace({ skills: 'agents' }, invocation, 1_048_576);
  assert.deepEqual(directories, ['.playwright']);
  assert.equal(files.get('.gitignore'), 'existing\n# Playwright CLI output (may contain credentials)\n.playwright-cli/\n');
  assert.match(files.get('.agents/skills/playwright-cli/SKILL.md')!, /playwright-cli/);
  assert.ok(files.has('.agents/skills/playwright-cli/references/storage-state.md'));
  assert.match(output, /Workspace initialized at `\/work`/);
  await initializePlaywrightWorkspace({}, invocation, 1_048_576);
  assert.equal(files.get('.gitignore')?.split('.playwright-cli/').length, 2);
  directories.length = 0;
  await initializePlaywrightWorkspace({ skills: true, global: true }, invocation, 1_048_576);
  assert.deepEqual(directories, []);
  assert.ok(files.has('/home/agent/.claude/skills/playwright-cli/SKILL.md'));
  await assert.rejects(initializePlaywrightWorkspace({ global: true }, invocation, 1_048_576), /requires --skills/);
});
