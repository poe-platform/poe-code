export function composeMiddleware(middleware, terminal) {
    const stack = [...middleware];
    if (typeof terminal !== "function" || stack.some((handler) => typeof handler !== "function")) {
        throw new TypeError("Middleware and terminal handlers must be functions");
    }
    return async (context) => {
        let lastIndex = -1;
        const dispatch = async (index) => {
            if (index <= lastIndex)
                throw new Error("next() may only be called once per middleware");
            lastIndex = index;
            context.signal.throwIfAborted();
            const handler = stack[index];
            if (!handler)
                return terminal(context);
            let active = true;
            let downstream;
            let downstreamPending = false;
            const next = () => {
                const result = active
                    ? dispatch(index + 1)
                    : Promise.reject(new Error("next() cannot be called after middleware completed"));
                if (active && !downstream) {
                    downstream = result;
                    downstreamPending = true;
                    void result.then(() => { downstreamPending = false; }, () => { downstreamPending = false; });
                }
                else
                    void result.catch(() => { });
                return result;
            };
            try {
                const result = await handler(context, next);
                if (downstreamPending)
                    throw new Error("Middleware must await or return next()");
                return result;
            }
            finally {
                active = false;
                if (downstream)
                    await downstream.then(() => { }, () => { });
            }
        };
        return dispatch(0);
    };
}
//# sourceMappingURL=plugin.js.map