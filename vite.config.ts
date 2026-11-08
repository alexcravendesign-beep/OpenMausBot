import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DurationSequencer } from "./scripts/testing/duration-sequencer.ts";
import { hostE2eOnly, portableE2eFiles } from "./scripts/testing/host-e2e.ts";
import { hostTimeout } from "./server/testing/host-timeout.ts";

// The About dialog's version, inlined at build time: the preload bridge is
// absent in dev.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
) as { version: string };

const root = fileURLToPath(new URL(".", import.meta.url));
const workers = Number(process.env.OMB_VITEST_WORKERS) || 1;
const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

/** The window's rail of places loads /rail: rail.html, its own small page, in development as from the server. */
function railPage(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url === "/rail" || req.url?.startsWith("/rail?")) req.url = `/rail.html${req.url.slice("/rail".length)}`;
    next();
  };
  return {
    name: "rail-page",
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

/**
 * In-house: VITE_PRODUCT_NAME at build time renames the product in the page's own metadata (title, home-screen name,
 * web manifest) so the served page never says MausBot. Unset (upstream, tests), nothing changes.
 */
function productNamePage(): Plugin | null {
  const name = process.env.VITE_PRODUCT_NAME?.trim();
  if (!name) return null;
  const description = process.env.VITE_PRODUCT_DESCRIPTION?.trim();
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  let outDir = "dist";
  return {
    name: "inhouse-product-name",
    configResolved: (config) => { outDir = config.build.outDir; },
    transformIndexHtml: (html) => html
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(name)}</title>`)
      .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(" \/>)/, `$1${esc(name)}$2`)
      .replace(/(<link rel="manifest"[^>]*\/>)/, description ? `<meta name="description" content="${esc(description)}" />\n    $1` : "$1"),
    closeBundle: () => {
      const file = `${outDir}/manifest.webmanifest`;
      try {
        const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
        writeFileSync(file, `${JSON.stringify({ ...manifest, name, short_name: name }, null, 2)}\n`);
      } catch { /* no manifest in this build (tests, rail-only) */ }
    },
  };
}

const include = [
  "evals/**/*.test.ts",
  "server/**/*.test.ts",
  "electron/**/*.test.mjs",
  "src/**/*.test.ts",
  "shared/**/*.test.ts",
  "companion/**/*.test.ts",
  "enterprise/**/*.test.ts",
  "connector/**/*.test.ts",
  "scripts/**/*.test.mjs",
  "scripts/**/*.test.ts",
];

export default defineConfig({
  plugins: [react(), tailwindcss(), railPage(), ...(productNamePage() ? [productNamePage()!] : [])],
  build: {
    rollupOptions: { input: { index: page("./index.html"), rail: page("./rail.html") } },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    include,
    // OMB_VITEST_E2E=host (CI's Windows and macOS shards) leaves the e2e files that run on Linux only.
    exclude: [...configDefaults.exclude, ...(hostE2eOnly() ? portableE2eFiles(root, include) : [])],
    setupFiles: ["server/testing/setup.ts", "src/testing/all-locales.ts"],
    // One file at a time by default: the suite spawns fake provider CLIs and real
    // harness servers, which a laptop feels. CI sets its runner's count (scripts/ci-scope.mjs).
    fileParallelism: workers > 1,
    maxWorkers: workers,
    // --shard splits the files by recorded CI seconds, not count
    sequence: { sequencer: DurationSequencer },
    // Known flakes in scripts/testing/ci-retry-list.json get two retries in
    // CI only, each reported.
    runner: "./scripts/testing/ci-retry-runner.ts",
    // Doubled on Windows, whose runners are about 1.45x slower.
    testTimeout: hostTimeout(20_000),
    hookTimeout: hostTimeout(30_000),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // IPv4 explicitly — a bare ::1 bind makes localhost a coin-flip for
    // clients that resolve IPv4 first
    host: "127.0.0.1",
    port: Number(process.env.OMB_UI_PORT) || 5199,
    // packager output lands inside the repo — its HTML files must never
    // trigger dev full-page reloads
    watch: {
      ignored: ["**/release/**", "**/build/**", "**/dist/**", "**/electron/resources/**"],
    },
    // the harness server owns every provider process; the app only ever
    // talks to /api — clients hold no transports
    proxy: {
      "/api": {
        ws: true,
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8799}`,
      },
      "/.well-known/openmausbot/environment": {
        target: `http://127.0.0.1:${process.env.OMB_PORT || process.env.OGB_PORT || 8799}`,
      },
    },
  },
});
