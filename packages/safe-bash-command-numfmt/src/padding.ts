import { quote } from "./presentation.js";

export async function emitPadded(settings: { padding: bigint; left: boolean; unicode: boolean }, output: { emit(text: string, error?: boolean): void | Promise<void> }, rendered: string, error = false): Promise<void> {
  const padding = Math.max(0, Number(settings.padding) - rendered.length);
  const spaces = async (): Promise<void> => {
    for (let remaining = padding; remaining > 0; remaining -= 1024) {
      await output.emit(" ".repeat(Math.min(remaining, 1024)), error);
    }
  };
  if (!settings.left) await spaces();
  await output.emit(error ? quote(rendered, settings.unicode).slice(settings.unicode ? 3 : 1, settings.unicode ? -3 : -1) : rendered, error);
  if (settings.left) await spaces();
}

