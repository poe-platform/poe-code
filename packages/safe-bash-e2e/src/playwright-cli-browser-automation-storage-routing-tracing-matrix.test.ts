import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withE2EHarness } from "./harness.js";
import {
  createPlaywrightCli,
  type PlaywrightAdapter,
  type PlaywrightCookie,
  type PlaywrightElementHandle,
  type PlaywrightLocator,
  type PlaywrightPage,
  type PlaywrightRecorderSink,
} from "@poe-platform/safe-bash/commands/playwright";

interface MockBrowserState {
  readonly actions: string[];
  readonly cookies: PlaywrightCookie[];
  readonly routes: Map<string, unknown>;
  readonly consoleListeners: ((msg: unknown) => void)[];
  readonly requestListeners: ((req: unknown) => void)[];
  readonly responseListeners: ((res: unknown) => void)[];
  readonly dialogListeners: ((dlg: unknown) => void)[];
  viewport: { width: number; height: number };
  offline: boolean;
  recorderSink?: PlaywrightRecorderSink;
  traceStarted: boolean;
}

function createRichPlaywrightHarness() {
  const state: MockBrowserState = {
    actions: [],
    cookies: [],
    routes: new Map(),
    consoleListeners: [],
    requestListeners: [],
    responseListeners: [],
    dialogListeners: [],
    viewport: { width: 1280, height: 720 },
    offline: false,
    traceStarted: false,
  };

  const makeHandle = (ref: string): PlaywrightElementHandle => ({
    async evaluate(fn: (node: any, arg?: any) => any, arg?: any) {
      const fakeNode = {
        tagName: ref === "e2" ? "INPUT" : "BUTTON",
        isConnected: true,
        ownerDocument: null,
        getAttribute: (name: string) => (name === "type" ? "text" : null),
      };
      return fn(fakeNode, arg);
    },
    async click(opts) {
      state.actions.push(`click:${ref}:${opts?.button ?? "left"}`);
    },
    async dblclick(opts) {
      state.actions.push(`dblclick:${ref}:${opts?.button ?? "left"}`);
    },
    async hover() {
      state.actions.push(`hover:${ref}`);
    },
    async check() {
      state.actions.push(`check:${ref}`);
    },
    async uncheck() {
      state.actions.push(`uncheck:${ref}`);
    },
    async selectOption(val) {
      const v = Array.isArray(val) ? val.join(",") : val;
      state.actions.push(`select:${ref}:${v}`);
      return [v];
    },
    async fill(val) {
      state.actions.push(`fill:${ref}:${val}`);
    },
    async press(key) {
      state.actions.push(`press:${ref}:${key}`);
    },
    async boundingBox() {
      return ref === "e1"
        ? { x: 10, y: 20, width: 100, height: 40 }
        : { x: 200, y: 120, width: 100, height: 40 };
    },
    async screenshot() {
      return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
    },
    async dispose() {},
  });

  const makePage = (initialUrl = "about:blank"): PlaywrightPage => {
    let currentUrl = initialUrl;
    const history: string[] = [initialUrl];
    let historyIdx = 0;

    const page: PlaywrightPage & { evaluateHandle?: any } = {
      url: () => currentUrl,
      title: async () => `Title:${currentUrl}`,
      goto: async (url: string) => {
        currentUrl = url;
        history.push(url);
        historyIdx = history.length - 1;
        state.actions.push(`goto:${url}`);
      },
      goBack: async () => {
        if (historyIdx > 0) historyIdx--;
        currentUrl = history[historyIdx]!;
        state.actions.push(`goBack:${currentUrl}`);
      },
      goForward: async () => {
        if (historyIdx < history.length - 1) historyIdx++;
        currentUrl = history[historyIdx]!;
        state.actions.push(`goForward:${currentUrl}`);
      },
      reload: async () => {
        state.actions.push(`reload:${currentUrl}`);
      },
      ariaSnapshot: async () =>
        [
          '- heading "Sign In Portal" [level=1]',
          '- button "Submit" [ref=e1]',
          '- textbox "Username" [ref=e2]',
          '- checkbox "Remember" [ref=e3]',
          '- combobox "Role" [ref=e4]',
        ].join("\n"),
      locator: (selector: string): PlaywrightLocator => {
        const ref = selector.startsWith("aria-ref=") ? selector.slice("aria-ref=".length) : selector;
        const handle = makeHandle(ref);
        const loc: PlaywrightLocator = {
          click: (opts) => handle.click(opts),
          fill: (val, opts) => handle.fill(val, opts),
          dblclick: (opts) => handle.dblclick!(opts),
          hover: (opts) => handle.hover!(opts),
          check: (opts) => handle.check!(opts),
          uncheck: (opts) => handle.uncheck!(opts),
          selectOption: (val, opts) => handle.selectOption!(val, opts),
          boundingBox: () => handle.boundingBox!(),
          elementHandle: async () => handle,
          elementHandles: async () => [handle],
          ariaSnapshot: async () => `- button "Submit"`,
          highlight: async (opts) => {
            state.actions.push(`highlight:${ref}:${opts?.style ?? "default"}`);
          },
          hideHighlight: async () => {
            state.actions.push(`hideHighlight:${ref}`);
          },
        };
        Object.defineProperty(loc, "toString", { value: () => `locator(${JSON.stringify(selector)})` });
        return loc;
      },
      hideHighlight: async () => {
        state.actions.push("page:hideHighlight");
      },
      evaluate: async <Result, Arg>(fn: (arg: Arg) => Result, arg: Arg): Promise<Result> => {
        if (typeof fn === "function") {
          try {
            return await fn(arg);
          } catch {
            return { width: state.viewport.width, height: state.viewport.height } as unknown as Result;
          }
        }
        return undefined as unknown as Result;
      },
      evaluateHandle: async (fn: (expr: string) => Promise<any>, expr: string) => {
        const capsule = await fn(expr);
        return {
          evaluate: async (cb: (cap: any, input: any) => any, input: any) => cb(capsule, input),
          dispose: async () => {},
        };
      },
      setViewportSize: async (size) => {
        state.viewport = { ...size };
        state.actions.push(`resize:${size.width}x${size.height}`);
      },
      pdf: async () => new TextEncoder().encode("%PDF-1.7-MOCK\n"),
      screenshot: async (opts) => {
        state.actions.push(`screenshot:full=${Boolean(opts?.fullPage)}:type=${opts?.type ?? "png"}`);
        return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      },
      keyboard: {
        press: async (key: string) => {
          state.actions.push(`key:press:${key}`);
        },
        insertText: async (text: string) => {
          state.actions.push(`key:insertText:${text}`);
        },
        down: async (key: string) => {
          state.actions.push(`key:down:${key}`);
        },
        up: async (key: string) => {
          state.actions.push(`key:up:${key}`);
        },
      },
      mouse: {
        move: async (x: number, y: number) => {
          state.actions.push(`mouse:move:${x},${y}`);
        },
        down: async (opts) => {
          state.actions.push(`mouse:down:${opts?.button ?? "left"}`);
        },
        up: async (opts) => {
          state.actions.push(`mouse:up:${opts?.button ?? "left"}`);
        },
        wheel: async (dx: number, dy: number) => {
          state.actions.push(`mouse:wheel:${dx},${dy}`);
        },
      },
      screencast: {
        showActions: async (opts) => {
          state.actions.push(`screencast:show:${opts?.position ?? "default"}`);
        },
        hideActions: async () => {
          state.actions.push("screencast:hide");
        },
      },
      close: async () => {
        const idx = pages.indexOf(page);
        if (idx >= 0) pages.splice(idx, 1);
        state.actions.push(`closePage:${currentUrl}`);
      },
      on() {},
      off() {},
    };
    return page;
  };

  const pages: PlaywrightPage[] = [];

  const adapter: PlaywrightAdapter = {
    browsers: {
      chromium: { headed: false },
      firefox: { headed: false },
    },
    async acquire() {
      pages.length = 0;

      const context: any = {
        newPage: async () => {
          const p = makePage("about:blank");
          pages.push(p);
          return p;
        },
        pages: () => [...pages],
        close: async () => {
          pages.length = 0;
        },
        cookies: async () => [...state.cookies],
        addCookies: async (newCookies: PlaywrightCookie[]) => {
          for (const c of newCookies) {
            const idx = state.cookies.findIndex((existing) => existing.name === c.name);
            if (idx >= 0) state.cookies[idx] = c;
            else state.cookies.push(c);
          }
        },
        clearCookies: async (filter?: { name?: string }) => {
          if (filter?.name) {
            const idx = state.cookies.findIndex((c) => c.name === filter.name);
            if (idx >= 0) state.cookies.splice(idx, 1);
          } else {
            state.cookies.length = 0;
          }
        },
        setOffline: async (offline: boolean) => {
          state.offline = offline;
          state.actions.push(`offline:${offline}`);
        },
        route: async (pattern: string, handler: unknown) => {
          state.routes.set(pattern, handler);
          state.actions.push(`route:${pattern}`);
        },
        unroute: async (pattern: string) => {
          state.routes.delete(pattern);
          state.actions.push(`unroute:${pattern}`);
        },
        _startRecording: async (_opts: { language: string }, sink: PlaywrightRecorderSink) => {
          state.recorderSink = sink;
          state.actions.push("recording:start");
        },
        _stopRecording: async () => {
          state.recorderSink = undefined;
          state.actions.push("recording:stop");
        },
        tracing: {
          start: async () => {
            state.traceStarted = true;
            state.actions.push("tracing:start");
          },
          stop: async () => {
            state.traceStarted = false;
            state.actions.push("tracing:stop");
          },
        },
        on(event: string, listener: (...args: any[]) => void) {
          if (event === "console") state.consoleListeners.push(listener);
          else if (event === "request") state.requestListeners.push(listener);
          else if (event === "response") state.responseListeners.push(listener);
          else if (event === "dialog") state.dialogListeners.push(listener);
        },
        off() {},
      };

      return {
        context,
        captureArtifact: async (produce) => {
          await produce("/tmp/mock-trace.zip");
          return new TextEncoder().encode("PK-MOCK-TRACE-ZIP");
        },
        executeCode: async ({ source }) => {
          state.actions.push(`run-code:${source}`);
          return { executed: true, sourceLength: source.length };
        },
        onClosed: () => () => {},
        release: async () => {},
      };
    },
  };

  return { adapter, state, pages };
}

