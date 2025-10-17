import React from "react";
import { Forms } from "@vendetta/ui/components";
import { vstorage } from "../storage";
import type { Profile } from "../types";

const { FormSection, FormRow, FormRadioRow, FormInput } = Forms;

export default function AvatarSettingsSection() {
  const currentProfile =
    vstorage.profiles.find((p: Profile) => p.id === vstorage.currentProfileId) ||
    vstorage.profiles[0];

  return (
    <FormSection title="Avatar Settings">
      <FormRow
        label="Avatar Type"
        subLabel="Choose how the embed thumbnail appears"
      />
      
      <FormRadioRow
        label="No Avatar"
        subLabel="No thumbnail image"
        selected={currentProfile.avatarType === "none"}
        onPress={() => {
          currentProfile.avatarType = "none";
        }}
      />
      
      <FormRadioRow
        label="Small Avatar"
        subLabel="45x45 thumbnail (summary card)"
        selected={currentProfile.avatarType === "small"}
        onPress={() => {
          currentProfile.avatarType = "small";
        }}
      />
      
      <FormRadioRow
        label="Large Avatar"
        subLabel="Large thumbnail (summary_large_image)"
        selected={currentProfile.avatarType === "large"}
        onPress={() => {
          currentProfile.avatarType = "large";
        }}
      />

      {(currentProfile.avatarType === "small" || currentProfile.avatarType === "large") && (
        <>
          <FormInput
            title="Avatar URL"
            value={currentProfile.avatarUrl}
            placeholder="Leave empty for default image"
            onChange={(v) => (currentProfile.avatarUrl = v)}
          />
          
          <FormInput
            title="Width (px)"
            value={currentProfile.avatarWidth}
            placeholder="Leave empty for unrestricted"
            onChange={(v) => (currentProfile.avatarWidth = v)}
          />
          
          <FormInput
            title="Height (px)"
            value={currentProfile.avatarHeight}
            placeholder="Leave empty for unrestricted"
            onChange={(v) => (currentProfile.avatarHeight = v)}
          />
        </>
      )}
    </FormSection>
  );
}