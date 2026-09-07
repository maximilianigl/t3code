import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import { vi } from "vite-plus/test";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopExternalLinks from "./DesktopExternalLinks.ts";

const withExternalLinks = <A, E>(
  effect: (input: {
    readonly externalLinks: DesktopExternalLinks.DesktopExternalLinks["Service"];
    readonly openExternal: ReturnType<typeof vi.fn>;
    readonly writeRules: (contents: string) => Effect.Effect<void, PlatformError.PlatformError>;
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-external-links-test-",
    });
    const openExternal = vi.fn(() => Effect.succeed(true));
    const environmentLayer = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: baseDir,
      platform: "darwin",
      processArch: "x64",
      appVersion: "1.2.3",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ T3CODE_HOME: baseDir })),
      ),
    );
    const shellLayer = Layer.succeed(ElectronShell.ElectronShell, {
      openExternal,
      openSystemSettings: () => Effect.succeed(true),
      copyText: () => Effect.void,
    });
    const externalLinks = yield* DesktopExternalLinks.DesktopExternalLinks.pipe(
      Effect.provide(
        DesktopExternalLinks.layer.pipe(
          Layer.provide(Layer.mergeAll(environmentLayer, shellLayer, NodeServices.layer)),
        ),
      ),
    );
    const rulesPath = path.join(
      baseDir,
      "userdata",
      DesktopExternalLinks.EXTERNAL_LINK_RULES_FILE_NAME,
    );
    const writeRules = (contents: string) =>
      fileSystem
        .makeDirectory(path.dirname(rulesPath), { recursive: true })
        .pipe(Effect.andThen(fileSystem.writeFileString(rulesPath, contents)));
    return yield* effect({ externalLinks, openExternal, writeRules });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

// A rule whose command exits with the given code, runnable wherever the tests run.
const exitWith = (match: string, code: number) =>
  `{ "match": "${match}", "command": ["${process.execPath}", "-e", "process.exit(${code})"] }`;
const rulesDocument = (...rules: string[]) => `{ "externalLinkRules": [${rules.join(", ")}] }`;

describe("matchesExternalLinkPattern", () => {
  it("treats * as a wildcard and everything else literally", () => {
    assert.isTrue(
      DesktopExternalLinks.matchesExternalLinkPattern(
        "https://login.example.com/*redirect_uri=https%3A%2F%2Fauth.example.com*",
        "https://login.example.com/tenant/oauth2/v2.0/authorize?client_id=x&redirect_uri=https%3A%2F%2Fauth.example.com%2Foauth",
      ),
    );
    assert.isFalse(
      DesktopExternalLinks.matchesExternalLinkPattern(
        "https://example.com/?q=a.b",
        "https://example.com/?q=aXb",
      ),
    );
    assert.isFalse(
      DesktopExternalLinks.matchesExternalLinkPattern(
        "https://example.com/*",
        "https://example.com.evil.test/",
      ),
    );
  });
});

describe("resolveExternalLinkCommand", () => {
  const url = "https://example.com/path?x=1";

  it("substitutes {url} in the first matching rule", () => {
    const command = DesktopExternalLinks.resolveExternalLinkCommand(
      [
        { match: "https://other.example/*", command: ["never"] },
        { match: "https://example.com/*", command: ["open", "-b", "com.example.browser", "{url}"] },
        { match: "*", command: ["later"] },
      ],
      url,
    );
    assert.deepEqual(command, Option.some(["open", "-b", "com.example.browser", url]));
  });

  it("appends the URL when no argument carries the placeholder", () => {
    const command = DesktopExternalLinks.resolveExternalLinkCommand(
      [{ match: "*", command: ["open", "-a", "Safari"] }],
      url,
    );
    assert.deepEqual(command, Option.some(["open", "-a", "Safari", url]));
  });

  it("skips rules without a command and returns none when nothing matches", () => {
    assert.deepEqual(
      DesktopExternalLinks.resolveExternalLinkCommand([{ match: "*", command: [] }], url),
      Option.none(),
    );
    assert.deepEqual(
      DesktopExternalLinks.resolveExternalLinkCommand(
        [{ match: "https://other.example/*", command: ["x"] }],
        url,
      ),
      Option.none(),
    );
  });
});

describe("DesktopExternalLinks", () => {
  it.effect("opens in the default browser when no rules file exists", () =>
    withExternalLinks(({ externalLinks, openExternal }) =>
      Effect.gen(function* () {
        const result = yield* externalLinks.open("https://example.com/");
        assert.isTrue(result);
        assert.deepEqual(openExternal.mock.calls, [["https://example.com/"]]);
      }),
    ),
  );

  it.effect("rejects unsafe URLs without consulting rules or the browser", () =>
    withExternalLinks(({ externalLinks, openExternal, writeRules }) =>
      Effect.gen(function* () {
        yield* writeRules(rulesDocument(exitWith("*", 0)));
        const result = yield* externalLinks.open("file:///etc/passwd");
        assert.isFalse(result);
        assert.equal(openExternal.mock.calls.length, 0);
      }),
    ),
  );

  it.effect("runs a matching rule instead of the default browser", () =>
    withExternalLinks(({ externalLinks, openExternal, writeRules }) =>
      Effect.gen(function* () {
        yield* writeRules(rulesDocument(exitWith("https://managed.example/*", 0)));
        const result = yield* externalLinks.open("https://managed.example/login");
        assert.isTrue(result);
        assert.equal(openExternal.mock.calls.length, 0);

        const other = yield* externalLinks.open("https://example.com/");
        assert.isTrue(other);
        assert.deepEqual(openExternal.mock.calls, [["https://example.com/"]]);
      }),
    ),
  );

  it.effect("falls back to the default browser when the command fails", () =>
    withExternalLinks(({ externalLinks, openExternal, writeRules }) =>
      Effect.gen(function* () {
        yield* writeRules(
          rulesDocument(
            exitWith("https://broken.example/*", 1),
            `{ "match": "https://missing.example/*", "command": ["/nonexistent/t3-browser"] }`,
          ),
        );
        assert.isTrue(yield* externalLinks.open("https://broken.example/"));
        assert.isTrue(yield* externalLinks.open("https://missing.example/"));
        assert.deepEqual(openExternal.mock.calls, [
          ["https://broken.example/"],
          ["https://missing.example/"],
        ]);
      }),
    ),
  );

  it.effect("ignores an unreadable rules file", () =>
    withExternalLinks(({ externalLinks, openExternal, writeRules }) =>
      Effect.gen(function* () {
        yield* writeRules("{ not json");
        assert.isTrue(yield* externalLinks.open("https://example.com/"));
        assert.deepEqual(openExternal.mock.calls, [["https://example.com/"]]);
      }),
    ),
  );
});
