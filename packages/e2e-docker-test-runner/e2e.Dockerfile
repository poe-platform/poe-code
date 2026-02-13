FROM node:22

# Create non-root user
RUN useradd -m -s /bin/bash poe

WORKDIR /build

# Copy and install the pre-built tarballs (needs root)
COPY poe-code.tgz tiny-stdio-mcp-server.tgz tiny-stdio-mcp-test-server.tgz ./
RUN npm install -g ./poe-code.tgz && \
    npm install --prefix /opt/mcp-test @modelcontextprotocol/sdk ./tiny-stdio-mcp-server.tgz ./tiny-stdio-mcp-test-server.tgz && \
    ln -sf /opt/mcp-test/node_modules/.bin/tiny-stdio-mcp-test-server /usr/local/bin/tiny-stdio-mcp-test-server && \
    rm poe-code.tgz tiny-stdio-mcp-server.tgz tiny-stdio-mcp-test-server.tgz

# Install agents that use global npm install (needs root)
RUN poe-code install codex && \
    poe-code install opencode

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
