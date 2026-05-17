import { describe, expect, it } from "vitest";

import { createSandboxClosure } from "../interp/values.js";
import { makeTimeModule } from "../modules/time.js";
import { lint } from "./index.js";
import { createLintModulesFromRuntimeRegistry } from "./runtime-modules.js";

describe("runtime lint modules", () => {
  it("preserves async metadata from sandbox and host function exports", () => {
    const modules = createLintModulesFromRuntimeRegistry({
      api: {
        run: createSandboxClosure({
          async: true,
          call: () => undefined,
          name: "run"
        }),
        sync: createSandboxClosure({
          call: () => undefined,
          name: "sync"
        })
      },
      host: {
        async task() {
          return "done";
        }
      }
    });

    expect(
      lint(
        [
          'import { run, sync } from "api";',
          'import { task } from "host";',
          "run();",
          "sync();",
          "task();"
        ].join("\n"),
        { modules }
      ).map((diagnostic) => diagnostic.code)
    ).toEqual(["AS-FLOATING-PROMISE", "AS-FLOATING-PROMISE"]);
  });

  it("marks time.sleep as async from the runtime module declaration", () => {
    const modules = createLintModulesFromRuntimeRegistry({
      time: makeTimeModule()
    });

    expect(lint('import * as time from "time";\ntime.sleep(1);', { modules })).toMatchObject([
      {
        code: "AS-FLOATING-PROMISE"
      }
    ]);
  });
});
