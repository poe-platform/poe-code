# Client resource URI parity

Five red in-memory result regressions reproduced malformed resource URIs being exposed in resources/list, resources/read, direct resource links, embedded resources, and prompt resource links. An independent main-Node QA reproduced a modern tool link with URI "not a URI" being accepted. The server already rejects these values.

Move the existing absolute-URI helper into its owning server package, export it through the protocol entry point, and reuse it at client resource/content boundaries. The client result and maintained server protocol/result matrix passes 83 cases in /tmp/mcp-client-resource-uri-tests-green.log. Preserve custom schemes and existing accepted URI behavior. No README additions or delivery claims are made.
