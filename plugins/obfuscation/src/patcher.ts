import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const { getCustomEmojiById } = findByStoreName("EmojiStore");

// Constants for the emoji indicator
const EMOJI_URL = "https://cdn.discordapp.com/emojis/1429139654137090220.webp?size=48&quality=lossless&name=unlocked";
const EMOJI_REGEX = /https:\/\/cdn.discordapp.com\/emojis\/(\d+)\.\w+/;
const INVISIBLE_PREFIX = "\u200B\u200B\u200B"; // Zero-width spaces
const VISIBLE_INDICATOR = `${INVISIBLE_PREFIX}${EMOJI_URL}${INVISIBLE_PREFIX}`;

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add invisible emoji indicator
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || content.includes(VISIBLE_INDICATOR) || content.startsWith(`[🔐${vstorage.marker}]`) || content.startsWith(`[🔓${vstorage.marker}]`) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Add invisible emoji indicator before the marker
        msg.content = `${VISIBLE_INDICATOR}[🔐${vstorage.marker}] ${scrambled}`;
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

      // Check if message has our invisible emoji indicator and lock marker
      const hasEmojiIndicator = content?.includes(VISIBLE_INDICATOR);
      const hasLockMarker = content?.includes(`[🔐${vstorage.marker}]`);
      const hasUnlockMarker = content?.includes(`[🔓${vstorage.marker}]`);

      if (!hasEmojiIndicator || (!hasLockMarker && !hasUnlockMarker)) return;

      const messageId = `${message.channel_id}-${message.id}`;
      
      // Extract the encrypted body if it's a locked message
      if (hasLockMarker) {
        const markerStart = content.indexOf(`[🔐${vstorage.marker}]`);
        const encryptedBody = content.slice(markerStart + `[🔐${vstorage.marker}] `.length);

        // If we have the secret, try to decrypt and show unlocked version
        if (vstorage.secret) {
          try {
            const decoded = unscramble(encryptedBody, vstorage.secret);
            // Successfully decoded with our key - replace with unlocked version
            message.content = `${VISIBLE_INDICATOR}[🔓${vstorage.marker}] ${decoded}`;
            content = message.content; // Update local content variable
          } catch {
            // Failed to decrypt with our key, leave as locked version
          }
        }
      }

      // Process the invisible emoji indicator to render as actual emoji
      if (content && content.includes(VISIBLE_INDICATOR)) {
        // Extract just the emoji URL part for rendering
        const emojiUrl = EMOJI_URL;
        // Replace the invisible indicator with the emoji URL for rendering
        const processedContent = content.replace(VISIBLE_INDICATOR, ` ${emojiUrl} `);
        message.content = processedContent;
        data.__realmoji = true;
      }
    })
  );

  // Additional patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || data.__realmoji !== true) return;
      
      const message = row?.message;
      if (!message || !message.content) return;

      // Process the content array to convert emoji URLs to custom emoji components
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link" && el.target?.match(EMOJI_REGEX)) {
            const match = el.target.match(EMOJI_REGEX);
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

  // Also patch getMessage - ALWAYS process incoming messages
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      if (!content?.includes(VISIBLE_INDICATOR) || (!content?.includes(`[🔐${vstorage.marker}]`) && !content?.includes(`[🔓${vstorage.marker}]`))) {
        return message;
      }

      // Extract the encrypted body if it's a locked message
      if (content.includes(`[🔐${vstorage.marker}]`)) {
        const markerStart = content.indexOf(`[🔐${vstorage.marker}]`);
        const encryptedBody = content.slice(markerStart + `[🔐${vstorage.marker}] `.length);

        if (vstorage.secret) {
          try {
            const decoded = unscramble(encryptedBody, vstorage.secret);
            message.content = `${VISIBLE_INDICATOR}[🔓${vstorage.marker}] ${decoded}`;
          } catch {
            // Leave as locked if decryption fails
          }
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
          if (message?.content?.includes(VISIBLE_INDICATOR) && 
              (message.content.includes(`[🔐${vstorage.marker}]`) || message.content.includes(`[🔓${vstorage.marker}]`))) {
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