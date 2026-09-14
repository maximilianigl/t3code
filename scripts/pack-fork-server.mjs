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
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";

const repoRoot = NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const pkgPath = NodePath.join(repoRoot, "apps/server/package.json");
const serverRequire = NodeModule.createRequire(pkgPath);
const { parse } = serverRequire("yaml");
const pkg = JSON.parse(NodeFS.readFileSync(pkgPath, "utf8"));
const ws = parse(NodeFS.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
const catalog = ws.catalog ?? {};
const fffNodeDir = NodeFS.realpathSync(
  NodePath.join(repoRoot, "apps/server/node_modules/@ff-labs/fff-node"),
);
const fffNodePackage = JSON.parse(
  NodeFS.readFileSync(NodePath.join(fffNodeDir, "package.json"), "utf8"),
);
const dependencies = resolveCatalogDependencies(pkg.dependencies, catalog, "apps/server");
const manifest = {
  name: pkg.name,
  repository: pkg.repository,
  bin: pkg.bin,
  type: pkg.type,
  version: pkg.version,
  engines: pkg.engines,
  files: pkg.files,
  dependencies: {
    ...dependencies,
    ...fffNodePackage.dependencies,
  },
  optionalDependencies: fffNodePackage.optionalDependencies,
  // fff-node is patched in this workspace so its ESM entry can also be loaded
  // through createRequire. npm ignores pnpm patch metadata, so ship a physical
  // copy of that package and promote its dependencies to the server manifest.
  bundledDependencies: ["@ff-labs/fff-node"],
  // The workspace overrides use pnpm-only selectors (`pkg>subpkg`) that npm
  // rejects at pack time — and npm ignores a dependency's overrides on install
  // (only the root project's apply), so the tarball loses nothing without them.
};
const stageDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-fork-pack-"));
try {
  NodeFS.cpSync(NodePath.join(repoRoot, "apps/server/dist"), NodePath.join(stageDir, "dist"), {
    recursive: true,
  });
  NodeFS.mkdirSync(NodePath.join(stageDir, "node_modules/@ff-labs"), { recursive: true });
  NodeFS.cpSync(fffNodeDir, NodePath.join(stageDir, "node_modules/@ff-labs/fff-node"), {
    recursive: true,
    filter: (source) => !source.startsWith(NodePath.join(fffNodeDir, "node_modules")),
  });
  NodeFS.writeFileSync(
    NodePath.join(stageDir, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  NodeChildProcess.execFileSync(
    "npm",
    ["pack", "--pack-destination", NodePath.join(repoRoot, "release")],
    {
      cwd: stageDir,
      stdio: "inherit",
    },
  );
} finally {
  NodeFS.rmSync(stageDir, { recursive: true, force: true });
}
console.log(`packed release/t3-${pkg.version}.tgz`);
