# Authorization server request body bounds

Two red in-memory request checks reproduced fully buffering oversized streamed request bodies and retaining declared oversized bodies. Read request chunks under the existing maxRequestBodyBytes limit, cancel on early rejection or abort, and release reader locks. Retain protocol error mapping for oversized bodies.

A third red registration check reproduced accepting malformed UTF-8 with a changed redirect URI (201 instead of 400). Decode strictly and report invalid_request when request bytes are malformed.

Run the maintained authorization server package suite, scope lint, and types. These in-memory checks do not verify TCP deployment.
