// Pack apps/server into release/t3-<version>.tgz for fork deployments.
//
// Plain `npm pack` ships the workspace manifest, whose `catalog:` dependency
// protocol npm cannot install; `pnpm pack` insists on resolving workspace
// devDependencies. The npm publish flow (apps/server/scripts/cli.ts publish)
// solves this by temporarily writing a cleaned manifest — same approach here,
// minus the publish.
//
// Usage: node scripts/pack-fork-server.mjs   (after `vp run --filter t3 build`)
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const repoRoot = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const pkgPath = NodePath.join(repoRoot, "apps/server/package.json");
const serverRequire = NodeModule.createRequire(pkgPath);
const { parse } = serverRequire("yaml");
const original = NodeFS.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);
const ws = parse(NodeFS.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
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
  NodeFS.writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + "\n");
  NodeChildProcess.execSync("npm pack --pack-destination ../../release", {
    cwd: NodePath.join(repoRoot, "apps/server"),
    stdio: "inherit",
  });
} finally {
  NodeFS.writeFileSync(pkgPath, original);
}
console.log(`packed release/t3-${pkg.version}.tgz`);
