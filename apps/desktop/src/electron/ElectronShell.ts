import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  REMOTE_CAPABLE_EDITOR_IDS,
  remoteSchemeForEditor,
  type SystemSettingsPane,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/unstable/process/ChildProcess";

import * as Electron from "electron";

/**
 * Deep links to individual System Settings panes. These are app-fixed, not
 * renderer-supplied, so they skip `parseSafeExternalUrl` — which exists to keep
 * arbitrary link schemes from reaching the OS handler — and open through their
 * own path below. The pane rather than the URL crosses the IPC boundary, so a
 * renderer can only ask for one of these known destinations.
 *
 * Full Disk Access uses the post-Ventura `PrivacySecurity.extension` anchor.
 */
const SYSTEM_SETTINGS_URLS: Record<SystemSettingsPane, string> = {
  "full-disk-access":
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
};
const PRISMA_BROWSER_BUNDLE_ID = "com.talon-sec.Work";

// Remote open-in-editor deep links (`vscode://vscode-remote/ssh-remote+…`,
// `zed://ssh/<host>/<path>`) must reach the OS handler; every other non-web
// scheme stays blocked.
const SAFE_WEB_PROTOCOLS = new Set(["http:", "https:"]);
const REMOTE_EDITOR_PROTOCOLS = new Set(
  REMOTE_CAPABLE_EDITOR_IDS.flatMap((id) => {
    const scheme = remoteSchemeForEditor(id);
    return scheme === undefined ? [] : [`${scheme}:`];
  }),
);

// Zed's host sits in the first path segment, so it needs its own userinfo ban.
const ZED_SSH_PATHNAME = /^\/[^/@:]+\/.+$/;

const isRemoteEditorUrl = (url: URL) =>
  REMOTE_EDITOR_PROTOCOLS.has(url.protocol) &&
  url.username.length === 0 &&
  url.password.length === 0 &&
  (url.protocol === "zed:"
    ? url.host === "ssh" && ZED_SSH_PATHNAME.test(url.pathname)
    : url.host === "vscode-remote" &&
      url.pathname.startsWith("/ssh-remote+") &&
      url.pathname.length > "/ssh-remote+".length);

export function parseSafeExternalUrl(rawUrl: unknown): Option.Option<string> {
  if (typeof rawUrl !== "string") {
    return Option.none();
  }

  try {
    const url = new URL(rawUrl);
    return SAFE_WEB_PROTOCOLS.has(url.protocol) || isRemoteEditorUrl(url)
      ? Option.some(url.href)
      : Option.none();
  } catch {
    return Option.none();
  }
}

export function isNvidiaManagedAuthUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "login.microsoftonline.com" ||
      !url.pathname.endsWith("/oauth2/v2.0/authorize")
    ) {
      return false;
    }

    const redirectUrl = new URL(url.searchParams.get("redirect_uri") ?? "");
    return (
      redirectUrl.protocol === "https:" &&
      redirectUrl.hostname === "authservice.nvidia.com" &&
      redirectUrl.pathname === "/oauth"
    );
  } catch {
    return false;
  }
}

export class ElectronShell extends Context.Service<
  ElectronShell,
  {
    readonly openExternal: (rawUrl: unknown) => Effect.Effect<boolean>;
    /** Opens a known System Settings pane by identifier, not by URL. */
    readonly openSystemSettings: (pane: SystemSettingsPane) => Effect.Effect<boolean>;
    readonly copyText: (text: string) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/electron/ElectronShell") {}

interface ElectronShellDependencies {
  readonly platform: NodeJS.Platform;
  readonly openDefault: (url: string) => Promise<void>;
  readonly openMacBundle: (bundleId: string, url: string) => Promise<boolean>;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = (dependencies: ElectronShellDependencies) =>
  ElectronShell.of({
    openExternal: (rawUrl) =>
      Option.match(parseSafeExternalUrl(rawUrl), {
        onNone: () => Effect.succeed(false),
        onSome: (externalUrl) =>
          Effect.promise(async () => {
            if (
              dependencies.platform === "darwin" &&
              isNvidiaManagedAuthUrl(externalUrl) &&
              (await dependencies
                .openMacBundle(PRISMA_BROWSER_BUNDLE_ID, externalUrl)
                .catch(() => false))
            ) {
              return true;
            }

            return dependencies.openDefault(externalUrl).then(
              () => true,
              () => false,
            );
          }),
      }),
    openSystemSettings: (pane) =>
      Effect.promise(() =>
        dependencies.openDefault(SYSTEM_SETTINGS_URLS[pane]).then(
          () => true,
          () => false,
        ),
      ),
    copyText: (text) =>
      Effect.promise(() => Electron.clipboard.writeText(text).catch(() => undefined)),
  });

const openMacBundle = (bundleId: string, url: string) =>
  Effect.gen(function* () {
    const process = yield* ChildProcess.make("/usr/bin/open", ["-b", bundleId, url], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = yield* process.exitCode;
    return exitCode === 0;
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => false),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );

export const layer = Layer.effect(
  ElectronShell,
  Effect.map(HostProcessPlatform, (platform) =>
    make({
      platform,
      openDefault: (url) => Electron.shell.openExternal(url),
      openMacBundle,
    }),
  ),
);
