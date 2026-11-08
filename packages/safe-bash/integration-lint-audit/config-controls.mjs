import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import { loadBoundaries } from '../scripts/integration-inputs.mjs';
import { readRegularInput } from '../scripts/typecheck-integration-inputs.mjs';
import { createLintInputGuard, createLintSelection } from '../../../scripts/lint-input-guard.mjs';

const repositoryRoot = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(import.meta.url);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const bootstrap = createLintInputGuard({ root: repositoryRoot, bootstrap: true });
const configPath = join(repositoryRoot, 'eslint.config.js');
const configBytes = bootstrap.read('eslint.config.js', 'configuration', 300000);
const wiringPaths = ['scripts/lint-input-guard.mjs', 'scripts/lint-eslint.mjs', 'packages/safe-bash/integration-lint-audit/boundary-leaf-receipts.json', 'packages/safe-bash/integration-boundaries.json', 'package.json'];
const wiringBindings = wiringPaths.map(path => ({ path, bytes: bootstrap.read(path, 'configuration') }));
const compatibilityModule = await import(pathToFileURL(configPath));
const guard = compatibilityModule.lintInputGuard;
assert.equal(guard.root, repositoryRoot, 'guarded control root changed');
guard.begin();
const readRegular = (filename, limit) => {
  assert.ok(filename.startsWith(repositoryRoot + '/'), 'control input outside repository');
  return guard.read(filename.slice(repositoryRoot.length + 1), 'configuration', limit);
};
const inventoryPath = join(repositoryRoot, 'packages/safe-bash/integration-lint-inventory.json');
const inventoryBytes = readRegular(inventoryPath, 535875);
assert.equal(inventoryBytes.length, 535875);
assert.equal(digest(inventoryBytes), 'c67f5004c29e0974e166fc007e794e1ae35083a017a1c96b6e60cb79b59c6689');
const inventory = JSON.parse(inventoryBytes);
const inventoryCounts = {
  records: inventory.records.length,
  owners: new Set(inventory.records.flatMap(record => record.owners.map(owner => owner.path))).size,
  regularMembers: inventory.records.reduce((total, record) => total + record.members.length, 0),
  symlinks: inventory.records.reduce((total, record) => total + (record.symlinks?.length ?? 0), 0),
  paths: inventory.records.reduce((total, record) => total + record.members.length + (record.symlinks?.length ?? 0), 0),
  controlledRecords: inventory.records.filter(record => record.role === 'controlled-executable-fixture').length,
  controlledMembers: inventory.records.filter(record => record.role === 'controlled-executable-fixture').reduce((total, record) => total + record.members.length, 0),
};
assert.deepEqual(inventoryCounts, { records: 70, owners: 103, regularMembers: 1802, symlinks: 2, paths: 1804, controlledRecords: 8, controlledMembers: 22 });
const controls = [
  {
    "name": "intentional regex class characters",
    "file": "packages/safe-bash/src/commands/du/du.ts",
    "code": "export const pattern = /[\\[\\/\\-]/;",
    "expected": []
  },
  {
    "name": "useless string escapes stay rejected",
    "file": "packages/safe-bash/src/commands/du/du.ts",
    "code": "export const text = \"\\[\\/\\-\";",
    "expected": [
      "no-useless-escape",
      "no-useless-escape",
      "no-useless-escape"
    ]
  },
  {
    "name": "unapproved regex identity escape stays rejected",
    "file": "packages/safe-bash/src/commands/du/du.ts",
    "code": "export const pattern = /\\#/;",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "unrelated package retains regex diagnostics",
    "file": "src/policy-control.ts",
    "code": "export const pattern = /[\\[]/;",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "registered deferred read accepted",
    "file": "packages/safe-bash/src/commands/yq/index.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": []
  },
  {
    "name": "ordinary constant preference remains",
    "file": "packages/safe-bash/src/commands/yq/index.ts",
    "code": "export function work() { let value = 1; return value; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "unrelated source retains deferred preference",
    "file": "packages/safe-bash/src/unrelated.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "generator owner alias accepted",
    "file": "packages/safe-bash/src/commands/stream-format/shared.ts",
    "code": "export class Owner { value = 1; stream() { const session = this; return (function* () { yield session.value; })(); } }",
    "expected": []
  },
  {
    "name": "other alias name stays rejected",
    "file": "packages/safe-bash/src/commands/stream-format/shared.ts",
    "code": "export class Owner { value = 1; stream() { const unrelated = this; return (function* () { yield unrelated.value; })(); } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "alias allowance does not escape file",
    "file": "packages/safe-bash/src/unrelated.ts",
    "code": "export class Owner { value = 1; stream() { const session = this; return (function* () { yield session.value; })(); } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "throw-only fixture accepted",
    "file": "packages/safe-bash/tests/commands/bytes-stress/readonly.test.ts",
    "code": "export async function* source() { throw new Error(\"must not consume\"); }",
    "expected": []
  },
  {
    "name": "suspended fixture accepted",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "export async function* source(pending: Promise<never>) { await pending; }",
    "expected": []
  },
  {
    "name": "production generator remains checked",
    "file": "packages/safe-bash/src/shell/runtime.ts",
    "code": "export async function* source() { throw new Error(\"unexpected\"); }",
    "expected": [
      "require-yield"
    ]
  },
  {
    "name": "neighbor test generator remains checked",
    "file": "packages/safe-bash/tests/commands/bytes-stress/neighbor.test.ts",
    "code": "export async function* source() { throw new Error(\"unexpected\"); }",
    "expected": [
      "require-yield"
    ]
  },
  {
    "name": "unsafe finally still rejected in fixture",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "export async function* source() { try { throw new Error(); } finally { return 1; } }",
    "expected": [
      "no-unsafe-finally"
    ]
  },
  {
    "name": "undefined package JS binding still rejected",
    "file": "packages/safe-bash/scripts/lint-policy-control.mjs",
    "code": "missingBinding();",
    "expected": [
      "no-undef"
    ]
  },
  {
    "name": "duplicate package JS keys still rejected",
    "file": "packages/safe-bash/scripts/lint-policy-control.mjs",
    "code": "export const value = { key: 1, key: 2 };",
    "expected": [
      "no-dupe-keys"
    ]
  },
  {
    "name": "ordinary fixture empty block still rejected",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "export function inspect(ready: boolean) { if (ready) {} }",
    "expected": [
      "no-empty"
    ]
  },
  {
    "name": "syntax fixture error still rejected",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "const = ;",
    "expected": [
      "parse"
    ]
  },
  {
    "name": "src/commands/stream-format/shared.ts:session:allowed",
    "file": "packages/safe-bash/src/commands/stream-format/shared.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": []
  },
  {
    "name": "src/commands/stream-format/shared.ts:session:other-name",
    "file": "packages/safe-bash/src/commands/stream-format/shared.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/commands/stream-format/shared.ts:session:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/commands/stream-inspection/shared.ts:session:allowed",
    "file": "packages/safe-bash/src/commands/stream-inspection/shared.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": []
  },
  {
    "name": "src/commands/stream-inspection/shared.ts:session:other-name",
    "file": "packages/safe-bash/src/commands/stream-inspection/shared.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/commands/stream-inspection/shared.ts:session:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/commands/structured/query-core.ts:session:allowed",
    "file": "packages/safe-bash/src/commands/structured/query-core.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": []
  },
  {
    "name": "src/commands/structured/query-core.ts:session:other-name",
    "file": "packages/safe-bash/src/commands/structured/query-core.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/commands/structured/query-core.ts:session:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const session = this; return session; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/fs/s3/filesystem.ts:adapter:allowed",
    "file": "packages/safe-bash/src/fs/s3/filesystem.ts",
    "code": "export class Owner { bind() { const adapter = this; return adapter; } }",
    "expected": []
  },
  {
    "name": "src/fs/s3/filesystem.ts:adapter:other-name",
    "file": "packages/safe-bash/src/fs/s3/filesystem.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/fs/s3/filesystem.ts:adapter:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const adapter = this; return adapter; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/fs/webdav/webdav.ts:filesystem:allowed",
    "file": "packages/safe-bash/src/fs/webdav/webdav.ts",
    "code": "export class Owner { bind() { const filesystem = this; return filesystem; } }",
    "expected": []
  },
  {
    "name": "src/fs/webdav/webdav.ts:filesystem:other-name",
    "file": "packages/safe-bash/src/fs/webdav/webdav.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/fs/webdav/webdav.ts:filesystem:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const filesystem = this; return filesystem; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/fs/mount/allocation.test.ts:filesystem:allowed",
    "file": "packages/safe-bash/tests/fs/mount/allocation.test.ts",
    "code": "export class Owner { bind() { const filesystem = this; return filesystem; } }",
    "expected": []
  },
  {
    "name": "tests/fs/mount/allocation.test.ts:filesystem:other-name",
    "file": "packages/safe-bash/tests/fs/mount/allocation.test.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/fs/mount/allocation.test.ts:filesystem:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const filesystem = this; return filesystem; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/shell/arrays/ledger.ts:root:allowed",
    "file": "packages/safe-bash/src/shell/arrays/ledger.ts",
    "code": "export class Owner { bind() { const root = this; return root; } }",
    "expected": []
  },
  {
    "name": "src/shell/arrays/ledger.ts:root:other-name",
    "file": "packages/safe-bash/src/shell/arrays/ledger.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/shell/arrays/ledger.ts:root:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const root = this; return root; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/shell/arrays/state.ts:monitor:allowed",
    "file": "packages/safe-bash/src/shell/arrays/state.ts",
    "code": "export class Owner { bind() { const monitor = this; return monitor; } }",
    "expected": []
  },
  {
    "name": "src/shell/arrays/state.ts:monitor:other-name",
    "file": "packages/safe-bash/src/shell/arrays/state.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "src/shell/arrays/state.ts:monitor:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const monitor = this; return monitor; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/grep-aliases/safety.test.ts:activeWorker:allowed",
    "file": "packages/safe-bash/tests/commands/grep-aliases/safety.test.ts",
    "code": "export class Owner { bind() { const activeWorker = this; return activeWorker; } }",
    "expected": []
  },
  {
    "name": "tests/commands/grep-aliases/safety.test.ts:activeWorker:other-name",
    "file": "packages/safe-bash/tests/commands/grep-aliases/safety.test.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/grep-aliases/safety.test.ts:activeWorker:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const activeWorker = this; return activeWorker; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:receiver:allowed",
    "file": "packages/safe-bash/tests/commands/timeout-author-20260828/timeout.test.ts",
    "code": "export class Owner { bind() { const receiver = this; return receiver; } }",
    "expected": []
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:receiver:other-name",
    "file": "packages/safe-bash/tests/commands/timeout-author-20260828/timeout.test.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:receiver:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const receiver = this; return receiver; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:fallbackReceiver:allowed",
    "file": "packages/safe-bash/tests/commands/timeout-author-20260828/timeout.test.ts",
    "code": "export class Owner { bind() { const fallbackReceiver = this; return fallbackReceiver; } }",
    "expected": []
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:fallbackReceiver:other-name",
    "file": "packages/safe-bash/tests/commands/timeout-author-20260828/timeout.test.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/commands/timeout-author-20260828/timeout.test.ts:fallbackReceiver:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const fallbackReceiver = this; return fallbackReceiver; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/shell/first-read-owned-fixtures.ts:fixture:allowed",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "export class Owner { bind() { const fixture = this; return fixture; } }",
    "expected": []
  },
  {
    "name": "tests/shell/first-read-owned-fixtures.ts:fixture:other-name",
    "file": "packages/safe-bash/tests/shell/first-read-owned-fixtures.ts",
    "code": "export class Owner { bind() { const unrelatedAlias = this; return unrelatedAlias; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  },
  {
    "name": "tests/shell/first-read-owned-fixtures.ts:fixture:other-file",
    "file": "packages/safe-bash/src/unrelated-alias.ts",
    "code": "export class Owner { bind() { const fixture = this; return fixture; } }",
    "expected": [
      "@typescript-eslint/no-this-alias"
    ]
  }
];
const exactFileControls = [
  {
    "name": "cancellation deferred boundary accepted",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": []
  },
  {
    "name": "cancellation cleanup assignment still rejected",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function create() { let cleanup: () => number | undefined; let boundary: number | undefined; cleanup = () => boundary; boundary = 1; return cleanup(); }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "cancellation ordinary initialized let rejected",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function create() { let value = 1; return value; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "cancellation ordinary deferred assignment rejected",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function create() { let value: number; value = 1; return value; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/neighbor.test.ts:deferred boundary still rejected",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/neighbor.test.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "packages/safe-bash/src/policy-boundary.ts:deferred boundary still rejected",
    "file": "packages/safe-bash/src/policy-boundary.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "src/policy-boundary.ts:deferred boundary still rejected",
    "file": "src/policy-boundary.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "WebDAV intentional empty object type accepted",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export type Input = {};",
    "expected": []
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/neighbor.ts:empty object type still rejected",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/neighbor.ts",
    "code": "export type Input = {};",
    "expected": [
      "@typescript-eslint/no-empty-object-type"
    ]
  },
  {
    "name": "packages/safe-bash/src/policy-type.ts:empty object type still rejected",
    "file": "packages/safe-bash/src/policy-type.ts",
    "code": "export type Input = {};",
    "expected": [
      "@typescript-eslint/no-empty-object-type"
    ]
  },
  {
    "name": "src/policy-type.ts:empty object type still rejected",
    "file": "src/policy-type.ts",
    "code": "export type Input = {};",
    "expected": [
      "@typescript-eslint/no-empty-object-type"
    ]
  },
  {
    "name": "WebDAV empty interface still rejected",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export interface Input {}",
    "expected": [
      "@typescript-eslint/no-empty-object-type"
    ]
  },
  {
    "name": "WebDAV ordinary const preference retained",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export function create() { let value = 1; return value; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "WebDAV does not inherit deferred policy",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export function create(register: (read: () => number | undefined) => void) { let pending: number | undefined; register(() => pending); pending = 1; return pending; }",
    "expected": [
      "prefer-const"
    ]
  },
  {
    "name": "cancellation does not inherit empty type policy",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export type Input = {};",
    "expected": [
      "@typescript-eslint/no-empty-object-type"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts:string escapes remain errors",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export const text = \"\\#\";",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts:unapproved regex quote remains error",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export const pattern = /[\\\"]/;",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts:unsafe finally remains error",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function run() { try { return 1; } finally { return 2; } }",
    "expected": [
      "no-unsafe-finally"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts:syntax remains error",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "const = ;",
    "expected": [
      "parse"
    ]
  },
  {
    "name": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts:ordinary empty block remains error",
    "file": "packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "code": "export function run(ready: boolean) { if (ready) {} }",
    "expected": [
      "no-empty"
    ]
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts:string escapes remain errors",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export const text = \"\\#\";",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts:unapproved regex quote remains error",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export const pattern = /[\\\"]/;",
    "expected": [
      "no-useless-escape"
    ]
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts:unsafe finally remains error",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export function run() { try { return 1; } finally { return 2; } }",
    "expected": [
      "no-unsafe-finally"
    ]
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts:syntax remains error",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "const = ;",
    "expected": [
      "parse"
    ]
  },
  {
    "name": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts:ordinary empty block remains error",
    "file": "packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "code": "export function run(ready: boolean) { if (ready) {} }",
    "expected": [
      "no-empty"
    ]
  },
  {
    "name": "canonical SafeJS arguments owner retains exact exception",
    "file": "packages/safe-js/src/interp/arguments.ts",
    "code": "export function capture() { return arguments[0]; }",
    "expected": []
  },
  {
    "name": "legacy SafeJS path does not retain canonical exception",
    "file": "packages/safejs/src/interp/arguments.ts",
    "code": "export function capture() { return arguments[0]; }",
    "expected": [
      "prefer-rest-params"
    ]
  },
  {
    "name": "canonical SafeJS neighbor retains rest-parameter diagnostic",
    "file": "packages/safe-js/src/interp/arguments-neighbor.ts",
    "code": "export function capture() { return arguments[0]; }",
    "expected": [
      "prefer-rest-params"
    ]
  },
  {
    "name": "canonical SafeJS arguments owner retains unsafe-finally diagnostic",
    "file": "packages/safe-js/src/interp/arguments.ts",
    "code": "export function capture() { try { return arguments[0]; } finally { return 1; } }",
    "expected": [
      "no-unsafe-finally"
    ]
  }
];
const eslint = createLintSelection(repositoryRoot, [...compatibilityModule.default, { processor: { supportsAutofix: true, preprocess: text => [text], postprocess: messages => messages.flat() } }]).eslint;
const results = [];
assert.equal(controls.length, 55);
assert.equal(exactFileControls.length, 29);
for (const control of [...controls, ...exactFileControls]) {
  const [result] = await eslint.lintText(control.code, { filePath: control.file });
  const rules = result.messages.map(message => message.ruleId ?? 'parse').sort();
  assert.deepEqual(rules, [...control.expected].sort(), control.name);
  if (exactFileControls.includes(control)) assert.ok(result.messages.every(message => message.severity === 2), control.name);
  results.push({ name: control.name, file: control.file, expected: control.expected, actual: rules, passed: true });
}
assert.equal(results.length, 84);
const frozenPolicyFixtures = [
  {
    "path": "tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "bytes": 26940,
    "sha256": "db49520d9baf10d159572a6edf2d06d8e3988b9d72a0c6b7b7589b1ca311965f",
    "owner": "tests/shell/cancellation-stage1-20260827/extension-v1/freeze-manifest.json",
    "ownerBytes": 1236,
    "ownerSha256": "4de91596d9f4234a169f8df074f8b0d2d0f01d1c78c427222718fc28145543ef",
    "ownerMember": "cancellation-extension.test.ts",
    "expected": [
      {
        "ruleId": "prefer-const",
        "line": 381,
        "column": 3,
        "severity": 2
      }
    ]
  },
  {
    "path": "tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts",
    "bytes": 2352,
    "sha256": "ed7561849eb048fafabba46fb80201fd006be5fb62a442f307e69c1812700614",
    "owner": "tests/fs/webdav/directory-access-independent-20260828/MANIFEST.json",
    "ownerBytes": 13954,
    "ownerSha256": "13aef9a1d4e5222015562108b14b4cad9bb26b04841468d6091408598e4db904",
    "ownerMember": "typed-inputs.ts",
    "expected": []
  }
];
const expectedNegativeAssertions = [
  "Assert<Not<Fits<\"1\", Mode>>>",
  "Assert<Not<Fits<null, Mode>>>",
  "Assert<Not<Fits<Uint8Array, Path>>>",
  "Assert<Not<Fits<{ signal: undefined }, FsOptions>>>",
  "Assert<Not<Fits<{ signal: { aborted: boolean } }, FsOptions>>>",
  "Assert<Not<Fits<{ baseUrl: string }, WebDavFileSystemOptions>>>",
  "Assert<Not<Fits<(url: string, init: RequestInit) => Response, WebDavFetch>>>",
  "Assert<Not<Fits<\"directoryAccess\", keyof WebDavFileSystemOptions>>>",
  "Assert<Not<Fits<\"maxAccessPathBytes\", keyof WebDavFileSystemOptions>>>",
  "Assert<Not<Fits<\"directoryNavigation\", keyof WebDavFileSystem[\"capabilities\"]>>>"
];
const packageRoot = join(repositoryRoot, 'packages/safe-bash');
const boundaries = loadBoundaries(packageRoot, guard.fileSystem);
const allowedFixtureReads = new Set(frozenPolicyFixtures.flatMap(fixture => [fixture.path, fixture.owner]).map(path => join(packageRoot, path)));
let frozenFixtureContentReads = 0;
const fixtureFileSystem = {
  ...guard.fileSystem,
  readAdmittedInput(filename, maximum) {
    assert.ok(allowedFixtureReads.has(filename), 'Unexpected policy fixture read');
    frozenFixtureContentReads++;
    return guard.fileSystem.readAdmittedInput(filename, maximum);
  },
  readFileSync(filename) {
    assert.ok(allowedFixtureReads.has(filename), 'Unexpected policy fixture read');
    frozenFixtureContentReads++;
    return guard.fileSystem.readFileSync(filename);
  },
};
const fixtureResults = [];
let typeAssertionPreservation;
for (const fixture of frozenPolicyFixtures) {
  const ownerBytes = readRegularInput(packageRoot, fixture.owner, fixture.ownerBytes, fixtureFileSystem, boundaries);
  assert.equal(ownerBytes.length, fixture.ownerBytes);
  assert.equal(digest(ownerBytes), fixture.ownerSha256);
  assert.equal(JSON.parse(ownerBytes).files[fixture.ownerMember], fixture.sha256);
  const bytes = readRegularInput(packageRoot, fixture.path, fixture.bytes, fixtureFileSystem, boundaries);
  assert.equal(bytes.length, fixture.bytes);
  assert.equal(digest(bytes), fixture.sha256);
  const [result] = await eslint.lintText(bytes.toString('utf8'), { filePath: 'packages/safe-bash/' + fixture.path });
  const messages = result.messages.map(({ ruleId, line, column, severity }) => ({ ruleId, line, column, severity }));
  assert.deepEqual(messages, fixture.expected, fixture.path);
  fixtureResults.push({ path: fixture.path, bytes: bytes.length, sha256: digest(bytes), messages, passed: true });
  if (fixture.ownerMember === 'typed-inputs.ts') {
    const parser = require('typescript');
    const source = parser.createSourceFile(fixture.path, bytes.toString('utf8'), parser.ScriptTarget.Latest, true, parser.ScriptKind.TS);
    assert.equal(source.parseDiagnostics.length, 0);
    const negative = source.statements.find(statement => parser.isTypeAliasDeclaration(statement) && statement.name.text === 'NegativeControls');
    const positive = source.statements.find(statement => parser.isTypeAliasDeclaration(statement) && statement.name.text === 'PositiveControls');
    assert.ok(negative && parser.isTupleTypeNode(negative.type));
    assert.ok(positive && parser.isTupleTypeNode(positive.type));
    const assertions = negative.type.elements.map(element => element.getText(source));
    assert.deepEqual(assertions, expectedNegativeAssertions);
    assert.equal(positive.type.elements.length, 8);
    let emptyObjectTypes = 0;
    const visit = node => {
      if (parser.isTypeLiteralNode(node) && node.members.length === 0) emptyObjectTypes++;
      parser.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(emptyObjectTypes, 1);
    typeAssertionPreservation = { positive: positive.type.elements.length, negative: assertions.length, emptyObjectTypes, assertions, validation: 'Pinned bytes and TypeScript AST preservation; no compiler/typecheck or fixture execution' };
  }
}
assert.equal(frozenFixtureContentReads, 4);
assert.equal(fixtureResults.length, 2);

const compatibilitySpecs = [
  {
    "name": "cancellation-cleanup",
    "path": "tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts",
    "bytes": 26940,
    "sha256": "db49520d9baf10d159572a6edf2d06d8e3988b9d72a0c6b7b7589b1ca311965f",
    "owner": {
      "path": "tests/shell/cancellation-stage1-20260827/extension-v1/freeze-manifest.json",
      "bytes": 1236,
      "sha256": "4de91596d9f4234a169f8df074f8b0d2d0f01d1c78c427222718fc28145543ef"
    },
    "selector": [
      "files",
      "cancellation-extension.test.ts"
    ],
    "finding": {
      "ruleId": "prefer-const",
      "severity": 2,
      "message": "'cleanup' is never reassigned. Use 'const' instead.",
      "line": 381,
      "column": 3,
      "nodeType": "Identifier",
      "messageId": "useConst",
      "endLine": 381,
      "endColumn": 10
    },
    "rawFinding": {
      "ruleId": "prefer-const",
      "severity": 2,
      "message": "'cleanup' is never reassigned. Use 'const' instead.",
      "line": 381,
      "column": 3,
      "nodeType": "Identifier",
      "messageId": "useConst",
      "endLine": 381,
      "endColumn": 10
    }
  },
  {
    "name": "holdout-string-escape",
    "path": "tests/shell-stress/targeted-holdout/cases.ts",
    "bytes": 8704,
    "sha256": "7829b1528b38d8951692ea8fdbc9ad7bd9119284f5a772528f86d08c5c935714",
    "owner": {
      "path": "benchmarks/shell-stress/targeted-holdout/references.json",
      "bytes": 52370,
      "sha256": "0c54a6736fc32729767861ad542324e1904c10f7ac7f6d7848bb43ce73c31cb4"
    },
    "selector": [
      "caseSourceSha256"
    ],
    "finding": {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\'.",
      "line": 45,
      "column": 104,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 45,
      "endColumn": 105
    },
    "rawFinding": {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\'.",
      "line": 45,
      "column": 104,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 45,
      "endColumn": 105,
      "suggestions": [
        {
          "messageId": "removeEscape",
          "fix": {
            "range": [
              5986,
              5987
            ],
            "text": ""
          },
          "desc": "Remove the `\\`. This maintains the current functionality."
        },
        {
          "messageId": "escapeBackslash",
          "fix": {
            "range": [
              5986,
              5986
            ],
            "text": "\\"
          },
          "desc": "Replace the `\\` with `\\\\` to include the actual backslash character."
        }
      ]
    }
  }
];
const jqCompatibilitySpec = {
  "name": "jq-case-specification",
  "path": "tests/commands/structured-stress/jq-42-independent-review/cases.mjs",
  "bytes": 3616,
  "sha256": "70270b9df9a3e407106d7facec5de7432cd34fdc750b65a682566eddedb66b8d",
  "owner": {
    "path": "tests/commands/structured-stress/jq-42-independent-review/manifest.json",
    "bytes": 68939,
    "sha256": "f4636b95d52c78b118c5eebc4a802ccf13d63a8a43c460f55da91e9f4e6ceacb"
  },
  "selector": [
    "independent",
    "caseSpecificationSha256"
  ],
  "findings": [
    {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\\".",
      "line": 13,
      "column": 105,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 13,
      "endColumn": 106
    },
    {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\\".",
      "line": 13,
      "column": 110,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 13,
      "endColumn": 111
    }
  ],
  "rawFindings": [
    {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\\".",
      "line": 13,
      "column": 105,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 13,
      "endColumn": 106,
      "suggestions": [
        {
          "messageId": "removeEscape",
          "fix": {
            "range": [
              1107,
              1108
            ],
            "text": ""
          },
          "desc": "Remove the `\\`. This maintains the current functionality."
        },
        {
          "messageId": "escapeBackslash",
          "fix": {
            "range": [
              1107,
              1107
            ],
            "text": "\\"
          },
          "desc": "Replace the `\\` with `\\\\` to include the actual backslash character."
        }
      ]
    },
    {
      "ruleId": "no-useless-escape",
      "severity": 2,
      "message": "Unnecessary escape character: \\\".",
      "line": 13,
      "column": 110,
      "nodeType": "Literal",
      "messageId": "unnecessaryEscape",
      "endLine": 13,
      "endColumn": 111,
      "suggestions": [
        {
          "messageId": "removeEscape",
          "fix": {
            "range": [
              1112,
              1113
            ],
            "text": ""
          },
          "desc": "Remove the `\\`. This maintains the current functionality."
        },
        {
          "messageId": "escapeBackslash",
          "fix": {
            "range": [
              1112,
              1112
            ],
            "text": "\\"
          },
          "desc": "Replace the `\\` with `\\\\` to include the actual backslash character."
        }
      ]
    }
  ]
};
assert.equal(typeof compatibilityModule.frozenStyleCompatibility, 'function', 'three exact native processors are required');
const compatibleESLint = createLintSelection(repositoryRoot, compatibilityModule.default).eslint;
const compatibilityResults = [];
const compatibilityBodies = new Map();
for (const spec of [...compatibilitySpecs, jqCompatibilitySpec]) {
  for (const binding of [spec.owner, spec]) {
    const filename = join(packageRoot, binding.path);
    const bytes = readRegularInput(packageRoot, binding.path, binding.bytes, guard.fileSystem, boundaries);
    assert.equal(bytes.length, binding.bytes);
    assert.equal(digest(bytes), binding.sha256);
    compatibilityBodies.set(filename, bytes);
  }
  const filename = join(packageRoot, spec.path);
  const text = compatibilityBodies.get(filename).toString('utf8');
  const [raw] = await eslint.lintText(text, { filePath: filename });
  assert.deepEqual(raw.messages, spec.rawFindings ?? [spec.rawFinding]);
  const [filtered] = await compatibleESLint.lintText(text, { filePath: filename });
  assert.deepEqual(filtered.messages, []);
  assert.equal(filtered.errorCount, 0);
  compatibilityResults.push({ name: spec.name + ':actual native compatibility', rawErrors: raw.errorCount, accepted: spec.findings?.length ?? 1, remainingErrors: filtered.errorCount, passed: true });
}
const { Volume, createFsFromVolume } = require('memfs');
const protectedStyleOwnerPin = compatibilityModule.protectedImportStyleBinding;
const protectedStyleOwnerBytes = readRegularInput(packageRoot, protectedStyleOwnerPin.path, protectedStyleOwnerPin.bytes, guard.fileSystem, boundaries);
assert.equal(protectedStyleOwnerBytes.length, protectedStyleOwnerPin.bytes);
assert.equal(digest(protectedStyleOwnerBytes), protectedStyleOwnerPin.sha256);
compatibilityBodies.set(join(packageRoot, protectedStyleOwnerPin.path), protectedStyleOwnerBytes);
const protectedStyleSourceBodies = new Map();
for (const member of JSON.parse(protectedStyleOwnerBytes.toString('utf8')).members) {
  const bytes = readRegularInput(packageRoot, member.path, member.bytes, guard.fileSystem, boundaries);
  assert.equal(bytes.length, member.bytes);
  assert.equal(digest(bytes), member.sha256);
  protectedStyleSourceBodies.set(member.path, bytes);
  compatibilityBodies.set(join(packageRoot, member.path), bytes);
}

const runtime704OwnerPin = compatibilityModule.runtime704IntentBinding;
const runtime704OwnerBytes = readRegularInput(packageRoot, runtime704OwnerPin.path, runtime704OwnerPin.bytes, guard.fileSystem, boundaries);
assert.equal(runtime704OwnerBytes.length, runtime704OwnerPin.bytes);
assert.equal(digest(runtime704OwnerBytes), runtime704OwnerPin.sha256);
compatibilityBodies.set(join(packageRoot, runtime704OwnerPin.path), runtime704OwnerBytes);
const runtime704SourceBinding = JSON.parse(runtime704OwnerBytes.toString('utf8')).source;
const runtime704SourceBytes = readRegularInput(packageRoot, runtime704SourceBinding.path, runtime704SourceBinding.bytes, guard.fileSystem, boundaries);
assert.equal(runtime704SourceBytes.length, runtime704SourceBinding.bytes);
assert.equal(digest(runtime704SourceBytes), runtime704SourceBinding.sha256);
compatibilityBodies.set(join(packageRoot, runtime704SourceBinding.path), runtime704SourceBytes);

function compatibilityModel() {
  const volume = Volume.fromJSON(Object.fromEntries([...compatibilityBodies].map(([filename, bytes]) => [filename, bytes.toString('utf8')])));
  const memory = createFsFromVolume(volume);
  const reads = [];
  const fileSystem = { ...memory, readFileSync(filename) { reads.push(filename); assert.ok(compatibilityBodies.has(filename), 'unapproved compatibility read'); return memory.readFileSync(filename); } };
  return { memory, fileSystem, reads };
}
function compatibilityCheck(name, action) {
  action();
  compatibilityResults.push({ name, passed: true });
}
for (const [index, spec] of compatibilitySpecs.entries()) {
  const filename = join(packageRoot, spec.path);
  const owner = join(packageRoot, spec.owner.path);
  const text = compatibilityBodies.get(filename).toString('utf8');
  const instantiate = model => compatibilityModule.frozenStyleCompatibility(model.fileSystem)[index].processor;
  compatibilityCheck(spec.name + ':unchanged text and exact one finding', () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    assert.equal(processor.supportsAutofix, false);
    assert.deepEqual(processor.preprocess(text, filename), [text]);
    assert.deepEqual(processor.postprocess([[structuredClone(spec.finding)]], filename), []);
    assert.throws(() => processor.postprocess([[spec.finding]], filename), /preprocess/);
  });
  for (const [label, messages] of [['missing', []], ['duplicate', [spec.finding, spec.finding]]]) compatibilityCheck(spec.name + ':' + label + ' finding refuses', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([messages], filename), /exactly one/);
  });
  for (const field of Object.keys(spec.finding)) compatibilityCheck(spec.name + ':diagnostic drift ' + field, () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    const changed = structuredClone(spec.finding);
    delete changed[field];
    assert.throws(() => processor.postprocess([[changed]], filename), /exactly one/);
  });
  compatibilityCheck(spec.name + ':unexpected diagnostic field refuses', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([[{ ...spec.finding, unexpected: true }]], filename), /exactly one/);
  });
  compatibilityCheck(spec.name + ':owner drift after construction refuses before source reread', () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    const beforeReads = model.reads.length;
    const changed = Buffer.from(compatibilityBodies.get(owner));
    changed[0] ^= 1;
    model.memory.writeFileSync(owner, changed);
    assert.throws(() => processor.preprocess(text, filename), /hash/);
    assert.equal(model.reads.slice(beforeReads).includes(filename), false);
    assert.throws(() => processor.postprocess([[spec.finding]], filename), /preprocess/);
  });
  compatibilityCheck(spec.name + ':extra same-rule and semantic findings remain errors', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    const extra = [
      { ...spec.finding, line: 1, column: 1 },
      ...['no-unsafe-finally', 'no-undef', 'no-dupe-keys', 'no-empty'].map(ruleId => ({ ruleId, severity: 2, message: 'control', line: 1, column: 1 })),
      { ruleId: null, fatal: true, severity: 2, message: 'Parsing error', line: 1, column: 1 },
    ];
    const returned = processor.postprocess([[...extra, spec.finding]], filename);
    assert.deepEqual(returned, extra);
    for (const [position, message] of returned.entries()) assert.equal(message, extra[position]);
  });
  for (const changedName of [filename.toUpperCase(), filename.replace('/tests/', '/tests/../tests/'), filename + '*', filename + '/neighbor.ts']) compatibilityCheck(spec.name + ':filename admission ' + changedName, () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    const beforeReads = model.reads.length;
    assert.throws(() => processor.preprocess(text, changedName), /filename/);
    assert.equal(model.reads.length, beforeReads);
  });
  compatibilityCheck(spec.name + ':text mutation fails closed and state cannot be reused', () => {
    const processor = instantiate(compatibilityModel());
    assert.throws(() => processor.preprocess(text + '\nexport let newFinding = 1;', filename), /source text/);
    assert.throws(() => processor.postprocess([[spec.finding]], filename), /preprocess/);
  });
  compatibilityCheck(spec.name + ':overlapping preprocessing refuses stale state', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.throws(() => processor.preprocess(text, filename), /overlapping/);
    assert.throws(() => processor.postprocess([[spec.finding]], filename), /preprocess/);
  });
  compatibilityCheck(spec.name + ':postprocess filename and block shape must match', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([[spec.finding]], filename + '.other'), /filename/);
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([[spec.finding], []], filename), /single unchanged block/);
  });
  for (const target of [filename, owner]) {
    compatibilityCheck(spec.name + ':hash drift ' + target, () => {
      const model = compatibilityModel();
      const bytes = Buffer.from(compatibilityBodies.get(target));
      bytes[0] ^= 1;
      model.memory.writeFileSync(target, bytes);
      assert.throws(() => instantiate(model), /hash/);
      if (target === owner) assert.equal(model.reads.includes(filename), false);
    });
    compatibilityCheck(spec.name + ':size drift refuses before read ' + target, () => {
      const model = compatibilityModel();
      model.memory.appendFileSync(target, 'x');
      assert.throws(() => instantiate(model), /size/);
      assert.equal(model.reads.includes(target), false);
    });
    compatibilityCheck(spec.name + ':symlink refuses before read ' + target, () => {
      const model = compatibilityModel();
      model.memory.unlinkSync(target);
      model.memory.symlinkSync(join(packageRoot, 'src/commands/XAN/argv.ts'), target);
      assert.throws(() => instantiate(model), /regular/);
      assert.equal(model.reads.includes(target), false);
    });
    compatibilityCheck(spec.name + ':hardlink refuses before read ' + target, () => {
      const model = compatibilityModel();
      model.memory.linkSync(target, target + '.alias');
      assert.throws(() => instantiate(model), /regular|link/);
      assert.equal(model.reads.includes(target), false);
    });
    compatibilityCheck(spec.name + ':canonical alias refuses before read ' + target, () => {
      const model = compatibilityModel();
      const original = model.fileSystem.realpathSync.bind(model.fileSystem);
      model.fileSystem.realpathSync = path => path === target ? target + '.alias' : original(path);
      assert.throws(() => instantiate(model), /canonical/);
      assert.equal(model.reads.includes(target), false);
    });
    compatibilityCheck(spec.name + ':special file refuses before read ' + target, () => {
      const model = compatibilityModel();
      const original = model.fileSystem.lstatSync.bind(model.fileSystem);
      model.fileSystem.lstatSync = path => { const stat = original(path); if (path === target) stat.isFile = () => false; return stat; };
      assert.throws(() => instantiate(model), /regular/);
      assert.equal(model.reads.includes(target), false);
    });
  }
  compatibilityCheck(spec.name + ':root ancestor symlink refuses all payload reads', () => {
    const model = compatibilityModel();
    model.memory.renameSync('/Users', '/moved-users');
    model.memory.symlinkSync('/moved-users', '/Users');
    assert.throws(() => instantiate(model), /regular/);
    assert.equal(model.reads.length, 0);
  });
  compatibilityCheck(spec.name + ':ancestor spelling refuses all payload reads', () => {
    const model = compatibilityModel();
    const original = model.fileSystem.readdirSync.bind(model.fileSystem);
    model.fileSystem.readdirSync = path => path === '/' ? ['users'] : original(path);
    assert.throws(() => instantiate(model), /spelling/);
    assert.equal(model.reads.length, 0);
  });
  compatibilityCheck(spec.name + ':owner selector change is not blessed', () => {
    const model = compatibilityModel();
    const data = JSON.parse(compatibilityBodies.get(owner));
    let selected = data;
    for (const key of spec.selector.slice(0, -1)) selected = selected[key];
    selected[spec.selector.at(-1)] = '0'.repeat(64);
    model.memory.writeFileSync(owner, JSON.stringify(data));
    assert.throws(() => instantiate(model), /size|hash|selector/);
    assert.equal(model.reads.includes(filename), false);
  });
  const configured = await compatibleESLint.calculateConfigForFile(filename);
  assert.equal(configured.rules[spec.finding.ruleId][0], 2);
  for (const neighbor of [filename + '.neighbor.ts', join(packageRoot, 'src/frozen-style-neighbor.ts')]) {
    const code = spec.finding.ruleId === 'prefer-const' ? 'export function run() { let value = 1; return value; }' : 'export const text = "' + String.fromCharCode(92) + '#";';
    const [result] = await compatibleESLint.lintText(code, { filePath: neighbor });
    assert.ok(result.messages.some(message => message.ruleId === spec.finding.ruleId && message.severity === 2));
    compatibilityResults.push({ name: spec.name + ':neighbor retains rule ' + neighbor, passed: true });
  }
  const [rejectedText] = await compatibleESLint.lintText(text + '\nexport let newFinding = 1;', { filePath: filename });
  assert.ok(rejectedText.messages.some(message => message.fatal && message.severity === 2 && /source text/.test(message.message)));
  compatibilityResults.push({ name: spec.name + ':native altered text remains fatal', passed: true });
}

