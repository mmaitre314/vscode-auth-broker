# Contributing to Auth Broker

Thanks for your interest in contributing! This guide covers the development workflow for the **Auth Broker** VS Code extension.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [VS Code](https://code.visualstudio.com/)
- [Git](https://git-scm.com/)

## Local Setup

The repo includes a [Dev Container](https://containers.dev/) configuration (`.devcontainer/devcontainer.json`) based on the `typescript-node:22` image. Opening the repo in VS Code with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) installed will prompt you to **Reopen in Container**, which provisions a ready-to-use environment with Node.js, npm, and `npm install` run automatically.

To set up without the Dev Container:

```bash
git clone https://github.com/mmaitre314/vscode-auth-broker.git
cd vscode-auth-broker
npm install
```

## Building

The extension is bundled with [esbuild](https://esbuild.github.io/). The entry point is `src/extension.ts` and the output goes to `dist/extension.js`.

```bash
# One-off build
npm run compile

# Rebuild on file changes
npm run watch
```

## Type Checking

TypeScript type checking is separate from the esbuild compilation step:

```bash
npm run lint
```

## Unit Tests

Tests use the built-in [Node.js test runner](https://nodejs.org/api/test.html) with [tsx](https://github.com/privatenumber/tsx) for TypeScript support.

```bash
npm test
```

Test files live in `src/test/`. The test command runs `node --import tsx --test src/test/server.test.ts`.

## Integration Tests

Integration tests call `ManagedIdentityCredential` against a live Auth Broker server and validate real tokens. They require the `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` environment variables (already set in the Dev Container) and are automatically skipped when `CI` is set or the environment variables are missing.

```bash
npm run test:integration
```

To run them, start the Auth Broker extension on the host, then execute the command inside the Dev Container.

For quick checks using Curl:
- Health check
  ```bash
  curl http://localhost:40342/health
  ```
- Basic token acquisition
  ```bash
  curl -H "X-IDENTITY-HEADER:AuthBrokerServer" "http://localhost:40342/oauth2/token?resource=https://management.azure.com/"
  ```
- Token acquisition for MS Graph as MS Office
  ```bash
  curl -H "X-IDENTITY-HEADER:AuthBrokerServer" "http://localhost:40342/oauth2/token?resource=https://graph.microsoft.com/.default&&client_id=d3590ed6-52b3-4102-aeff-aad2292ab01c"
  ```
- Parameterized token acquisition
  ```bash
  curl -H "X-IDENTITY-HEADER:$IDENTITY_HEADER" "$IDENTITY_ENDPOINT?resource=https://management.azure.com/"
  ```

## Running the Extension Locally

1. Open the repo in VS Code.
2. Press **F5** to launch an **Extension Development Host** window.
3. The extension activates on startup and registers its commands (e.g. `Auth Broker: Start Server`).

## Versioning

The version is tracked in `package.json` under the `version` field and follows [Semantic Versioning](https://semver.org/):

- **Patch** (`1.0.x`) — bug fixes.
- **Minor** (`1.x.0`) — new features, backward-compatible.
- **Major** (`x.0.0`) — breaking changes.

Bump the `version` field in `package.json` before packaging a new release.

## Packaging

The extension is packaged into a `.vsix` file using [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce). The `vscode:prepublish` script runs a production build automatically.

```bash
npm run package
```

This produces a file like `vscode-auth-broker-1.0.0.vsix` in the repo root.

To install the `.vsix` locally for testing:

```bash
code --install-extension vscode-auth-broker-*.vsix
```

## Publishing

Publish to the [VS Code Marketplace](https://marketplace.visualstudio.com/) using `vsce`:

```bash
npx vsce publish
```

This requires a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token) for the `mmaitre314` publisher.

## Project Structure

```
media/
  icon.svg              # Source icon (editable)
  icon.png              # Generated 128×128 PNG used by the extension
src/
  extension.ts          # Extension entry point (activation, commands)
  server.ts             # HTTP token server implementation
  test/
    server.test.ts      # Unit tests for the server
esbuild.js              # Build script
```

## Updating the Icon

Edit `media/icon.svg`, then regenerate the PNG:

```bash
npm install --no-save sharp
node -e "require('sharp')('media/icon.svg').resize(128,128).png().toFile('media/icon.png').then(()=>console.log('done'))"
```

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
