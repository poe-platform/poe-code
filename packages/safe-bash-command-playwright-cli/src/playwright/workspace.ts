import type { PlaywrightInvocation } from './invocation.js';
import { playwrightSkillFiles } from './workspace-assets.js';
import { PlaywrightResourceLimitError } from './resource-limit.js';

export async function initializePlaywrightWorkspace(options: Readonly<Record<string, string | boolean | readonly string[]>>, invocation: PlaywrightInvocation, maxBytes: number): Promise<void> {
  if (options.global && !options.skills) throw new Error('--global requires --skills');
  const workspace = invocation.workspace;
  if (!workspace || !invocation.writeArtifact || !invocation.readArtifact) throw new Error('Workspace filesystem unavailable');
  if (options.global && !workspace.home) throw new Error('Workspace home directory unavailable');
  const encoder = new TextEncoder();
  let writtenBytes = 0;
  const write = async (path: string, text: string) => {
    invocation.signal.throwIfAborted();
    const bytes = encoder.encode(text);
    writtenBytes += bytes.byteLength;
    if (writtenBytes > maxBytes) throw new PlaywrightResourceLimitError('Workspace install byte limit exceeded');
    await invocation.writeArtifact!(bytes, path);
  };
  if (!options.global) {
    await workspace.mkdir('.playwright');
    await invocation.write(`✅ Workspace initialized at \`${workspace.cwd}\`.\n`);
    if (await workspace.exists('.git')) {
      let existing = '';
      try { existing = new TextDecoder().decode(await invocation.readArtifact('.gitignore', maxBytes)); }
      catch (error) { if (!error || typeof error !== 'object' || Reflect.get(error, 'code') !== 'ENOENT') throw error; }
      if (!existing.split('\n').some(line => line.trim() === '.playwright-cli/')) {
        await write('.gitignore', existing + (existing && !existing.endsWith('\n') ? '\n' : '') + '# Playwright CLI output (may contain credentials)\n.playwright-cli/\n');
        await invocation.write('✅ Added `.playwright-cli/` to `.gitignore`.\n');
      }
    }
  }
  if (options.skills) {
    const target = options.skills === 'agents' ? 'agents' : 'claude';
    const directory = `${options.global ? workspace.home!.replace(/\/$/, '') + '/' : ''}.${target}/skills/playwright-cli`;
    for (const [name, text] of Object.entries(playwrightSkillFiles)) await write(`${directory}/${name}`, text);
    await invocation.write(`✅ Skill installed to \`${directory}\`.\n`);
  }
  invocation.signal.throwIfAborted();
}
