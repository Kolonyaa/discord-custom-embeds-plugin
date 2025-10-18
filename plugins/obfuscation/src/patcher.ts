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

// Regex that matches the friendly link we create: [Obfuscation](<...>)
// Capture group 1 -> the inner URL (inside < >)
const EMOJI_LINK_REGEX = /\[obf\]\(<([^>\s]+)>\)/;

// Helper functions to work with marker URLs
function createEmojiLinkWithMarker(marker) {
  // returns the friendly link, not raw angle-bracket URL
  const url = `${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}`;
  return `[Obfuscation](<${url}>)`;
}

function extractMarkerFromUrl(url) {
  const match = url.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationIndicator(content) {
  // message.content can be string or array etc; do a quick string check too
  if (!content) return false;
  if (typeof content === "string") {
    return content.includes("[Obfuscation](") || content.includes(BASE_EMOJI_URL);
  }
  // If content is array (parsed message), check for link entries that contain our base URL
  if (Array.isArray(content)) {
    return content.some(el => (el?.type === "link" && el.target?.includes(BASE_EMOJI_URL)) || (typeof el === "string" && el.includes("[Obfuscation](")));
  }
  return false;
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

      if (!content || hasObfuscationIndicator(content) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        // Use friendly [Obfuscation](<url&marker=...>) link before the encrypted content
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

      // Check if message has our obfuscation indicator
      if (!hasObfuscationIndicator(content)) return;

      const messageId = `${message.channel_id}-${message.id}`;

      // Normalize to string to find the link if needed
      const textContent = typeof content === "string" ? content : (Array.isArray(content) ? content.map(c => (typeof c === "string" ? c : (c?.text ?? ""))).join("") : "");

      // Find the friendly link: [Obfuscation](<...>)
      const linkMatch = textContent.match(EMOJI_LINK_REGEX);
      if (!linkMatch) return;

      const innerUrl = linkMatch[1]; // url inside <...>
      const marker = extractMarkerFromUrl(innerUrl);

      if (!marker) return;

      // Extract the encrypted body (everything after the friendly link)
      // Find the index in the original content string (we already built textContent)
      const wrappedLinkRaw = linkMatch[0]; // the full "[Obfuscation](<...>)"
      const encryptedBody = textContent.slice(textContent.indexOf(wrappedLinkRaw) + wrappedLinkRaw.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Successfully decoded - replace content with decrypted version
          // Keep the friendly link but now show decrypted text after it
          message.content = `${wrappedLinkRaw} ${decoded}`;
          content = message.content; // Update local content variable
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Process the friendly link to render as actual emoji for plugin users:
      // Replace the friendly link "[Obfuscation](<URL>)" with the actual inner URL (so existing emoji rendering can pick it up)
      if (content && hasObfuscationIndicator(content)) {
        const actualUrl = innerUrl; // already without < >
        // Replace the friendly markdown link with the actual angle-bracketed URL for emoji rendering
        // Note: we keep a space around it to avoid gluing words
        const processedContent = content.replace(wrappedLinkRaw, ` ${actualUrl} `);
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
      if (!hasObfuscationIndicator(content)) return message;

      // Normalize to string to find the friendly link if needed
      const textContent = typeof content === "string" ? content : (Array.isArray(content) ? content.map(c => (typeof c === "string" ? c : (c?.text ?? ""))).join("") : "");

      const linkMatch = textContent.match(EMOJI_LINK_REGEX);
      if (!linkMatch) return message;

      const innerUrl = linkMatch[1];
      const marker = extractMarkerFromUrl(innerUrl);

      if (!marker) return message;

      const wrappedLinkRaw = linkMatch[0];
      const encryptedBody = textContent.slice(textContent.indexOf(wrappedLinkRaw) + wrappedLinkRaw.length).trim();

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Keep the friendly link but now show decrypted text after it
          message.content = `${wrappedLinkRaw} ${decoded}`;
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
          if (hasObfuscationIndicator(message?.content)) {
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