import { describe, expect, expectTypeOf, it } from "vitest";
import type { CommandNode } from "toolcraft";
import type {
  AuthProvider,
  BearerTokenAuthOptions,
  CommandsFromSpecOptions,
  CommandContributor,
  Diagnostic,
  DefineClientFromSpecOptions,
  DefineClientOptions,
  DefinedClient,
  GenerateOptions,
  GeneratedFile,
  HttpRequestOptions,
  OpenApiDocument,
  OpenApiClientServices,
  ToolcraftConfig,
  TokenSource
} from "./index.js";
import * as entrypoint from "./index.js";
import { HttpError } from "./index.js";

describe("toolcraft-openapi", () => {
  it("loads the package entrypoint", () => {
    expect(Object.keys(entrypoint).sort()).toEqual([
      "DIAGNOSTIC_CODES",
      "HttpError",
      "SUPPORTED_TOOLCRAFT_EDITION",
      "bearerTokenAuth",
      "commandsFromSpec",
      "defineApiCommand",
      "defineClient",
      "defineClientFromSpec",
      "diagnose",
      "formatDiagnostic",
      "formatDiagnostics",
      "generate",
      "inspectOpenApiDocument",
      "inspectOpenApiSource",
      "mergeToolcraftConfig",
      "prepareMultipartFileInputs",
      "readToolcraftConfig",
      "renderOpenApiInspection",
      "requestJson",
      "resolveOpenApiBaseUrl",
      "validateToolcraftConfig",
      "writeBinaryResponseOutput"
    ]);
  });

  it("exports config and diagnostic public types", () => {
    expectTypeOf<ToolcraftConfig>().toMatchTypeOf<{
      edition: string;
    }>();
    expectTypeOf<Diagnostic>().toMatchTypeOf<{
      code: string;
      severity: "error" | "warn";
      message: string;
    }>();
  });

  it("defines token sources that can resolve and invalidate tokens", () => {
    expectTypeOf<TokenSource>().toMatchTypeOf<{
      getToken: () => Promise<string>;
      invalidate?: () => Promise<void>;
    }>();
  });

  it("defines command contributors as toolcraft command collections", () => {
    expectTypeOf<CommandContributor>().toMatchTypeOf<{
      commands: CommandNode<any>[];
    }>();
  });

  it("allows auth providers to combine token access and contributed commands", () => {
    type InlineAuthProvider = {
      getToken: () => Promise<string>;
      invalidate?: () => Promise<void>;
      commands: CommandNode<any>[];
    };

    expectTypeOf<AuthProvider>().toMatchTypeOf<InlineAuthProvider>();
  });

  it("exports bearerTokenAuth options for client auth configuration", () => {
    expectTypeOf<BearerTokenAuthOptions>().toMatchTypeOf<{
      serviceName: string;
      envVar: string;
      whoamiPath?: string;
      commandPrefix?: string;
    }>();
  });

  it("exports defineClient options with generated and handwritten command lists", () => {
    expectTypeOf<DefineClientOptions>().toMatchTypeOf<{
      name: string;
      baseUrl: string;
      auth: AuthProvider;
      commands: CommandNode<any>[];
      handwrittenCommands?: CommandNode<any>[];
    }>();
  });

  it("exports the shared services shape for generated command handlers", () => {
    expectTypeOf<OpenApiClientServices>().toMatchTypeOf<{
      baseUrl: string;
      tokenSource: TokenSource;
    }>();
  });

  it("exports the defined client shape", () => {
    expectTypeOf<DefinedClient>().toMatchTypeOf<{
      name: string;
      mcpPrefix: string;
      root: CommandNode<any>;
      services: OpenApiClientServices;
    }>();
  });

  it("exports defineClient with the public options and result types", () => {
    expectTypeOf<typeof entrypoint.defineClient>().toMatchTypeOf<
      (options: DefineClientOptions) => DefinedClient
    >();
  });

  it("exports defineClientFromSpec options with spec loading fields", () => {
    expectTypeOf<DefineClientFromSpecOptions>().toMatchTypeOf<{
      name: string;
      baseUrl: string;
      auth: AuthProvider;
      handwrittenCommands?: CommandNode<any>[];
      cwd?: string;
      fetch?: typeof globalThis.fetch;
    }>();
  });

  it("exports defineClientFromSpec with the public signature", () => {
    expectTypeOf<typeof entrypoint.defineClientFromSpec>().toMatchTypeOf<
      (
        spec: OpenApiDocument | string | URL,
        options: DefineClientFromSpecOptions
      ) => Promise<DefinedClient>
    >();
  });

  it("exports the generate() option and result shapes", () => {
    expectTypeOf<GenerateOptions>().toMatchTypeOf<{
      specSha: string;
    }>();

    expectTypeOf<GeneratedFile>().toMatchTypeOf<{
      path: string;
      contents: string;
    }>();

    expectTypeOf<OpenApiDocument>().toMatchTypeOf<{
      paths?: Record<string, unknown>;
    }>();
  });

  it("exports generate() with the public signature", () => {
    expectTypeOf<typeof entrypoint.generate>().toMatchTypeOf<
      (document: OpenApiDocument, options: GenerateOptions) => GeneratedFile[]
    >();
  });

  it("exports commandsFromSpec() with the public signature", () => {
    expectTypeOf<CommandsFromSpecOptions>().toMatchTypeOf<{
      cwd?: string;
      fetch?: typeof globalThis.fetch;
      fs?: {
        readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
      };
    }>();

    expectTypeOf<typeof entrypoint.commandsFromSpec>().toMatchTypeOf<
      (
        source: OpenApiDocument | string | URL,
        options?: CommandsFromSpecOptions
      ) => Promise<CommandNode<any>[]>
    >();
  });

  it("exports the HTTP request option shape", () => {
    expectTypeOf<HttpRequestOptions>().toMatchTypeOf<{
      baseUrl: string;
      path: string;
      method: string;
      auth: "required" | "none";
      tokenSource: TokenSource;
    }>();
  });

  it("exports requestJson with the public request shape", () => {
    expectTypeOf<typeof entrypoint.requestJson>().toMatchTypeOf<
      (options: HttpRequestOptions) => Promise<unknown>
    >();
  });

  it("exports an HTTP error with status and body fields", () => {
    expect(
      new HttpError({
        request: {
          method: "GET",
          url: "https://api.example.com/teapot",
          headers: {}
        },
        response: {
          status: 418,
          statusText: "I'm a Teapot",
          headers: {},
          body: { ok: false }
        }
      })
    ).toMatchObject({
      status: 418,
      statusText: "I'm a Teapot",
      body: { ok: false }
    });
  });
});
