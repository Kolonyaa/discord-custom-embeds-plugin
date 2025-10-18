import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
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

interface FloatingPillProps {
  onToggle: (enabled: boolean) => void;
}

export default function FloatingPill({ onToggle }: FloatingPillProps) {
  useProxy(vstorage);
  const [localEnabled, setLocalEnabled] = React.useState(vstorage.enabled);

  const handlePress = () => {
    const newState = !localEnabled;
    setLocalEnabled(newState);
    vstorage.enabled = newState;
    onToggle(newState);
  };

  return (
    <RN.Pressable
      android_ripple={styles.androidRipple}
      style={styles.container}
      onPress={handlePress}
    >
      <RN.Text style={[styles.text, localEnabled ? styles.enabled : styles.disabled]}>
        {localEnabled ? "🔐 ON" : "🔓 OFF"}
      </RN.Text>
    </RN.Pressable>
  );
}