function checkJqCompatibility() {
  const spec = jqCompatibilitySpec;
  const filename = join(packageRoot, spec.path);
  const owner = join(packageRoot, spec.owner.path);
  const text = compatibilityBodies.get(filename).toString('utf8');
  const instantiate = model => {
    const configurations = compatibilityModule.frozenStyleCompatibility(model.fileSystem);
    const legacySpecs = [...compatibilitySpecs, jqCompatibilitySpec];
    const styleMembers = JSON.parse(protectedStyleOwnerBytes.toString('utf8')).members;
    assert.equal(legacySpecs.length, 3);
    assert.equal(styleMembers.length, 22);
    const expected = [
      ...legacySpecs.map(record => ({ name: record.name, path: record.path, supportsAutofix: false })),
      ...styleMembers.map(member => ({ name: 'import-697ad-' + member.position, path: member.path, supportsAutofix: true })),
      { name: 'import-697ad-runtime704-intent', path: runtime704SourceBinding.path, supportsAutofix: false },
    ].map(record => ({
      name: 'safe-bash/frozen-style-' + record.name,
      files: ['packages/safe-bash/' + record.path],
      meta: { name: 'safe-bash/frozen-style-' + record.name, version: '1' },
      supportsAutofix: record.supportsAutofix,
    }));
    assert.equal(expected.length, 26);
    assert.equal(new Set(expected.map(record => record.name)).size, 26);
    assert.equal(new Set(expected.map(record => record.files[0])).size, 26);
    assert.equal(configurations.length, 26);
    assert.deepEqual(configurations.map(configuration => {
      assert.deepEqual(Object.keys(configuration).sort(), ['files', 'name', 'processor']);
      assert.equal(typeof configuration.processor.preprocess, 'function');
      assert.equal(typeof configuration.processor.postprocess, 'function');
      return { name: configuration.name, files: configuration.files, meta: configuration.processor.meta, supportsAutofix: configuration.processor.supportsAutofix };
    }), expected);
    const legacyConfigurations = configurations.filter(configuration => legacySpecs.some(record => configuration.name === 'safe-bash/frozen-style-' + record.name && configuration.files.length === 1 && configuration.files[0] === 'packages/safe-bash/' + record.path));
    assert.equal(legacyConfigurations.length, 3, 'three exact native processors are required');
    assert.deepEqual(legacyConfigurations.map(configuration => configuration.files), legacySpecs.map(record => ['packages/safe-bash/' + record.path]));
    assert.deepEqual(configurations[2].files, ['packages/safe-bash/' + spec.path]);
    return configurations[2].processor;
  };
  compatibilityCheck(spec.name + ':exact two findings and unchanged MJS block', () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    assert.equal(processor.supportsAutofix, false);
    assert.deepEqual(processor.preprocess(text, filename), [text]);
    assert.deepEqual(processor.postprocess([structuredClone(spec.findings)], filename), []);
    assert.throws(() => processor.postprocess([spec.findings], filename), /preprocess/);
    assert.ok(model.reads.includes(owner));
    assert.ok(model.reads.includes(filename));
  });
  for (const [index, finding] of spec.findings.entries()) {
    for (const field of Object.keys(finding)) compatibilityCheck(spec.name + ':tuple ' + index + ' drift ' + field, () => {
      const processor = instantiate(compatibilityModel());
      processor.preprocess(text, filename);
      const changed = structuredClone(spec.findings);
      delete changed[index][field];
      assert.throws(() => processor.postprocess([changed], filename), /exactly one/);
    });
    for (const [label, messages] of [
      ['missing', spec.findings.filter((_, position) => position !== index)],
      ['duplicate', [...spec.findings, finding]],
      ['extra field', spec.findings.map((entry, position) => position === index ? { ...entry, unexpected: true } : entry)],
    ]) compatibilityCheck(spec.name + ':tuple ' + index + ' ' + label + ' refuses', () => {
      const processor = instantiate(compatibilityModel());
      processor.preprocess(text, filename);
      assert.throws(() => processor.postprocess([messages], filename), /exactly one/);
    });
  }
  compatibilityCheck(spec.name + ':both findings required', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([[]], filename), /exactly one/);
  });
  compatibilityCheck(spec.name + ':diagnostic order is not a waiver', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    assert.deepEqual(processor.postprocess([[...spec.findings].reverse()], filename), []);
  });
  compatibilityCheck(spec.name + ':extras retain object identity order and severity', () => {
    const processor = instantiate(compatibilityModel());
    processor.preprocess(text, filename);
    const extras = [
      { ...spec.findings[0], line: 1, column: 1 },
      ...['no-unsafe-finally', 'no-undef', 'no-dupe-keys', 'no-empty'].map(ruleId => ({ ruleId, severity: 2, message: 'control', line: 1, column: 1 })),
      { ruleId: null, fatal: true, severity: 2, message: 'Parsing error', line: 1, column: 1 },
    ];
    const returned = processor.postprocess([[extras[0], spec.findings[0], ...extras.slice(1), spec.findings[1]]], filename);
    assert.deepEqual(returned, extras);
    for (const [index, message] of returned.entries()) assert.equal(message, extras[index]);
  });
  for (const changedName of [filename.toUpperCase(), filename.replace('/cases.mjs', '/CaSeS.mjs'), filename.replace('/tests/', '/tests/../tests/'), filename + '*', filename + '@(other)', filename + '/neighbor.mjs', ...['argv.ts', 'budget.ts', 'options.ts', 'sort.ts'].map(name => join(packageRoot, 'src/commands/XAN', name)), join(packageRoot, 'src/commands/XaN'), join(packageRoot, 'src/commands')]) compatibilityCheck(spec.name + ':filename admission ' + changedName, () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    const beforeReads = model.reads.length;
    assert.throws(() => processor.preprocess(text, changedName), /filename/);
    assert.equal(model.reads.length, beforeReads);
  });
  for (const target of [filename, owner]) {
    for (const [label, change] of [
      ['shorter', bytes => bytes.subarray(1)],
      ['longer', bytes => Buffer.concat([bytes, Buffer.from('x')])],
      ['ceiling', () => Buffer.alloc(target === owner ? 68940 : 65537)],
    ]) compatibilityCheck(spec.name + ':size ' + label + ' before read ' + target, () => {
      const model = compatibilityModel();
      model.memory.writeFileSync(target, change(compatibilityBodies.get(target)));
      assert.throws(() => instantiate(model), /size/);
      assert.equal(model.reads.includes(target), false);
    });
    compatibilityCheck(spec.name + ':hash drift ' + target, () => {
      const model = compatibilityModel();
      const bytes = Buffer.from(compatibilityBodies.get(target));
      bytes[0] ^= 1;
      model.memory.writeFileSync(target, bytes);
      assert.throws(() => instantiate(model), /hash/);
      if (target === owner) assert.equal(model.reads.includes(filename), false);
    });
    for (const [label, change] of [
      ['symlink', model => { model.memory.unlinkSync(target); model.memory.symlinkSync(join(packageRoot, 'src/commands/XAN/argv.ts'), target); }],
      ['hardlink', model => model.memory.linkSync(target, target + '.alias')],
      ['canonical alias', model => { const original = model.fileSystem.realpathSync.bind(model.fileSystem); model.fileSystem.realpathSync = name => name === target ? target + '.alias' : original(name); }],
      ['special', model => { const original = model.fileSystem.lstatSync.bind(model.fileSystem); model.fileSystem.lstatSync = name => { const stat = original(name); if (name === target) stat.isFile = () => false; return stat; }; }],
    ]) compatibilityCheck(spec.name + ':' + label + ' before read ' + target, () => {
      const model = compatibilityModel();
      change(model);
      assert.throws(() => instantiate(model), /regular|canonical|link/);
      assert.equal(model.reads.includes(target), false);
    });
  }
  compatibilityCheck(spec.name + ':owner drift after construction prevents source reread', () => {
    const model = compatibilityModel();
    const processor = instantiate(model);
    const beforeReads = model.reads.length;
    const bytes = Buffer.from(compatibilityBodies.get(owner));
    bytes[0] ^= 1;
    model.memory.writeFileSync(owner, bytes);
    assert.throws(() => processor.preprocess(text, filename), /hash/);
    assert.equal(model.reads.slice(beforeReads).includes(filename), false);
    assert.throws(() => processor.postprocess([spec.findings], filename), /preprocess/);
  });
  for (const [label, change] of [
    ['missing', data => { delete data.independent.caseSpecificationSha256; }],
    ['different', data => { data.independent.caseSpecificationSha256 = '0'.repeat(64); }],
  ]) compatibilityCheck(spec.name + ':owner selector ' + label + ' is not blessed', () => {
    const model = compatibilityModel();
    const data = JSON.parse(compatibilityBodies.get(owner));
    change(data);
    model.memory.writeFileSync(owner, JSON.stringify(data));
    assert.throws(() => instantiate(model), /size|hash|selector/);
    assert.equal(model.reads.includes(filename), false);
  });
  compatibilityCheck(spec.name + ':ancestor link refuses all payload', () => {
    const model = compatibilityModel();
    model.memory.renameSync('/Users', '/moved-users');
    model.memory.symlinkSync('/moved-users', '/Users');
    assert.throws(() => instantiate(model), /regular/);
    assert.equal(model.reads.length, 0);
  });
  compatibilityCheck(spec.name + ':case-insensitive ancestor alias refuses all payload', () => {
    const model = compatibilityModel();
    const original = model.fileSystem.readdirSync.bind(model.fileSystem);
    model.fileSystem.readdirSync = name => name === '/' ? ['uSeRs'] : original(name);
    assert.throws(() => instantiate(model), /spelling/);
    assert.equal(model.reads.length, 0);
  });
  compatibilityCheck(spec.name + ':preprocess state and text remain exact', () => {
    const processor = instantiate(compatibilityModel());
    assert.throws(() => processor.postprocess([spec.findings], filename), /preprocess/);
    assert.throws(() => processor.preprocess(text + '\n', filename), /source text/);
    processor.preprocess(text, filename);
    assert.throws(() => processor.preprocess(text, filename), /overlapping/);
    assert.throws(() => processor.postprocess([spec.findings], filename), /preprocess/);
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([spec.findings], filename + '.other'), /filename/);
    processor.preprocess(text, filename);
    assert.throws(() => processor.postprocess([spec.findings, []], filename), /single unchanged block/);
  });
  compatibilityCheck(spec.name + ':only the pinned JQ owner extends the old bound', () => {
    const parser = require('typescript');
    const syntax = parser.createSourceFile('factory.mjs', compatibilityModule.frozenStyleCompatibility.toString(), parser.ScriptTarget.Latest, true, parser.ScriptKind.JS);
    assert.equal(syntax.parseDiagnostics.length, 0);
    const factory = syntax.statements[0];
    const records = factory.body.statements.find(node => parser.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(syntax) === 'records').declarationList.declarations[0].initializer;
    const expectedOld = compatibilitySpecs.map(({ rawFinding, ...record }) => { assert.ok(rawFinding); return record; });
    const { rawFindings, ...expectedJq } = spec;
    assert.equal(rawFindings.length, 2);
    assert.deepEqual(JSON.parse(records.getText(syntax)), [...expectedOld, { ...expectedJq, ownerMaximumBytes: 68939 }]);
    const readBinding = factory.body.statements.find(node => parser.isFunctionDeclaration(node) && node.name.text === 'readBinding');
    assert.equal(readBinding.parameters[1].initializer.getText(syntax), '65536');
    const calls = [];
    function visit(node) {
      if (parser.isCallExpression(node) && node.expression.getText(syntax) === 'readBinding') calls.push(node.arguments.map(argument => argument.getText(syntax)));
      parser.forEachChild(node, visit);
    }
    visit(factory);
    assert.deepEqual(calls, [['protectedImportStyleBinding'], ['runtime704IntentBinding'], ['record.owner', 'record.ownerMaximumBytes ?? 65536'], ['record', 'record.sourceMaximumBytes ?? 65536']]);
  });
  compatibilityCheck(spec.name + ':all twenty declarations remain source sealed', () => {
    const parser = require('typescript');
    const syntax = parser.createSourceFile(filename, text, parser.ScriptTarget.Latest, true, parser.ScriptKind.JS);
    assert.equal(syntax.parseDiagnostics.length, 0);
    const statement = syntax.statements.find(node => parser.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(syntax) === 'cases'));
    const declaration = statement.declarationList.declarations.find(node => node.name.getText(syntax) === 'cases');
    assert.ok(parser.isArrayLiteralExpression(declaration.initializer));
    assert.equal(declaration.initializer.elements.length, 20);
    assert.equal(digest(Buffer.from(text)), spec.sha256);
    assert.equal(JSON.parse(compatibilityBodies.get(owner)).independent.caseSpecificationSha256, spec.sha256);
  });
}

