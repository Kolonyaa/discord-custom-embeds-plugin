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
const INVISIBLE_CHAR = "⠀"; // Braille pattern blank

// Function to build the hidden indicator URL
function buildIndicatorUrl(marker: string, isEncrypted: boolean = true): string {
  const status = isEncrypted ? "encrypted" : "decrypted";
  return `${EMOJI_BASE_URL}?size=48&quality=lossless&name=blowjob4&marker=${marker}&status=${status}`;
}

// Function to parse marker from URL
function parseMarkerFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.searchParams.get("marker");
  } catch {
    return null;
  }
}

// Function to check if URL is our indicator
function isIndicatorUrl(url: string): boolean {
  const marker = parseMarkerFromUrl(url);
  return marker !== null && url.includes(EMOJI_BASE_URL);
}

export function applyPatches() {
  const patches = [];

  // Outgoing messages - add hidden visual indicator
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || content.includes(buildIndicatorUrl(vstorage.marker)) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        const indicatorUrl = buildIndicatorUrl(vstorage.marker, true);
        // Format: [invisible_char](<url>) encrypted_content
        msg.content = `[${INVISIBLE_CHAR}](<${indicatorUrl}>) ${scrambled}`;
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

      // Check if message has our hidden indicator pattern
      const indicatorMatch = content?.match(/\[⠀\]\(<([^>]+)>\)\s+([\w=+/]+)/);
      if (!indicatorMatch) return;

      const [fullMatch, indicatorUrl, encryptedContent] = indicatorMatch;
      const marker = parseMarkerFromUrl(indicatorUrl);
      
      // Only process if it's our marker
      if (!marker || marker !== vstorage.marker) return;

      const messageId = `${message.channel_id}-${message.id}`;
      
      // If we have the secret, try to decrypt
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          // Successfully decoded - replace with decrypted version
          const decryptedIndicatorUrl = buildIndicatorUrl(vstorage.marker, false);
          message.content = `[${INVISIBLE_CHAR}](<${decryptedIndicatorUrl}>) ${decoded}`;
          content = message.content; // Update local content variable
          data.__realmoji = true;
          data.__decrypted = true;
        } catch (e) {
          // Failed to decrypt, mark for emoji rendering but keep encrypted
          data.__realmoji = true;
          data.__decrypted = false;
        }
      } else {
        // No secret, just mark for emoji rendering
        data.__realmoji = true;
        data.__decrypted = false;
      }
    })
  );

  // Additional patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || data.__realmoji !== true) return;
      
      const message = row?.message;
      if (!message || !message.content) return;

      // Extract the indicator URL from the content
      const indicatorMatch = message.content.match(/\[⠀\]\(<([^>]+)>\)/);
      if (!indicatorMatch) return;

      const indicatorUrl = indicatorMatch[1];
      const marker = parseMarkerFromUrl(indicatorUrl);
      const isEncrypted = !data.__decrypted;

      // Process the content to convert the markdown link to a custom emoji
      if (typeof message.content === "string") {
        const emojiMatch = indicatorUrl.match(EMOJI_REGEX);
        if (emojiMatch) {
          const url = `${emojiMatch[0]}?size=128`;
          const emoji = getCustomEmojiById(emojiMatch[1]);

          // Create the custom emoji component
          const emojiComponent = {
            type: "customEmoji",
            id: emojiMatch[1],
            alt: isEncrypted ? "🔐" : "🔓",
            src: url,
            frozenSrc: url.replace("gif", "webp"),
            jumboable: false,
          };

          // Replace the markdown link with the emoji component and the rest of the content
          const contentAfterIndicator = message.content.slice(indicatorMatch[0].length).trim();
          
          if (isEncrypted) {
            // Encrypted message: show just the emoji + encrypted content
            message.content = [emojiComponent, { type: "text", content: ` ${contentAfterIndicator}` }];
          } else {
            // Decrypted message: show emoji + decrypted content
            message.content = [emojiComponent, { type: "text", content: ` ${contentAfterIndicator}` }];
          }
        }
      } else if (Array.isArray(message.content)) {
        // If content is already an array, find and replace the link component
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
              alt: isEncrypted ? "🔐" : "🔓",
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
      const indicatorMatch = content?.match(/\[⠀\]\(<([^>]+)>\)\s+([\w=+/]+)/);
      if (!indicatorMatch) return message;

      const [fullMatch, indicatorUrl, encryptedContent] = indicatorMatch;
      const marker = parseMarkerFromUrl(indicatorUrl);
      
      if (!marker || marker !== vstorage.marker) return message;

      // If we have the secret, try to decrypt
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedContent, vstorage.secret);
          const decryptedIndicatorUrl = buildIndicatorUrl(vstorage.marker, false);
          message.content = `[${INVISIBLE_CHAR}](<${decryptedIndicatorUrl}>) ${decoded}`;
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
          const indicatorMatch = message?.content?.match(/\[⠀\]\(<([^>]+)>\)\s+([\w=+/]+)/);
          if (indicatorMatch) {
            const marker = parseMarkerFromUrl(indicatorMatch[1]);
            if (marker === vstorage.marker) {
              FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                message: message,
                log_edit: false,
              });
            }
          }
        });
      }
    });
  };

  setTimeout(reprocessExistingMessages, 500);

  return () => patches.forEach(unpatch => unpatch());
}