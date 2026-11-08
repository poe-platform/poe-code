export interface SnapshotScript {
  incrementalAriaSnapshot(
    node: Node,
    options: { mode: string; refPrefix?: string; track?: string; doNotRenderActive?: boolean }
  ): { full: string; incremental?: string; iframeRefs: string[] };
  _safeBashSnapshotLabels?: boolean;
}

// Chromium's control.labels NodeList scans the tree for each control. Reverse
// the lookup through native label.control once per tree and synchronous capture.
// Only the provider's utility world is changed; restore its descriptors even
// when capture throws, and never keep an index across DOM mutations.
export function installSnapshotLabelCache(injected: SnapshotScript) {
  if (injected._safeBashSnapshotLabels) return;
  const snapshot = injected.incrementalAriaSnapshot;
  injected.incrementalAriaSnapshot = function (node, options) {
    const roots = new Map<Node, Map<Element, HTMLLabelElement[]>>();
    const descriptors: [object, PropertyDescriptor][] = [];
    try {
      for (const constructor of [
        HTMLButtonElement,
        HTMLInputElement,
        HTMLMeterElement,
        HTMLOutputElement,
        HTMLProgressElement,
        HTMLSelectElement,
        HTMLTextAreaElement
      ]) {
        const prototype = constructor.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "labels");
        if (!descriptor?.get) throw new Error("Native labels getter is unavailable");
        descriptors.push([prototype, descriptor]);
        Object.defineProperty(prototype, "labels", {
          ...descriptor,
          get(this: Element) {
            if (this instanceof HTMLInputElement && this.type === "hidden") return null;
            const root = this.getRootNode() as Document | DocumentFragment | Element;
            let controls = roots.get(root);
            if (!controls) {
              controls = new Map();
              roots.set(root, controls);
              const labels = Array.from(root.querySelectorAll("label"));
              if (root instanceof HTMLLabelElement) labels.unshift(root);
              for (const label of labels) {
                const control = label.control;
                if (!control) continue;
                let associated = controls.get(control);
                if (!associated) controls.set(control, (associated = []));
                associated.push(label);
              }
            }
            return controls.get(this) ?? [];
          }
        });
      }
      return snapshot.call(this, node, options);
    } finally {
      for (const [prototype, descriptor] of descriptors)
        Object.defineProperty(prototype, "labels", descriptor);
    }
  };
  injected._safeBashSnapshotLabels = true;
}
