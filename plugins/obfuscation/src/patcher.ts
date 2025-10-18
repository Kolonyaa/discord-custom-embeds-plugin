import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add visual indicator for everyone
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!content || content.startsWith(`[🔐${vstorage.marker}]`) || content.startsWith(`[🔓${vstorage.marker}]`) || !vstorage.enabled || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Send with visual indicator so EVERYONE sees the lock icon
        msg.content = `[🔐${vstorage.marker}] ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Patch RowManager for message rendering
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1 || !vstorage.enabled) return;
      
      const message = data.message;
      const content = message?.content;
      
      // Check if message has our lock indicator (encrypted message)
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return;

      const messageId = `${message.channel_id}-${message.id}`;
      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      // If we have the secret, try to decrypt and show unlocked version
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded with our key - replace with unlocked version
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // Failed to decrypt with our key, leave as locked version
          // message.content stays as `[🔐${vstorage.marker}] ${encryptedBody}`
        }
      }
      // If no secret, message stays as locked version
    })
  );

  // Also patch getMessage
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message || !vstorage.enabled) return message;
      
      const content = message.content;
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

  // Process existing messages by forcing a re-render
  const reprocessExistingMessages = () => {
    if (!vstorage.enabled) return;
    
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");
    
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

  setTimeout(reprocessExistingMessages, 500);

  return () => patches.forEach(unpatch => unpatch());
}