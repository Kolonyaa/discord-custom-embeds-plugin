import { storage } from "@vendetta/plugin";

export const vstorage = storage.obfuscation ??= {
  enabled: true,
  marker: "default_marker",
  secret: "default_secret",
};