import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import signLocal from "./sign-macos-local.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));

it("signs with the chosen local identity without provisioning or timestamping", async () => {
  await signLocal({
    app: "/tmp/T3 Code.app",
    identity: "local-certificate-hash",
    optionsForFile: () => ({ hardenedRuntime: true, entitlements: "/tmp/entitlements.plist" }),
  });

  const options = vi.mocked(signApplication).mock.calls[0]![0] as SignOptions;
  expect(options.identity).toBe("local-certificate-hash");
  expect(options.preAutoEntitlements).toBe(false);
  expect(options.preEmbedProvisioningProfile).toBe(false);
  expect(options.provisioningProfile).toBeUndefined();
  expect(options.optionsForFile?.("/tmp/T3 Code.app", { platform: "darwin" })).toEqual({
    hardenedRuntime: true,
    entitlements: "/tmp/entitlements.plist",
    timestamp: "none",
  });
});
