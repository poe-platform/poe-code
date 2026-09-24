/** Runtime state access carried through command middleware without exposing mutable bindings. */
export const variablePresence = Symbol("variablePresence");

export interface VariablePresenceContext {
  readonly [variablePresence]?: (name: string) => Promise<boolean>;
}
