/**
 * Standalone HTTP authentication broker server.
 *
 * Runs MSAL PublicClientApplication and NativeBrokerPlugin in-process,
 * serving token requests over HTTP. No VS Code dependency.
 *
 * Can be run from the command line or as a subprocess of the VS Code extension.
 *
 * Usage:
 *   node broker-process.js --port 40342 --identity-header AuthBrokerServer
 *
 * Stdout protocol (one JSON-safe line per message):
 *   [error]       Error log message
 *   [warning]     Warning log message
 *   [info]        Informational log message
 *   [debug]       Debug log message
 *   [trace]       Trace log message
 *   [openBrowser] URL to open in a browser
 *
 * Newlines in messages are escaped as literal \n, carriage returns as \r,
 * and backslashes as \\.
 */

import { AuthBrokerServer, type Logger } from "./server.js";

// --- Stdout protocol --------------------------------------------------------

/** Escape newlines and backslashes so each message fits on a single line. */
function escapeForLine(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function printLine(prefix: string, message: string): void {
  process.stdout.write(`[${prefix}] ${escapeForLine(message)}\n`);
}

// --- Logger that writes prefixed lines to stdout ----------------------------

const logger: Logger = {
  trace: (msg) => printLine("trace", msg),
  debug: (msg) => printLine("debug", msg),
  info: (msg) => printLine("info", msg),
  warn: (msg) => printLine("warn", msg),
  error: (msg) => printLine("error", typeof msg === "string" ? msg : msg.message ?? String(msg)),
};

// --- CLI argument parsing ---------------------------------------------------

function parseArgs(argv: string[]): { port: number; identityHeader: string } {
  const args = argv.slice(2);
  let port = 40342;
  let identityHeader = "AuthBrokerServer";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--port":
        port = parseInt(args[++i], 10);
        if (isNaN(port) || port < 0 || port > 65535) {
          printLine("error", `Invalid --port value: ${args[i]}`);
          process.exit(1);
        }
        break;
      case "--identity-header":
        identityHeader = args[++i];
        if (!identityHeader) {
          printLine("error", "Missing value for --identity-header");
          process.exit(1);
        }
        break;
    }
  }

  return { port, identityHeader };
}

// --- Global error handlers --------------------------------------------------

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.stack ?? err.message}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  logger.error(`Unhandled rejection: ${msg}`);
});

// --- Start server -----------------------------------------------------------

const config = parseArgs(process.argv);

const server = new AuthBrokerServer({
  port: config.port,
  identityHeader: config.identityHeader,
  openBrowser: async (url) => printLine("openBrowser", url),
  logger,
});

function shutdown() {
  server.stop().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.start().catch((err) => {
  logger.error(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
