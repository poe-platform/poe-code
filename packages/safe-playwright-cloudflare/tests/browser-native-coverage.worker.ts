import { RpcTarget } from "cloudflare:workers";
import type { Browser, Frame, Page } from "@cloudflare/playwright";
import type { CoverageMapData } from "istanbul-lib-coverage";

export const coverageSnapshots: CoverageMapData[] = [];

class CoverageSink extends RpcTarget {
	record(coverage: CoverageMapData) {
		coverageSnapshots.push(coverage);
	}
}

/** Preserve RPC result/disposal semantics while giving the test guest a sink. */
export function coverageLoader(loader: WorkerLoader) {
	return {
		load(options: Parameters<WorkerLoader["load"]>[0]) {
			const worker = loader.load(options);
			return {
				getEntrypoint(...args: Parameters<typeof worker.getEntrypoint>) {
					const entry = worker.getEntrypoint(...args) as unknown as {
						// type-erasure-boundary -- The instrumentation wrapper forwards opaque guest RPC arguments and adds its test-only coverage sink.
						run(relay: unknown, metadata: object): Promise<unknown>;
						[Symbol.dispose]?(): void;
					};
					return {
						run: (relay: unknown, metadata: object) =>
							entry.run(relay, {
								...metadata,
								coverageSink: new CoverageSink(),
							}),
						[Symbol.dispose]: () => entry[Symbol.dispose]?.(),
					};
				},
			};
		},
	};
}

/** Read counters from the same native utility worlds that serialized the tree. */
export async function collectRendererCoverage(browser: Browser, page: Page) {
	const connection = (
		browser as Browser & {
			_connection: {
				toImpl(frame: Frame): {
					_utilityContext(): Promise<{
						rawEvaluateJSON(source: string): Promise<CoverageMapData>;
					}>;
				};
			};
		}
	)._connection;
	await Promise.all(
		page.frames().map(async (frame) => {
			const context = await connection.toImpl(frame)._utilityContext();
			const coverage = await context.rawEvaluateJSON(
				"globalThis.__coverage__ ?? {}",
			);
			if (Object.keys(coverage).length) coverageSnapshots.push(coverage);
		}),
	);
}
