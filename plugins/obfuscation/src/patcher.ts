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
const EMOJI_REGEX = /https:\/\/cdn.discordapp.com\/emojis\/(\d+)\.\w+/;
const MESSAGE_REGEX = /^\[⠀\]\(<https:\/\/cdn\.discordapp\.com\/emojis\/1413171773284810883\.webp\?.*?&marker=([^&>]+)>\)\s+(.+)$/;

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add visual indicator for everyone
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || content.match(MESSAGE_REGEX) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Create the formatted message with marker in URL
        const emojiUrl = `${EMOJI_BASE_URL}?size=48&quality=lossless&name=blowjob4&marker=${encodeURIComponent(vstorage.marker)}`;
        msg.content = `[⠀](<${emojiUrl}>) ${scrambled}`;
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
      const content = message?.content;

      // Check if message matches our format and extract marker + content
      const match = content?.match(MESSAGE_REGEX);
      if (!match) return;

      const [, marker, encryptedContent] = match;
      const messageId = `${message.channel_id}-${message.id}`;
      
      // Store the marker for this message
      data.obfuscationMarker = marker;

      // If we have the secret, try to decrypt and show unlocked version
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          // Successfully decoded with our key - replace with decrypted content
          // We'll keep the same format but show it as decrypted
          const emojiUrl = `${EMOJI_BASE_URL}?size=48&quality=lossless&name=blowjob4&marker=${encodeURIComponent(marker)}`;
          message.content = `[⠀](<${emojiUrl}>) ${decoded}`;
          data.__realmoji = true;
          data.__decrypted = true;
        } catch {
          // Failed to decrypt with our key, mark for emoji rendering but keep encrypted
          data.__realmoji = true;
          data.__encrypted = true;
        }
      } else {
        // No secret available, just mark for emoji rendering
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
      const urlMatch = message.content.match(/<([^>]+)>/);
      if (!urlMatch) return;

      const emojiUrl = urlMatch[1];
      const emojiIdMatch = emojiUrl.match(EMOJI_REGEX);
      if (!emojiIdMatch) return;

      // Process the content to convert emoji URL to custom emoji component
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link" && el.target === emojiUrl) {
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
            
            // Add a visual indicator (lock/unlock emoji) after the custom emoji
            if (data.__decrypted) {
              // Add unlocked lock emoji
              message.content.splice(i + 1, 0, {
                type: "text",
                content: " 🔓 "
              });
            } else if (data.__encrypted) {
              // Add locked lock emoji  
              message.content.splice(i + 1, 0, {
                type: "text",
                content: " 🔐 "
              });
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
      const match = content?.match(MESSAGE_REGEX);
      if (!match) return message;

      const [, marker, encryptedContent] = match;

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          const emojiUrl = `${EMOJI_BASE_URL}?size=48&quality=lossless&name=blowjob4&marker=${encodeURIComponent(marker)}`;
          message.content = `[⠀](<${emojiUrl}>) ${decoded}`;
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
          if (message?.content?.match(MESSAGE_REGEX)) {
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