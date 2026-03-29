import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AuthBrokerServer } from "../server.js";

const IDENTITY_HEADER = "AuthBrokerServer";
const FAKE_EXPIRES_ON = 1700000000;
const FAKE_EXPIRES_ON_DATE = new Date(FAKE_EXPIRES_ON * 1000);

function createMockClient() {
  const acquireTokenInteractive = mock.fn(async () => ({
    accessToken: "fake-access-token",
    expiresOn: FAKE_EXPIRES_ON_DATE,
  }));
  return { acquireTokenInteractive };
}

function get(
  port: number,
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${port}${path}`,
      { headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on("error", reject);
  });
}

function identityHeaders(): Record<string, string> {
  return { "X-IDENTITY-HEADER": IDENTITY_HEADER };
}

describe("AuthBrokerServer", () => {
  let server: AuthBrokerServer;
  let mockClient: ReturnType<typeof createMockClient>;
  let mockCreateClient: ReturnType<typeof mock.fn>;

  beforeEach(async () => {
    mockClient = createMockClient();
    mockCreateClient = mock.fn(() => mockClient);
    server = new AuthBrokerServer({
      port: 0, // random port
      identityHeader: IDENTITY_HEADER,
      createClient: mockCreateClient as any,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // -- Success cases ---------------------------------------------------------

  it("returns a token for a valid request", async () => {
    const { status, body } = await get(
      server.port,
      "/oauth2/token?api-version=2019-08-01&resource=https%3A%2F%2Fmanagement.azure.com%2F",
      identityHeaders(),
    );
    const data = JSON.parse(body);

    assert.equal(status, 200);
    assert.equal(data.access_token, "fake-access-token");
    assert.equal(data.expires_on, FAKE_EXPIRES_ON);
    assert.equal(mockClient.acquireTokenInteractive.mock.callCount(), 1);
    assert.deepEqual(mockClient.acquireTokenInteractive.mock.calls[0].arguments[0].scopes, [
      "https://management.azure.com/.default",
    ]);
  });

  it("handles resource that already has /.default suffix", async () => {
    const { status } = await get(
      server.port,
      "/oauth2/token?resource=https%3A%2F%2Fgraph.microsoft.com%2F.default",
      identityHeaders(),
    );

    assert.equal(status, 200);
    assert.deepEqual(mockClient.acquireTokenInteractive.mock.calls[0].arguments[0].scopes, [
      "https://graph.microsoft.com/.default",
    ]);
  });

  it("returns expires_on in the response", async () => {
    const { body } = await get(
      server.port,
      "/oauth2/token?resource=https%3A%2F%2Fr",
      identityHeaders(),
    );
    const data = JSON.parse(body);
    assert.equal(data.expires_on, FAKE_EXPIRES_ON);
  });

  it("returns Content-Type application/json", async () => {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${server.port}/oauth2/token?resource=r`,
        { headers: identityHeaders() },
        resolve,
      );
      req.on("error", reject);
    });
    // Drain the body
    for await (const _ of res) { /* discard */ }
    assert.equal(res.headers["content-type"], "application/json");
  });

  it("accepts client_id parameter", async () => {
    const { status } = await get(
      server.port,
      "/oauth2/token?api-version=2019-08-01&resource=https%3A%2F%2Fmanagement.azure.com%2F&client_id=123",
      identityHeaders(),
    );

    assert.equal(status, 200);
    assert.equal(mockCreateClient.mock.callCount(), 1);
    assert.equal(mockCreateClient.mock.calls[0].arguments[0], "123");
  });

  it("uses Azure CLI client_id by default", async () => {
    await get(
      server.port,
      "/oauth2/token?resource=r",
      identityHeaders(),
    );

    assert.equal(mockCreateClient.mock.callCount(), 1);
    assert.equal(mockCreateClient.mock.calls[0].arguments[0],
      "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
    );
  });

  it("caches credentials by client_id", async () => {
    await get(
      server.port,
      "/oauth2/token?resource=r&client_id=aaa",
      identityHeaders(),
    );
    await get(
      server.port,
      "/oauth2/token?resource=r&client_id=aaa",
      identityHeaders(),
    );

    assert.equal(mockCreateClient.mock.callCount(), 1);
  });

  it("creates separate credentials for different client_ids", async () => {
    const clients = new Map<string, ReturnType<typeof createMockClient>>();
    mockCreateClient.mock.mockImplementation((cid: string) => {
      const c = createMockClient();
      clients.set(cid, c);
      return c;
    });

    await get(
      server.port,
      "/oauth2/token?resource=r&client_id=aaa",
      identityHeaders(),
    );
    await get(
      server.port,
      "/oauth2/token?resource=r&client_id=bbb",
      identityHeaders(),
    );

    assert.equal(clients.size, 2);
    assert.ok(clients.has("aaa"));
    assert.ok(clients.has("bbb"));
  });

  // -- Error cases -----------------------------------------------------------

  it("returns 400 when resource is missing", async () => {
    const { status, body } = await get(
      server.port,
      "/oauth2/token",
      identityHeaders(),
    );
    const data = JSON.parse(body);

    assert.equal(status, 400);
    assert.equal(data.error, "invalid_resource");
    assert.ok(data.error_description.toLowerCase().includes("resource"));
  });

  it("returns 401 when X-IDENTITY-HEADER is missing", async () => {
    const { status, body } = await get(
      server.port,
      "/oauth2/token?resource=r",
    );
    const data = JSON.parse(body);

    assert.equal(status, 401);
    assert.equal(data.error, "missing_identity_header");
    assert.ok(data.error_description);
  });

  it("returns 403 when X-IDENTITY-HEADER is wrong", async () => {
    const { status, body } = await get(
      server.port,
      "/oauth2/token?resource=r",
      { "X-IDENTITY-HEADER": "wrong-value" },
    );
    const data = JSON.parse(body);

    assert.equal(status, 403);
    assert.equal(data.error, "invalid_identity_header");
  });

  it("returns 404 for unknown paths", async () => {
    const { status, body } = await get(server.port, "/unknown");
    const data = JSON.parse(body);

    assert.equal(status, 404);
    assert.equal(data.error, "not_found");
    assert.ok(data.error_description);
  });

  it("returns 500 when credential throws", async () => {
    mockClient.acquireTokenInteractive.mock.mockImplementation(async () => {
      throw new Error("broker unavailable");
    });

    const { status, body } = await get(
      server.port,
      "/oauth2/token?resource=r",
      identityHeaders(),
    );
    const data = JSON.parse(body);

    assert.equal(status, 500);
    assert.equal(data.error, "credential_error");
    assert.ok(data.error_description.includes("broker unavailable"));
  });

  // -- Error response format -------------------------------------------------

  it("error responses have both error and error_description fields", async () => {
    const { body } = await get(
      server.port,
      "/oauth2/token?resource=r",
    );
    const data = JSON.parse(body);

    assert.ok("error" in data);
    assert.ok("error_description" in data);
  });

  // -- Security: localhost only ----------------------------------------------

  it("binds to 127.0.0.1", () => {
    assert.equal(server.address, "127.0.0.1");
  });
});
