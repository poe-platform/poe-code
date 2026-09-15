#!/usr/bin/env node
import { runOpCli } from "./node-host.js";

process.exitCode = await runOpCli(process.argv.slice(2));
