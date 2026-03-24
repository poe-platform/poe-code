FROM node:22

# Create non-root user
RUN useradd -m -s /bin/bash poe

WORKDIR /build

# Copy and install the pre-built tarballs (needs root)
COPY poe-code.tgz e2e-docker-test-runner.tgz auth-store.tgz poe-oauth.tgz agent-defs.tgz design-system.tgz agent-spawn.tgz poe-acp-client.tgz tiny-mcp-client.tgz poe-agent.tgz tiny-stdio-mcp-server.tgz tiny-stdio-mcp-test-server.tgz ./
RUN npm install -g commander ./poe-code.tgz ./e2e-docker-test-runner.tgz ./auth-store.tgz ./poe-oauth.tgz ./agent-defs.tgz ./design-system.tgz ./agent-spawn.tgz ./poe-acp-client.tgz ./tiny-mcp-client.tgz ./poe-agent.tgz && \
    npm install --prefix /opt/mcp-test @modelcontextprotocol/sdk ./tiny-stdio-mcp-server.tgz ./tiny-stdio-mcp-test-server.tgz && \
    ln -sf /opt/mcp-test/node_modules/.bin/tiny-stdio-mcp-test-server /usr/local/bin/tiny-stdio-mcp-test-server && \
    mkdir -p /node_modules/@poe-code && \
    ln -sf /usr/local/lib/node_modules/@poe-code/poe-agent /node_modules/@poe-code/poe-agent && \
    mv poe-code.tgz /opt/poe-code.tgz && \
    node --input-type=module -e "await import.meta.resolve('@poe-code/poe-agent')" >/dev/null && \
    proxy-server --help >/dev/null && \
    rm e2e-docker-test-runner.tgz auth-store.tgz poe-oauth.tgz agent-defs.tgz design-system.tgz agent-spawn.tgz poe-acp-client.tgz tiny-mcp-client.tgz poe-agent.tgz tiny-stdio-mcp-server.tgz tiny-stdio-mcp-test-server.tgz

# Install agents that use global npm install (needs root)
RUN poe-code install codex && \
    poe-code install opencode

# Allow the non-root user to manage global npm packages
RUN chown -R poe:poe /usr/local/lib/node_modules /usr/local/bin

# Switch to non-root user
USER poe
ENV HOME=/home/poe

# Install uv for Python tools
RUN curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet
ENV PATH="/home/poe/.local/bin:$PATH"

# Install agents that install to user home (~/.local/bin)
RUN poe-code install claude-code && \
    poe-code install kimi

WORKDIR /workspace
