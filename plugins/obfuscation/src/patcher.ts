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
const EMOJI_BASE_URL = "https://cdn.discordapp.com/emojis/1413171773284810883.webp";
const EMOJI_REGEX = /https:\/\/cdn\.discordapp\.com\/emojis\/1413171773284810883\.webp\?[^>]*marker=([^&>]+)/;
const INVISIBLE_CHAR = "⠀"; // Braille pattern blanks

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add hidden visual indicator
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || 
          content.includes(EMOJI_BASE_URL) || 
          content.includes(`[🔐${vstorage.marker}]`) || 
          content.includes(`[🔓${vstorage.marker}]`) || 
          !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Create the hidden emoji link with marker in URL parameters
        const emojiUrl = `${EMOJI_BASE_URL}?size=48&quality=lossless&name=blowjob4&marker=${encodeURIComponent(vstorage.marker)}`;
        // Format: [invisible_char](<url>) encrypted_content
        msg.content = `[${INVISIBLE_CHAR}](<${emojiUrl}>) ${scrambled}`;
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
      if (!content) return;

      // Check if message has our hidden emoji pattern
      const emojiMatch = content.match(/\[⠀\]\(<([^>]+)>\)\s+([\w=+\/]+)/);
      if (!emojiMatch) return;

      const fullUrl = emojiMatch[1];
      const encryptedContent = emojiMatch[2];
      
      // Extract marker from URL parameters
      const markerMatch = fullUrl.match(EMOJI_REGEX);
      const marker = markerMatch ? decodeURIComponent(markerMatch[1]) : vstorage.marker;

      const messageId = `${message.channel_id}-${message.id}`;

      // If we have the secret, try to decrypt and show unlocked version
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          // Successfully decoded - create unlocked version with visible emoji
          const emojiUrl = `${EMOJI_BASE_URL}?size=128&marker=${encodeURIComponent(marker)}`;
          message.content = `[${INVISIBLE_CHAR}](<${emojiUrl}>) ${decoded}`;
          content = message.content;
          data.__realmoji = true;
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt, leave as encrypted but still process the emoji
          data.__realmoji = true;
          data.__encrypted = true;
        }
      } else {
        // No secret available, just process the emoji
        data.__realmoji = true;
        data.__encrypted = true;
      }
    })
  );

  // Additional patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || data.__realmoji !== true) return;
      
      const message = row?.message;
      if (!message || !message.content) return;

      // Extract the emoji URL from the content
      const emojiMatch = message.content.match(/\[⠀\]\(<([^>]+)>\)/);
      if (!emojiMatch) return;

      const fullUrl = emojiMatch[1];
      const match = fullUrl.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.webp/);
      if (!match) return;

      // Process the content array to convert emoji URLs to custom emoji components
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link" && el.target === fullUrl) {
            const url = `${match[0]}?size=128`;
            const emoji = getCustomEmojiById(match[1]);

            message.content[i] = {
              type: "customEmoji",
              id: match[1],
              alt: emoji?.name ?? "🔐",
              src: url,
              frozenSrc: url,
              jumboable: false,
            };
            break;
          }
        }
      }
      
      // Add visual indicator for decrypted/encrypted state
      if (Array.isArray(message.content)) {
        // Find the text content after the emoji
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "text" && el.content) {
            if (data.__decrypted) {
              // Add unlocked indicator to decrypted text
              el.content = `🔓 ${el.content}`;
            } else if (data.__encrypted) {
              // Add locked indicator to encrypted text
              el.content = `🔐 ${el.content}`;
            }
            break;
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
      if (!content) return message;

      // Check if message has our hidden emoji pattern
      const emojiMatch = content.match(/\[⠀\]\(<([^>]+)>\)\s+([\w=+\/]+)/);
      if (!emojiMatch) return message;

      const fullUrl = emojiMatch[1];
      const encryptedContent = emojiMatch[2];

      // Extract marker from URL parameters
      const markerMatch = fullUrl.match(EMOJI_REGEX);
      const marker = markerMatch ? decodeURIComponent(markerMatch[1]) : vstorage.marker;

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          // Create unlocked version
          const emojiUrl = `${EMOJI_BASE_URL}?size=128&marker=${encodeURIComponent(marker)}`;
          message.content = `[${INVISIBLE_CHAR}](<${emojiUrl}>) ${decoded}`;
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
          if (message?.content?.match(/\[⠀\]\(<[^>]+>\)\s+[\w=+\/]+/)) {
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