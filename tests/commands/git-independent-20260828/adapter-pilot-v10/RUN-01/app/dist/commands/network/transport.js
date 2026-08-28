import { request as httpRequest, validateHeaderName, validateHeaderValue } from "node:http";
import { request as httpsRequest } from "node:https";
import { readBytes } from "../../contracts/index.js";
import { CurlError } from "./types.js";
import { withSignal } from "./shared.js";
export function createNodeHttpTransport(options = {}) {
    const maxHeaderSize = options.maxHeaderBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(maxHeaderSize) || maxHeaderSize < 1)
        throw new RangeError("Invalid header limit");
    const ca = Array.isArray(options.ca) ? [...options.ca] : options.ca;
    return async (input) => {
        input.signal.throwIfAborted();
        const url = new URL(input.url);
        if (!["http:", "https:"].includes(url.protocol))
            throw new CurlError(1, "Unsupported protocol");
        const headers = Object.create(null);
        for (const [name, value] of input.headers) {
            validateHeaderName(name);
            validateHeaderValue(name, value);
            (headers[name.toLowerCase()] ??= []).push(value);
        }
        const stopped = new AbortController();
        const signal = AbortSignal.any([input.signal, stopped.signal]);
        return new Promise((resolve, reject) => {
            let request;
            let finish;
            const closed = new Promise(resolve => { finish = resolve; });
            let cleanup;
            const dispose = () => {
                cleanup ??= Promise.resolve().then(async () => {
                    stopped.abort();
                    if (request) {
                        request.destroy();
                        await closed;
                    }
                });
                return cleanup;
            };
            input.registerCleanup?.(dispose);
            request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
                method: input.method, headers, signal, maxHeaderSize, agent: false,
                ...(ca === undefined ? {} : { ca: ca }),
            }, response => {
                const responseHeaders = [];
                for (let index = 0; index < response.rawHeaders.length; index += 2) {
                    responseHeaders.push([response.rawHeaders[index], response.rawHeaders[index + 1]]);
                }
                const body = (async function* () {
                    try {
                        for await (const chunk of response) {
                            input.signal.throwIfAborted();
                            yield new Uint8Array(chunk);
                        }
                    }
                    finally {
                        response.destroy();
                        await dispose();
                    }
                })();
                resolve({
                    status: response.statusCode ?? 0, statusText: response.statusMessage ?? "",
                    httpVersion: response.httpVersion, headers: responseHeaders, body,
                    async dispose() { response.destroy(); await dispose(); },
                });
            });
            request.on("error", reject);
            request.on("close", () => { stopped.abort(); finish?.(); });
            const upload = async () => {
                if (input.body)
                    for await (const chunk of readBytes(input.body, signal)) {
                        await withSignal(() => new Promise((done, failed) => {
                            request.write(chunk, error => error ? failed(error) : done());
                        }), signal);
                    }
                request.end();
            };
            void upload().catch(error => request.destroy(error instanceof Error ? error : new Error("Upload canceled")));
        });
    };
}
//# sourceMappingURL=transport.js.map