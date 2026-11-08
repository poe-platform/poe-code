export declare const text: {
  readonly intro: (content: string) => string;
  readonly heading: (content: string) => string;
  readonly section: (content: string) => string;
  readonly sectionHeader: (content: string) => string;
  readonly command: (content: string) => string;
  readonly argument: (content: string) => string;
  readonly option: (content: string) => string;
  readonly example: (content: string) => string;
  readonly usageCommand: (content: string) => string;
  readonly link: (content: string) => string;
  readonly muted: (content: string) => string;
  readonly error: (content: string) => string;
  readonly badge: (content: string) => string;
  readonly selectLabel: (label: string, detail?: string) => string;
};
export { typography } from "./typography.js";
