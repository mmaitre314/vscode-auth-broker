// @ts-check
const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * Plugin: rewrite `require("@azure/msal-node-runtime")` so the bundled code
 * loads the correct platform-specific native binary at runtime.
 *
 * `@azure/msal-node-runtime` ships a postinstall script (`copyBinaries.js`)
 * that copies the native `.node` addon for the *current* platform into
 * `dist/msal-node-runtime.node`. Because `npm install` runs inside a Linux
 * Dev Container, only the Linux binary ends up there — which fails on Windows
 * (the host where the VS Code extension actually runs).
 *
 * This plugin replaces the stock loader with a tiny resolver that maps
 * `process.platform`/`process.arch` to the correct subdirectory at runtime.
 */
const msalNodeRuntimePlugin = {
  name: "msal-node-runtime",
  setup(build) {
    build.onResolve({ filter: /^@azure\/msal-node-runtime$/ }, () => ({
      path: "@azure/msal-node-runtime",
      namespace: "msal-node-runtime",
    }));
    build.onLoad({ filter: /.*/, namespace: "msal-node-runtime" }, () => ({
      contents: `
        const path = require("path");
        const platformMap = { win32: "windows", darwin: "macos", linux: "linux" };
        const archMap = { ia32: "x86", x64: "x64", arm64: "arm64" };
        const platform = platformMap[process.platform];
        const arch = archMap[process.arch];
        const msalDir = path.dirname(require.resolve("@azure/msal-node-runtime/package.json"));
        let msalNodeRuntime;
        try {
          msalNodeRuntime = require(path.join(msalDir, "dist", platform, arch, "msal-node-runtime.node"));
        } catch {
          msalNodeRuntime = require(path.join(msalDir, "dist", "msal-node-runtime.node"));
        }
        exports.msalNodeRuntime = msalNodeRuntime;
      `,
      resolveDir: __dirname,
      loader: "js",
    }));
  },
};

/**
 * Plugin: stub out `keytar` with a no-op module.
 *
 * `@azure/msal-node-extensions` has a top-level `require('keytar')` for its
 * credential persistence layer. We only use `NativeBrokerPlugin` (WAM-based),
 * not the keytar-based persistence, so we can safely stub it out. VS Code
 * no longer ships keytar as a built-in module.
 */
const keytarStubPlugin = {
  name: "keytar-stub",
  setup(build) {
    build.onResolve({ filter: /^keytar$/ }, () => ({
      path: "keytar",
      namespace: "keytar-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "keytar-stub" }, () => ({
      contents: `module.exports = {};`,
      loader: "js",
    }));
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts", "src/process.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outdir: "dist",
    external: ["vscode"],
    plugins: [msalNodeRuntimePlugin, keytarStubPlugin],
    loader: { ".node": "file" },
    logLevel: "info",
    logOverride: { "require-resolve-not-external": "silent" },
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
