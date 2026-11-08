import { expect, it } from 'vitest';
import { avOptionNames, filterInputMetadata, filterOutputMetadata, nativeReference, optionMetadata, pathOptionMetadata } from './options.generated.js';
import { discover, filterOptions } from './discover.js';
import { createDependencyResolver } from './resolver.js';

it('keeps command and indirect-value filter grammar selection immutable', async () => {
  const original = Reflect.get(filterOptions, '0');
  const remove = Reflect.get(filterOptions, 'delete');
  const restore = Reflect.get(filterOptions, 'add');
  try {
    if (typeof remove === 'function') remove.call(filterOptions, 'vf');
    Reflect.set(filterOptions, '0', 'map');
    const argv = ['-vf', 'lut3d=file=look.cube', '-map', '0:a?', 'out.wav'].map(value => new TextEncoder().encode(value));
    expect(discover('ffmpeg', argv).dependencies.map(dependency => dependency.role)).toEqual(['filter-resource', 'output']);
    const b = (value: string) => new TextEncoder().encode(value);
    const resolver = await createDependencyResolver(discover('ffmpeg', ['-/vf', 'graph.option', 'out.wav'].map(b)), {
      cwd: b('/work'), budgets: { nodes: 10, bytes: 1000, depth: 5, symlinks: 5 },
    });
    const root = resolver.graph().nodes.find(node => new TextDecoder().decode(node.original) === 'graph.option')!;
    const children = await resolver.content(root.id, { content: b('lut3d=file=look.cube') });
    expect(children.map(node => [node.location, node.access])).toEqual([[b('/work/look.cube'), 'read']]);
  } finally {
    if (typeof restore === 'function') restore.call(filterOptions, 'vf');
    if (original !== undefined) Reflect.set(filterOptions, '0', original);
    else Reflect.deleteProperty(filterOptions, '0');
  }
});

it('keeps pinned executable identity immutable at runtime', () => {
  const executable = nativeReference.executables.ffmpeg;
  const original = executable.path;
  try {
    expect(Reflect.set(executable, 'path', '/unqualified/ffmpeg')).toBe(false);
    expect(executable.path).toBe(original);
    expect(Object.isFrozen(nativeReference)).toBe(true);
    expect(Object.isFrozen(nativeReference.executables)).toBe(true);
  } finally {
    Reflect.set(executable, 'path', original);
  }
});

it('keeps source-derived option arity, scope and reader grammar immutable', () => {
  const seek = optionMetadata.ffmpeg.ss;
  const original = seek.arity;
  try {
    expect(Reflect.set(seek, 'arity', 0)).toBe(false);
    expect(seek.arity).toBe(original);
    for (const value of [optionMetadata, optionMetadata.ffmpeg, seek.scopes,
      avOptionNames, pathOptionMetadata.attach, filterInputMetadata.ass.keys,
      filterOutputMetadata.signature.positional]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  } finally {
    Reflect.set(seek, 'arity', original);
  }
});
