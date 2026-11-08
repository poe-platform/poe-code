export interface NativeSpecification {
  id: string;
  category: string;
  inputHex: string;
  argv?: string[];
  files?: Record<string, string>;
  allBoundaries?: boolean;
  stages?: string[][];
}
export const cases: NativeSpecification[];
