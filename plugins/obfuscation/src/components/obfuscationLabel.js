// components/ObfuscationLabel.js
import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";

export default function ObfuscationLabel({ marker, isEncrypted = true }) {
  return (
    <RN.View 
      style={{
        backgroundColor: isEncrypted ? "#5865F2" : "#57F287",
        borderRadius: 8,
        paddingHorizontal: 6,
        paddingVertical: 2,
        marginRight: 8,
        alignSelf: 'flex-start',
      }}
    >
      <RN.Text 
        style={{
          color: "#FFFFFF",
          fontSize: 12,
          fontWeight: "600",
          fontFamily: "gg sans",
        }}
      >
        {isEncrypted ? "🔐" : "🔓"} {marker}
      </RN.Text>
    </RN.View>
  );
}