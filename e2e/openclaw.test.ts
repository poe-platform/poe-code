import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createContainer } from '@poe-code/e2e-docker-test-runner';
import type { Container } from '@poe-code/e2e-docker-test-runner';

const OPENCLAW_CONFIG = '/home/poe/.openclaw/openclaw.json';
const POE_CODE_CONFIG = '/home/poe/.poe-code/config.json';

const OPENCLAW_STUB = `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const home = process.env.HOME || '/home/poe';
const configDir = path.join(home, '.openclaw');
const configFile = path.join(configDir, 'openclaw.json');

const args = process.argv.slice(2);
const cmd = args[0];
const sub = args[1];

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile, 'utf8')); }
  catch { return {}; }
}

function writeConfig(obj) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(obj, null, 2));
}

function deepGet(obj, dotPath) {
  const keys = dotPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

function deepSet(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function deepUnset(obj, dotPath) {
  const keys = dotPath.split('.');
  let current = obj;
  const stack = [];
  for (let i = 0; i < keys.length - 1; i++) {
    if (current == null || typeof current !== 'object') return;
    stack.push({ obj: current, key: keys[i] });
    current = current[keys[i]];
  }
  if (current != null && typeof current === 'object') {
    delete current[keys[keys.length - 1]];
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    const { obj: parent, key } = stack[i];
    if (parent[key] && typeof parent[key] === 'object' && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    }
  }
}

if (cmd === 'config' && sub === 'file') {
  process.stdout.write(configFile + '\\n');
  process.exit(0);
}

if (cmd === 'config' && sub === 'validate' && args.includes('--json')) {
  process.stdout.write(JSON.stringify({ valid: true, path: configFile }));
  process.exit(0);
}

if (cmd === 'config' && sub === 'set') {
  const dotPath = args[2];
  const value = args[3];
  const config = readConfig();
  const parsed = args.includes('--strict-json') ? JSON.parse(value) : value;
  deepSet(config, dotPath, parsed);
  writeConfig(config);
  process.exit(0);
}

if (cmd === 'config' && sub === 'get' && args.includes('--json')) {
  const dotPath = args[2];
  const config = readConfig();
  const value = deepGet(config, dotPath);
  if (value === undefined) {
    process.stderr.write('Config path not found: ' + dotPath + '\\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}

if (cmd === 'config' && sub === 'unset') {
  const dotPath = args[2];
  const config = readConfig();
  deepUnset(config, dotPath);
  writeConfig(config);
  process.exit(0);
}

if (cmd === 'models' && sub === 'set') {
  const modelId = args[2];
  const config = readConfig();
  deepSet(config, 'agents.defaults.model.primary', modelId);
  writeConfig(config);
  process.exit(0);
}

process.stderr.write('openclaw stub: unknown command: ' + args.join(' ') + '\\n');
process.exit(1);
`;

describe('openclaw', () => {
  let container: Container;

  beforeEach(async () => {
    container = await createContainer({ testName: 'openclaw' });
    await container.login();

    await container.writeFile('/usr/local/bin/openclaw', OPENCLAW_STUB);
    await container.execOrThrow('chmod +x /usr/local/bin/openclaw');
    await container.execOrThrow('mkdir -p /home/poe/.openclaw');
    await container.writeFile(OPENCLAW_CONFIG, '{}');
  });

  afterEach(async () => {
    if (container) {
      await expect(container).toHaveHealthyProxy();
      await container.destroy();
    }
  });

  it('configure sets provider config and default model', async () => {
    const result = await container.exec('poe-code configure openclaw --yes');
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(OPENCLAW_CONFIG);
    const raw = await container.readFile(OPENCLAW_CONFIG);
    const config = JSON.parse(raw);

    const providerConfig = config.models?.providers?.poe;
    expect(providerConfig).toBeDefined();
    expect(providerConfig.baseUrl).toEqual(expect.any(String));
    expect(providerConfig.apiKey).toEqual(expect.any(String));
    expect(providerConfig.api).toBe('openai-completions');
    expect(providerConfig.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
        }),
      ])
    );

    const primaryModel = config.agents?.defaults?.model?.primary;
    expect(primaryModel).toEqual(expect.stringMatching(/^poe\//));

    await expect(container).toHaveFile(POE_CODE_CONFIG);
    const metaRaw = await container.readFile(POE_CODE_CONFIG);
    const meta = JSON.parse(metaRaw);
    expect(meta.configured_services?.openclaw?.files).toEqual(
      expect.arrayContaining([OPENCLAW_CONFIG])
    );
  });

  it('unconfigure removes provider config', async () => {
    const configureResult = await container.exec('poe-code configure openclaw --yes');
    expect(configureResult).toHaveExitCode(0);

    const unconfigureResult = await container.exec('poe-code unconfigure openclaw');
    expect(unconfigureResult).toHaveExitCode(0);

    const raw = await container.readFile(OPENCLAW_CONFIG);
    const config = JSON.parse(raw);

    expect(config.models?.providers?.poe).toBeUndefined();

    const primaryModel = config.agents?.defaults?.model?.primary;
    const isPoeModel = typeof primaryModel === 'string' && primaryModel.startsWith('poe/');
    expect(isPoeModel).toBe(false);

    const metaRaw = await container.readFile(POE_CODE_CONFIG);
    const meta = JSON.parse(metaRaw);
    expect(meta.configured_services?.openclaw).toBeUndefined();
  });

  it('configure --dry-run does not modify config', async () => {
    const result = await container.exec('poe-code --dry-run configure openclaw --yes');
    expect(result).toHaveExitCode(0);

    const raw = await container.readFile(OPENCLAW_CONFIG);
    const config = JSON.parse(raw);
    expect(config).toEqual({});

    await expect(container).not.toHaveFile(POE_CODE_CONFIG);
  });
});
