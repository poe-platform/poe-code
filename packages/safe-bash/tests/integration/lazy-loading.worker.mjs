import {
  Shell,
  createMemoryFileSystem,
  agentCommands,
  optionalCommands,
  optionalCommandCatalog
} from "lazy-shell";
import { pythonCommands } from "lazy-python";
import { llmCommands } from "lazy-llm";

export default {
  async fetch(request) {
    try {
      const began = performance.now();
      const fs = createMemoryFileSystem();
      const shell = new Shell({ fs, cwd: "/", env: { MARK: "worker" } })
        .use(agentCommands())
        .use(optionalCommands({ profile: "full" }))
        .use(
          pythonCommands({
            createExecutor: () => ({
              async run(start) {
                start.onReady();
                return 0;
              },
              terminate() {}
            })
          })
        )
        .use(
          llmCommands({
            defaultModel: "fixture",
            providers: [
              {
                name: "fixture",
                models: [{ id: "fixture" }],
                async *complete() {
                  yield "fixture reply";
                }
              }
            ]
          })
        );
      const setupMs = performance.now() - began;
      const discovery = optionalCommandCatalog.length;
      const ordinary = await shell.exec(
        "printf 'plain shell\\n'; command -v pdftotext; python -c pass; llm fixture"
      );
      const before = [...(globalThis.__lazyEngineEvaluations ?? [])];
      if (new URL(request.url).pathname === "/setup") {
        await shell.dispose();
        return Response.json({ setupMs, discovery, before, ordinary });
      }
      const firstAt = performance.now();
      const first = await shell.exec(
        "printf 'name,value\\na,2\\nb,1\\n' | csvsort -c value | csvcut -c name"
      );
      const firstMs = performance.now() - firstAt;
      const afterCsv = [...(globalThis.__lazyEngineEvaluations ?? [])];
      const secondAt = performance.now();
      const second = await shell.exec("printf 'name,value\\nc,3\\n' | csvsort -c value");
      const secondMs = performance.now() - secondAt;
      const pdf = await shell.exec(
        "printf '<h1>Lazy PDF</h1>' | wkhtmltopdf - /lazy.pdf; pdftotext /lazy.pdf -"
      );
      const media = await shell.exec("ffprobe -version");
      const git = await shell.exec("git --version");
      const disposedAt = performance.now();
      await shell.dispose();
      return Response.json({
        setupMs,
        firstMs,
        secondMs,
        cleanupMs: performance.now() - disposedAt,
        discovery,
        before,
        afterCsv,
        after: globalThis.__lazyEngineEvaluations,
        ordinary,
        first,
        second,
        pdf,
        media,
        git
      });
    } catch (error) {
      return Response.json({ error: String(error), stack: error.stack }, { status: 500 });
    }
  }
};
