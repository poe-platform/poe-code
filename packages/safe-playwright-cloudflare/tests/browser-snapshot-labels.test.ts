import { afterEach, expect, test, vi } from "vitest";
import { installSnapshotLabelCache, type SnapshotScript } from "../src/browser-snapshot-labels";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  let nativeReads = 0;
  let labelReads = 0;
  class Root {
    labels: Label[] = [];
    scans = 0;
    querySelectorAll(selector: string) {
      expect(selector).toBe("label");
      this.scans++;
      return this.labels;
    }
  }
  class Control {
    constructor(readonly root: Root) {}
    getRootNode() {
      return this.root;
    }
  }
  class Button extends Control {
    get labels() {
      nativeReads++;
      return this.root.labels.filter((label) => label.target === this);
    }
  }
  class Input extends Control {
    type = "text";
    get labels(): Label[] | null {
      nativeReads++;
      return this.type === "hidden"
        ? null
        : this.root.labels.filter((label) => label.target === this);
    }
  }
  class Label {
    constructor(readonly target: Control) {}
    get control() {
      labelReads++;
      return this.target;
    }
  }
  vi.stubGlobal("HTMLButtonElement", Button);
  vi.stubGlobal("HTMLInputElement", Input);
  vi.stubGlobal("HTMLLabelElement", Label);
  for (const name of [
    "HTMLMeterElement",
    "HTMLOutputElement",
    "HTMLProgressElement",
    "HTMLSelectElement",
    "HTMLTextAreaElement"
  ]) {
    // Each native interface owns its descriptor.
    vi.stubGlobal(
      name,
      class extends Control {
        get labels() {
          return [];
        }
      }
    );
  }
  const root = new Root();
  const buttons = Array.from({ length: 20005 }, () => new Button(root));
  const first = new Label(buttons[0]!);
  const second = new Label(buttons[0]!);
  root.labels = [first, second];
  const result = { full: "native", iframeRefs: ["f1"] };
  const script: SnapshotScript = {
    incrementalAriaSnapshot() {
      expect(buttons[0]!.labels).toEqual(root.labels);
      expect(buttons.slice(1).every((button) => button.labels.length === 0)).toBe(true);
      return result;
    }
  };
  const capture = () => script.incrementalAriaSnapshot({} as Node, { mode: "ai" });
  return {
    root,
    buttons,
    script,
    capture,
    result,
    Root,
    Button,
    Input,
    Label,
    reads: () => ({ native: nativeReads, labels: labelReads })
  };
}

test("wide snapshots scan each label root once and retain the native result", () => {
  const f = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(f.Button.prototype, "labels");
  installSnapshotLabelCache(f.script);
  const installed = f.script.incrementalAriaSnapshot;
  installSnapshotLabelCache(f.script);
  expect(f.script.incrementalAriaSnapshot).toBe(installed);
  expect(f.capture()).toBe(f.result);
  expect(f.root.scans).toBe(1);
  expect(f.reads()).toEqual({ native: 0, labels: 2 });
  expect(Object.getOwnPropertyDescriptor(f.Button.prototype, "labels")).toEqual(descriptor);
  expect(f.buttons[0]!.labels).toEqual(f.root.labels);
  expect(f.reads().native).toBe(1);
  f.root.labels = [new f.Label(f.buttons[0]!)];
  expect(f.capture()).toBe(f.result);
  expect(f.root.scans).toBe(2);
  expect(f.reads().labels).toBe(3);
});

test("separate roots retain separate associations and hidden inputs retain null labels", () => {
  const f = fixture();
  const shadow = new f.Root();
  const button = new f.Button(shadow);
  shadow.labels = [new f.Label(button)];
  const hidden = new f.Input(f.root);
  hidden.type = "hidden";
  f.script.incrementalAriaSnapshot = () => {
    expect(button.labels).toEqual(shadow.labels);
    expect(f.buttons[0]!.labels).toEqual(f.root.labels);
    expect(hidden.labels).toBeNull();
    return f.result;
  };
  installSnapshotLabelCache(f.script);
  f.capture();
  expect(f.root.scans).toBe(1);
  expect(shadow.scans).toBe(1);
});

test("failed captures restore every native getter and preserve the failure", () => {
  const f = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(f.Button.prototype, "labels");
  const failure = new Error("native snapshot failed");
  f.script.incrementalAriaSnapshot = () => {
    throw failure;
  };
  installSnapshotLabelCache(f.script);
  expect(f.capture).toThrow(failure);
  expect(Object.getOwnPropertyDescriptor(f.Button.prototype, "labels")).toEqual(descriptor);
  expect(f.buttons[0]!.labels).toEqual(f.root.labels);
  expect(f.reads().native).toBe(1);
});
