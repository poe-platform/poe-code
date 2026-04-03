#!/usr/bin/env node
import { createTerminalPngMcpServer } from "./index.js";

await createTerminalPngMcpServer().listen();
