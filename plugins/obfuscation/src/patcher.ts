import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Export a function that can be called from outside to force reprocessing
export let forceReprocessMessages: (() => void) | null = null;

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add visual indicator for everyone
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;

      if (!content || content.startsWith(`[🔐${vstorage.marker}]`) || content.startsWith(`[🔓${vstorage.marker}]`) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        msg.content = `[🔐${vstorage.marker}] ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Patch RowManager for message rendering
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;

      const message = data.message;
      const content = message?.content;

      // If plugin is disabled, show encrypted version regardless
      if (!vstorage.enabled) {
        if (content?.startsWith(`[🔓${vstorage.marker}]`)) {
          const decryptedBody = content.slice(`[🔓${vstorage.marker}] `.length);
          try {
            const scrambled = scramble(decryptedBody, vstorage.secret);
            message.content = `[🔐${vstorage.marker}] ${scrambled}`;
          } catch (e) {
            // If scrambling fails, leave as is
          }
        }
        return;
      }

      // Plugin is enabled - try to decrypt
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // Failed to decrypt, leave as locked
        }
      }
    })
  );

  // Also patch getMessage
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      
      // If plugin is disabled, show encrypted version
      if (!vstorage.enabled) {
        if (content?.startsWith(`[🔓${vstorage.marker}]`)) {
          const decryptedBody = content.slice(`[🔓${vstorage.marker}] `.length);
          try {
            const scrambled = scramble(decryptedBody, vstorage.secret);
            message.content = `[🔐${vstorage.marker}] ${scrambled}`;
          } catch (e) {
            // If scrambling fails, leave as is
          }
        }
        return message;
      }

      // Plugin is enabled - try to decrypt
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return message;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // Leave as locked if decryption fails
        }
      }

      return message;
    })
  );

  // Create the force reprocess function
  forceReprocessMessages = () => {
    console.log("[ObfuscationPlugin] Force reprocessing messages from patcher...");
    
    const channels = MessageStore.getMutableMessages?.() ?? {};
    Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
      if (channelMessages && typeof channelMessages === 'object') {
        Object.values(channelMessages).forEach((message: any) => {
          if (message?.content) {
            FluxDispatcher.dispatch({
              type: "MESSAGE_UPDATE", 
              message: { ...message },
              log_edit: false,
            });
          }
        });
      }
    });
  };

  return () => {
    forceReprocessMessages = null;
    patches.forEach(unpatch => unpatch());
  };
}