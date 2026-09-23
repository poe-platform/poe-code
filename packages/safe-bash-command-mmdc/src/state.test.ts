import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  layoutMermaid,
  parseMermaid,
  renderMermaidPng,
  renderMermaidSvg,
  verifySceneGeometry
} from "./index.js";

export const STATE_FIXTURES: Record<string, string> = {
  "state-v2-start-end": `stateDiagram-v2
    [*] --> Idle
    state "Queued Job" as Queued
    state "Active Execution" as Running
    state "Completed" as Done
    Idle --> Queued : submit()
    Queued --> Running : dispatch()
    Running --> Done : exit(0)
    Done --> [*]
  `,
  "state-composite-nested": `stateDiagram-v2
    [*] --> Initializing
    state "Worker Lifecycle" as Lifecycle {
      state "Sandbox Ready" as Ready
      state "Executing Command" as Busy
      Ready --> Busy : exec(argv)
      Busy --> Ready : stdout closed
    }
    Initializing --> Ready : mount VFS
    Busy --> Terminated : SIGTERM
    Terminated --> [*]
  `,
  "state-cycles-notes": `stateDiagram-v2
    [*] --> Connecting
    state "Connected Session" as Connected
    state "Backoff Retry" as Retry
    Connecting --> Connected : TLS Handshake OK
    Connecting --> Retry : Timeout
    Retry --> Connecting : Backoff Elapsed
    Connected --> [*] : Graceful Close
    note right of Connected : Subpixel verified session
    note left of Retry : Exponential jitter window
  `
};

describe("stateDiagram-v2 parser, layout, and geometry invariants", () => {
  for (const [name, source] of Object.entries(STATE_FIXTURES)) {
    it(`parses, lays out, and satisfies all geometric invariants for ${name}`, () => {
      const doc = parseMermaid(source);
      assert.equal(doc.family, "state");
      for (const mode of ["light", "dark"] as const) {
        const scene = layoutMermaid(doc, { theme: mode });
        const check = verifySceneGeometry(scene);
        assert.equal(
          check.ok,
          true,
          `Geometry violations for ${name} (${mode}): ${check.violations.join("; ")}`
        );
        const svgRes = renderMermaidSvg(source, { theme: mode });
        assert.ok(svgRes.svg.includes("<svg"));
        const pngRes = renderMermaidPng(source, { theme: mode, scale: 2 });
        assert.ok(pngRes.png.byteLength > 100);
      }
    });
  }
});
