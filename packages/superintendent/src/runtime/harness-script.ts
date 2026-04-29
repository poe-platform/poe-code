export const superintendentHarnessScript = [
  "---",
  "kind: superintendent-harness",
  "version: 1",
  "---",
  "```js",
  'import { meta } from "harness";',
  'import { run } from "superintendent";',
  "",
  "return await run({ maxRounds: meta.frontmatter.max_rounds });",
  "```",
  ""
].join("\n");
