import assert from 'node:assert/strict';
import { join, relative, isAbsolute } from 'node:path';

function inside(parent, target) { const path = relative(parent, target); return path !== '..' && !path.startsWith('../') && !isAbsolute(path); }

export function declarationReadProof(records, label, consumerRoot, toolsRoot, routes) {
  const route = routes.cases[label]; assert.ok(route, `UNDECLARED_TYPE_ROUTE:${label}`);
  const reads = records.filter(row => row.kind === 'actual-file-read');
  assert.ok(records.some(row => row.kind === 'actual-commonjs-compile' && row.path === join(toolsRoot, 'typescript/lib/_tsc.js')), 'ACTUAL_TSC_COMPILE_REQUIRED');
  const packageRoot = join(consumerRoot, 'node_modules/virtual-bash');
  for (const row of reads) {
    assert.ok(inside(consumerRoot, row.path) || inside(toolsRoot, row.path), `READ_OUTSIDE_DECLARED_CONSUMER_OR_TOOLS:${row.path}`);
    if (row.path.includes('/virtual-bash/')) {
      assert.ok(inside(packageRoot, row.path), 'FOREIGN_PACKAGE_OR_SOURCE_FALLBACK');
      const key = relative(packageRoot, row.path);
      assert.ok(key === 'package.json' || (key.startsWith('dist/') && key.endsWith('.d.ts')), `SOURCE_OR_UNDECLARED_PRODUCT_READ:${key}`);
      assert.ok(!key.includes('/shell/cancellation.'), 'PRIVATE_HELPER_DECLARATION_FORBIDDEN');
      const expected = key === 'package.json' ? route.packageMetadataSha256 : routes.packageFiles[key];
      assert.equal(row.sha256, expected, `DECLARATION_READ_HASH:${key}`);
    }
    const local = relative(consumerRoot, row.path);
    if (Object.hasOwn(routes.typeDependencies, local)) assert.equal(row.sha256, routes.typeDependencies[local], `TYPE_DEPENDENCY_READ_HASH:${local}`);
  }
  assert.ok(reads.some(row => row.path === join(packageRoot, 'package.json') && row.sha256 === route.packageMetadataSha256), 'PACKAGE_EXPORTS_METADATA_NOT_READ');
  assert.ok(reads.some(row => row.path === join(consumerRoot, 'consumer.ts') && row.sha256 === route.payloadSha256), 'UNCHANGED_CONSUMER_NOT_READ');
  for (const root of route.requiredRoots) assert.ok(reads.some(row => row.path === join(packageRoot, routes.roots[root].entrypoint)), `WRONG_DECLARATION_ENTRY:${root}`);
  const required = Object.assign({}, ...route.requiredRoots.map(name => routes.roots[name].required));
  for (const [path, digest] of Object.entries(required)) assert.ok(reads.some(row => row.path === join(packageRoot, path) && row.sha256 === digest), `MISSING_REQUIRED_DECLARATION:${path}`);
  return { label, publicImports: route.publicImports, requiredRoots: route.requiredRoots, requiredTransitiveDeclarations: Object.keys(required).length, authenticatedProductReads: reads.filter(row => inside(packageRoot, row.path)).length, payloadSha256: route.payloadSha256, packageMetadataSha256: route.packageMetadataSha256 };
}

export function assertExactT03(result, routes) {
  assert.equal(result.code, 2); assert.equal(result.signal, null); assert.equal(result.stderr, '');
  assert.equal(result.stdout, routes.exactT03Stdout, 'EXACT_T03_CODE_LOCATION_MESSAGE');
}
