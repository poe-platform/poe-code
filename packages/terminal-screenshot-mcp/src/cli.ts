#!/usr/bin/env node
import { createTerminalScreenshotMcpServer } from "./index.js";

await createTerminalScreenshotMcpServer().listen();
