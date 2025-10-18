import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { vstorage } from "../storage";

const styles = stylesheet.createThemedStyleSheet({
  androidRipple: {
    color: semanticColors.ANDROID_RIPPLE,
    cornerRadius: 8,
  } as any,
  container: {
    backgroundColor: semanticColors.BACKGROUND_TERTIARY,
    borderRadius: 8,
    marginRight: 8,
    marginTop: -12,
    flexDirection: "row",
    alignItems: "center",
  },
  text: {
    color: semanticColors.TEXT_NORMAL,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  enabled: {
    color: semanticColors.TEXT_POSITIVE,
  },
  disabled: {
    color: semanticColors.TEXT_MUTED,
  },
});

export default function FloatingPill() {
  // Use React state for the UI, sync with storage
  const [isEnabled, setIsEnabled] = React.useState(vstorage.enabled);

  const handleToggle = () => {
    const newState = !isEnabled;
    setIsEnabled(newState);
    vstorage.enabled = newState;
  };

  return (
    <RN.Pressable
      android_ripple={styles.androidRipple}
      style={styles.container}
      onPress={handleToggle}
    >
      <RN.Text style={[styles.text, isEnabled ? styles.enabled : styles.disabled]}>
        {isEnabled ? "🔐 ON" : "🔓 OFF"}
      </RN.Text>
    </RN.Pressable>
  );
}