import { expect, it } from "vitest";
import * as csvkit from "../packages/safe-bash-command-csvkit/src/index.js";
import * as op from "../packages/safe-bash-command-op/src/index.js";
import * as pandoc from "../packages/safe-bash-command-pandoc/src/index.js";
import * as ssconvert from "../packages/safe-bash-command-ssconvert/src/index.js";
import * as xmllint from "../packages/safe-bash-command-xmllint/src/index.js";
import * as xz from "../packages/safe-bash-command-xz/src/index.js";
import * as csvcut from "../packages/safe-bash-command-csvcut/src/index.js";
import * as csvgrep from "../packages/safe-bash-command-csvgrep/src/index.js";
import * as diff3 from "../packages/safe-bash-command-diff3/src/index.js";
import * as exiftool from "../packages/safe-bash-command-exiftool/src/index.js";
import * as fold from "../packages/safe-bash-command-fold/src/index.js";
import * as htmlq from "../packages/safe-bash-command-htmlq/src/index.js";
import * as mmdc from "../packages/safe-bash-command-mmdc/src/index.js";
import * as fmt from "../packages/safe-bash-command-fmt/src/index.js";
import * as imagemagick from "../packages/safe-bash-command-imagemagick/src/index.js";

const families = { csvkit, op, pandoc, ssconvert, xmllint, xz, csvcut, csvgrep, diff3, exiftool, fold, htmlq, mmdc, fmt, imagemagick };
it.each(Object.entries(families))("%s exposes usable standard command factories", (name, api) => {
  const title = name[0]!.toUpperCase() + name.slice(1);
  const command = Reflect.get(api, `create${title}Command`)();
  const commands = Reflect.get(api, `create${title}Commands`)();
  const plugin = Reflect.get(api, `${name}Commands`)();
  expect(typeof command.execute).toBe("function");
  expect(commands.length).toBeGreaterThan(0);
  expect(commands.map((entry: { name: string }) => entry.name)).toContain(command.name);
  expect(typeof plugin.setup).toBe("function");
});

