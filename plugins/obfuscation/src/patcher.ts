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
// This regex finds the inner <...&marker=...> (angle brackets included). It captures the full <...>
const EMOJI_REGEX = /<https:\/\/cdn\.discordapp\.com\/emojis\/1413171773284810883\.webp\?size=48&quality=lossless&name=blowjob4(&marker=[^>&\s]+)>/;

// --- Helper functions to work with marker URLs and markdown-wrapped link handling ---
function createEmojiUrlWithMarker(marker) {
  return `<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>`;
}

// Create a markdown-wrapped emoji link like: [Obfuscation](<https://...&marker=...>)
function createMarkdownWrappedEmoji(marker) {
  const emojiWithAngle = createEmojiUrlWithMarker(marker); // already in <...>
  return `[Obfuscation](${emojiWithAngle})`;
}

function extractMarkerFromUrl(url) {
  const match = url.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function hasObfuscationEmoji(content) {
  return typeof content === "string" && content.includes(BASE_EMOJI_URL);
}

// Given the raw content string and the inner wrappedEmojiUrl (the <...>), return the text after the markdown link
function extractEncryptedAfterMdLink(content, wrappedUrl) {
  if (typeof content !== "string") return "";

  // Find the first occurrence of wrappedUrl
  const urlStart = content.indexOf(wrappedUrl);
  if (urlStart === -1) {
    // fallback: nothing found — return trimmed remainder (shouldn't normally happen)
    return content.trim();
  }

  // If the wrappedUrl is directly present (not wrapped in md), handle that too:
  // e.g. "<url> ciphertext"
  const possibleCloseAngle = content.indexOf(">", urlStart);
  if (possibleCloseAngle !== -1) {
    // check if there's a ')' right after the '>' indicating it's inside a markdown link
    const afterAngleChar = content.charAt(possibleCloseAngle + 1);
    if (afterAngleChar === ")") {
      // This would be strange (link without [text]) but handle fallback
      return content.slice(possibleCloseAngle + 1).trim();
    }
  }

  // Look backwards to find the opening '(' for the markdown link that contains this wrappedUrl
  // A markdown link looks like: [text](<wrappedUrl>)
  // Search for the nearest '(' that precedes the wrappedUrl
  let parenOpen = content.lastIndexOf("(", urlStart);
  // Also find the closing ')' that follows the wrappedUrl
  let parenClose = content.indexOf(")", urlStart + wrappedUrl.length);

  // If we didn't find an opening '(' before the URL, maybe it's not wrapped in markdown; just return after the url.
  if (parenOpen === -1 || parenClose === -1) {
    // fallback: return everything after the wrappedUrl
    const after = content.slice(urlStart + wrappedUrl.length).trim();
    return after;
  }

  // Otherwise, return everything after the closing ')'
  return content.slice(parenClose + 1).trim();
}

// Replace the full markdown link that contains the wrappedUrl with replacement string
function replaceMdLinkContainingWrappedUrl(content, wrappedUrl, replacement) {
  if (typeof content !== "string") return content;
  // Escape wrappedUrl for regex
  const escaped = wrappedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match [any text](<wrappedUrl>) or [any text](wrappedUrl) (be permissive)
  const mdRegex = new RegExp(`\\[[^\\]]*\\]\\(<?${escaped.replace(/\\<|\\>/g, "")}>?\\)`);
  if (mdRegex.test(content)) {
    return content.replace(mdRegex, replacement);
  }
  // If regex fails, fallback to simple replace of the raw wrappedUrl
  return content.replace(wrappedUrl, replacement);
}

// --- applyPatches: installs all patches and returns an unpatch function ---
export function applyPatches() {
  const patches = [];

  // Outgoing messages - wrap emoji URL in markdown link so non-plugin users see [Obfuscation] instead of raw URL
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
        // Use a Markdown-wrapped link so people without the plugin see friendly text instead of the raw URL
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

      // Check if message has our emoji indicator
      if (!hasObfuscationEmoji(content)) return;

      const messageId = `${message.channel_id}-${message.id}`;

      // Extract the inner <...> wrapped URL (we search for the inner pattern)
      const markerMatch = content.match(EMOJI_REGEX);
      const wrappedEmojiUrl = markerMatch ? markerMatch[0] : null;
      const marker = wrappedEmojiUrl ? extractMarkerFromUrl(wrappedEmojiUrl) : null;

      if (!marker || !wrappedEmojiUrl) return;

      // Extract the encrypted body (robustly handle markdown-wrapped link)
      const encryptedBody = extractEncryptedAfterMdLink(content, wrappedEmojiUrl);

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Rebuild the content preserving the markdown-wrapped emoji link (so non-plugin view remains nice)
          const mdWrappedEmoji = createMarkdownWrappedEmoji(marker);
          message.content = `${mdWrappedEmoji} ${decoded}`;
          content = message.content; // update local copy
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt with our key, leave as encrypted
          data.__encrypted = true;
        }
      } else {
        data.__encrypted = true;
      }

      // Process the wrapped emoji link to render as actual emoji by replacing the entire markdown link with the plain URL
      if (content && hasObfuscationEmoji(content)) {
        const actualUrl = wrappedEmojiUrl.slice(1, -1); // remove < and >
        // Replace the markdown link (e.g. [Obfuscation](<...>)) with the plain URL surrounded by spaces
        const processedContent = replaceMdLinkContainingWrappedUrl(content, wrappedEmojiUrl, ` ${actualUrl} `);
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
      if (!hasObfuscationEmoji(content)) return message;

      // Extract marker and encrypted body from wrapped URL
      const markerMatch = content.match(EMOJI_REGEX);
      const wrappedEmojiUrl = markerMatch ? markerMatch[0] : null;
      const marker = wrappedEmojiUrl ? extractMarkerFromUrl(wrappedEmojiUrl) : null;

      if (!marker || !wrappedEmojiUrl) return message;

      const encryptedBody = extractEncryptedAfterMdLink(content, wrappedEmojiUrl);

      // If we have the secret, try to decrypt
      if (vstorage.secret && encryptedBody) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          const mdWrappedEmoji = createMarkdownWrappedEmoji(marker);
          message.content = `${mdWrappedEmoji} ${decoded}`;
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

  // small delay to allow things to settle before reprocessing
  setTimeout(reprocessExistingMessages, 500);

  // Return unpatch function
  return () => patches.forEach((unpatch) => unpatch());
}
