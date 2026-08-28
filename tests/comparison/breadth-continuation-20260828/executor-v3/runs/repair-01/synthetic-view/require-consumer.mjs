import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const value = require('./loaded.cjs');
export function execute() { return { exitCode: 0, value: value.value, files: {} }; }
