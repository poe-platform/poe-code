import type { Module } from "./parser.js";

export type SourceImport = { request: string; imported: string; namespace?: true; local: string };
export type SourceExport = { exported?: string; local?: string; request?: string; imported?: string; namespace?: true };
export type SourceModuleSyntax = {
  moduleRequests: Array<{specifier: string; attributes: Array<[string, string]>}>;
  imports: SourceImport[];
  exports: SourceExport[];
};
export type ParsedSourceModule = SourceModuleSyntax & {
  hasTLA: boolean;
  module: Module;
  requests: string[];
};
