import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { vstorage } from "./storage";

import ProfileListSection from "./components/ProfileListSection";
import ProfileFormSection from "./components/ProfileFormSection";
import AvatarSettingsSection from "./components/AvatarSettingsSection";
import ExamplePreviewSection from "./components/ExamplePreviewSection";

export default function Settings() {
  useProxy(vstorage);

  return (
    <RN.ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
      <ExamplePreviewSection />
      <ProfileListSection />
      <ProfileFormSection />
      <AvatarSettingsSection />
    </RN.ScrollView>
  );
}