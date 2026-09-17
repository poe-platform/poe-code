import { runInNewContext } from 'node:vm';
import type { PlaywrightElementHandle, PlaywrightSnapshotHandle, SnapshotNode } from '../../src/playwright/adapter.js';
import type { FrameSnapshotCapsule, FrameSnapshotInput } from '../../src/playwright/frame-snapshot.js';

export function createSnapshotFrame(elements: readonly { node: SnapshotNode; native: PlaywrightElementHandle }[], content = '') {
  const capsules: PlaywrightSnapshotHandle[] = [];
  const disposedCapsules: PlaywrightSnapshotHandle[] = [];
  const acquiredElements: PlaywrightElementHandle[] = [];
  const frame = {
    locator() { throw new Error('Snapshot locator fallback forbidden'); },
    async evaluateHandle(callback: (input: FrameSnapshotInput) => FrameSnapshotCapsule, input: FrameSnapshotInput): Promise<PlaywrightSnapshotHandle> {
      const document = { body: { innerText: content }, querySelectorAll: () => elements.map(element => element.node) };
      const create = runInNewContext(`(${callback.toString()})`, { document, TextEncoder }) as typeof callback;
      const capsule = create(input);
      const handle: PlaywrightSnapshotHandle = {
        async evaluate(callback, argument) { return structuredClone(callback(capsule, argument)); },
        async evaluateHandle(callback, slot) {
          const node = callback(capsule, slot);
          const native = elements.find(element => element.node === node)?.native ?? null;
          if (native) acquiredElements.push(native);
          return {
            asElement: () => native,
            async dispose() { if (native) await native.dispose(); },
          };
        },
        async dispose() { disposedCapsules.push(handle); },
      };
      capsules.push(handle);
      return handle;
    },
  };
  return { frame, capsules, disposedCapsules, acquiredElements };
}
