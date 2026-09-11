export interface BrowserWorkerResource {
  worker: Pick<Worker, "addEventListener" | "removeEventListener" | "postMessage">;
  close(): void;
}
export const browserWorkerRuntime: {
  create(identity: string, workerData: unknown): BrowserWorkerResource;
};
