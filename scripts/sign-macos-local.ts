import { type SignOptions } from "@electron/osx-sign";

import sign from "./sign-macos.ts";

/** Local identities need neither a provisioning profile nor Apple's timestamp service. */
export default async function signLocal(options: SignOptions): Promise<void> {
  const localOptions = { ...options };
  delete localOptions.provisioningProfile;
  await sign({
    ...localOptions,
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (file, context) => ({
      ...options.optionsForFile?.(file, context),
      timestamp: "none",
    }),
  });
}
