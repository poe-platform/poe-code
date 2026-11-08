import { renderFileChanges } from "toolcraft-design-rust";

export function createFileChangeRenderers(options = {}) {
  return {
    rich: (result) => {
      process.stdout.write(`${renderFileChanges(result.changes, { mode: options.mode })}\n`);
    },
    markdown: (result) =>
      renderFileChanges(result.changes, { mode: options.mode, format: "markdown" }),
    json: (result) => result
  };
}
