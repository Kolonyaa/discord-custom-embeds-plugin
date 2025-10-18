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
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1413171773284810883.webp?size=48&quality=lossless&name=blowjob4";
const EMOJI_REGEX = /\[Obfuscation\]\(<https:\/\/cdn\.discordapp\.com\/emojis\/1413171773284810883\.webp\?size=48&quality=lossless&name=blowjob4(&marker=[^>&\s]+)>\)/;

// Helper functions to work with marker URLs
function createEmojiUrlWithMarker(marker) {
  return `[Obfuscation](<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>)`;
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
        // Add markdown link with emoji URL before the encrypted content
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

      const messageId = `${message.channel_id}-${message.id}`;
      
      // Extract marker from the markdown link
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;
      
      if (!marker) return;

      // Extract the encrypted body (everything after the markdown link)
      const markdownLink = markerMatch[0];
      const encryptedBody = content.slice(content.indexOf(markdownLink) + markdownLink.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded - we'll keep the markdown link but process it for emoji rendering
          message.content = `${markdownLink} ${decoded}`;
          content = message.content;
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Mark this message for emoji processing
      data.__realmoji = true;
    })
  );

  // Additional patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || data.__realmoji !== true) return;
      
      const message = row?.message;
      if (!message || !message.content) return;

      // Process the content to convert markdown link to custom emoji
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          
          // Look for text nodes that contain our markdown link
          if (el.type === "text" && el.content?.includes("[Obfuscation](")) {
            const markdownMatch = el.content.match(EMOJI_REGEX);
            if (markdownMatch) {
              const markdownLink = markdownMatch[0];
              const urlMatch = markdownLink.match(/<([^>]+)>/);
              const actualUrl = urlMatch ? urlMatch[1] : BASE_EMOJI_URL;
              
              // Extract emoji ID from URL
              const emojiMatch = actualUrl.match(/\/emojis\/(\d+)\.webp/);
              if (!emojiMatch) continue;
              
              const emojiId = emojiMatch[1];
              const emoji = getCustomEmojiById(emojiId);
              const displayUrl = `${actualUrl.split('?')[0]}?size=128`;
              
              // Split the text around the markdown link
              const parts = el.content.split(markdownLink);
              
              // Create new content array with emoji component
              const newContent = [];
              
              // Add text before the markdown link
              if (parts[0]) {
                newContent.push({
                  type: "text",
                  content: parts[0]
                });
              }
              
              // Add the emoji component
              newContent.push({
                type: "customEmoji",
                id: emojiId,
                alt: emoji?.name ?? "🔒",
                src: displayUrl,
                frozenSrc: displayUrl.replace("webp", "png"),
                jumboable: false,
              });
              
              // Add text after the markdown link
              if (parts[1]) {
                newContent.push({
                  type: "text", 
                  content: parts[1]
                });
              }
              
              // Replace the single text element with our new array
              message.content.splice(i, 1, ...newContent);
              break; // We found and processed our markdown link
            }
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

      // Extract marker and encrypted body from markdown link
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;
      
      if (!marker) return message;

      const markdownLink = markerMatch[0];
      const encryptedBody = content.slice(content.indexOf(markdownLink) + markdownLink.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `${markdownLink} ${decoded}`;
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