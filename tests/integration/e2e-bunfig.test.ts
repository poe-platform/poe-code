import { describe, expect, it } from 'bun:test';

describe('e2e bunfig', () => {
  it('preloads setup and matchers for e2e runs', async () => {
    const bunfig = await Bun.file('e2e/bunfig.toml').text();

    expect(bunfig).toContain('preload = ["./setup.ts", "../packages/e2e-docker-test-runner/src/matchers.ts"]');
  });
});
