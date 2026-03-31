import { describe, expect, it } from 'bun:test';
import packageJson from '../../package.json' with { type: 'json' };

describe('e2e package scripts', () => {
  it('runs e2e tests from the e2e working directory', () => {
    expect(packageJson.scripts.e2e).toContain('--cwd e2e');
    expect(packageJson.scripts.e2e).toContain('--max-concurrency 1');
    expect(packageJson.scripts.e2e).not.toContain('--config e2e/bunfig.toml');
  });

  it('runs verbose e2e tests from the e2e working directory', () => {
    expect(packageJson.scripts['e2e:verbose']).toContain('--cwd e2e');
    expect(packageJson.scripts['e2e:verbose']).toContain('--max-concurrency 1');
    expect(packageJson.scripts['e2e:verbose']).not.toContain('--config e2e/bunfig.toml');
  });
});
