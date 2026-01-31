import * as clack from "@clack/prompts";
import { text as textComponent } from "../components/text.js";

export { isCancel, cancel, log } from "@clack/prompts";

export function intro(title: string): void {
  clack.intro(textComponent.intro(title));
}

export function outro(message: string): void {
  clack.outro(message);
}

export function note(message: string, title?: string): void {
  clack.note(message, title);
}

export type SelectOptions<T extends { value: unknown; label?: string }[]> = Parameters<typeof clack.select<T>>[0];

export async function select<T extends { value: unknown; label?: string }[]>(
  opts: SelectOptions<T>
): Promise<T[number]["value"] | symbol> {
  return clack.select(opts);
}

export type TextOptions = Parameters<typeof clack.text>[0];

export async function text(opts: TextOptions): Promise<string | symbol> {
  return clack.text(opts);
}

export type ConfirmOptions = Parameters<typeof clack.confirm>[0];

export async function confirm(opts: ConfirmOptions): Promise<boolean | symbol> {
  return clack.confirm(opts);
}

export type PasswordOptions = Parameters<typeof clack.password>[0];

export async function password(opts: PasswordOptions): Promise<string | symbol> {
  return clack.password(opts);
}

export type SpinnerOptions = {
  start: (message?: string) => void;
  stop: (message?: string, code?: number) => void;
  message: (message?: string) => void;
};

export function spinner(): SpinnerOptions {
  return clack.spinner();
}
