# Auth Broker — VSCode Extension

Entra authentication broker for VSCode Dev Containers. Runs a local HTTP server on the host that serves device-bound access tokens (with Token Protection) to `ManagedIdentityCredential` inside containers.

## Quick Start

1. Install the extension in VSCode.
2. Add the following to your Dev Container's `devcontainer.json` (see [`.devcontainer/devcontainer.json`](https://github.com/mmaitre314/vscode-auth-broker/blob/main/.devcontainer/devcontainer.json) for a full example):
  ```json
  "remoteEnv": {
    "IDENTITY_ENDPOINT": "http://host.docker.internal:40342/oauth2/token",
    "IDENTITY_HEADER": "AuthBrokerServer"
  }
  ```
3. In the container, use `ManagedIdentityCredential` as usual:
  ```python
  from azure.identity import ManagedIdentityCredential

  credential = ManagedIdentityCredential()
  token = credential.get_token("https://graph.microsoft.com/.default")
  ```

## How It Works

The extension starts an HTTP server on `http://127.0.0.1:40342` that mimics the
[Azure App Service managed-identity endpoint](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).
Inside a Dev Container, `ManagedIdentityCredential` from
[azure-identity](https://pypi.org/project/azure-identity/) calls this endpoint
via Docker's `host.docker.internal` hostname to acquire tokens.

Authentication on the host uses
[@azure/identity-broker](https://www.npmjs.com/package/@azure/identity-broker)
with the Windows Web Account Manager (WAM) for broker-based, device-bound token
acquisition.

## Commands

| Command | Description |
|---------|-------------|
| **Auth Broker: Start Server** | Start the token server |
| **Auth Broker: Stop Server** | Stop the token server |
| **Auth Broker: Copy Dev Container Config** | Copy the `remoteEnv` JSON snippet to clipboard |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `authBroker.port` | `40342` | TCP port the server listens on |
| `authBroker.identityHeader` | `AuthBrokerServer` | Expected value of the `X-IDENTITY-HEADER` request header |

## API

### `GET /oauth2/token`

Returns a JSON object with an access token for the requested resource.

**Required headers:**

| Header | Value |
|--------|-------|
| `X-IDENTITY-HEADER` | Must match the configured identity header (default: `AuthBrokerServer`) |

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | The resource URI to get a token for |
| `api-version` | No | API version (e.g., `2019-08-01`) |
| `client_id` | No | Client ID (default: Azure CLI `04b07795-8ddb-461a-bbee-02f9e1bf7b46`) |

**Success response (200):**

```json
{
  "access_token": "eyJ0eXAiOiJKV1QiL...",
  "expires_on": 1700000000
}
```

**Error response:**

```json
{
  "error": "invalid_resource",
  "error_description": "Missing required query parameter: resource"
}
```

## Logs

Logs are available in VSCode in the **Output** panel. Select **Auth Broker** from the dropdown to view them. Adjust the log level as needed.

## Security

- The server binds exclusively to `127.0.0.1` — it is not accessible from the
  network. Docker Desktop routes `host.docker.internal` through a NAT bridge
  that reaches localhost.
- The `X-IDENTITY-HEADER` header mitigates Server-Side Request Forgery (SSRF).

## Platform Support

- **Windows**: Full support via WAM (Web Account Manager) broker
- **Linux**: Supported via `@azure/identity-broker`
- **macOS**: Not yet supported by `@azure/identity-broker`

## Standalone Usage

The token server can run directly from a terminal without VSCode:

```bash
git clone https://github.com/mmaitre314/vscode-auth-broker.git
cd vscode-auth-broker
npm install
npm run compile
npm run start:broker
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building, testing, and publishing instructions.

## License

MIT