checkJqCompatibility();
const jqFilename = join(packageRoot, jqCompatibilitySpec.path);
const jqConfigured = await compatibleESLint.calculateConfigForFile(jqFilename);
assert.equal(jqConfigured.rules['no-useless-escape'][0], 2);
assert.equal(jqConfigured.languageOptions.parser.name, 'espree');
assert.equal(jqConfigured.languageOptions.sourceType, 'module');
compatibilityResults.push({ name: jqCompatibilitySpec.name + ':native MJS parser and enabled rule', passed: true });
for (const neighbor of [jqFilename + '.neighbor.mjs', join(packageRoot, 'src/frozen-style-neighbor.mjs')]) {
  const code = 'export const text = "' + String.fromCharCode(92) + '#";';
  const [result] = await compatibleESLint.lintText(code, { filePath: neighbor });
  assert.ok(result.messages.some(message => message.ruleId === 'no-useless-escape' && message.severity === 2));
  compatibilityResults.push({ name: jqCompatibilitySpec.name + ':neighbor retains rule ' + neighbor, passed: true });
}
const [jqRejectedText] = await compatibleESLint.lintText(compatibilityBodies.get(jqFilename).toString('utf8') + '\nexport let newFinding = 1;', { filePath: jqFilename });
assert.ok(jqRejectedText.messages.some(message => message.fatal && message.severity === 2 && /source text/.test(message.message)));
compatibilityResults.push({ name: jqCompatibilitySpec.name + ':native altered text remains fatal', passed: true });
const frozenStyleCounts = compatibilityResults.filter(result => Object.hasOwn(result, 'accepted')).map(result => ({ name: result.name, raw: result.rawErrors, accepted: result.accepted }));
assert.deepEqual(frozenStyleCounts.map(result => [result.raw, result.accepted]), [[1, 1], [1, 1], [2, 2]]);

