import { storage } from "@vendetta/plugin";

export const vstorage = storage.obfuscation ??= {
  enabled: true,
  secret: "default_secret",
};