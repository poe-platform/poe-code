import assert from "node:assert/strict";
import test from "node:test";
import * as facade from "./index.js";
import * as command from "safe-bash-command-pptx/engine";
import * as presentation from "safe-bash-presentation-engine";
import * as bytes from "./bytes.js";
import * as sharedBytes from "safe-bash-presentation-engine/bytes";

test("legacy presentation and bytes facades retain canonical implementations", () => {
  assert.equal(facade.createPptxCommandEngine, command.createPptxCommandEngine);
  assert.equal(facade.Presentation, presentation.Presentation);
  assert.equal(facade.OfficeError, presentation.OfficeError);
  assert.deepEqual(bytes, sharedBytes);
});
