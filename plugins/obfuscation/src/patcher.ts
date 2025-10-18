import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Simple prefix instead of emoji for testing
const PREFIX = "[ENC]";

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying MINIMAL patches...");

  // ONLY patch sendMessage to scramble outgoing messages
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;
      if (!content || !vstorage.secret) return;
      if (content.startsWith(PREFIX)) return; // Don't double-encrypt

      console.log("[ObfuscationPlugin] Sending message:", content);

      try {
        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);
        
        // Add simple prefix
        msg.content = `${PREFIX} ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble:", e);
      }
    })
  );

  // ONLY patch RowManager for incoming messages
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;
      if (!data.message?.content) return;

      const content = data.message.content;
      
      // Only process if it starts with our prefix
      if (!content.startsWith(PREFIX)) return;

      console.log("[ObfuscationPlugin] Processing encrypted message:", content);

      const encryptedBody = content.slice(PREFIX.length).trim();

      if (!vstorage.secret || !encryptedBody) {
        console.log("[ObfuscationPlugin] No secret or encrypted body");
        return;
      }

      try {
        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Successfully decoded:", decoded);
        data.message.content = decoded;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to decode:", e);
      }
    })
  );

  // Process existing messages
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    setTimeout(() => {
      const channels = MessageStore.getMutableMessages?.() ?? {};

      Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
        if (channelMessages && typeof channelMessages === 'object') {
          Object.values(channelMessages).forEach((message: any) => {
            if (message?.content?.startsWith(PREFIX)) {
              FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                message: { ...message },
              });
            }
          });
        }
      });
    }, 1000);
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}