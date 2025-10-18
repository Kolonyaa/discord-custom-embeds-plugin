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
function createEmojiUrlWithMarker(marker) {
  return `<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>`;
}

function extractMarkerFromUrl(url) {
  const match = url.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationEmoji(content) {
  return content?.includes(BASE_EMOJI_URL);
}

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add visual indicator for everyone
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || hasObfuscationEmoji(content) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Add wrapped emoji URL with marker before the encrypted content
        const emojiWithMarker = createEmojiUrlWithMarker(vstorage.marker);
        msg.content = `${emojiWithMarker} ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Improved RowManager patch with better content parsing
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;

      const message = data.message;
      let content = message?.content;

      // Check if message has our emoji indicator
      if (!hasObfuscationEmoji(content)) return;

      // Extract marker and encrypted content more reliably
      const markerMatch = content.match(EMOJI_REGEX);
      if (!markerMatch) return;

      const wrappedEmojiUrl = markerMatch[0];
      const marker = extractMarkerFromUrl(wrappedEmojiUrl);
      
      if (!marker) return;

      // More robust extraction of encrypted content
      const contentAfterEmoji = content.substring(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length);
      const encryptedBody = contentAfterEmoji.trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded - replace content with decrypted version
          message.content = `${wrappedEmojiUrl} ${decoded}`;
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          console.error("[ObfuscationPlugin] Failed to decrypt message:", e);
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Process the wrapped emoji URL to render as actual emoji
      const actualUrl = wrappedEmojiUrl.slice(1, -1); // Remove < and >
      message.content = message.content.replace(wrappedEmojiUrl, ` ${actualUrl} `);
      data.__realmoji = true;
    })
  );

  // Improved emoji rendering patch
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || data.__realmoji !== true) return;
      
      const message = row?.message;
      if (!message || !message.content) return;

      // Process the content array to convert emoji URLs to custom emoji components
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link" && el.target?.includes(BASE_EMOJI_URL)) {
            const match = el.target.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.webp/);
            if (!match) continue;
            
            const url = `${match[0]}?size=128`;
            const emoji = getCustomEmojiById(match[1]);

            message.content[i] = {
              type: "customEmoji",
              id: match[1],
              alt: emoji?.name ?? "<obfuscation-emoji>",
              src: url,
              frozenSrc: url.replace("gif", "webp"),
              jumboable: false,
            };
          }
        }
      }
    })
  );

  // Improved getMessage patch
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      if (!hasObfuscationEmoji(content)) return message;

      // Extract marker and encrypted body from wrapped URL
      const markerMatch = content.match(EMOJI_REGEX);
      if (!markerMatch) return message;

      const wrappedEmojiUrl = markerMatch[0];
      const marker = extractMarkerFromUrl(wrappedEmojiUrl);
      
      if (!marker) return message;

      const contentAfterEmoji = content.substring(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length);
      const encryptedBody = contentAfterEmoji.trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `${wrappedEmojiUrl} ${decoded}`;
        } catch (e) {
          console.error("[ObfuscationPlugin] Failed to decrypt in getMessage:", e);
        }
      }

      return message;
    })
  );

  // Improved message reprocessing with error handling
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    try {
      const channels = MessageStore.getMutableMessages?.() ?? {};

      Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
        if (channelMessages && typeof channelMessages === 'object') {
          Object.values(channelMessages).forEach((message: any) => {
            if (hasObfuscationEmoji(message?.content)) {
              // Create a clean copy to avoid mutation issues
              const cleanMessage = { ...message };
              FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                message: cleanMessage,
                log_edit: false,
              });
            }
          });
        }
      });
    } catch (e) {
      console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
    }
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => patches.forEach(unpatch => unpatch());
}