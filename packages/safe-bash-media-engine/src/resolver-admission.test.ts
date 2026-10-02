import { expect, it } from 'vitest';
import { discover, discoverImageMagick } from './index.js';
import { createDependencyResolver } from './resolver.js';

const b = (value: string) => new TextEncoder().encode(value);
const t = (value: Uint8Array | undefined) => value && new TextDecoder().decode(value);
const budgets = { nodes: 100, bytes: 100000, depth: 10, symlinks: 10 };

it('owns all frontend occurrences before the first advisory await', async () => {
  const discovery = discover('ffmpeg', ['-i', 'Case雪\n.ppm', 'Case雪\n.ppm'].map(b));
  let visited = false;
  const resolver = await createDependencyResolver(discovery, {
    cwd: b('/work'), budgets, link: async () => {
      if (!visited) {
        visited = true;
        for (const dependency of discovery.dependencies) dependency.value.fill(120);
      }
      return undefined;
    },
  });
  expect(resolver.graph().nodes.map(node => [t(node.original), node.access])).toEqual([
    ['Case雪\n.ppm', 'read'], ['Case雪\n.ppm', 'write'],
  ]);
});

it('owns invocation policy for later occurrences before advisory traversal', async () => {
  const policy = { allow: ['file', 'https'] };
  const resolver = await createDependencyResolver(discover('ffmpeg', ['-i', 'local.ppm', 'https://h/out?sig=+%2f#part'].map(b)), {
    cwd: b('/work'), budgets, policy, link: async () => { policy.allow.splice(0, 2, 'pipe'); return undefined; },
  });
  expect(resolver.graph().nodes.map(node => node.policy?.allow)).toEqual([['file', 'https'], ['file', 'https']]);
  expect(resolver.graph().issues.some(issue => issue.reason === 'policy')).toBe(false);
});

it('owns the resolution base used for inline drawing resources', async () => {
  const cwd = b('/work');
  const discovery = await discoverImageMagick('magick', ['in.ppm', '-draw', "image Over 0,0 1,1 'overlay.ppm'", 'out.ppm'].map(b));
  const resolver = await createDependencyResolver(discovery, {
    cwd, budgets, link: async () => { cwd.set(b('/else')); return undefined; },
  });
  expect(t(resolver.graph().nodes.find(node => t(node.original) === 'overlay.ppm')?.location)).toBe('/work/overlay.ppm');
});

it('owns later ImageMagick operands including selector and output spelling', async () => {
  const discovery = await discoverImageMagick('magick', ['first.ppm', 'second.tif[2]', 'out.ppm'].map(b));
  const resolver = await createDependencyResolver(discovery, {
    cwd: b('/work'), budgets, link: async () => {
      for (const resource of discovery.resources) {
        resource.operand.fill(120);
        resource.path?.fill(120);
      }
      return undefined;
    },
  });
  expect(resolver.graph().nodes.map(node => [t(node.original), node.access])).toEqual([
    ['first.ppm', 'read'], ['second.tif[2]', 'read'], ['out.ppm', 'write'],
  ]);
});
