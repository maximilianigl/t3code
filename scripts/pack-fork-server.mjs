// Pack apps/server into release/t3-<version>.tgz for fork deployments.
//
// Plain `npm pack` ships the workspace manifest, whose `catalog:` dependency
// protocol npm cannot install; `pnpm pack` insists on resolving workspace
// devDependencies. The npm publish flow (apps/server/scripts/cli.ts publish)
// solves this by temporarily writing a cleaned manifest — same approach here,
// minus the publish.
//
// Usage: node scripts/pack-fork-server.mjs   (after `vp run --filter t3 build`)
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(repoRoot, "apps/server/package.json");
const original = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);
const ws = parse(readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
const catalog = ws.catalog ?? {};
const manifest = {
  name: pkg.name,
  repository: pkg.repository,
  bin: pkg.bin,
  type: pkg.type,
  version: pkg.version,
  engines: pkg.engines,
  files: pkg.files,
  dependencies: resolveCatalogDependencies(pkg.dependencies, catalog, "apps/server"),
  // The workspace overrides use pnpm-only selectors (`pkg>subpkg`) that npm
  // rejects at pack time — and npm ignores a dependency's overrides on install
  // (only the root project's apply), so the tarball loses nothing without them.
};
try {
  writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + "\n");
  execSync("npm pack --pack-destination ../../release", {
    cwd: join(repoRoot, "apps/server"),
    stdio: "inherit",
  });
} finally {
  writeFileSync(pkgPath, original);
}
console.log(`packed release/t3-${pkg.version}.tgz`);
