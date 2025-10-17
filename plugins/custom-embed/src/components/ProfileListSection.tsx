import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { vstorage } from "../storage";
import { profileManager } from "../profileManager";
import type { Profile } from "../types";

const { FormSection, FormRow, FormDivider } = Forms;

export default function ProfileListSection() {
  const currentProfile = vstorage.profiles.find((p: Profile) => p.id === vstorage.currentProfileId) || vstorage.profiles[0];

  return (
    <FormSection title="Profile Management" titleStyleType="no_border">
      <FormRow
        label="Current Profile"
        subLabel={`${vstorage.profiles.length} profile(s) available`}
        trailing={
          <RN.View style={{ flexDirection: "row", alignItems: "center" }}>
            <RN.Text style={{ color: "#fff", marginRight: 8 }}>
              {currentProfile.name}
            </RN.Text>
          </RN.View>
        }
      />

      {vstorage.profiles.map((profile: Profile, i: number) => (
        <RN.View key={profile.id}>
          <FormRow
            label={profile.name}
            subLabel={`${profile.baseUrl.includes("vercel.app") ? "Default" : "Custom"} URL`}
            trailing={
              <RN.View style={{ flexDirection: "row" }}>
                {profile.id === vstorage.currentProfileId && (
                  <RN.Text style={{ color: "#00ff88", marginRight: 8 }}>Active</RN.Text>
                )}
              </RN.View>
            }
            onPress={() => (vstorage.currentProfileId = profile.id)}
          />
          {i < vstorage.profiles.length - 1 && <FormDivider />}
        </RN.View>
      ))}

      <FormRow
        label="Create New Profile"
        onPress={() => {
          const name = `Profile ${vstorage.profiles.length + 1}`;
          const newProfile = profileManager.createProfile(name);
          vstorage.currentProfileId = newProfile.id;
        }}
      />

      {vstorage.profiles.length > 1 && (
        <>
          <FormRow
            label="Duplicate Current Profile"
            onPress={() => {
              const duplicated = profileManager.duplicateProfile(currentProfile.id);
              if (duplicated) vstorage.currentProfileId = duplicated.id;
            }}
          />
          <FormRow
            label="Delete Current Profile"
            onPress={() => profileManager.deleteProfile(currentProfile.id)}
          />
        </>
      )}
    </FormSection>
  );
}