describe("playwright-cli browser automation, storage, routing, recording, and tracing E2E matrix", () => {
  it("1. navigation lifecycle: open, goto, go-back, go-forward, reload, and close", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/page1 >/dev/null
          playwright-cli goto https://example.test/page2 >/dev/null
          playwright-cli go-back >/dev/null
          playwright-cli go-forward >/dev/null
          playwright-cli reload >/dev/null
          playwright-cli close >/dev/null
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(state.actions, [
          "goto:https://example.test/page1",
          "goto:https://example.test/page2",
          "goBack:https://example.test/page1",
          "goForward:https://example.test/page2",
          "reload:https://example.test/page2",
        ]);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("2. multi-tab management: tab-list, tab-new, tab-select, and tab-close", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/tab0 >/dev/null
          playwright-cli tab-new https://example.test/tab1 >/dev/null
          playwright-cli tab-list | grep -c 'example.test'
          playwright-cli tab-select 0 >/dev/null
          playwright-cli tab-close 1 >/dev/null
          playwright-cli tab-list | grep -c 'example.test'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "2\n1");
      });
    } finally {
      await cli.dispose();
    }
  });

  it("3. snapshot capture (stdout and --filename) and find (plain substring and --regex)", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/login >/dev/null
          playwright-cli snapshot --filename /workspace/snap.yml >/dev/null
          grep -o 'Sign In Portal' /workspace/snap.yml
          playwright-cli find "Submit" | grep -o 'Submit' | head -n 1
          playwright-cli find --regex "button.*Submit" | grep -o 'Submit' | head -n 1
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), ["Sign In Portal", "Submit", "Submit"].join("\n"));
      });
    } finally {
      await cli.dispose();
    }
  });

  it("4. snapshot ref resolution with click, fill (--submit), dblclick, hover, check, uncheck, and select", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/form >/dev/null
          playwright-cli snapshot >/dev/null
          playwright-cli fill e2 "alice@example.test" >/dev/null
          playwright-cli check e3 >/dev/null
          playwright-cli uncheck e3 >/dev/null
          playwright-cli select e4 "admin" >/dev/null
          playwright-cli hover e1 >/dev/null
          playwright-cli click e1 >/dev/null
          playwright-cli dblclick e1 right >/dev/null
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(state.actions, [
          "goto:https://example.test/form",
          "fill:e2:alice@example.test",
          "check:e3",
          "uncheck:e3",
          "select:e4:admin",
          "hover:e1",
          "click:e1:left",
          "dblclick:e1:right",
        ]);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("5. drag between two snapshot element refs using boundingBox coordinates", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/board >/dev/null
          playwright-cli snapshot >/dev/null
          playwright-cli drag e1 e2 >/dev/null
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(state.actions, [
          "goto:https://example.test/board",
          "mouse:move:60,40",
          "mouse:down:left",
          "mouse:move:250,140",
          "mouse:move:250,140",
          "mouse:up:left",
        ]);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("6. keyboard and mouse abilities: press, type (--submit), keydown, keyup, mousemove, mousedown, mouseup, mousewheel", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://example.test/canvas >/dev/null
          playwright-cli press Escape >/dev/null
          playwright-cli type "hello world" --submit >/dev/null
          playwright-cli keydown Shift >/dev/null
          playwright-cli keyup Shift >/dev/null
          playwright-cli mousemove 150 250 >/dev/null
          playwright-cli mousedown middle >/dev/null
          playwright-cli mouseup middle >/dev/null
          playwright-cli mousewheel 0 120 >/dev/null
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.deepEqual(state.actions, [
          "goto:https://example.test/canvas",
          "key:press:Escape",
          "key:insertText:hello world",
          "key:press:Enter",
          "key:down:Shift",
          "key:up:Shift",
          "mouse:move:150,250",
          "mouse:down:middle",
          "mouse:up:middle",
          "mouse:wheel:0,120",
        ]);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("7. cookie management: cookie-set, cookie-list (--domain, --path), cookie-get, cookie-delete, and cookie-clear", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test/home >/dev/null
          playwright-cli cookie-set sid "tok_123" --httpOnly --secure --sameSite Strict >/dev/null
          playwright-cli cookie-set theme "dark" --domain other.example.test --path /ui >/dev/null
          playwright-cli --raw cookie-get sid
          playwright-cli --raw cookie-list --domain other.example.test
          playwright-cli cookie-delete sid >/dev/null
          playwright-cli --raw cookie-get sid
          playwright-cli cookie-clear >/dev/null
          playwright-cli --raw cookie-list
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /sid=tok_123 \(domain: app\.example\.test, path: \/, httpOnly: true, secure: true, sameSite: Strict\)/);
        assert.match(r.stdout, /theme=dark \(domain: other\.example\.test, path: \/ui\)/);
        assert.match(r.stdout, /Cookie 'sid' not found/);
        assert.match(r.stdout, /No cookies found/);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("8. network routing: route (--status, --body, --content-type, --header), route-list, and unroute", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli route "**/api/v1/users" --status 200 --content-type application/json --body '{"ok":true}' >/dev/null
          playwright-cli route "**/api/v1/Analytics" --header "X-Trace: 1" --remove-header "Cookie" >/dev/null
          playwright-cli --raw route-list
          playwright-cli unroute "**/api/v1/users" >/dev/null
          echo "---AFTER-UNROUTE---"
          playwright-cli --raw route-list
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /\*\*\/api\/v1\/users/);
        assert.match(r.stdout, /\*\*\/api\/v1\/Analytics/);
        const afterUnroute = r.stdout.split("---AFTER-UNROUTE---")[1]!;
        assert.ok(!afterUnroute.includes("**/api/v1/users"));
        assert.ok(afterUnroute.includes("**/api/v1/Analytics"));
      });
    } finally {
      await cli.dispose();
    }
  });

  it("9. network-state-set toggles browser offline/online state", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli --raw network-state-set offline
          playwright-cli --raw network-state-set online
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "Network is now offline\nNetwork is now online");
        assert.equal(state.offline, false);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("10. viewport resize and PDF artifact generation (pdf --filename)", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test/report >/dev/null
          playwright-cli resize 1440 900 >/dev/null
          playwright-cli pdf --filename /workspace/report.pdf >/dev/null
          head -n 1 /workspace/report.pdf
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "%PDF-1.7-MOCK");
        assert.deepEqual(state.viewport, { width: 1440, height: 900 });
      });
    } finally {
      await cli.dispose();
    }
  });

  it("11. eval / evaluate native JS expressions with stdout and --filename JSON artifact output", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli eval "() => ({ sum: 19 + 23, tag: 'ok' })" --filename /workspace/eval1.json >/dev/null
          playwright-cli eval "() => [10, 20, 30]" --filename /workspace/eval2.json >/dev/null
          jq -c '.' /workspace/eval1.json
          jq -c '.' /workspace/eval2.json
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), `{"sum":42,"tag":"ok"}\n[10,20,30]`);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("12. run-code executes inline and --filename Playwright functions against the active page", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        await h.writeText("/workspace/snippet.js", "async (page) => { await page.goto('https://example.test'); }");
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli --raw run-code "async (page) => page.url()"
          playwright-cli --raw run-code --filename /workspace/snippet.js
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(state.actions.some((a) => a.startsWith("run-code:")));
      });
    } finally {
      await cli.dispose();
    }
  });

  it("13. action recording lifecycle: recording-start, recorded sink callbacks, and recording-stop", async () => {
    const { adapter, state, pages } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r1 = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli --raw recording-start
        `);
        assert.equal(r1.exitCode, 0, r1.stderr);
        state.recorderSink?.actionAdded(pages[0]!, {}, "await page.getByRole('button').click();");
        const r2 = await h.exec(`
          playwright-cli --raw recording-stop
        `);
        assert.equal(r2.exitCode, 0, r2.stderr);
        assert.match(r2.stdout, /await page\.getByRole\('button'\)\.click\(\);/);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("14. tracing lifecycle: tracing-start and tracing-stop export trace zip artifact to VFS", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli --raw tracing-start
          playwright-cli tracing-stop > /workspace/trace-stop.out
          ZIP_FILE=$(find /workspace/.playwright-cli -name "*.zip" | head -n 1)
          cat "$ZIP_FILE"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.match(r.stdout, /Trace recording started/);
        assert.match(r.stdout, /PK-MOCK-TRACE-ZIP/);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("15. highlight and video-show-actions / video-hide-actions visual debugging commands", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test >/dev/null
          playwright-cli snapshot >/dev/null
          playwright-cli highlight "#submit-btn" --style "border: 2px solid red" >/dev/null
          playwright-cli highlight --hide >/dev/null
          playwright-cli --raw video-show-actions --position top-right --cursor pointer
          playwright-cli --raw video-hide-actions
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.ok(state.actions.includes("highlight:#submit-btn:border: 2px solid red"));
        assert.ok(state.actions.includes("page:hideHighlight"));
        assert.ok(state.actions.includes("screencast:show:top-right"));
        assert.ok(state.actions.includes("screencast:hide"));
      });
    } finally {
      await cli.dispose();
    }
  });

  it("16. console and network event log capture across page interactions", async () => {
    const { adapter, state, pages } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        await h.exec(`playwright-cli open https://app.example.test >/dev/null`);
        for (const l of state.consoleListeners) {
          l({
            type: () => "error",
            text: () => "Uncaught TypeError: boom",
            location: () => ({ url: "https://app.example.test/app.js", lineNumber: 12, columnNumber: 4 }),
            page: () => pages[0]!,
          });
        }
        const fakeReq = {
          url: () => "https://app.example.test/api/items",
          method: () => "GET",
          resourceType: () => "fetch",
          headers: () => ({}),
          postData: () => null,
          failure: () => null,
          frame: () => ({ page: () => pages[0]!, parentFrame: () => null }),
          isNavigationRequest: () => false,
        };
        for (const l of state.requestListeners) l(fakeReq);
        for (const l of state.responseListeners) {
          l({
            request: () => fakeReq,
            status: () => 200,
            statusText: () => "OK",
            headers: () => ({ "content-type": "application/json" }),
            body: async () => new Uint8Array(),
          });
        }
        const r = await h.exec(`
          playwright-cli console > /workspace/console.out
          playwright-cli requests > /workspace/network.out
          playwright-cli request 1 > /workspace/req1.out
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        const allLogs = await h.exec(`cat /workspace/console.out /workspace/network.out /workspace/req1.out`);
        assert.match(allLogs.stdout, /boom/);
        assert.match(allLogs.stdout, /api\/items/);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("17. workspace install (--skills) and config-print from VFS JSON configuration", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        await h.writeText(
          "/workspace/.playwright/cli.config.json",
          JSON.stringify({
            browser: { browserName: "chromium" },
            outputDir: ".playwright-cli/custom-out",
          })
        );
        const r = await h.exec(`
          playwright-cli install --skills >/dev/null
          test -d /workspace/.claude/skills/playwright-cli && echo "skills:installed"
          playwright-cli open --config /workspace/.playwright/cli.config.json https://app.example.test >/dev/null
          playwright-cli --json config-print | jq -r '.result.outputDir'
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "skills:installed\n/workspace/.playwright/.playwright-cli/custom-out");
      });
    } finally {
      await cli.dispose();
    }
  });

  it("18. resource limit enforcement: maxSessions and maxTabs reject excess allocations cleanly", async () => {
    const { adapter } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({
      adapter,
      limits: { maxSessions: 1, maxTabs: 2 },
      replace: true,
    });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli -s=s1 open https://example.test/1 >/dev/null
          if playwright-cli -s=s2 open https://example.test/2 2>/workspace/s2.err >/workspace/s2.out; then
            echo "unexpected-s2"
          else
            echo "s2-blocked:$?"
          fi
          playwright-cli -s=s1 tab-new https://example.test/tab2 >/dev/null
          if playwright-cli -s=s1 tab-new https://example.test/tab3 2>/workspace/tab3.err >/workspace/tab3.out; then
            echo "unexpected-tab3"
          else
            echo "tab3-blocked:$?"
          fi
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "s2-blocked:1\ntab3-blocked:1");
      });
    } finally {
      await cli.dispose();
    }
  });

  it("19. help and command-specific --help render structured usage without acquiring a browser session", async () => {
    let acquired = 0;
    const { adapter } = createRichPlaywrightHarness();
    const wrappedAdapter: PlaywrightAdapter = {
      ...adapter,
      async acquire(req) {
        acquired++;
        return adapter.acquire(req);
      },
    };
    const cli = createPlaywrightCli({ adapter: wrappedAdapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli --help | head -n 3
          playwright-cli snapshot --help | head -n 2
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(acquired, 0);
        assert.match(r.stdout, /playwright-cli/);
      });
    } finally {
      await cli.dispose();
    }
  });

  it("20. end-to-end automated QA workflow: open -> snapshot -> fill & click -> eval metrics -> sqlite3 + jq audit report", async () => {
    const { adapter, state } = createRichPlaywrightHarness();
    const cli = createPlaywrightCli({ adapter, replace: true });
    try {
      await withE2EHarness({ plugins: [cli.plugin] }, async (h) => {
        const r = await h.exec(`
          playwright-cli open https://app.example.test/checkout >/dev/null
          playwright-cli snapshot --filename /workspace/checkout.snap >/dev/null
          playwright-cli fill e2 "qa-buyer@example.test" >/dev/null
          playwright-cli check e3 >/dev/null
          playwright-cli click e1 >/dev/null
          playwright-cli eval "() => ({ route: '/checkout', status: 'submitted', items: 3 })" --filename /workspace/metrics.json >/dev/null
          ROUTE=$(jq -r '.route' /workspace/metrics.json)
          STATUS=$(jq -r '.status' /workspace/metrics.json)
          ITEMS=$(jq -r '.items' /workspace/metrics.json)
          sqlite3 /workspace/qa.db "CREATE TABLE runs(route TEXT, status TEXT, items INT);"
          sqlite3 /workspace/qa.db "INSERT INTO runs VALUES ('$ROUTE', '$STATUS', $ITEMS);"
          sqlite3 /workspace/qa.db "SELECT route, status, items FROM runs;"
        `);
        assert.equal(r.exitCode, 0, r.stderr);
        assert.equal(r.stdout.trim(), "/checkout|submitted|3");
        assert.deepEqual(state.actions, [
          "goto:https://app.example.test/checkout",
          "fill:e2:qa-buyer@example.test",
          "check:e3",
          "click:e1:left",
        ]);
      });
    } finally {
      await cli.dispose();
    }
  });
});
