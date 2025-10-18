import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const { getCustomEmojiById } = findByStoreName("EmojiStore");

// Base emoji URL
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
const EMOJI_REGEX = /<https:\/\/cdn\.discordapp\.com\/emojis\/1429170621891477615\.webp\?size=48&quality=lossless(&marker=[^>&\s]+)>/;

// Helper functions
function createEmojiUrlWithMarker(marker: string): string {
  return `<${BASE_EMOJI_URL}&marker=${encodeURIComponent(marker)}>`;
}

function hasObfuscationEmoji(content: string): boolean {
  return content?.includes(BASE_EMOJI_URL);
}

function extractMarkerFromUrl(url: string): string | null {
  const match = url.match(/&marker=([^>&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying EMOJI RENDERING patches...");

  // Outgoing messages - same as before
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;
      if (!content || !vstorage.secret) return;
      if (hasObfuscationEmoji(content)) return;

      console.log("[ObfuscationPlugin] Sending message:", content);

      try {
        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);
        
        msg.content = `${createEmojiUrlWithMarker(vstorage.marker)} ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble:", e);
      }
    })
  );

  // Process incoming messages with complex regex
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1) return;
      if (!data.message?.content) return;

      const content = data.message.content;
      if (!hasObfuscationEmoji(content)) return;

      console.log("[ObfuscationPlugin] Processing with complex regex:", content);

      // EXACT extraction logic from original code
      const markerMatch = content.match(EMOJI_REGEX);
      const marker = markerMatch ? extractMarkerFromUrl(markerMatch[0]) : null;

      if (!marker) return;

      const wrappedEmojiUrl = markerMatch[0];
      const encryptedBody = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length).trim();

      if (!vstorage.secret || !encryptedBody) {
        console.log("[ObfuscationPlugin] No secret or encrypted body");
        return;
      }

      try {
        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Successfully decoded:", decoded);
        
        // Use the same wrapped emoji URL but now the content is decrypted
        data.message.content = `${wrappedEmojiUrl} ${decoded}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to decode:", e);
      }
    })
  );

  // ADD BACK: Patch to render the emoji URL as a custom emoji component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1) return;

      const message = row?.message;
      if (!message || !message.content) return;

      console.log("[ObfuscationPlugin] Rendering emoji for message:", message.content);

      // Process the content array to convert emoji URLs to custom emoji components
      if (Array.isArray(message.content)) {
        for (let i = 0; i < message.content.length; i++) {
          const el = message.content[i];
          if (el.type === "link") {
            // Match our specific emoji URL
            const match = el.target.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.\w+/);
            if (!match) continue;

            const url = `${match[0]}?size=128`;
            const emoji = getCustomEmojiById(match[1]);

            console.log("[ObfuscationPlugin] Converting link to emoji:", el.target);

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

  // Process existing messages
  const reprocessExistingMessages = () => {
    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    setTimeout(() => {
      const channels = MessageStore.getMutableMessages?.() ?? {};

      Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
        if (channelMessages && typeof channelMessages === 'object') {
          Object.values(channelMessages).forEach((message: any) => {
            if (hasObfuscationEmoji(message?.content)) {
              FluxDispatcher.dispatch({
                type: "MESSAGE_UPDATE",
                message: { ...message },
              });
            }
          });
        }
      });
    }, 1000);
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}