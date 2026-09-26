declare module "citeproc" {
  interface Cluster {
    citationID: string;
    citationItems: Record<string, unknown>[];
    properties: {noteIndex: number; mode?: string};
  }
  class Engine {
    readonly opt: {readonly xclass: string};
    constructor(system: {retrieveLocale(language: string): string; retrieveItem(id: string): Record<string, unknown>}, style: string, language?: string);
    rebuildProcessorState(citations: Cluster[], mode: "html", uncited: string[]): [string, number, string][];
    makeBibliography(): false | [Record<string, unknown>, string[]];
  }
  const CSL: {Engine: typeof Engine};
  export default CSL;
}
