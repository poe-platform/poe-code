import { readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('./', import.meta.url));
await writeFile(root + 'BUILD-INSPECTION-STARTUP.json', JSON.stringify({ at: new Date().toISOString(), sourceOnly: true, children: 0 }) + '\n', { flag: 'wx', mode: 0o600 });
try {
  const read = async pathname => { const status = await lstat(pathname); assert(status.isFile() && !status.isSymbolicLink() && status.size <= 4 * 1024 * 1024); return readFile(pathname, 'utf8'); };
  const result = JSON.parse(await read(root + 'RUN-01/RESULT.json'));
  if (result.status !== 'SOURCE_PREPARATION_COMPLETE') {
    console.log(JSON.stringify({ result, failure: JSON.parse(await read(root + 'RUN-01/FAILURE.json')) }));
    process.exitCode = 1;
  } else {
    const inventory = JSON.parse(await read(root + 'RUN-01/FINAL-SOURCE-INVENTORY.json'));
    const archive = JSON.parse(await read(root + 'RUN-01/ARCHIVE-INVENTORY.json'));
    const dependencies = JSON.parse(await read(root + 'RUN-01/BUILD-DEPENDENCIES.json'));
    const observation = JSON.parse(await read(root + 'RUN-01/BUILD-SOURCE-OBSERVATIONS.json'));
    const files = ['Makefile.in', 'builtins/Makefile.in', 'lib/readline/Makefile.in', 'lib/sh/Makefile.in', 'configure'];
    const selected = [];
    for (const filename of files) {
      const content = await read(inventory.source + '/' + filename);
      const bound = inventory.rows.find(row => row.path === 'bash-5.3/' + filename);
      assert(bound && createHash('sha256').update(content).digest('hex') === bound.sha256);
      const lines = content.split('\n');
      const declarations = filename === 'configure' ? [] : lines.flatMap((line, index) => /^(Program|PROGRAM|SHELL|CC|CC_FOR_BUILD|BUILD_CC|BUILD_SHELL|AR|RANLIB|LIBS|LIBREADLINE|TERMCAP_LIB|LIBTERMCAP|LIBINTL|READLINE_LIB|READLINE_DEP|INTL_DEP|MKBUILTINS|MKFLAGS|MAKE|SYNTAX|SIGNAMES|MKSYNTAX|MKVERSION|MKSIGNAMES|SUPPORT_SRC|CREATED_SUPPORT|CREATED_HEADERS|CREATED_SOURCES|OTHER_DOCS|all|bash|mkbuiltins|mksyntax|mkversion|mksignames|version\.h|syntax\.c|signames\.h|\$\(Program\))\b[^#]*[:=]/.test(line) ? [{ line: index + 1, code: line }] : []);
      const tokens = [...new Set((content.match(/(?:support\/[a-zA-Z0-9_.-]+|\.\/mk[a-zA-Z0-9_.-]+|conftest[a-zA-Z0-9_.-]*|config\.(?:status|guess|sub)|makeinfo|bison|yacc|msgfmt|gettext|libiconv|libintl|ncurses|termcap|tinfo)/g) ?? []))].sort();
      selected.push({ filename, sha256: bound.sha256, declarations, codeReferenceTokens: tokens, tokensNotProofOfExecutedDependency: true });
    }
    const detail = { source: inventory.source, sourceInventorySha256: inventory.sha256, selected, scope: 'STATIC_CODE_REFERENCES_ONLY_NO_HELPER_EXECUTION' };
    await writeFile(root + 'BUILD-RECIPE-DETAILS.json', JSON.stringify(detail, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: result.status, work: result.work, elapsedMs: result.elapsedMs, children: result.starts, closed: result.closedChildren, capture: result.capturedBytes, patches: result.patchesApplied, archiveMembers: archive.members, archiveBytes: archive.aggregateRegularBytes, tarBytes: archive.tar.bytes, sourceMembers: inventory.members, sourceHash: inventory.sha256, excluded: archive.excluded, links: archive.rows.filter(row => row.type === '1' || row.type === '2').length, changed: inventory.changedPaths, dependencies: dependencies.dependencies.map(row => ({ tool: row.target.path, libraries: row.dependencies.trim().split('\n').slice(1) })), sdk: dependencies.sdk, version: observation.observations.flatMap(row => row.declarations ?? []), recipes: selected.filter(row => row.filename === 'Makefile.in' || row.filename === 'builtins/Makefile.in').map(row => ({ filename: row.filename, declarations: row.declarations, tokens: row.codeReferenceTokens })) }));
  }
} catch (error) {
  await writeFile(root + 'BUILD-INSPECTION-FAILURE.json', JSON.stringify({ message: error.message }) + '\n', { flag: 'wx', mode: 0o600 });
  process.exitCode = 1;
}
