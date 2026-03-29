import * as http from "node:http";
import { URL } from "node:url";
import { PublicClientApplication, IPublicClientApplication, LogLevel } from "@azure/msal-node";

const DEFAULT_CLIENT_ID = "04b07795-8ddb-461a-bbee-02f9e1bf7b46"; // Azure CLI

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
}

export const noopLogger: Logger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export interface ServerOptions {
  port: number;
  identityHeader: string;
  openBrowser?: (url: string) => Promise<void>;
  logger?: Logger;
  createClient?: (clientId: string) => IPublicClientApplication; // For testing purposes, allows injection of a custom client factory
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  error: string,
  description: string,
): void {
  sendJson(res, statusCode, { error, error_description: description });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let brokerPlugin: any;

export class AuthBrokerServer {
  private server: http.Server | null = null;
  private openBrowser: (url: string) => Promise<void>;
  private logger: Logger;
  private identityHeader: string;
  port: number;
  private tokenClients = new Map<string, IPublicClientApplication>();
  private createClient?: (clientId: string) => IPublicClientApplication; // For testing purposes, allows injection of a custom client factory

  constructor(options: ServerOptions) {
    this.openBrowser = options.openBrowser ?? (async () => {});
    this.logger = options.logger ?? noopLogger;
    this.identityHeader = options.identityHeader;
    this.port = options.port;
    this.createClient = options.createClient;
  }

  get address(): string {
    const addr = this.server?.address();
    return (addr && typeof addr === 'object') ? addr.address : '127.0.0.1';
  }

  /** Start the HTTP server. Resolves once the server is listening. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
        }
        this.logger.info(`Server listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  /** Stop the HTTP server. */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        this.server = null;
        if (err) {
          reject(err);
        } else {
          this.logger.info("Server stopped");
          resolve();
        }
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "?";

    try {
      this.logger.debug(`Request: ${method} ${url}`);
      await this.handleRequestInner(req, res, url);
    } catch (err) {
      this.logger.error(`Unhandled exception handling ${method} ${url}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      if (!res.headersSent) {
        sendError(res, 500, "internal_error", err instanceof Error ? err.message : String(err));
      }
    }
    this.logger.info(`${method} ${url} → ${res.statusCode}`);
  }

  private async handleRequestInner(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    // Only allow GET
    if (req.method !== "GET") {
      sendError(res, 404, "not_found", `Method not allowed: ${req.method}`);
      return;
    }

    // Health check endpoint — returns the server's command-line parameters.
    if (url.pathname === "/health") {
      sendJson(res, 200, {
        port: this.port,
        identityHeader: this.identityHeader,
      });
      return;
    }

    // Only /oauth2/token is supported beyond /health
    if (url.pathname !== "/oauth2/token") {
      sendError(
        res,
        404,
        "not_found",
        `The requested path does not exist: ${url.pathname}`,
      );
      return;
    }

    // Validate X-IDENTITY-HEADER
    const identityHeader = req.headers["x-identity-header"] as string | undefined;
    if (!identityHeader) {
      this.logger.warn("Rejected: Missing required header: X-IDENTITY-HEADER");
      sendError(
        res,
        401,
        "missing_identity_header",
        "Missing required header: X-IDENTITY-HEADER",
      );
      return;
    }
    if (identityHeader !== this.identityHeader) {
      this.logger.warn(`Rejected: Invalid X-IDENTITY-HEADER value ${identityHeader}`);
      sendError(
        res,
        403,
        "invalid_identity_header",
        `Invalid X-IDENTITY-HEADER value: ${identityHeader}`,
      );
      return;
    }

    // Parse resource
    const resource = url.searchParams.get("resource");
    if (!resource) {
      sendError(
        res,
        400,
        "invalid_resource",
        "Missing required query parameter: resource",
      );
      return;
    }

    const clientId = url.searchParams.get("client_id") ?? DEFAULT_CLIENT_ID;

    // Convert resource to scope
    const scope = resource.endsWith("/.default") ? resource : resource.replace(/\/+$/, "") + "/.default";

    this.logger.info(`Token request: clientId=${clientId}, scope=${scope}`);

    const client = await this.getTokenClient(clientId);

    this.logger.debug(`Attempting token acquisition`);
    let result;
    try {
      result = await client.acquireTokenInteractive({ scopes: [scope], openBrowser: this.openBrowser });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Token acquisition failed: ${message}`);
      sendError(res, 500, "credential_error", message);
      return;
    }

    const expiresOn = result.expiresOn ? Math.floor(result.expiresOn.getTime() / 1000) : 0;
    sendJson(res, 200, { access_token: result.accessToken, expires_on: expiresOn });
  }
    
  private async getTokenClient(clientId: string): Promise<IPublicClientApplication> {
    if (!brokerPlugin) {
      this.logger.info("Initializing NativeBrokerPlugin for token acquisition");

      // Delay-load msal-node-extensions to avoid having to install libsecret-1.so.0 to run unit tests
      const { NativeBrokerPlugin } = await import("@azure/msal-node-extensions");
      brokerPlugin = new NativeBrokerPlugin();
      if (!brokerPlugin.isBrokerAvailable) {
        // Log the reason for unavailability if possible
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const msalNodeRuntime = require("@azure/msal-node-runtime") as {
            msalNodeRuntime?: { StartupError?: unknown };
          };
          const startupError = msalNodeRuntime.msalNodeRuntime?.StartupError;
          this.logger.error(
            `Native broker is not available: ${startupError ? JSON.stringify(startupError) : "unknown error"}`,
          );
        } catch {
          this.logger.error("Native broker is not available and @azure/msal-node-runtime could not be loaded");
        }
      }
    }

    let pca = this.tokenClients.get(clientId);
    if (!pca) {
      this.logger.info(`Creating new PublicClientApplication for clientId=${clientId}`);

      if (this.createClient) {
        pca = this.createClient(clientId);
      } else {
        pca = new PublicClientApplication({
          auth: { clientId },
          broker: { nativeBrokerPlugin: brokerPlugin },
          system: {
            loggerOptions: {
              loggerCallback: (level, message) => this.logger.trace(message),
              logLevel: LogLevel.Trace,
              piiLoggingEnabled: false,
            },
          },
        });
      }
      
      this.tokenClients.set(clientId, pca);
    }
  
    return pca;
  }
}
