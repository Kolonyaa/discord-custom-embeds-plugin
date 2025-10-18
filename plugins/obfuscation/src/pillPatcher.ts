import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { vstorage } from "../storage";
import { FluxDispatcher } from "@vendetta/metro/common";

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
  useProxy(vstorage);

  const handleToggle = () => {
    const newState = !vstorage.enabled;
    vstorage.enabled = newState;
    
    // Force immediate UI update
    setTimeout(() => {
      // Dispatch multiple events to ensure re-render
      FluxDispatcher.dispatch({
        type: "UPDATE_TEXT_INPUT",
        value: "", 
      });
      
      // Also try to force chat re-render
      FluxDispatcher.dispatch({
        type: "LOCAL_STORAGE_UPDATED",
        key: "obfuscation-enabled",
        value: newState,
      });
    }, 50);
  };

  return (
    <RN.Pressable
      android_ripple={styles.androidRipple}
      style={styles.container}
      onPress={handleToggle}
    >
      <RN.Text style={[styles.text, vstorage.enabled ? styles.enabled : styles.disabled]}>
        {vstorage.enabled ? "🔐 ON" : "🔓 OFF"}
      </RN.Text>
    </RN.Pressable>
  );
}