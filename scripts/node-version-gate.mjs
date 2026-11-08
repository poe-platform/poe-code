/**
 * Shared constants and snippets for enforcing a minimum Node.js version
 * at the very top of every bin entry point.
 *
 * The snippet is written in ES5-compatible syntax so that even ancient
 * Node versions can parse it and print a friendly error instead of
 * crashing with a SyntaxError on modern syntax.
 */

export const MIN_NODE_MAJOR = 18;

/**
 * Returns a JS snippet (ES5-safe) that checks the Node.js major version
 * and exits with a human-readable message if it's too old.
 *
 * @param {string} binName - The binary name shown in the error message.
 */
export function versionGateSnippet(binName) {
  return [
    `var _major = parseInt(process.versions.node.split(".")[0], 10);`,
    `if (_major < ${MIN_NODE_MAJOR}) {`,
    `  console.error(`,
    `    "${binName} requires Node.js ${MIN_NODE_MAJOR} or later. Current: " + process.version`,
    `  );`,
    `  process.exit(1);`,
    `}`,
  ].join("\n");
}
