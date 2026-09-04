import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initializeLintConfiguration } from './scripts/lint-input-guard.mjs';
import { assertAdmittedInputPath, assertLiteralInputPath, readRegularInput } from './packages/safe-bash/scripts/typecheck-integration-inputs.mjs';

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const jsFiles = ['**/*.js', '**/*.cjs', '**/*.mjs'];
const safeBashRoot = fileURLToPath(new URL('./packages/safe-bash/', import.meta.url));


export const protectedImportStyleBinding = Object.freeze({
  "path": "integration-lint-audit/import-697ad-protected-style.json",
  "bytes": 27000,
  "sha256": "ea8b3b138e97e752a19d27e142d45b4b082db49d73da705cbdbcfbe453f81c53"
});

export const runtime704IntentBinding = Object.freeze({
  "path": "integration-lint-audit/import-697ad-runtime704-intent.json",
  "bytes": 2967,
  "sha256": "88b6126422756fafb26db6ea6b90abd96e705cd2dd2fda2ee0ee45b9696d343f"
});

export function frozenStyleCompatibility(fileSystem = lintInputGuard.fileSystem, boundaries = safeBashBoundaries) {
  const records = [
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
      }
    },
    {
      "name": "jq-case-specification",
      "path": "tests/commands/structured-stress/jq-42-independent-review/cases.mjs",
      "bytes": 3616,
      "sha256": "70270b9df9a3e407106d7facec5de7432cd34fdc750b65a682566eddedb66b8d",
      "owner": {
        "path": "tests/commands/structured-stress/jq-42-independent-review/manifest.json",
        "bytes": 68939,
        "sha256": "f4636b95d52c78b118c5eebc4a802ccf13d63a8a43c460f55da91e9f4e6ceacb"
      },
      "ownerMaximumBytes": 68939,
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
      ]
    }
  ];
  const root = resolve(safeBashRoot);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  function readBinding(binding, maximumBytes = 65536) {
    assertAdmittedInputPath(binding.path, boundaries);
    const absolute = join(root, binding.path);
    assertLiteralInputPath(absolute.slice(1));
    let directory = '/';
    const parts = absolute.slice(1).split('/');
    for (const [index, part] of parts.entries()) {
      assert.ok(fileSystem.readdirSync(directory).includes(part), 'frozen style input spelling changed');
      directory = join(directory, part);
      const stat = fileSystem.lstatSync(directory);
      assert.ok(!stat.isSymbolicLink(), 'frozen style input must be regular');
      if (index === parts.length - 1) {
        assert.ok(stat.isFile() && stat.nlink === 1, 'frozen style input must be a regular single-link file');
        assert.ok(stat.size === binding.bytes && stat.size <= maximumBytes, 'frozen style input size changed');
      } else assert.ok(stat.isDirectory(), 'frozen style ancestor must be regular');
    }
    assert.equal(fileSystem.realpathSync(absolute), absolute, 'frozen style input must be canonical');
    const bytes = readRegularInput(root, binding.path, binding.bytes, fileSystem, boundaries);
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === binding.bytes, 'frozen style input size changed');
    assert.equal(hash(bytes), binding.sha256, 'frozen style input hash changed');
    return bytes;
  }
  const importedOwner = JSON.parse(readBinding(protectedImportStyleBinding));
  assert.equal(importedOwner.version, 1, 'protected import style owner version changed');
  assert.deepEqual(importedOwner.authority, {
    kind: 'current-root-import-origin-style-policy',
    acceptedDiagnostics: 34,
    protectedFiles: 22,
    sourceChangesAuthorized: false,
    supportRetirement: false,
    historicalFreezeOwnerClaim: false,
    harmlessnessClaim: false,
    semanticDiagnosticsAccepted: false,
  }, 'protected import style authority changed');
  assert.deepEqual(importedOwner.origin, {
    sourceCommit: '697ad092de111642aa376f74560da9927a0c9512',
    sourceRootTree: 'f47aa740fda10dab5eeb3674f4229865baaafc53',
  }, 'protected import style origin changed');
  assert.deepEqual(importedOwner.members.map(member => member.position), [17, 18, 307, 308, 309, 310, 313, 314, 315, 316, 317, 318, 344, 345, 346, 347, 348, 349, 350, 351, 388, 389], 'protected import style membership changed');
  assert.equal(new Set(importedOwner.members.map(member => member.path)).size, 22, 'protected import style paths must be unique');
  const importedRecords = importedOwner.members.map((member, index) => {
    assert.deepEqual(Object.keys(member).sort(), ['position', 'path', 'role', 'bytes', 'sha256', 'origin', 'proofSelector', 'findings'].sort(), 'protected import style member shape changed');
    assert.equal(member.role, index < 2 ? 'active-composite-runtime-regression' : 'active-copied-runtime', 'protected import style role changed');
    assert.equal(member.origin.sourcePath, member.path, 'protected import style origin path changed');
    assert.equal(member.origin.mode, '100644', 'protected import style origin mode changed');
    assert.equal(member.findings.length, index < 2 ? 7 : 1, 'protected import style finding count changed');
    assert.ok(member.findings.every(finding => finding.multiplicity === 1 && finding.diagnostic.ruleId === 'no-unused-vars' && finding.diagnostic.severity === 2 && Array.isArray(finding.diagnostic.suggestions)), 'protected import style diagnostic scope changed');
    return {
      name: 'import-697ad-' + member.position,
      path: member.path,
      bytes: member.bytes,
      sha256: member.sha256,
      owner: protectedImportStyleBinding,
      selector: ['members', String(index)],
      importedMember: member,
      preserveSuggestionMetadata: true,
      findings: member.findings.map(finding => finding.diagnostic),
    };
  });
  const runtimeIntentOwner = JSON.parse(readBinding(runtime704IntentBinding));
  assert.equal(runtimeIntentOwner.version, 1, 'runtime704 intent owner version changed');
  assert.deepEqual(runtimeIntentOwner.authority, {
    kind: 'current-root-characterized-intent-policy',
    acceptedDiagnostics: 2,
    sourceChangesAuthorized: false,
    supportRetirement: false,
    historicalFreezeOwnerClaim: false,
    wholeRuntimeClearance: false,
  }, 'runtime704 intent authority changed');
  assert.deepEqual(runtimeIntentOwner.source, {
    path: 'tests/shell-stress/env-replacement/output-budget-evidence/safe-bash-env-output-baseline-runtime.mjs',
    bytes: 101847,
    sha256: 'cd040f35dfe77b10cfe26d446f3802d54050b132e6b053198a426f9453f4015e',
  }, 'runtime704 intent source binding changed');
  assert.equal(runtimeIntentOwner.role, 'active-runtime-implementation', 'runtime704 intent role changed');
  assert.equal(runtimeIntentOwner.origin.sourcePath, runtimeIntentOwner.source.path, 'runtime704 intent origin path changed');
  assert.equal(runtimeIntentOwner.origin.sourceCommit, importedOwner.origin.sourceCommit, 'runtime704 intent original commit changed');
  assert.equal(runtimeIntentOwner.origin.sourceRootTree, importedOwner.origin.sourceRootTree, 'runtime704 intent original tree changed');
  assert.equal(runtimeIntentOwner.origin.mode, '100644', 'runtime704 intent original mode changed');
  assert.deepEqual(runtimeIntentOwner.findings.map(finding => finding.diagnostic.ruleId), ['require-yield', 'no-ex-assign'], 'runtime704 intent diagnostic scope changed');
  assert.ok(runtimeIntentOwner.findings.every(finding => finding.multiplicity === 1 && finding.diagnostic.severity === 2 && !Object.hasOwn(finding.diagnostic, 'fix') && !Object.hasOwn(finding.diagnostic, 'suggestions')), 'runtime704 intent diagnostic scope changed');
  const intentRecord = {
    name: 'import-697ad-runtime704-intent',
    ...runtimeIntentOwner.source,
    owner: runtime704IntentBinding,
    selector: [],
    importedMember: runtimeIntentOwner,
    sourceMaximumBytes: 101847,
    findings: runtimeIntentOwner.findings.map(finding => finding.diagnostic),
  };
  return [...records, ...importedRecords, intentRecord].map(record => {
    const filename = join(root, record.path);
    function authenticate() {
      let selected = JSON.parse(readBinding(record.owner, record.ownerMaximumBytes ?? 65536));
      for (const key of record.selector) {
        assert.ok(selected && typeof selected === 'object' && Object.hasOwn(selected, key), 'frozen style owner selector missing');
        selected = selected[key];
      }
      if (record.importedMember) assert.deepEqual(selected, record.importedMember, 'protected import style owner association changed');
      else assert.equal(selected, record.sha256, 'frozen style owner selector changed');
      const bytes = readBinding(record, record.sourceMaximumBytes ?? 65536);
      if (record.importedMember) {
        const blobOid = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
        assert.equal(blobOid, record.importedMember.origin.blobOid, 'protected import style original blob changed');
      }
      return bytes;
    }
    authenticate();
    let prepared = false;
    return {
      name: 'safe-bash/frozen-style-' + record.name,
      files: ['packages/safe-bash/' + record.path],
      processor: {
        meta: { name: 'safe-bash/frozen-style-' + record.name, version: '1' },
        supportsAutofix: record.preserveSuggestionMetadata === true,
        preprocess(text, actualFilename) {
          const overlapping = prepared;
          prepared = false;
          assert.ok(!overlapping, 'overlapping frozen style preprocess');
          assert.equal(actualFilename, filename, 'frozen style filename changed');
          const bytes = authenticate();
          assert.ok(bytes.equals(Buffer.from(text, 'utf8')), 'frozen style source text changed');
          prepared = true;
          return [text];
        },
        postprocess(messageLists, actualFilename) {
          const admitted = prepared;
          prepared = false;
          assert.ok(admitted, 'frozen style postprocess requires admitted preprocess');
          assert.equal(actualFilename, filename, 'frozen style filename changed');
          assert.ok(Array.isArray(messageLists) && messageLists.length === 1 && Array.isArray(messageLists[0]), 'frozen style requires a single unchanged block');
          const messages = messageLists[0];
          const accepted = (record.findings ?? [record.finding]).map(finding => {
            const matching = messages.filter(message => isDeepStrictEqual(message, finding));
            assert.equal(matching.length, 1, 'frozen style requires exactly one unchanged diagnostic');
            return matching[0];
          });
          return messages.filter(message => !accepted.includes(message));
        },
      },
    };
  });
}

