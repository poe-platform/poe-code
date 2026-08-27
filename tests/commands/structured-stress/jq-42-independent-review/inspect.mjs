import { sourceSnapshot } from './common.mjs';
const snapshot = sourceSnapshot();
console.log(JSON.stringify({ head: snapshot.head, productSha256: snapshot.productSha256, structuredSha256: snapshot.structuredSha256, structuredFiles: Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => path.startsWith('src/commands/structured/'))) }, null, 2));
