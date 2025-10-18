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
// Regex to match the full markdown link format: [Obfuscation](<url_with_marker>)
const MD_LINK_REGEX = /\[Obfuscation\]\(<https:\/\/cdn\.discordapp\.com\/emojis\/1413171773284810883\.webp\?size=48&quality=lossless&name=blowjob4(&marker=[^>&\s]+)>\)/;

// Helper functions
function createMarkdownWrappedEmoji(marker) {
  return `[Obfuscation](<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>)`;
}

function extractMarkerFromMdLink(mdLink) {
  const match = mdLink.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationEmoji(content) {
  return typeof content === "string" && content.includes("[Obfuscation](<") && content.includes(BASE_EMOJI_URL);
}

function extractEncryptedBody(content, mdLink) {
  if (!content || !mdLink) return "";
  
  const linkIndex = content.indexOf(mdLink);
  if (linkIndex === -1) return "";
  
  // Get everything after the markdown link and trim whitespace
  const afterLink = content.slice(linkIndex + mdLink.length).trim();
  
  // The encrypted content should be base64, so we look for base64-like patterns
  // Base64 typically doesn't have spaces in the middle of the encoded string
  // Split by space and take the first part that looks like base64
  const possibleBase64 = afterLink.split(/\s+/)[0];
  
  // Basic base64 validation - should only contain A-Za-z0-9+/= and have correct length
  if (/^[A-Za-z0-9+/]*={0,2}$/.test(possibleBase64) && possibleBase64.length % 4 === 0) {
    return possibleBase64;
  }
  
  // If it doesn't look like valid base64, return the raw content (might be a false positive)
  return afterLink;
}

export function applyPatches() {
  const patches = [];

  // Outgoing messages - wrap emoji URL in markdown link
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;
      if (!content || hasObfuscationEmoji(content) || !vstorage.secret) return;

      try {
        const scrambled = scramble(content, vstorage.secret);
        const mdWrappedEmoji = createMarkdownWrappedEmoji(vstorage.marker);
        msg.content = `${mdWrappedEmoji} ${scrambled}`;
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

      if (!hasObfuscationEmoji(content)) return;

      // Extract the full markdown link
      const mdLinkMatch = content.match(MD_LINK_REGEX);
      const mdLink = mdLinkMatch ? mdLinkMatch[0] : null;
      const marker = mdLink ? extractMarkerFromMdLink(mdLink) : null;

      if (!marker || !mdLink) return;

      // Extract the encrypted body with validation
      const encryptedBody = extractEncryptedBody(content, mdLink);

      // If we have the secret and encrypted body looks valid, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          console.log("[ObfuscationPlugin] Attempting to decrypt:", encryptedBody.substring(0, 50) + "...");
          const decoded = unscramble(encryptedBody, vstorage.secret);
          console.log("[ObfuscationPlugin] Successfully decrypted:", decoded);
          
          // Keep the markdown link for non-plugin users, but we'll process it for emoji rendering
          message.content = `${mdLink} ${decoded}`;
          content = message.content;
          data.__decrypted = true;
        } catch (e) {
          console.error("[ObfuscationPlugin] Failed to decrypt message:", e);
          console.error("[ObfuscationPlugin] Encrypted body was:", encryptedBody);
          data.__encrypted = true;
        }
      } else {
        console.log("[ObfuscationPlugin] No secret or invalid encrypted body");
        data.__encrypted = true;
      }

      // Process for emoji rendering - replace markdown link with raw URL
      if (content && mdLink) {
        // Extract the actual URL from the markdown link
        const urlMatch = mdLink.match(/<([^>]+)>/);
        const actualUrl = urlMatch ? urlMatch[1] : BASE_EMOJI_URL;
        
        // Replace the markdown link with the raw URL for emoji processing
        message.content = content.replace(mdLink, ` ${actualUrl} `);
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
              alt: emoji?.name ?? "🔒",
              src: url,
              frozenSrc: url.replace("webp", "png"),
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

      // Extract the full markdown link
      const mdLinkMatch = content.match(MD_LINK_REGEX);
      const mdLink = mdLinkMatch ? mdLinkMatch[0] : null;
      const marker = mdLink ? extractMarkerFromMdLink(mdLink) : null;

      if (!marker || !mdLink) return message;

      const encryptedBody = extractEncryptedBody(content, mdLink);

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `${mdLink} ${decoded}`;
        } catch (e) {
          console.error("[ObfuscationPlugin] Failed to decrypt in getMessage:", e);
        }
      }

      return message;
    })
  );

  // Process existing messages by forcing a re-render - ALWAYS process
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    const channels = MessageStore.getMutableMessages?.() ?? {};

    Object.entries(channels).forEach(([channelId, channelMessages]) => {
      if (channelMessages && typeof channelMessages === "object") {
        Object.values(channelMessages).forEach((message) => {
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

  setTimeout(reprocessExistingMessages, 1000);

  return () => patches.forEach((unpatch) => unpatch());
}