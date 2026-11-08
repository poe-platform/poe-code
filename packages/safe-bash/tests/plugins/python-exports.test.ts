import assert from 'node:assert/strict';
import test from 'node:test';
import * as api from '../../src/core.js';

test('Python is a public explicit plugin and leaves the aggregate unchanged', () => {
  assert.equal(typeof api.pythonCommands, 'function');
  assert.equal(typeof api.createPythonCommands, 'function');
  assert.equal(typeof api.createPythonPackageEnvironment, 'function');
  assert.ok(api.pythonDocumentPackages.includes('python-docx==1.2.0'));
  assert.ok(api.pythonDocumentPackages.includes('lxml==6.0.2'));
  assert.equal(api.createAgentCommands().some(command => command.name === 'python' || command.name === 'python3'), false);
});
