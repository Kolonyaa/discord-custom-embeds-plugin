import { storage } from "@vendetta/plugin";
import type { Profile } from "./types";

storage.profiles ??= [{
  id: "default",
  name: "Default",
  baseUrl: "https://discord-custom-embeds.vercel.app/embed",
  color: "#fc7ea4",
  title: "〔 ͟𝀛͟𝀛͟╹͟⌵͟╹͟𝀛͟𝀛͟ 〕",
  siteName: "〔 ͟𝀛͟𝀛͟╹͟⌵͟╹͟𝀛͟𝀛͟ 〕",
  avatarType: "none",
  avatarUrl: "",
  avatarWidth: "",
  avatarHeight: "",
}];

storage.currentProfileId ??= storage.profiles[0].id;

export const vstorage = storage;

export const getCurrentProfile = (): Profile => {
  const currentProfile = storage.profiles.find(p => p.id === storage.currentProfileId);
  return currentProfile || storage.profiles[0];
};