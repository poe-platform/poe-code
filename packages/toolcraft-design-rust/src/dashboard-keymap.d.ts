type KeypressEvent = {
  name?: string;
  ch?: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};
import type {Command} from "./dashboard-types.js";

export declare function createKeymap(
  overrides?: Partial<Record<Command, string[]>>
): (event: KeypressEvent) => Command | undefined;
export declare function createKeymap<TCommand extends string>(
  overrides: Partial<Record<TCommand, string[]>> | undefined,
  options: {
    commands: readonly TCommand[];
    defaultBindings: Record<TCommand, readonly string[]>;
  }
): (event: KeypressEvent) => TCommand | undefined;
export declare function canonicalizeBinding(binding: string): string | undefined;
