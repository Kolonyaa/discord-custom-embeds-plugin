import React from "react";
import { Forms } from "@vendetta/ui/components";
import { vstorage } from "../storage";
import type { Profile } from "../types";

const { FormSection, FormInput } = Forms;

export default function ProfileFormSection() {
  const currentProfile = vstorage.profiles.find((p: Profile) => p.id === vstorage.currentProfileId) || vstorage.profiles[0];

  return (
    <FormSection title={`Settings - ${currentProfile.name}`}>
      <FormInput 
        title="Profile Name" 
        value={currentProfile.name} 
        onChange={v => (currentProfile.name = v)} 
      />
      <FormInput 
        title="Base URL" 
        value={currentProfile.baseUrl} 
        onChange={v => (currentProfile.baseUrl = v)} 
      />
      <FormInput 
        title="Embed Color" 
        value={currentProfile.color} 
        onChange={v => (currentProfile.color = v)} 
      />
      <FormInput 
        title="Site Name (og:site_name)" 
        value={currentProfile.siteName} 
        placeholder="Leave empty for no site name"
        onChange={v => (currentProfile.siteName = v)} 
      />
      <FormInput 
        title="Embed Title (og:title)" 
        value={currentProfile.title} 
        placeholder="Leave empty for no title"
        onChange={v => (currentProfile.title = v)} 
      />
    </FormSection>
  );
}