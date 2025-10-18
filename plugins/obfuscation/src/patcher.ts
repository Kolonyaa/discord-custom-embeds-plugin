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

  // Patch RowManager for message rendering - ALWAYS process incoming messages
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;

      const message = data.message;
      let content = message?.content;

      // Check if message has our emoji indicator
      if (!hasObfuscationEmoji(content)) return;


      // Extract marker from the wrapped URL
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;

      if (!marker) return;

      // Extract the encrypted body (everything after the wrapped emoji URL)
      const wrappedEmojiUrl = markerMatch[0];
      const encryptedBody = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded - replace content with decrypted version
          // Use the same wrapped emoji URL but now the content is decrypted
          message.content = `${wrappedEmojiUrl} ${decoded}`;
          content = message.content; // Update local content variable
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Process the wrapped emoji URL to render as actual emoji
      if (content && hasObfuscationEmoji(content)) {
        // Extract the actual URL from the wrapped version for processing
        const actualUrl = wrappedEmojiUrl.slice(1, -1); // Remove < and >
        // Replace the wrapped URL with the actual URL for emoji rendering
        const processedContent = content.replace(wrappedEmojiUrl, ` ${actualUrl} `);
        message.content = processedContent;
        data.__realmoji = true;
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

      // Extract marker and encrypted body from wrapped URL
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;

      if (!marker) return message;

      const wrappedEmojiUrl = markerMatch[0];
      const encryptedBody = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `${wrappedEmojiUrl} ${decoded}`;
        } catch {
          // Leave as encrypted if decryption fails
        }
      }

      return message;
    })
  );

  // Process existing messages by forcing a re-render - ALWAYS process
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    const channels = MessageStore.getMutableMessages?.() ?? {};

    Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
      if (channelMessages && typeof channelMessages === 'object') {
        Object.values(channelMessages).forEach((message: any) => {
          if (hasObfuscationEmoji(message?.content)) {
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