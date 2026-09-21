import assert from "node:assert/strict";
import { test, mock } from "node:test";
import * as original from "../../toolcraft-design/dist/index.js";
import * as own from "../dist/index.js";

function capture(api, format, operation) {
  let output = "";
  const writer = mock.method(process.stdout, "write", (value) => {
    output += value;
    return true;
  });
  try {
    api.withOutputFormat(format, () => operation(api.logger));
  } finally {
    writer.mock.restore();
  }
  return output;
}
test("owned logger retains emitted identity and detached methods without rendering", () => {
  for (const api of [own, original]) {
    const values = [],
      logger = api.createLogger((value) => values.push(value)),
      marker = { opaque: true };
    logger.info(marker);
    logger.success("ok");
    logger.warn("careful");
    logger.error("failed");
    const { message, resolved, errorResolved } = logger;
    message("message", "custom");
    resolved("label", "value");
    errorResolved("error", "reason");
    assert.equal(values[0], marker);
    assert.deepEqual(values.slice(1), [
      "ok",
      "careful",
      "failed",
      "message",
      "label: value",
      "error: reason"
    ]);
  }
});
test("owned logger preserves terminal, markdown and JSON output across themes and control strings", () => {
  const prior = { force: process.env.FORCE_COLOR, theme: process.env.POE_CODE_THEME };
  try {
    for (const color of ["0", "1"])
      for (const theme of ["dark", "light"])
        for (const brand of ["purple", "blue", "green"]) {
          process.env.FORCE_COLOR = color;
          process.env.POE_CODE_THEME = theme;
          for (const api of [own, original]) api.configureTheme({ brand });
          for (const format of ["terminal", "markdown", "json"])
            for (const text of [
              "",
              "first\n\nlast",
              "red\x1b[31mtext\x1b[0m",
              "x\x1b]private\x07y",
              "a\r\nb\rc",
              "\ud800🌍\udfff",
              "a\u009b31mb",
              "a\x1bPcontent\x1b\\b"
            ]) {
              const operation = (logger) => {
                logger.info(text);
                logger.success(text);
                logger.warn(text);
                logger.error(text);
                logger.message(text);
                logger.message(text, "custom");
                logger.resolved("label", text);
                logger.errorResolved("label", text);
              };
              assert.equal(capture(own, format, operation), capture(original, format, operation));
              assert.equal(own.stripAnsi(text), original.stripAnsi(text));
            }
        }
  } finally {
    for (const [key, value] of [
      ["FORCE_COLOR", prior.force],
      ["POE_CODE_THEME", prior.theme]
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    own.resetTheme?.();
    original.resetTheme();
  }
});
test("owned output format scopes survive async work and cache resets", async () => {
  for (const api of [own, original]) {
    api.resetOutputFormatCache();
    assert.equal(api.resolveOutputFormat({ OUTPUT_FORMAT: "JSON" }), "json");
    assert.equal(api.resolveOutputFormat({ OUTPUT_FORMAT: "terminal" }), "json");
    await api.withOutputFormat("markdown", async () => {
      await Promise.resolve();
      assert.equal(api.resolveOutputFormat(), "markdown");
    });
    assert.equal(api.resolveOutputFormat(), "json");
    api.resetOutputFormatCache();
    assert.equal(api.resolveOutputFormat({ OUTPUT_FORMAT: "unknown" }), "terminal");
  }
});
