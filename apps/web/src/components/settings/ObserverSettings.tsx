import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { DEFAULT_OBSERVER_PROMPT } from "@t3tools/shared/observerPrompt";
import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { ScopedSwitch } from "./ScopedSwitch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ObserverSettingsRows() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedPrompt = useScopedSettingsMixed(["observerPrompt"]);
  const promptEdited = useRef(false);

  return (
    <>
      <SettingsRow
        serverScoped
        settingKeys={["observerEnabled"]}
        {...searchableSetting("you-should-know")}
        description="When a Claude reply finishes, the same session is asked whether there is something you should know but might have missed. Anything it flags appears under the reply. The check reuses the session's prompt cache and never enters the conversation. Other providers are not supported."
        resetAction={
          settings.observerEnabled !== DEFAULT_UNIFIED_SETTINGS.observerEnabled ? (
            <SettingResetButton
              label="you should know"
              onClick={() =>
                updateSettings({ observerEnabled: DEFAULT_UNIFIED_SETTINGS.observerEnabled })
              }
            />
          ) : null
        }
        control={
          <ScopedSwitch
            settingKeys={["observerEnabled"]}
            checked={settings.observerEnabled}
            onCheckedChange={(checked) => updateSettings({ observerEnabled: Boolean(checked) })}
            aria-label="You should know"
          />
        }
      />

      {settings.observerEnabled ? (
        <SettingsRow
          serverScoped
          settingKeys={["observerPrompt"]}
          {...searchableSetting("you-should-know-prompt")}
          description="Starts as Claude Code's own prompt for this feature. {{seen}} and {{known}} are replaced with the last notes shown and the ones you marked as known."
          resetAction={
            mixedPrompt || settings.observerPrompt !== "" ? (
              <SettingResetButton
                label="you should know prompt"
                onClick={() => updateSettings({ observerPrompt: "" })}
              />
            ) : null
          }
        >
          <div className="mt-3 pb-3.5">
            <Textarea
              key={`${mixedPrompt}:${settings.observerPrompt}`}
              aria-label="You should know prompt"
              rows={12}
              onChange={() => {
                promptEdited.current = true;
              }}
              defaultValue={mixedPrompt ? "" : settings.observerPrompt || DEFAULT_OBSERVER_PROMPT}
              placeholder={
                mixedPrompt ? "Mixed. Enter a prompt to apply to all selected targets." : undefined
              }
              onBlur={(event) => {
                const value = event.target.value.trim();
                const stored = value === DEFAULT_OBSERVER_PROMPT.trim() ? "" : value;
                if (promptEdited.current && (mixedPrompt || stored !== settings.observerPrompt)) {
                  updateSettings({ observerPrompt: stored });
                }
                promptEdited.current = false;
              }}
            />
          </div>
        </SettingsRow>
      ) : null}
    </>
  );
}
