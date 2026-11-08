import type { TerminalKey as TerminalKeyFromKeys } from "./keys.js";
import type { NewSessionOptions as NewSessionOptionsFromPilot } from "./terminal-pilot.js";
import type {
  HistoryOptions as HistoryOptionsFromSession,
  WaitForOptions as WaitForOptionsFromSession
} from "./terminal-session.js";
import type {
  HistoryOptions,
  NewSessionOptions,
  TerminalKey,
  WaitForOptions
} from "./index.js";

type AssertAssignable<To, ignoredFrom extends To> = true;

type ignoredTerminalKeyIsExported = AssertAssignable<TerminalKeyFromKeys, TerminalKey>;
type ignoredTerminalKeyMatchesSource = AssertAssignable<TerminalKey, TerminalKeyFromKeys>;

type ignoredNewSessionOptionsIsExported = AssertAssignable<
  NewSessionOptionsFromPilot,
  NewSessionOptions
>;
type ignoredNewSessionOptionsMatchSource = AssertAssignable<
  NewSessionOptions,
  NewSessionOptionsFromPilot
>;

type ignoredWaitForOptionsIsExported = AssertAssignable<
  WaitForOptionsFromSession,
  WaitForOptions
>;
type ignoredWaitForOptionsMatchSource = AssertAssignable<
  WaitForOptions,
  WaitForOptionsFromSession
>;

type ignoredHistoryOptionsIsExported = AssertAssignable<
  HistoryOptionsFromSession,
  HistoryOptions
>;
type ignoredHistoryOptionsMatchSource = AssertAssignable<
  HistoryOptions,
  HistoryOptionsFromSession
>;

type ignoredTerminalPilotIsExported = typeof import("./index.js").TerminalPilot;
type ignoredTerminalSessionIsExported = typeof import("./index.js").TerminalSession;
type ignoredTerminalScreenIsExported = typeof import("./index.js").TerminalScreen;

// @ts-expect-error matchPattern is internal and must not be exported
type ignoredInternalHelperIsNotExported = typeof import("./index.js").matchPattern;
