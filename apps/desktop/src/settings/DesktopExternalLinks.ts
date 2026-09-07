import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";

/**
 * Optional, machine-local routing of external links. Lives next to the other
 * desktop-local settings files; when the file is missing every link opens in
 * the default browser exactly as upstream does. See docs/user/external-links.md.
 */
export const EXTERNAL_LINK_RULES_FILE_NAME = "external-link-rules.json";
const URL_PLACEHOLDER = "{url}";
// A launcher such as macOS `open` exits right away; a browser binary may run
// until the user closes it. Anything still alive after this window counts as
// launched and is left running.
const LAUNCH_FAILURE_WINDOW = Duration.seconds(2);

export const ExternalLinkRule = Schema.Struct({
  match: Schema.String,
  command: Schema.Array(Schema.String),
});
export type ExternalLinkRule = typeof ExternalLinkRule.Type;

const ExternalLinkRulesDocument = Schema.Struct({
  externalLinkRules: Schema.optionalKey(Schema.Array(ExternalLinkRule)),
});
const decodeExternalLinkRulesDocument = Schema.decodeEffect(
  fromLenientJson(ExternalLinkRulesDocument),
);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `*` matches any run of characters, including none; everything else is literal. */
export function matchesExternalLinkPattern(pattern: string, url: string): boolean {
  const source = pattern.split("*").map(escapeRegExp).join(".*");
  return new RegExp(`^${source}$`).test(url);
}

/**
 * The first matching rule's argv with `{url}` substituted. When no argument
 * carries the placeholder the URL is appended, so `["open", "-a", "Safari"]`
 * works as written.
 */
export function resolveExternalLinkCommand(
  rules: ReadonlyArray<ExternalLinkRule>,
  url: string,
): Option.Option<ReadonlyArray<string>> {
  const rule = rules.find(
    (candidate) => candidate.command.length > 0 && matchesExternalLinkPattern(candidate.match, url),
  );
  if (rule === undefined) {
    return Option.none();
  }
  const command = rule.command.map((argument) => argument.replaceAll(URL_PLACEHOLDER, url));
  return Option.some(
    rule.command.some((argument) => argument.includes(URL_PLACEHOLDER))
      ? command
      : [...command, url],
  );
}

export class DesktopExternalLinks extends Context.Service<
  DesktopExternalLinks,
  {
    /**
     * Opens a safe external URL through the first matching rule, falling back
     * to the default browser when no rule matches or the command fails.
     */
    readonly open: (rawUrl: unknown) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/settings/DesktopExternalLinks") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const electronShell = yield* ElectronShell.ElectronShell;
  const rulesPath = environment.path.join(environment.stateDir, EXTERNAL_LINK_RULES_FILE_NAME);

  // Read on every open so edits apply without a restart. Links are rare and
  // the file is tiny.
  const loadRules: Effect.Effect<ReadonlyArray<ExternalLinkRule>> = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(rulesPath))) {
      return [];
    }
    const document = yield* decodeExternalLinkRulesDocument(
      yield* fileSystem.readFileString(rulesPath),
    );
    return document.externalLinkRules ?? [];
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("Ignoring unreadable external link rules.", { path: rulesPath, error }),
    ),
    Effect.orElseSucceed((): ReadonlyArray<ExternalLinkRule> => []),
  );

  const launch = (command: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const [executable = "", ...args] = command;
      const handle = yield* ChildProcess.make(executable, args, {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      // Unref so closing the scope leaves a long-lived browser process alone.
      yield* Effect.asVoid(handle.unref);
      const exitCode = yield* Effect.timeoutOption(handle.exitCode, LAUNCH_FAILURE_WINDOW);
      return Option.match(exitCode, {
        onNone: () => true,
        onSome: (code) => code === 0,
      });
    }).pipe(
      Effect.scoped,
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.tapError((error) =>
        Effect.logWarning("External link command failed; opening in the default browser.", {
          command,
          error,
        }),
      ),
      Effect.orElseSucceed(() => false),
    );

  return DesktopExternalLinks.of({
    open: (rawUrl) =>
      Option.match(ElectronShell.parseSafeExternalUrl(rawUrl), {
        onNone: () => Effect.succeed(false),
        onSome: (url) =>
          Effect.gen(function* () {
            const command = resolveExternalLinkCommand(yield* loadRules, url);
            if (Option.isSome(command) && (yield* launch(command.value))) {
              return true;
            }
            return yield* electronShell.openExternal(url);
          }),
      }),
  });
});

export const layer = Layer.effect(DesktopExternalLinks, make);
