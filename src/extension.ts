import * as vscode from "vscode";
import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as readline from "node:readline";

let brokerProcess: ChildProcess | undefined;
let intentionalStop = false;
let restartCount = 0;
let statusBarItem: vscode.StatusBarItem | undefined;
let log: vscode.LogOutputChannel | undefined;

const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 2000;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("authBroker");
  return {
    port: cfg.get<number>("port", 40342),
    identityHeader: cfg.get<string>("identityHeader", "AuthBrokerServer"),
  };
}

// --- Stdout line protocol ---------------------------------------------------

/** Unescape the line-safe encoding produced by the broker process. */
function unescapeLine(s: string): string {
  return s.replace(/\\(\\|n|r)/g, (_, ch) => {
    switch (ch) {
      case "\\": return "\\";
      case "n": return "\n";
      case "r": return "\r";
      default: return ch;
    }
  });
}

const LINE_PREFIX_RE = /^\[(\w+)\] (.*)/s;

function processLine(line: string): void {
  const match = LINE_PREFIX_RE.exec(line);
  if (!match) {
    log?.warn(line);
    return;
  }

  const [, prefix, rawMessage] = match;
  const message = unescapeLine(rawMessage);

  switch (prefix) {
    case "error":
      log?.error(message);
      break;
    case "warn":
      log?.warn(message);
      break;
    case "info":
      log?.info(message);
      break;
    case "debug":
      log?.debug(message);
      break;
    case "trace":
      log?.trace(message);
      break;
    case "openBrowser":
      vscode.env.openExternal(vscode.Uri.parse(message));
      break;
    default:
      log?.warn(`[${prefix}] ${message}`);
      break;
  }
}

// --- Process management -----------------------------------------------------

function startBrokerProcess(port: number, identityHeader: string): void {
  const brokerPath = path.join(__dirname, "process.js");

  brokerProcess = spawn(process.execPath, [
    brokerPath,
    "--port", String(port),
    "--identity-header", identityHeader,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutRl = readline.createInterface({ input: brokerProcess.stdout! });
  stdoutRl.on("line", processLine);

  // Redirect stderr lines as warnings
  const stderrRl = readline.createInterface({ input: brokerProcess.stderr! });
  stderrRl.on("line", (line) => {
    log?.warn(`[stderr] ${line}`);
  });

  brokerProcess.on("error", (err) => {
    log?.error(`Broker process error: ${err.message}`);
    brokerProcess = undefined;
    updateStatusBar(false);
  });

  brokerProcess.on("exit", (code, signal) => {
    brokerProcess = undefined;
    updateStatusBar(false);

    if (intentionalStop) {
      log?.info("Broker process stopped");
      return;
    }

    log?.warn(`Broker process exited unexpectedly (code=${code}, signal=${signal})`);

    if (restartCount < MAX_RESTARTS) {
      restartCount++;
      log?.info(`Restarting broker process (attempt ${restartCount}/${MAX_RESTARTS})...`);
      setTimeout(() => startServer(), RESTART_DELAY_MS);
    } else {
      log?.error(`Broker process crashed ${MAX_RESTARTS} times — not restarting`);
      vscode.window.showErrorMessage(
        "Auth Broker process crashed repeatedly. Check the Auth Broker output for details.",
      );
    }
  });
}

// --- Commands ---------------------------------------------------------------

async function startServer() {
  log?.debug("Command: startServer");
  if (brokerProcess) {
    vscode.window.showInformationMessage("Auth Broker already running.");
    return;
  }

  intentionalStop = false;
  const { port, identityHeader } = getConfig();

  try {
    startBrokerProcess(port, identityHeader);
    restartCount = 0;
    updateStatusBar(true, port);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Auth Broker failed to start: ${message}`);
    log?.error(`Failed to start: ${message}`);
  }
}

async function stopServer() {
  log?.debug("Command: stopServer");
  if (!brokerProcess) {
    vscode.window.showInformationMessage("Auth Broker is not running.");
    return;
  }

  intentionalStop = true;
  brokerProcess.kill();
  brokerProcess = undefined;
  updateStatusBar(false);
}

function updateStatusBar(running: boolean, port?: number) {
  if (!statusBarItem) {
    return;
  }
  if (running && port) {
    statusBarItem.text = "$(shield)";
    statusBarItem.tooltip = `Auth Broker running on http://127.0.0.1:${port}`;
    statusBarItem.command = "vscode-auth-broker.stop";
  } else {
    statusBarItem.text = "$(circle-large-outline)";
    statusBarItem.tooltip = "Auth Broker stopped. Click to start.";
    statusBarItem.command = "vscode-auth-broker.start";
  }
  statusBarItem.show();
}

async function copyDevContainerConfig() {
  log?.debug("Command: copyDevContainerConfig");
  const { port, identityHeader } = getConfig();
  const snippet = JSON.stringify(
    {
      remoteEnv: {
        IDENTITY_ENDPOINT: `http://host.docker.internal:${port}/oauth2/token`,
        IDENTITY_HEADER: identityHeader,
      },
    },
    null,
    4,
  );
  await vscode.env.clipboard.writeText(snippet);
  vscode.window.showInformationMessage(
    "Dev Container remoteEnv config copied to clipboard.",
  );
}

export async function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("Auth Broker", { log: true });
  context.subscriptions.push(log);
  log.info("Activating Auth Broker extension");

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("vscode-auth-broker.start", startServer),
    vscode.commands.registerCommand("vscode-auth-broker.stop", stopServer),
    vscode.commands.registerCommand(
      "vscode-auth-broker.copyDevContainerConfig",
      copyDevContainerConfig,
    ),
  );

  // Auto-start on activation
  await startServer();
}

export async function deactivate() {
  log?.info("Deactivating Auth Broker extension");
  if (brokerProcess) {
    intentionalStop = true;
    brokerProcess.kill();
    brokerProcess = undefined;
  }
}
