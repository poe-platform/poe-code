export const geometry = [1, 2, 4, 8, 16].map(scale => ({ first: 1024 * scale, followups: 8 * scale, count: 1024 * scale }));
export const retention = [4096, 16384, 65536].map(first => ({ first, followups: 16, count: 7 }));
export const kinds = ['immutable-Buffer', 'borrowed-Buffer', 'borrowed-Uint8Array'];
export const commands = ['tail', 'head'];
export const bounds = Object.freeze({ copyInput: 6, copyCount: 2, copySlack: 256, allocateInput: 8, allocateCount: 4, allocateSlack: 512, backingCount: 4, backingSlack: 64 });
export const expectedTestCount = 53;
