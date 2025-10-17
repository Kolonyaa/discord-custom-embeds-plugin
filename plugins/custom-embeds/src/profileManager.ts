import { storage } from "@vendetta/plugin";
import type { Profile } from "./types";

export const profileManager = {
  createProfile(name: string): Profile {
    const newProfile: Profile = {
      id: `profile_${Date.now()}`,
      name,
      baseUrl: "https://discord-custom-embeds.vercel.app/embed",
      color: "#fc7ea4",
      title: "〔 ͟𝀛͟𝀛͟╹͟⌵͟╹͟𝀛͟𝀛͟ 〕",
      siteName: "〔 ͟𝀛͟𝀛͟╹͟⌵͟╹͟𝀛͟𝀛͟ 〕",
      avatarType: "none",
      avatarUrl: "",
      avatarWidth: "",
      avatarHeight: "",
    };

    storage.profiles.push(newProfile);
    if (storage.profiles.length === 1) storage.currentProfileId = newProfile.id;
    return newProfile;
  },

  deleteProfile(id: string): boolean {
    const index = storage.profiles.findIndex(p => p.id === id);
    if (index === -1) return false;

    storage.profiles.splice(index, 1);
    if (storage.currentProfileId === id && storage.profiles.length)
      storage.currentProfileId = storage.profiles[0].id;
    else if (!storage.profiles.length)
      delete storage.currentProfileId;

    return true;
  },

  switchProfile(id: string): boolean {
    if (!storage.profiles.find(p => p.id === id)) return false;
    storage.currentProfileId = id;
    return true;
  },

  duplicateProfile(id: string): Profile | null {
    const profile = storage.profiles.find(p => p.id === id);
    if (!profile) return null;

    const duplicated: Profile = { ...profile, id: `profile_${Date.now()}`, name: `${profile.name} (Copy)` };
    storage.profiles.push(duplicated);
    return duplicated;
  },
};
