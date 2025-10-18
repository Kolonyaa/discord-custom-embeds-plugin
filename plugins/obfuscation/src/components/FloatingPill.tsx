import { React } from "@vendetta/metro/common";
import { ReactNative as RN } from "@vendetta/metro/common";
import { stylesheet } from "@vendetta/metro/common";
import { semanticColors } from "@vendetta/ui";
import { useProxy } from "@vendetta/storage";
import { FluxDispatcher } from "@vendetta/metro/common";
import { findByStoreName } from "@vendetta/metro";
import { vstorage } from "../storage";
import { scramble, unscramble } from "../obfuscationUtils";
import { forceReprocessMessages } from "../patcher";

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

export default function FloatingPill() {
  useProxy(vstorage);

  const reprocessAllMessages = () => {
    console.log("[ObfuscationPlugin] Manually reprocessing messages after toggle...");
    
    const channels = MessageStore.getMutableMessages?.() ?? {};

    Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
      if (channelMessages && typeof channelMessages === 'object') {
        Object.values(channelMessages).forEach((message: any) => {
          if (!message?.content) return;

          const content = message.content;
          
          // If plugin is enabled and message is encrypted, decrypt it
          if (vstorage.enabled && content.startsWith(`[🔐${vstorage.marker}]`)) {
            if (vstorage.secret) {
              try {
                const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);
                const decoded = unscramble(encryptedBody, vstorage.secret);
                message.content = `[🔓${vstorage.marker}] ${decoded}`;
              } catch (e) {
                console.error("Failed to decrypt message:", e);
              }
            }
          }
          // If plugin is disabled and message is decrypted, re-encrypt it
          else if (!vstorage.enabled && content.startsWith(`[🔓${vstorage.marker}]`)) {
            if (vstorage.secret) {
              try {
                const decryptedBody = content.slice(`[🔓${vstorage.marker}] `.length);
                const scrambled = scramble(decryptedBody, vstorage.secret);
                message.content = `[🔐${vstorage.marker}] ${scrambled}`;
              } catch (e) {
                console.error("Failed to re-encrypt message:", e);
              }
            }
          }

          // Force update regardless of whether content changed
          FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: { ...message },
            log_edit: false,
          });
        });
      }
    });
  };

  const handleToggle = () => {
  vstorage.enabled = !vstorage.enabled;
  
  // Use the forceReprocessMessages from patcher if available, otherwise fallback
  setTimeout(() => {
    if (forceReprocessMessages) {
      forceReprocessMessages();
    } else {
      reprocessAllMessages(); // fallback to local function
    }
  }, 200);
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