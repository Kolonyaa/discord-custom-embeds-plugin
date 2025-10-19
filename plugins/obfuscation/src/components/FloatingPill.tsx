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
    <RN.View
      style={{
        flexDirection: "row",
        position: "absolute",
        right: ACTION_ICON_SIZE - 32,
        top: -ACTION_ICON_SIZE,
        zIndex: 9999,
      }}
    >
      <RN.Pressable
        android_ripple={styles.androidRipple}
        onPress={handleToggle}
        style={styles.actionButton}
      >
        <RN.Image
          style={styles.actionIcon}
          source={{
            uri: vstorage.enabled
              ? "https://files.catbox.moe/6jbhby.png" // Locked icon (white PNG)
              : "https://files.catbox.moe/qsvl6n.png", // Unlocked icon (white PNG)
          }}
          tintColor={vstorage.enabled ? "#ffb3d4" : semanticColors.INTERACTIVE_NORMAL}
        />
      </RN.Pressable>
    </RN.View>
  );
}