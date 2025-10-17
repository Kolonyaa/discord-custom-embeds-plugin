import React from "react";
import { ReactNative as RN } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { vstorage } from "../storage";
import type { Profile } from "../types";

const { FormSection, FormRow } = Forms;

export default function ExamplePreviewSection() {
  const currentProfile =
    vstorage.profiles.find((p: Profile) => p.id === vstorage.currentProfileId) ||
    vstorage.profiles[0];

  // Determine if we should show avatar based on avatarType
  const showAvatar = currentProfile.avatarType !== "none";
  
  // Calculate avatar dimensions based on settings
  let avatarWidth = 45;
  let avatarHeight = 45;
  let isLargeAvatar = false;

  if (showAvatar) {
    if (currentProfile.avatarType === "large") {
      // For large avatars, use provided dimensions or default to large size
      avatarWidth = currentProfile.avatarWidth ? parseInt(currentProfile.avatarWidth) : 400;
      avatarHeight = currentProfile.avatarHeight ? parseInt(currentProfile.avatarHeight) : 200;
      isLargeAvatar = true;
    } else {
      // For small avatars, use provided dimensions or default to small size
      avatarWidth = currentProfile.avatarWidth ? parseInt(currentProfile.avatarWidth) : 45;
      avatarHeight = currentProfile.avatarHeight ? parseInt(currentProfile.avatarHeight) : 45;
      isLargeAvatar = false;
    }
  }

  return (
    <FormSection title="Open Graph Embed Preview">
      {/* Open Graph Embed Preview */}
      <RN.View
        style={{
          backgroundColor: "#27272f", // Modern Discord grey
          borderRadius: 14, // Slightly more rounded corners
          borderWidth: 1,
          borderColor: "#3f4147",
          margin: 10,
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        {/* Embed Color Accent - LEFT SIDE */}
        <RN.View
          style={{
            width: 4,
            backgroundColor: currentProfile.color || "#5865F2",
          }}
        />
        
        <RN.View style={{ flex: 1, padding: 12 }}>
          {/* Top row with title/site and small avatar */}
          <RN.View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <RN.View style={{ flex: 1, marginRight: 8 }}>
              {currentProfile.siteName && (
                <RN.Text
                  style={{
                    color: "#b5bac1", // Modern Discord light grey
                    fontSize: 10,
                    marginBottom: 4,
                    fontFamily: "ggsans-normal",
                  }}
                >
                  {currentProfile.siteName}
                </RN.Text>
              )}
              
              {currentProfile.title && (
                <RN.Text
                  style={{
                    color: "#00a8fc",
                    fontWeight: "700", // Bolder hyperlink text
                    fontSize: 16,
                    marginBottom: 8,
                    fontFamily: "ggsans-bold", // Use bold variant for hyperlink
                  }}
                >
                  {currentProfile.title}
                </RN.Text>
              )}
            </RN.View>

            {/* Small Avatar - Top Right (only for small avatars) */}
            {showAvatar && !isLargeAvatar && (
              <RN.Image
                source={{ 
                  uri: currentProfile.avatarUrl || "https://files.catbox.moe/1f995e.webp" 
                }}
                style={{
                  width: avatarWidth * 1.5, // Scale up to match Discord's apparent size
                  height: avatarHeight * 1.5,
                  borderRadius: 6, // Slightly more rounded corners
                  maxWidth: 120, // Adjusted max for scaled avatars
                  maxHeight: 120,
                }}
              />
            )}
          </RN.View>

          {/* Description */}
          <RN.Text
            style={{
              color: "#dbdee1", // Modern Discord text color
              fontSize: 12,
              lineHeight: 18,
              marginBottom: isLargeAvatar ? 12 : 0,
              fontFamily: "ggsans-normal",
            }}
          >
            This is what your embedded message text would look like in a Discord Open Graph embed preview...
          </RN.Text>

          {/* Large Image - for large avatars aligned to bottom left */}
          {showAvatar && isLargeAvatar && (
            <RN.Image
              source={{ 
                uri: currentProfile.avatarUrl || "https://files.catbox.moe/1f995e.webp" 
              }}
              style={{
                width: avatarWidth > 0 ? Math.min(avatarWidth, 400) : "100%",
                height: avatarHeight > 0 ? Math.min(avatarHeight, 300) : 200,
                borderRadius: 8, // Slightly more rounded corners
                marginTop: 12,
                resizeMode: "cover",
                alignSelf: "flex-start",
              }}
            />
          )}
        </RN.View>
      </RN.View>

      <FormRow
        label=""
        subLabel="This preview shows how your Open Graph embed would appear in Discord. The actual appearance may vary based on Discord's rendering."
      />
    </FormSection>
  );
}