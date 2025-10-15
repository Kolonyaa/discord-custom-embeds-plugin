import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";

const { FormSwitchRow, FormRow, FormInput } = Forms;
import { vstorage } from "../";

export default function Settings() {
  useProxy(vstorage);

  return (
    <RN.ScrollView style={{ flex: 1 }}>
      <FormSwitchRow
        label="Enable Message Prefixer"
        subLabel="Automatically add prefix to all sent messages"
        leading={<FormRow.Icon source={getAssetIDByName("ic_message_edit")} />}
        onValueChange={() => {
          vstorage.config.enabled = !vstorage.config.enabled;
        }}
        value={vstorage.config.enabled}
      />
      
      <FormInput
        title="Prefix Text"
        value={vstorage.config.prefix}
        placeholder="you said: "
        onChange={(value: string) => {
          vstorage.config.prefix = value;
        }}
      />
      
      <FormRow
        label="Preview"
        subLabel={`"hello" → "${vstorage.config.prefix}hello"`}
        leading={<FormRow.Icon source={getAssetIDByName("ic_eye")} />}
      />
    </RN.ScrollView>
  );
}