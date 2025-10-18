import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetti/metro/common";
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
function createEmojiLinkWithMarker(marker) {
  return `[Obfuscation](<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>)`;
}

function extractMarkerFromLink(link) {
  const match = link.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationLink(content) {
  return content?.includes("[Obfuscation](<") && content?.includes(BASE_EMOJI_URL);
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

      if (!content || hasObfuscationLink(content) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Add markdown link with emoji URL before the encrypted content
        const emojiLink = createEmojiLinkWithMarker(vstorage.marker);
        msg.content = `${emojiLink} ${scrambled}`;
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

      // Check if message has our obfuscation link
      if (!hasObfuscationLink(content)) return;

      const messageId = `${message.channel_id}-${message.id}`;
      
      // Extract marker from the markdown link
      const linkMatch = content.match(EMOJI_REGEX);
      const marker = linkMatch ? extractMarkerFromLink(linkMatch[0]) : null;
      
      if (!marker) return;

      // Extract the encrypted body (everything after the markdown link)
      const markdownLink = linkMatch[0];
      const encryptedBody = content.slice(content.indexOf(markdownLink) + markdownLink.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded - replace content with decrypted version
          // Extract the actual URL from the markdown link for emoji rendering
          const urlMatch = markdownLink.match(/<([^>]+)>/);
          const actualUrl = urlMatch ? urlMatch[1] : BASE_EMOJI_URL;
          
          // Replace the markdown link with just the URL for emoji rendering
          message.content = `${actualUrl} ${decoded}`;
          content = message.content; // Update local content variable
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Process the emoji URL to render as actual emoji
      if (content && content.includes(BASE_EMOJI_URL)) {
        // Replace the URL with a space-separated version for processing
        const processedContent = content.replace(BASE_EMOJI_URL, ` ${BASE_EMOJI_URL} `);
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

  // Also patch getMessage - ALWAYS process incoming messages
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      if (!hasObfuscationLink(content)) return message;

      // Extract marker and encrypted body from markdown link
      const linkMatch = content.match(EMOJI_REGEX);
      const marker = linkMatch ? extractMarkerFromLink(linkMatch[0]) : null;
      
      if (!marker) return message;

      const markdownLink = linkMatch[0];
      const encryptedBody = content.slice(content.indexOf(markdownLink) + markdownLink.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Extract the actual URL from the markdown link
          const urlMatch = markdownLink.match(/<([^>]+)>/);
          const actualUrl = urlMatch ? urlMatch[1] : BASE_EMOJI_URL;
          message.content = `${actualUrl} ${decoded}`;
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
          if (hasObfuscationLink(message?.content)) {
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