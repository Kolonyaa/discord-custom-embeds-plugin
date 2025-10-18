import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { useProxy } from "@vendetta/storage";
import { vstorage } from "./storage";

const { FormSection, FormSwitch, FormInput } = Forms;

export default function Settings() {
  useProxy(vstorage);

  return (
    <RN.ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 38 }}>
      <FormSection title="Message Obfuscation">
        <FormSwitch
          label="Enable Obfuscation"
          value={vstorage.enabled}
          onValueChange={(v) => (vstorage.enabled = v)}
        />

        <FormInput
          title="Shared Secret"
          value={vstorage.secret}
          onChange={(v) => (vstorage.secret = v)}
          placeholder="Enter shared secret"
          secureTextEntry
        />
      </FormSection>
    </RN.ScrollView>
  );
}