function policyConfig(safeBashInputs, compatibility = []) {
  return tseslint.config(
  ...compatibility,
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      '.codex/**',
      '.cursor/**',
      '.tmp/**',
      '.turbo/**',
      'tmp/**',
      'out/**',
      'screenshots/**',
      'vscode-extension/out/**',
      'vscode-extension/node_modules/**',
      '**/*.d.ts',
      'packages/safe-bash/src/commands/xan',
      ...safeBashInputs.files.map(path => `packages/safe-bash/${path}`),
      ...safeBashInputs.directories.map(path => `packages/safe-bash/${path}/**`),
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: jsFiles,
    rules: {
      ...js.configs.recommended.rules,
      'no-control-regex': 'off',
    },
  },
  {
    files: tsFiles,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^ignored' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: jsFiles.map(pattern => `packages/safe-bash/${pattern}`),
    languageOptions: {
      ecmaVersion: 'latest',
    },
  },
  {
    files: [...jsFiles, ...tsFiles].map(pattern => `packages/safe-bash/${pattern}`),
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': ['error', { allowRegexCharacters: ['/', '[', '-'] }],
    },
  },
  {
    name: 'safe-bash/harness-unused-bindings',
    files: jsFiles.map(pattern => `packages/safe-bash/tests/${pattern}`),
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    name: 'safe-bash/deferred-construction',
    files: [
      'packages/safe-bash/src/commands/network/transport.ts',
      'packages/safe-bash/src/commands/regex-execution/ere/transport/validation.ts',
      'packages/safe-bash/src/commands/yq/index.ts',
    ],
    rules: {
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    name: 'safe-bash/cancellation-cleanup-sentinel',
    files: [
      'packages/safe-bash/tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts',
    ],
    rules: {
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    },
  },
  {
    name: 'safe-bash/webdav-options-type-control',
    files: [
      'packages/safe-bash/tests/fs/webdav/directory-access-independent-20260828/typed-inputs.ts',
    ],
    rules: {
      '@typescript-eslint/no-empty-object-type': ['error', { allowObjectTypes: 'always' }],
    },
  },
  ...[
    {
      name: 'generator-session',
      files: [
        'src/commands/stream-format/shared.ts',
        'src/commands/stream-inspection/shared.ts',
        'src/commands/structured/query-core.ts',
      ],
      allowedNames: ['session'],
    },
    {
      name: 'stream-adapter',
      files: ['src/fs/s3/filesystem.ts'],
      allowedNames: ['adapter'],
    },
    {
      name: 'stream-and-accessor-filesystem',
      files: ['src/fs/webdav/webdav.ts', 'tests/fs/mount/allocation.test.ts'],
      allowedNames: ['filesystem'],
    },
    {
      name: 'ancestor-traversal',
      files: ['src/shell/arrays/ledger.ts'],
      allowedNames: ['root'],
    },
    {
      name: 'proxy-mutation-monitor',
      files: ['src/shell/arrays/state.ts'],
      allowedNames: ['monitor'],
    },
    {
      name: 'worker-receiver-observation',
      files: ['tests/commands/grep-aliases/safety.test.ts'],
      allowedNames: ['activeWorker'],
    },
    {
      name: 'invocation-receiver-observation',
      files: ['tests/commands/timeout-author-20260828/timeout.test.ts'],
      allowedNames: ['receiver', 'fallbackReceiver'],
    },
    {
      name: 'first-read-fixture-owner',
      files: ['tests/shell/first-read-owned-fixtures.ts'],
      allowedNames: ['fixture'],
    },
  ].map(({ name, files, allowedNames }) => ({
    name: `safe-bash/${name}`,
    files: files.map(file => `packages/safe-bash/${file}`),
    rules: {
      '@typescript-eslint/no-this-alias': ['error', { allowedNames }],
    },
  })),
  {
    name: 'safe-bash/throw-only-stream-fixtures',
    files: [
      'packages/safe-bash/tests/commands/bytes-stress/readonly.test.ts',
      'packages/safe-bash/tests/commands/bytes/encoding/codecs.test.ts',
      'packages/safe-bash/tests/commands/bytes/encoding/streaming.test.ts',
      'packages/safe-bash/tests/commands/du/helpers.ts',
      'packages/safe-bash/tests/commands/safejs/command.test.ts',
      'packages/safe-bash/tests/commands/time-env/sleep.test.ts',
      'packages/safe-bash/tests/commands/tree/behavior.test.ts',
      'packages/safe-bash/tests/commands/tree/safety.test.ts',
      'packages/safe-bash/tests/fs/authority-trust-review/authority.test.ts',
      'packages/safe-bash/tests/fs/s3/streaming.test.ts',
      'packages/safe-bash/tests/shell-stress/targeted-holdout/probes.ts',
    ],
    rules: {
      'require-yield': 'off',
    },
  },
  {
    name: 'safe-bash/suspended-stream-fixtures',
    files: [
      'packages/safe-bash/tests/commands/archive/lifecycle.test.ts',
      'packages/safe-bash/tests/commands/regex-execution/cleanup-registration/controls.test.ts',
      'packages/safe-bash/tests/shell/first-read-owned-fixtures.ts',
    ],
    rules: {
      'require-yield': 'off',
    },
  },
  {
    files: ['packages/safe-js/src/interp/arguments.ts'],
    rules: {
      'prefer-rest-params': 'off',
    },
  },
  {
    files: ['packages/agent-spawn/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['poe-code/src/*'],
              message: 'Import from poe-code public API, not src/',
            },
          ],
        },
      ],
    },
  }
);
}

const context = await initializeLintConfiguration({
  root: fileURLToPath(new URL('./', import.meta.url)).slice(0, -1),
  buildConfig(inputs, fileSystem, boundaries) {
    return policyConfig(inputs, fileSystem ? frozenStyleCompatibility(fileSystem, boundaries) : []);
  },
});
export const lintInputGuard = context.guard;
const safeBashBoundaries = context.boundaries;
export default context.config;
