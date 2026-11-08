import { resolve } from 'node:path';
import { capture } from './supervisor.mjs';

const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1'];
await capture('original-five-and-head-zero', process.execPath, [...testArgs, '--test-name-pattern=pipeline close: first-read-', 'tests/shell/remote-close.test.ts']);
await capture('existing-remote-after-write-and-no-write', process.execPath, [...testArgs, '--test-name-pattern=pipeline close: (?!first-read-)', 'tests/shell/remote-close.test.ts']);
await capture('existing-byte-io', process.execPath, [...testArgs, 'tests/contracts/io.test.ts', 'tests/contracts/io.stress.test.ts']);
await capture('existing-shared-lifecycle', process.execPath, [...testArgs, '--test-name-pattern=hard-timeout lifecycle regression: shared-', 'tests/shell/lifecycle.test.ts']);
await capture('existing-streaming', process.execPath, [...testArgs, '--test-name-pattern=pipes preserve|early downstream|pipeline redirects|AbortSignal reaches', 'tests/shell/streaming.test.ts']);
await capture('copied-source-build', process.execPath, [resolve('node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { timeoutMs: 30000 });
