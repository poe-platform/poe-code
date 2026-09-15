export function createOverlayManager(initialFocus: string) {
  const stack: { focus: string; controller: AbortController }[] = [];
  return {
    open(focus: string): AbortSignal { const controller = new AbortController(); stack.push({ focus, controller }); return controller.signal; },
    close(): boolean { const overlay = stack.pop(); overlay?.controller.abort(); return overlay !== undefined; },
    focus(): string { return stack.at(-1)?.focus ?? initialFocus; },
    dispose(): void { while (stack.length) stack.pop()!.controller.abort(); }
  };
}
