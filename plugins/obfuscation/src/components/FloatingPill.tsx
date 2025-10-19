import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { vstorage } from "../storage";

const ACTION_ICON_SIZE = 40;
const styles = stylesheet.createThemedStyleSheet({
  androidRipple: {
    color: semanticColors.ANDROID_RIPPLE,
    cornerRadius: 2147483647,
  } as any,
  actionButton: {
    borderRadius: 2147483647,
    height: ACTION_ICON_SIZE,
    width: ACTION_ICON_SIZE,
    marginHorizontal: 4,
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semanticColors.BACKGROUND_SECONDARY_ALT,
    marginLeft: 8,
    marginTop: -4,
  },
  actionIcon: {
    width: ACTION_ICON_SIZE * 0.6,
    height: ACTION_ICON_SIZE * 0.6,
  },
});

export default function FloatingPill() {
  useProxy(vstorage);

  const handleToggle = () => {
    vstorage.enabled = !vstorage.enabled;
  };

  return (
    // Full-screen overlay to capture touches
    <RN.View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
      }}
      pointerEvents="box-none" // Only children handle touches
    >
      {/* Positioned container for the button */}
      <RN.View
        style={{
          position: "absolute",
          right: ACTION_ICON_SIZE - 32,
          top: -ACTION_ICON_SIZE,
        }}
        pointerEvents="auto" // Capture touches to prevent passing through
      >
        <RN.Pressable
          android_ripple={styles.androidRipple}
          onPress={handleToggle}
          style={styles.actionButton}
        >
          <RN.Image
            key={vstorage.enabled ? "on" : "off"}
            style={styles.actionIcon}
            source={{
              uri: vstorage.enabled
                ? "https://files.catbox.moe/qsvl6n.png"
                : "https://files.catbox.moe/6jbhby.png",
            }}
            tintColor={vstorage.enabled ? "#ffb3d4" : "#B9BBBE"}
          />
        </RN.Pressable>
      </RN.View>
    </RN.View>
  );
}
