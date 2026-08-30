import assert from 'node:assert/strict';
import { admitCandidate, requireReady, sha256 } from './binding.mjs';

export function prepareType(packetBytes, go, files, preparationSha256, consumerBytes) {
  const packet = admitCandidate(packetBytes, go, files, preparationSha256);
  requireReady(packet.kind === 'type', 'separate type GO');
  const binding = packet.typeConsumer;
  requireReady(binding && binding.sourceSha256 === sha256(consumerBytes), 'exact inert consumer');
  for (const value of [packet.moduleSpecifier, binding.commandContract, binding.pluginContract]) requireReady(typeof value === 'string' && /^[A-Za-z0-9_@./-]+$/.test(value), 'literal type import specifier');
  requireReady(Array.isArray(binding.resolvedDeclarations) && binding.resolvedDeclarations.length >= 3 && binding.resolvedDeclarations.every(path => files.has(path) && path.endsWith('.d.ts')), 'module/contract declaration closure');
  const source = consumerBytes.toString('utf8').replace('__MODULE_SPECIFIER__', packet.moduleSpecifier).replace('__COMMAND_CONTRACT__', binding.commandContract).replace('__PLUGIN_CONTRACT__', binding.pluginContract);
  const argv = [binding.compilerEntry, '--noEmit', '--strict', '--exactOptionalPropertyTypes', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--types', 'node', binding.consumerPath];
  assert.ok(binding.consumerPath?.endsWith('/consumer.ts') && binding.compilerEntry?.endsWith('/tsc.js'));
  requireReady(sha256(JSON.stringify(argv)) === binding.argvSha256, 'exact opt-in compiler argv');
  return { source, executable: packet.node.path, executableSha256: packet.node.sha256, argv, expected: { exitCode: 0, stdoutBase64: '', stderrBase64: '', noEmit: true }, execution: 'UNRUN_REQUIRES_BOUND_COMPILER_AND_DECLARATION_CLOSURE' };
}