async function checkHeldBoundaryGlobalIgnore(configuration) {
  const selection = createLintSelection(repositoryRoot, configuration);
  const boundary = 'packages/safe-bash/src/commands/xan';
  const observations = [];
  const check = (name, action) => { action(); observations.push({ name: 'held boundary:' + name, passed: true }); };
  check('actual ConfigArray excludes the canonical directory', () => {
    assert.equal(selection.directoryIgnored(join(repositoryRoot, boundary)), true);
  });
  check('one literal global ignore, not a file-local waiver', () => {
    const global = configuration.filter(entry => Object.hasOwn(entry, 'ignores') && Object.keys(entry).every(key => key === 'name' || key === 'ignores'));
    assert.equal(global.flatMap(entry => entry.ignores).filter(pattern => pattern === boundary).length, 1);
  });
  const aliases = [
    'packages/safe-bash/src/commands/XAN',
    'packages/safe-bash/src/commands/XaN',
    'packages/SAFE-BASH/src/commands/xan',
  ];
  const filesystemCalls = [];
  const refuse = (...args) => { filesystemCalls.push(args); throw new Error('held control must not access the filesystem'); };
  const fileSystem = {
    constants: require('node:fs').constants,
    lstatSync: refuse, readdirSync: refuse, realpathSync: refuse,
    openSync: refuse, fstatSync: refuse, readSync: refuse, closeSync: refuse,
    readFileSync: refuse, readlinkSync: refuse,
  };
  const model = createLintInputGuard({ root: repositoryRoot, boundaries, fileSystem });
  check('held admission remains a zero-I/O denial', () => {
    assert.equal(model.isHeld(boundary), true);
    assert.throws(() => model.inspect(boundary), /held/);
    assert.deepEqual(filesystemCalls, []);
    assert.equal(model.snapshot().metadataOperations, 0);
    assert.equal(model.snapshot().readBytes, 0);
  });
  for (const alias of aliases) check('alias stays denied rather than globally waived ' + alias, () => {
    assert.equal(selection.directoryIgnored(join(repositoryRoot, alias)), false);
    const aliasModel = createLintInputGuard({ root: repositoryRoot, boundaries, fileSystem });
    assert.throws(() => aliasModel.isHeld(alias), /case alias/);
    assert.throws(() => aliasModel.inspect(alias), /case alias/);
    assert.equal(aliasModel.snapshot().metadataOperations, 0);
    assert.deepEqual(filesystemCalls, []);
  });
  for (const neighbor of [
    'packages/safe-bash/src/commands',
    'packages/safe-bash/src/commands/xan-neighbor',
    'packages/safe-bash/src/commands/xander',
    'packages/safe-bash/src/commands/xargs',
    'packages/safe-bash/src/commands/yq',
    'packages/safe-bash/src/commands/nested/xan',
    'packages/other/src/commands/xan',
  ]) check('synthetic neighboring directory stays admitted ' + neighbor, () => {
    assert.equal(selection.directoryIgnored(join(repositoryRoot, neighbor)), false);
    assert.equal(model.isHeld(neighbor), false);
  });
  for (const neighbor of [
    'packages/safe-bash/src/commands/xan-neighbor/control.mjs',
    'packages/safe-bash/src/commands/xander/control.mjs',
    'packages/safe-bash/src/commands/xargs/control.mjs',
    'packages/safe-bash/src/commands/xan.mjs',
  ]) {
    const [result] = await selection.eslint.lintText('unboundHeldNeighbor;', { filePath: join(repositoryRoot, neighbor) });
    assert.equal(result.fatalErrorCount, 0);
    assert.ok(result.messages.some(message => message.ruleId === 'no-undef' && message.severity === 2));
    observations.push({ name: 'held boundary:synthetic neighbor still fails lint ' + neighbor, passed: true });
  }
  check('synthetic checks never inspect or read held paths', () => {
    assert.deepEqual(filesystemCalls, []);
    const counters = model.snapshot();
    for (const key of ['metadataOperations', 'directories', 'entries', 'opens', 'closes', 'readCalls', 'readBytes']) assert.equal(counters[key], 0);
  });
  return observations;
}

