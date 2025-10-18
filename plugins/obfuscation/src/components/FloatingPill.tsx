import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { vstorage } from "../storage";
import { FluxDispatcher } from "@vendetta/metro/common";
import { findByStoreName } from "@vendetta/metro";

const MessageStore = findByStoreName("MessageStore");

const styles = stylesheet.createThemedStyleSheet({
  androidRipple: {
    color: semanticColors.ANDROID_RIPPLE,
    cornerRadius: 8,
  } as any,
  container: {
    backgroundColor: "transparent",
    borderRadius: 8,
    marginRight: 8,
    marginTop: -12,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
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

// Function to reprocess all messages
const reprocessAllMessages = () => {
  console.log("[ObfuscationPlugin] Reprocessing all messages...");
  
  const channels = MessageStore.getMutableMessages?.() ?? {};
  
  Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
    if (channelMessages && typeof channelMessages === 'object') {
      Object.values(channelMessages).forEach((message: any) => {
        if (message?.content?.startsWith(`[🔐${vstorage.marker}]`)) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: message,
            log_edit: false,
          });
        }
      });
    }
  });
};

export default function FloatingPill() {
  useProxy(vstorage);

  const handleToggle = () => {
    const newState = !vstorage.enabled;
    vstorage.enabled = newState;
    
    // Reprocess messages immediately after toggle
    setTimeout(() => {
      reprocessAllMessages();
    }, 100);
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