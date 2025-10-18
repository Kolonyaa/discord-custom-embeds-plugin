import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Base emoji URL
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";

// Check for wrapped emoji URL
function hasObfuscationEmoji(content: string): boolean {
  return content?.includes(`<${BASE_EMOJI_URL}>`);
}

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying WRAPPED EMOJI patches...");

  // Outgoing messages - add wrapped emoji URL
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;
      if (!content || !vstorage.secret) return;
      if (hasObfuscationEmoji(content)) return;

      console.log("[ObfuscationPlugin] Sending message:", content);

      try {
        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);
        
        // Add WRAPPED emoji URL before scrambled content
        msg.content = `<${BASE_EMOJI_URL}> ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble:", e);
      }
    })
  );

  // Process incoming messages in RowManager
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;
      if (!data.message?.content) return;

      const content = data.message.content;
      
      // Only process if it contains our WRAPPED emoji URL
      if (!hasObfuscationEmoji(content)) return;

      console.log("[ObfuscationPlugin] Processing wrapped emoji message:", content);

      // Extract encrypted body (everything after WRAPPED emoji URL)
      const wrappedUrl = `<${BASE_EMOJI_URL}>`;
      const emojiIndex = content.indexOf(wrappedUrl);
      const encryptedBody = content.slice(emojiIndex + wrappedUrl.length).trim();

      if (!vstorage.secret || !encryptedBody) {
        console.log("[ObfuscationPlugin] No secret or encrypted body");
        return;
      }

      try {
        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Successfully decoded:", decoded);
        
        // Replace entire content with decoded version
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
            if (hasObfuscationEmoji(message?.content)) {
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