export async function checkProtectedImportStyle({ configText, ownerBytes, sourceBodies, runnerText, intentOwnerBytes, intentSourceBytes }) {
  const { ESLint } = require('eslint');
  const { Volume, createFsFromVolume } = require('memfs');
  const { isDeepStrictEqual, parseArgs } = require('node:util');
  const observations = [];
  const check = (name, action) => {
    action();
    observations.push({ name: 'protected import style:' + name, passed: true });
  };
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const owner = JSON.parse(ownerBytes.toString('utf8'));
  const bindingStart = configText.indexOf('export const protectedImportStyleBinding = Object.freeze(');
  assert.ok(bindingStart >= 0, 'protected import style binding is required');
  const bindingJsonStart = configText.indexOf('{', bindingStart);
  const bindingJsonEnd = configText.indexOf('\n});', bindingJsonStart) + 2;
  const binding = JSON.parse(configText.slice(bindingJsonStart, bindingJsonEnd));
  const intentBindingStart = configText.indexOf('export const runtime704IntentBinding = Object.freeze(');
  assert.ok(intentBindingStart >= 0, 'separate runtime704 intent binding is required');
  const intentBindingJsonStart = configText.indexOf('{', intentBindingStart);
  const intentBindingJsonEnd = configText.indexOf('\n});', intentBindingJsonStart) + 2;
  const intentBinding = JSON.parse(configText.slice(intentBindingJsonStart, intentBindingJsonEnd));
  const intent = JSON.parse(intentOwnerBytes.toString('utf8'));
  const factoryStart = configText.indexOf('export function frozenStyleCompatibility(');
  const factoryEnd = configText.indexOf('\nfunction policyConfig(', factoryStart);
  assert.ok(factoryStart >= 0 && factoryEnd > factoryStart, 'exact factory boundaries required');
  const factoryText = configText.slice(factoryStart, factoryEnd).replace('export function ', 'function ');
  const recordsStart = factoryText.indexOf('  const records = ') + '  const records = '.length;
  const recordsEnd = factoryText.indexOf('\n  ];', recordsStart) + 4;
  const legacyRecords = JSON.parse(factoryText.slice(recordsStart, recordsEnd));
  const ownedRoot = '/protected-style-owned/packages/safe-bash';
  const legacyBodies = new Map();
  const legacyFixtures = legacyRecords.map((record, index) => {
    const text = Buffer.from('export const legacy' + index + ' = 1;\n');
    const fixture = { ...structuredClone(record), bytes: text.length, sha256: sha256(text) };
    const ownerData = {};
    let selected = ownerData;
    for (const key of fixture.selector.slice(0, -1)) {
      selected[key] = {};
      selected = selected[key];
    }
    selected[fixture.selector.at(-1)] = fixture.sha256;
    const bytes = Buffer.from(JSON.stringify(ownerData));
    fixture.owner = { ...fixture.owner, bytes: bytes.length, sha256: sha256(bytes) };
    legacyBodies.set(fixture.path, text);
    legacyBodies.set(fixture.owner.path, bytes);
    return fixture;
  });
  const fixtureFactoryText = factoryText.slice(0, recordsStart) + JSON.stringify(legacyFixtures) + factoryText.slice(recordsEnd);
  const bodies = new Map([...legacyBodies, [binding.path, ownerBytes], ...sourceBodies, [intentBinding.path, intentOwnerBytes], [intent.source.path, intentSourceBytes]]);
  const literal = candidate => {
    assert.equal(typeof candidate, 'string');
    assert.ok(candidate.length > 0 && !candidate.startsWith('/') && !candidate.includes('\\'));
    assert.ok(candidate.split('/').every(part => part && part !== '.' && part !== '..'));
    assert.ok(![...candidate].some(character => '*?[]{}!'.includes(character)));
  };
  const admitted = candidate => {
    literal(candidate);
    assert.ok(bodies.has(candidate), 'only owned exact fixture paths are admitted');
  };
  const model = (replacementOwner, replacementIntent) => {
    const modelBodies = new Map(bodies);
    const modelBinding = { ...binding };
    const modelIntentBinding = { ...intentBinding };
    if (replacementIntent) {
      const replacementBytes = Buffer.from(JSON.stringify(replacementIntent));
      modelBodies.set(intentBinding.path, replacementBytes);
      Object.assign(modelIntentBinding, { bytes: replacementBytes.length, sha256: sha256(replacementBytes) });
    }
    if (replacementOwner) {
      const replacementBytes = Buffer.from(JSON.stringify(replacementOwner));
      modelBodies.set(binding.path, replacementBytes);
      Object.assign(modelBinding, { bytes: replacementBytes.length, sha256: sha256(replacementBytes) });
    }
    const memory = createFsFromVolume(Volume.fromJSON(Object.fromEntries([...modelBodies].map(([relative, bytes]) => [join(ownedRoot, relative), bytes.toString('utf8')]))));
    const reads = [];
    const fileSystem = { ...memory, readFileSync(filename) {
      const relative = filename.slice(ownedRoot.length + 1);
      assert.ok(filename.startsWith(ownedRoot + '/') && bodies.has(relative), 'unapproved owned read');
      reads.push(relative);
      return memory.readFileSync(filename);
    } };
    const boundedRead = (root, relative, maximum, suppliedFileSystem) => {
      assert.equal(root, ownedRoot);
      admitted(relative);
      assert.equal(suppliedFileSystem, fileSystem);
      assert.ok(Number.isSafeInteger(maximum) && maximum >= 0 && (maximum <= 65536 || (relative === intent.source.path && maximum === 101847 && intent.source.sha256 === 'cd040f35dfe77b10cfe26d446f3802d54050b132e6b053198a426f9453f4015e')));
      const bytes = fileSystem.readFileSync(join(root, relative));
      assert.ok(bytes.length <= maximum);
      return bytes;
    };
    const factory = new Function('assert', 'createHash', 'join', 'resolve', 'isDeepStrictEqual', 'safeBashRoot', 'protectedImportStyleBinding', 'runtime704IntentBinding', 'assertAdmittedInputPath', 'assertLiteralInputPath', 'readRegularInput', fixtureFactoryText + '\nreturn frozenStyleCompatibility;')(assert, createHash, join, resolve, isDeepStrictEqual, ownedRoot, modelBinding, modelIntentBinding, admitted, literal, boundedRead);
    return { memory, fileSystem, reads, instantiate: () => factory(fileSystem, {}), replacePinnedOwner(changedOwner) {
      const bytes = Buffer.from(JSON.stringify(changedOwner));
      Object.assign(modelBinding, { bytes: bytes.length, sha256: sha256(bytes) });
      memory.writeFileSync(join(ownedRoot, binding.path), bytes);
    } };
  };
  const expectedPositions = [17, 18, 307, 308, 309, 310, 313, 314, 315, 316, 317, 318, 344, 345, 346, 347, 348, 349, 350, 351, 388, 389];
  check('exact finite owner and complete diagnostic counts', () => {
    assert.equal(binding.bytes, ownerBytes.length);
    assert.equal(binding.sha256, sha256(ownerBytes));
    assert.ok(binding.bytes <= 65536);
    assert.equal(owner.version, 1);
    assert.equal(owner.authority.kind, 'current-root-import-origin-style-policy');
    assert.equal(owner.authority.sourceChangesAuthorized, false);
    assert.equal(owner.authority.supportRetirement, false);
    assert.equal(owner.authority.semanticDiagnosticsAccepted, false);
    assert.equal(owner.authority.historicalFreezeOwnerClaim, false);
    assert.equal(owner.authority.harmlessnessClaim, false);
    assert.deepEqual(owner.members.map(member => member.position), expectedPositions);
    assert.equal(new Set(owner.members.map(member => member.path)).size, 22);
    assert.equal(sourceBodies.size, 22);
    assert.equal(owner.members.reduce((total, member) => total + member.findings.length, 0), 34);
    assert.ok(owner.members.every(member => member.findings.every(finding => finding.multiplicity === 1 && finding.diagnostic.ruleId === 'no-unused-vars' && finding.diagnostic.severity === 2 && finding.diagnostic.suggestions.length > 0)));
  });
  check('old three settings and source association remain separate', () => {
    const entries = model().instantiate();
    assert.equal(entries.length, 26);
    for (const entry of entries.slice(0, 3)) assert.equal(entry.processor.supportsAutofix, false);
    for (const [index, member] of owner.members.entries()) {
      assert.deepEqual(entries[index + 3].files, ['packages/safe-bash/' + member.path]);
      assert.equal(entries[index + 3].processor.supportsAutofix, true);
      assert.equal(member.origin.sourcePath, member.path);
      const bytes = sourceBodies.get(member.path);
      assert.equal(bytes.length, member.bytes);
      assert.equal(sha256(bytes), member.sha256);
      assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), member.origin.blobOid);
    }
  });
  for (const [label, mutate, expected] of [
    ['origin commit', changed => { changed.origin.sourceCommit = '0'.repeat(40); }, /origin changed/],
    ['origin path', changed => { changed.members[0].origin.sourcePath += '.neighbor'; }, /origin path/],
    ['origin mode', changed => { changed.members[0].origin.mode = '100755'; }, /origin mode/],
    ['origin blob', changed => { changed.members[0].origin.blobOid = '0'.repeat(40); }, /original blob/],
    ['member role', changed => { changed.members[0].role = 'archival'; }, /role changed/],
    ['member count', changed => { changed.members.pop(); }, /membership changed/],
    ['diagnostic multiplicity', changed => { changed.members[0].findings[0].multiplicity = 2; }, /diagnostic scope/],
    ['diagnostic rule', changed => { changed.members[0].findings[0].diagnostic.ruleId = 'no-ex-assign'; }, /diagnostic scope/],
    ['semantic authority', changed => { changed.authority.semanticDiagnosticsAccepted = true; }, /authority changed/],
  ]) check('authenticated owner fixture rejects ' + label, () => {
    const changed = structuredClone(owner);
    mutate(changed);
    assert.throws(() => model(changed).instantiate(), expected);
  });
  check('owner symlink is refused before any source payload', () => {
    const state = model();
    const filename = join(ownedRoot, binding.path);
    state.memory.unlinkSync(filename);
    state.memory.symlinkSync('/owned-denied-owner', filename);
    assert.throws(() => state.instantiate(), /regular/);
    assert.deepEqual(state.reads, []);
  });
  check('missing owner is refused before any source payload', () => {
    const state = model();
    state.memory.unlinkSync(join(ownedRoot, binding.path));
    assert.throws(() => state.instantiate());
    assert.deepEqual(state.reads, []);
  });
  check('captured owner association refuses a repinned synthetic successor before source', () => {
    const state = model();
    const processor = state.instantiate()[3].processor;
    const changed = structuredClone(owner);
    changed.members[0].origin.parentTree = '0'.repeat(40);
    state.replacePinnedOwner(changed);
    state.reads.length = 0;
    const member = owner.members[0];
    assert.throws(() => processor.preprocess(sourceBodies.get(member.path).toString('utf8'), join(ownedRoot, member.path)), /association changed/);
    assert.deepEqual(state.reads, [binding.path]);
  });
  for (const [index, record] of legacyFixtures.entries()) check('legacy processor behavior retained ' + record.name, () => {
    const state = model();
    const processor = state.instantiate()[index].processor;
    const filename = join(ownedRoot, record.path);
    const text = legacyBodies.get(record.path).toString('utf8');
    assert.deepEqual(processor.preprocess(text, filename), [text]);
    const extra = { ruleId: 'no-unsafe-finally', severity: 2, message: 'owned retained semantic sentinel', line: 900, column: 1 };
    assert.deepEqual(processor.postprocess([[(record.findings ?? [record.finding]), extra].flat()], filename), [extra]);
    assert.equal(processor.supportsAutofix, false);
  });
  check('only runtime704 receives the exact source bound; owners retain old defaults', () => {
    const parser = require('typescript');
    const syntax = parser.createSourceFile('owned-factory.mjs', factoryText, parser.ScriptTarget.Latest, true, parser.ScriptKind.JS);
    assert.equal(syntax.parseDiagnostics.length, 0);
    const factory = syntax.statements[0];
    const readBinding = factory.body.statements.find(node => parser.isFunctionDeclaration(node) && node.name.text === 'readBinding');
    assert.equal(readBinding.parameters[1].initializer.getText(syntax), '65536');
    const explicitSourceBounds = [];
    function visit(node) {
      if (parser.isPropertyAssignment(node) && node.name.getText(syntax) === 'sourceMaximumBytes') explicitSourceBounds.push(node.initializer.getText(syntax));
      parser.forEachChild(node, visit);
    }
    visit(factory);
    assert.deepEqual(explicitSourceBounds, ['101847']);
    assert.ok(legacyRecords.every(record => !Object.hasOwn(record, 'sourceMaximumBytes')));
    assert.deepEqual(legacyRecords.filter(record => Object.hasOwn(record, 'ownerMaximumBytes')).map(record => [record.name, record.ownerMaximumBytes]), [['jq-case-specification', 68939]]);
    assert.ok(owner.members.every(member => member.bytes <= 65536));
    assert.ok(ownerBytes.length <= 65536 && intentOwnerBytes.length <= 65536);
  });
  const nativeConfig = [{ files: ['**/*.js', '**/*.mjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }] } }];
  const rawESLint = new ESLint({ cwd: '/protected-style-owned', overrideConfigFile: true, overrideConfig: nativeConfig, fix: false });
  const filteredESLint = new ESLint({ cwd: '/protected-style-owned', overrideConfigFile: true, overrideConfig: [...nativeConfig, ...model().instantiate()], fix: false });
  for (const [index, member] of owner.members.entries()) {
    const filename = join(ownedRoot, member.path);
    const bytes = sourceBodies.get(member.path);
    const text = bytes.toString('utf8');
    const messages = member.findings.map(finding => finding.diagnostic);
    const [raw] = await rawESLint.lintText(text, { filePath: filename });
    const [filtered] = await filteredESLint.lintText(text, { filePath: filename });
    check('native full tuple match position ' + member.position, () => {
      assert.deepEqual(raw.messages, messages);
      assert.equal(raw.errorCount, messages.length);
      assert.equal(raw.fatalErrorCount, 0);
      assert.equal(raw.output, undefined);
      assert.deepEqual(filtered.messages, []);
      assert.equal(filtered.errorCount, 0);
      assert.equal(filtered.output, undefined);
      assert.equal(sha256(bytes), member.sha256);
    });
    const prepare = () => {
      const state = model();
      const processor = state.instantiate()[index + 3].processor;
      const originalBytes = Buffer.from(bytes);
      assert.deepEqual(processor.preprocess(text, filename), [text]);
      assert.deepEqual(bytes, originalBytes);
      return { state, processor };
    };
    check('unmatched semantic and same-rule findings retained position ' + member.position, () => {
      const { processor } = prepare();
      const extras = [{ ruleId: 'no-unsafe-finally', severity: 2, message: 'owned semantic sentinel', line: 900, column: 1 }, { ...structuredClone(messages[0]), line: 901 }];
      assert.deepEqual(processor.postprocess([[...messages, ...extras]], filename), extras);
      assert.throws(() => processor.postprocess([messages], filename), /preprocess/);
    });
    for (const [kind, transform] of [['missing', values => values.slice(1)], ['duplicate', values => [...values, values[0]]]]) check(kind + ' diagnostic refuses position ' + member.position, () => {
      const { processor } = prepare();
      assert.throws(() => processor.postprocess([transform(structuredClone(messages))], filename), /exactly one/);
    });
    for (const field of Object.keys(messages[0])) check('full tuple field ' + field + ' refuses position ' + member.position, () => {
      const { processor } = prepare();
      const changed = structuredClone(messages);
      changed[0][field] = typeof changed[0][field] === 'number' ? changed[0][field] + 1 : 'changed';
      assert.throws(() => processor.postprocess([changed], filename), /exactly one/);
    });
    for (const field of ['range', 'text']) check('suggestion ' + field + ' refuses position ' + member.position, () => {
      const { processor } = prepare();
      const changed = structuredClone(messages);
      if (field === 'range') changed[0].suggestions[0].fix.range[0]++;
      else changed[0].suggestions[0].fix.text += 'changed';
      assert.throws(() => processor.postprocess([changed], filename), /exactly one/);
    });
    check('source drift refuses position ' + member.position, () => {
      const state = model();
      const processor = state.instantiate()[index + 3].processor;
      const changed = Buffer.from(bytes);
      changed[0] ^= 1;
      state.memory.writeFileSync(filename, changed);
      assert.throws(() => processor.preprocess(text, filename), /hash/);
    });
    check('owner is freshly authenticated before source position ' + member.position, () => {
      const state = model();
      const processor = state.instantiate()[index + 3].processor;
      const changed = Buffer.from(ownerBytes);
      changed[0] ^= 1;
      state.memory.writeFileSync(join(ownedRoot, binding.path), changed);
      state.reads.length = 0;
      assert.throws(() => processor.preprocess(text, filename), /hash/);
      assert.deepEqual(state.reads, [binding.path]);
    });
    check('filename alias refuses before content position ' + member.position, () => {
      const state = model();
      const processor = state.instantiate()[index + 3].processor;
      state.reads.length = 0;
      assert.throws(() => processor.preprocess(text, filename.toUpperCase()), /filename/);
      assert.deepEqual(state.reads, []);
    });
    check('source symlink refuses without content position ' + member.position, () => {
      const state = model();
      const processor = state.instantiate()[index + 3].processor;
      state.memory.unlinkSync(filename);
      state.memory.symlinkSync('/owned-denied-target', filename);
      state.reads.length = 0;
      assert.throws(() => processor.preprocess(text, filename), /regular/);
      assert.deepEqual(state.reads, [binding.path]);
    });
  }
  const member = owner.members[2];
  const filename = join(ownedRoot, member.path);
  const unchanged = Buffer.from(sourceBodies.get(member.path));
  const extraESLint = new ESLint({ cwd: '/protected-style-owned', overrideConfigFile: true, overrideConfig: [...nativeConfig, { rules: { semi: ['error', 'never'] } }, ...model().instantiate()], fix: false });
  const [extra] = await extraESLint.lintText(unchanged.toString('utf8'), { filePath: filename });
  check('autofixable extras remain unapplied with fix false', () => {
    assert.ok(extra.messages.some(message => message.ruleId === 'semi' && message.fix));
    assert.ok(extra.fixableErrorCount > 0);
    assert.ok(extra.errorCount > 0);
    assert.equal(extra.output, undefined);
    assert.deepEqual(sourceBodies.get(member.path), unchanged);
  });
  const neighbor = join(ownedRoot, 'tests/owned-protected-style-neighbor.mjs');
  const [neighborResult] = await filteredESLint.lintText('const unusedNeighbor = 1;\n', { filePath: neighbor });
  check('ordinary neighboring unused binding remains an error', () => {
    assert.equal(neighborResult.errorCount, 1);
    assert.equal(neighborResult.messages[0].ruleId, 'no-unused-vars');
  });
  const baselinePath = join(ownedRoot, intent.source.path);
  const intentMessages = intent.findings.map(finding => finding.diagnostic);
  const intentRules = [...nativeConfig, { rules: { 'require-yield': 'error', 'no-ex-assign': 'error' } }];
  const rawIntentESLint = new ESLint({ cwd: '/protected-style-owned', overrideConfigFile: true, overrideConfig: intentRules, fix: false });
  const filteredIntentESLint = new ESLint({ cwd: '/protected-style-owned', overrideConfigFile: true, overrideConfig: [...intentRules, ...model().instantiate()], fix: false });
  const [rawIntent] = await rawIntentESLint.lintText(intentSourceBytes.toString('utf8'), { filePath: baselinePath });
  const [filteredIntent] = await filteredIntentESLint.lintText(intentSourceBytes.toString('utf8'), { filePath: baselinePath });
  check('runtime704 separate two-intent owner and exact native tuples', () => {
    assert.equal(intentOwnerBytes.length, intentBinding.bytes);
    assert.equal(sha256(intentOwnerBytes), intentBinding.sha256);
    assert.ok(intentBinding.bytes <= 65536);
    assert.equal(intentSourceBytes.length, 101847);
    assert.equal(sha256(intentSourceBytes), intent.source.sha256);
    assert.equal(intent.authority.kind, 'current-root-characterized-intent-policy');
    assert.equal(intent.role, 'active-runtime-implementation');
    assert.equal(intent.authority.wholeRuntimeClearance, false);
    assert.deepEqual(rawIntent.messages, intentMessages);
    assert.equal(rawIntent.errorCount, 2);
    assert.equal(rawIntent.output, undefined);
    assert.deepEqual(filteredIntent.messages, []);
    assert.equal(filteredIntent.errorCount, 0);
    assert.equal(filteredIntent.output, undefined);
    assert.ok(intentMessages.every(message => !Object.hasOwn(message, 'fix') && !Object.hasOwn(message, 'suggestions')));
    assert.equal(model().instantiate()[25].processor.supportsAutofix, false);
  });
  const prepareIntent = () => {
    const state = model();
    const processor = state.instantiate()[25].processor;
    assert.deepEqual(processor.preprocess(intentSourceBytes.toString('utf8'), baselinePath), [intentSourceBytes.toString('utf8')]);
    return { state, processor };
  };
  for (const [index, message] of intentMessages.entries()) {
    for (const field of Object.keys(message)) check('runtime704 full tuple ' + index + ' field ' + field + ' drift refuses', () => {
      const { processor } = prepareIntent();
      const changed = structuredClone(intentMessages);
      changed[index][field] = typeof changed[index][field] === 'number' ? changed[index][field] + 1 : 'changed';
      assert.throws(() => processor.postprocess([changed], baselinePath), /exactly one/);
    });
    for (const [label, values] of [['missing', intentMessages.filter((_, position) => position !== index)], ['duplicate', [...intentMessages, message]]]) check('runtime704 ' + label + ' tuple ' + index + ' refuses', () => {
      const { processor } = prepareIntent();
      assert.throws(() => processor.postprocess([values], baselinePath), /exactly one/);
    });
  }
  check('runtime704 swapped site coordinates refuse', () => {
    const { processor } = prepareIntent();
    const changed = structuredClone(intentMessages);
    [changed[0].line, changed[1].line] = [changed[1].line, changed[0].line];
    assert.throws(() => processor.postprocess([changed], baselinePath), /exactly one/);
  });
  check('runtime704 extra core and same-rule semantic findings remain errors', () => {
    const { processor } = prepareIntent();
    const extras = [{ ruleId: 'no-unsafe-finally', severity: 2, message: 'owned unmatched semantic sentinel', line: 900, column: 1 }, { ...intentMessages[0], line: 901 }, { ...intentMessages[1], line: 902 }];
    assert.deepEqual(processor.postprocess([[...intentMessages, ...extras]], baselinePath), extras);
  });
  check('runtime704 source mutation fails closed', () => {
    const state = model();
    const processor = state.instantiate()[25].processor;
    const changed = Buffer.from(intentSourceBytes);
    changed[0] ^= 1;
    state.memory.writeFileSync(baselinePath, changed);
    assert.throws(() => processor.preprocess(intentSourceBytes.toString('utf8'), baselinePath), /hash/);
  });
  check('runtime704 exact source size refuses an extra byte before source payload', () => {
    const state = model();
    const processor = state.instantiate()[25].processor;
    state.memory.writeFileSync(baselinePath, Buffer.concat([intentSourceBytes, Buffer.from(' ')]));
    state.reads.length = 0;
    assert.throws(() => processor.preprocess(intentSourceBytes.toString('utf8'), baselinePath), /size/);
    assert.deepEqual(state.reads, [intentBinding.path]);
  });
  check('runtime704 owner mutation refuses before source payload', () => {
    const state = model();
    const processor = state.instantiate()[25].processor;
    const changed = Buffer.from(intentOwnerBytes);
    changed[0] ^= 1;
    state.memory.writeFileSync(join(ownedRoot, intentBinding.path), changed);
    state.reads.length = 0;
    assert.throws(() => processor.preprocess(intentSourceBytes.toString('utf8'), baselinePath), /hash/);
    assert.deepEqual(state.reads, [intentBinding.path]);
  });
  for (const alias of [baselinePath.toUpperCase(), baselinePath + '.neighbor', join(ownedRoot, owner.members[0].path)]) check('runtime704 path/contract swap refuses ' + alias, () => {
    const state = model();
    const processor = state.instantiate()[25].processor;
    state.reads.length = 0;
    assert.throws(() => processor.preprocess(intentSourceBytes.toString('utf8'), alias), /filename/);
    assert.deepEqual(state.reads, []);
  });
  for (const [label, mutate, expected] of [
    ['source hash', changed => { changed.source.sha256 = '0'.repeat(64); }, /source binding/],
    ['source path', changed => { changed.source.path += '.neighbor'; }, /source binding/],
    ['source bound', changed => { changed.source.bytes++; }, /source binding/],
    ['original blob', changed => { changed.origin.blobOid = '0'.repeat(40); }, /original blob/],
    ['diagnostic rule', changed => { changed.findings[0].diagnostic.ruleId = 'no-unsafe-finally'; }, /diagnostic scope/],
    ['whole-runtime authority', changed => { changed.authority.wholeRuntimeClearance = true; }, /authority/],
  ]) check('runtime704 authenticated owner fixture rejects ' + label, () => {
    const changed = structuredClone(intent);
    mutate(changed);
    assert.throws(() => model(undefined, changed).instantiate(), expected);
  });
  const argumentStart = runnerText.indexOf('export function parseLintArguments(');
  const argumentEnd = runnerText.indexOf('\nexport async function lintRoot(', argumentStart);
  assert.ok(argumentStart >= 0 && argumentEnd > argumentStart, 'exact runner argument function required');
  const parseArguments = new Function('assert', 'parseArgs', runnerText.slice(argumentStart, argumentEnd).replace('export function ', 'function ') + '\nreturn parseLintArguments;')(assert, parseArgs);
  for (const flag of ['--fix', '--fix-dry-run']) check('root runner rejects ' + flag + ' before initialization', () => {
    assert.throws(() => parseArguments([flag]), /Unknown option/);
    const mainStart = runnerText.indexOf('export async function main(');
    const parseCall = runnerText.indexOf('parseLintArguments(argv)', mainStart);
    const guardCall = runnerText.indexOf('createLintInputGuard(', mainStart);
    assert.ok(mainStart >= 0 && parseCall > mainStart && guardCall > parseCall);
  });
  check('retained runner arguments still accepted', () => {
    assert.deepEqual(parseArguments([]), { format: 'stylish', maxWarnings: -1 });
    assert.deepEqual(parseArguments(['--format=json', '--max-warnings=0']), { format: 'json', maxWarnings: 0 });
  });
  return { passed: observations.length, isolatedRawStyleErrors: 34, isolatedAcceptedStyleErrors: 34, isolatedRawIntentErrors: 2, isolatedAcceptedIntentErrors: 2, prospectiveStyleContractDerivedAccepted: 38, prospectiveIntentAccepted: 2, prospectiveCompatibilityAccepted: 40, actualRootConfigurationInitializedByThisFunction: false, observations };
}

const protectedImportStyleResults = await checkProtectedImportStyle({
  configText: configBytes.toString('utf8'),
  ownerBytes: protectedStyleOwnerBytes,
  sourceBodies: protectedStyleSourceBodies,
  intentOwnerBytes: runtime704OwnerBytes,
  intentSourceBytes: runtime704SourceBytes,
  runnerText: wiringBindings.find(binding => binding.path === 'scripts/lint-eslint.mjs').bytes.toString('utf8'),
});

const heldBoundaryResults = await checkHeldBoundaryGlobalIgnore(compatibilityModule.default);

assert.ok(readRegular(configPath, 300000).equals(configBytes), 'ESLint configuration changed during controls');
assert.ok(readRegular(inventoryPath, 535875).equals(inventoryBytes), 'Frozen inventory changed during controls');
for (const binding of wiringBindings) assert.ok(guard.read(binding.path, 'configuration').equals(binding.bytes), 'Guarded wiring changed during controls: ' + binding.path);
const policyMarkers = [
  ["ecmaVersion: 'latest'", 'Package-only modern JavaScript syntax'],
  ["'no-empty': ['error', { allowEmptyCatch: true }]", 'Empty catches only; ordinary empty blocks remain checked'],
  ["allowRegexCharacters", 'Only slash, opening bracket and hyphen regex escapes; string escapes remain checked'],
  ["safe-bash/deferred-construction", 'Three exact deferred-initialization source files'],
  ["safe-bash/cancellation-cleanup-sentinel", 'Exact cleanup-before-acquisition boundary; raw cleanup finding has separate frozen-style compatibility'],
  ['"name": "cancellation-cleanup"', 'One source/owner-bound cleanup style finding; no rule waiver'],
  ['"name": "holdout-string-escape"', 'One source/owner-bound oracle-input style finding; no fixture exclusion'],
  ["safe-bash/webdav-options-type-control", 'Exact sealed empty-object relation; all ten negative assertions retained'],
  ["name: 'generator-session'", 'Exact lexical session owners in generators'],
  ["name: 'stream-adapter'", 'Exact stream adapter owner'],
  ["name: 'stream-and-accessor-filesystem'", 'Exact filesystem owners in stream/accessor callbacks'],
  ["name: 'ancestor-traversal'", 'Mutable owner ancestor cursor'],
  ["name: 'proxy-mutation-monitor'", 'Proxy callback owner'],
  ["name: 'worker-receiver-observation'", 'Worker receiver observation fixture'],
  ["name: 'invocation-receiver-observation'", 'Invocation receiver observation fixture'],
  ["name: 'first-read-fixture-owner'", 'First-read lifecycle fixture owner'],
  ["safe-bash/throw-only-stream-fixtures", 'Eleven exact throw-only stream fixture files'],
  ["safe-bash/suspended-stream-fixtures", 'Three exact suspended-stream fixture files'],
];
const lines = configBytes.toString('utf8').split('\n');
const policyLocations = policyMarkers.map(([marker, role]) => {
  const index = lines.findIndex(line => line.includes(marker));
  assert.ok(index >= 0, marker);
  return { path: 'eslint.config.js', line: index + 1, role, text: lines[index].trim() };
});
const eslintVersion = JSON.parse(readRegular(require.resolve('eslint/package.json'), 30000)).version;
const schemas = Object.fromEntries(['no-useless-escape', 'prefer-const', 'require-yield'].map(name => [name, builtinRules.get(name).meta.schema]));
console.log(JSON.stringify({
  version: 1,
  capturedAt: new Date().toISOString(),
  command: 'node packages/safe-bash/integration-lint-audit/config-controls.mjs "$PWD"',
  node: process.version,
  eslint: eslintVersion,
  execution: 'ESLint lintText only; synthetic inputs are never written or executed; no product tests or publication',
  config: { path: 'eslint.config.js', bytes: configBytes.length, sha256: digest(configBytes) },
  guardedWiring: wiringBindings.map(binding => ({ path: binding.path, bytes: binding.bytes.length, sha256: digest(binding.bytes) })),
  inventory: { path: 'packages/safe-bash/integration-lint-inventory.json', bytes: inventoryBytes.length, sha256: digest(inventoryBytes), counts: inventoryCounts },
  policyLocations,
  schemas,
  passed: results.length + fixtureResults.length + compatibilityResults.length + heldBoundaryResults.length + protectedImportStyleResults.passed,
  protectedImportStyleResults,
  heldBoundaryResults,
  compatibilityResults,
  acceptedFrozenStyleFindings: frozenStyleCounts.reduce((total, result) => total + result.accepted, 0),
  rawFrozenStyleFindings: frozenStyleCounts.reduce((total, result) => total + result.raw, 0),
  frozenStyleCounts,
  rawRuleValidation: 'Original 82 controls retain all rules with only the compatibility processor bypassed; new controls exercise native processors.',
  syntheticPassed: results.length,
  fixturePassed: fixtureResults.length,
  frozenFixtureContentReads,
  typeAssertionPreservation,
  fixtureResults,
  failed: 0,
  results,
}, null, 2));
