import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const { getCustomEmojiById } = findByStoreName("EmojiStore");

// Base emoji URL without marker
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
const EMOJI_REGEX = /<https:\/\/cdn\.discordapp\.com\/emojis\/1429170621891477615\.webp\?size=48&quality=lossless(&marker=[^>&\s]+)>/;

// Helper functions to work with marker URLs
function createEmojiUrlWithMarker(marker: string): string {
  return `<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>`;
}

function extractMarkerFromUrl(url: string): string | null {
  const match = url.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationEmoji(content: string): boolean {
  return content?.includes(BASE_EMOJI_URL);
}

export function applyPatches() {
  const patches = [];

  // Debug: Log when patches are applied
  console.log("[ObfuscationPlugin] Applying patches...");

  // Outgoing messages - add visual indicator for everyone
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) {
        console.log("[ObfuscationPlugin] Obfuscation disabled, skipping");
        return;
      }

      if (!content || hasObfuscationEmoji(content) || !vstorage.secret) {
        console.log("[ObfuscationPlugin] Invalid content or no secret:", { 
          hasContent: !!content, 
          hasEmoji: hasObfuscationEmoji(content), 
          hasSecret: !!vstorage.secret 
        });
        return;
      }

      console.log("[ObfuscationPlugin] Original content:", content);
      
      try {
        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled content:", scrambled);
        
        // Add wrapped emoji URL with marker before the encrypted content
        const emojiWithMarker = createEmojiUrlWithMarker(vstorage.marker);
        // Use clearer separation between emoji and encoded content
        msg.content = `${emojiWithMarker} -- ${scrambled}`;
        
        console.log("[ObfuscationPlugin] Final content to send:", msg.content);
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Patch RowManager for message rendering - ALWAYS process incoming messages
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;
      if (!data.message?.content) return;

      const content = data.message.content;
      if (!hasObfuscationEmoji(content)) return;

      console.log("[ObfuscationPlugin] Processing message for display:", content);

      const markerMatch = content.match(EMOJI_REGEX);
      if (!markerMatch) {
        console.log("[ObfuscationPlugin] No marker match found");
        return;
      }

      const wrappedEmojiUrl = markerMatch[0];
      // Extract the encrypted body (everything after the wrapped emoji URL and separator)
      const contentAfterEmoji = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length);
      const encryptedBody = contentAfterEmoji.replace(/^\s*--\s*/, '').trim();

      console.log("[ObfuscationPlugin] Encrypted body extracted:", encryptedBody);

      // If we have no secret or no encrypted body, just render as-is
      if (!vstorage.secret || !encryptedBody) {
        console.log("[ObfuscationPlugin] No secret or encrypted body, marking as encrypted");
        data.__encrypted = true;
        return;
      }

      try {
        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Successfully decoded:", decoded);
        
        // Replace the entire content with decoded version but keep the emoji
        data.message.content = `${wrappedEmojiUrl} ${decoded}`;
        data.__decrypted = true;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to decode:", e, "Encrypted body:", encryptedBody);
        data.__encrypted = true;
      }
    })
  );

  // Additional patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1) return;

      const message = row?.message;
      if (!message || !message.content) return;

      // Process the content array to convert ALL emoji URLs to custom emoji components
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link") {
            // Match any Discord emoji URL, not just the obfuscation one
            const match = el.target.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.\w+/);
            if (!match) continue;

            const url = `${match[0]}?size=128`;
            const emoji = getCustomEmojiById(match[1]);

            message.content[i] = {
              type: "customEmoji",
              id: match[1],
              alt: emoji?.name ?? "<external-emoji>",
              src: url,
              frozenSrc: url.replace("gif", "webp"),
              jumboable: false,
            };
          }
        }
      }
    })
  );

  // Also patch getMessage - ALWAYS process incoming messages
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      if (!hasObfuscationEmoji(content)) return message;

      console.log("[ObfuscationPlugin] getMessage processing:", content);

      // Extract marker and encrypted body from wrapped URL
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;

      if (!marker) return message;

      const wrappedEmojiUrl = markerMatch[0];
      const contentAfterEmoji = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length);
      const encryptedBody = contentAfterEmoji.replace(/^\s*--\s*/, '').trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          console.log("[ObfuscationPlugin] getMessage decoded:", decoded);
          message.content = `${wrappedEmojiUrl} ${decoded}`;
        } catch (e) {
          console.error("[ObfuscationPlugin] getMessage failed to decode:", e);
          // Leave as encrypted if decryption fails
        }
      }

      return message;
    })
  );

  // Process existing messages by forcing a re-render - ALWAYS process
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    // Wait a bit longer for everything to be ready
    setTimeout(() => {
      const channels = MessageStore.getMutableMessages?.() ?? {};

      let processedCount = 0;
      Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
        if (channelMessages && typeof channelMessages === 'object') {
          Object.values(channelMessages).forEach((message: any) => {
            if (hasObfuscationEmoji(message?.content)) {
              console.log("[ObfuscationPlugin] Reprocessing message:", message.content);
              FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                message: { ...message }, // Create a new object to force update
              });
              processedCount++;
            }
          });
        }
      });
      
      console.log(`[ObfuscationPlugin] Reprocessed ${processedCount} messages`);
    }, 1000);
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}