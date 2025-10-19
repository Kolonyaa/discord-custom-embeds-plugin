import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { getAssetIDByName } from "@vendetta/ui/assets";
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
    backgroundColor: "#2b2d31", // Manual dark grey to match Discord input
  },
  actionIcon: {
    tintColor: semanticColors.INTERACTIVE_NORMAL,
    width: ACTION_ICON_SIZE * 0.6,
    height: ACTION_ICON_SIZE * 0.6,
  },
  enabledIcon: {
    tintColor: "#ffb3d4", // Your pink color for ON
  },
  disabledIcon: {
    tintColor: "#949ba4", // Slightly lighter grey for OFF
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
        right: 8, // Move more to the right (decreased value = more right)
        bottom: 64, // Move higher up (increased value = higher position)
        zIndex: 9999,
      }}
    >
      <RN.Pressable
        android_ripple={styles.androidRipple}
        onPress={handleToggle}
        style={styles.actionButton}
      >
        <RN.Image
          style={[
            styles.actionIcon,
            vstorage.enabled ? styles.enabledIcon : styles.disabledIcon,
          ]}
          source={getAssetIDByName("EyeIcon")}
        />
      </RN.Pressable>
    </RN.View>
  );
}