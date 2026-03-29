import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ManagedIdentityCredential } from "@azure/identity";

const skip =
  !!process.env.CI ||
  !process.env.IDENTITY_ENDPOINT ||
  !process.env.IDENTITY_HEADER;

describe("Integration: ManagedIdentityCredential via Auth Broker", { skip }, () => {
  let credential: ManagedIdentityCredential;

  before(() => {
    credential = new ManagedIdentityCredential();
  });

  it("acquires a token for Azure Resource Manager", async () => {
    const token = await credential.getToken(
      "https://management.azure.com/.default",
    );

    assert.ok(token, "expected a token response");
    assert.ok(
      typeof token.token === "string" && token.token.length > 0,
      "access_token should be a non-empty string",
    );
    assert.ok(
      token.expiresOnTimestamp > Date.now(),
      "token should expire in the future",
    );
  });

  it("acquires a token for MS Graph using MS Office client ID", async () => {
    const officeCredential = new ManagedIdentityCredential({
      clientId: "d3590ed6-52b3-4102-aeff-aad2292ab01c",
    });
    const token = await officeCredential.getToken(
      "https://graph.microsoft.com/.default",
    );

    assert.ok(token, "expected a token response");
    assert.ok(
      typeof token.token === "string" && token.token.length > 0,
      "access_token should be a non-empty string",
    );
    assert.ok(
      token.expiresOnTimestamp > Date.now(),
      "token should expire in the future",
    );
  });
});
