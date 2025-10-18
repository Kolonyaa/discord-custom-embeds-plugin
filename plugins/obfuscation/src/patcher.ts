import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Safely get EmojiStore
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Base emoji URL
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";

// This regex is used to detect plugin messages
const EMOJI_REGEX = /<https:\/\/cdn\.discordapp\.com\/emojis\/1429170621891477615\.webp\?size=48&quality=lossless>/;

// Helper functions
function createEmojiUrl(): string {
  // Wrapped in < > so that plugin can detect it but Discord’s native client doesn’t render as link
  return `<${BASE_EMOJI_URL}>`;
}

function hasObfuscationEmoji(content: string): boolean {
  return content?.includes(BASE_EMOJI_URL);
}

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying modified patches...");

  // PATCH 1: Outgoing messages
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;

        if (!vstorage.enabled) return;
        if (!content || !vstorage.secret) return;
        if (hasObfuscationEmoji(content)) return;

        console.log("[ObfuscationPlugin] Sending message:", content);

        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

        // Invisible zero-width marker (U+200B) before emoji so plugin can detect but non-plugin users won't see
        const INVISIBLE_MARKER = "\u200B"; // zero-width space

        // For plugin users, the emoji will still render (since they look for the marker)
        // For non-plugin users, the <url> gets stripped by Discord automatically since it's not visible text
        msg.content = `${INVISIBLE_MARKER}${createEmojiUrl()} ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 2: Incoming message decoding
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.content) return;

        const content = message.content;
        if (!hasObfuscationEmoji(content)) return;

        const emojiMatch = content.match(EMOJI_REGEX);
        if (!emojiMatch) return;

        const wrappedEmojiUrl = emojiMatch[0];
        const encryptedBody = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length).trim();

        if (!vstorage.secret || !encryptedBody) return;

        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Decoded:", decoded);

        // Replace message content with emoji + readable text
        data.message.content = `${wrappedEmojiUrl} ${decoded}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 3: Emoji rendering (unchanged except with marker-safe handling)
  if (getCustomEmojiById) {
    patches.push(
      after("generate", RowManager.prototype, ([data], row) => {
        try {
          if (data.rowType !== 1) return;
          const message = row?.message;
          if (!message || !message.content) return;

          if (Array.isArray(message.content)) {
            for (let i = 0; i < message.content.length; i++) {
              const el = message.content[i];
              if (el && el.type === "link" && el.target) {
                const match = el.target.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.\w+/);
                if (!match) continue;

                const url = `${match[0]}?size=128`;

                let emojiName = "<indicator>";
                try {
                  const emoji = getCustomEmojiById(match[1]);
                  if (emoji && emoji.name) emojiName = emoji.name;
                } catch (e) {
                  console.warn("[ObfuscationPlugin] Failed to get emoji info:", e);
                }

                message.content[i] = {
                  type: "customEmoji",
                  id: match[1],
                  alt: emojiName,
                  src: url,
                  frozenSrc: url.replace("gif", "webp"),
                  jumboable: false,
                };
              }
            }
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] Emoji rendering error:", e);
        }
      })
    );
  } else {
    console.warn("[ObfuscationPlugin] Skipping emoji rendering patch - getCustomEmojiById not available");
  }

  // PATCH 4: Reprocess old messages (so already-sent ones get decoded)
  const reprocessExistingMessages = () => {
    try {
      console.log("[ObfuscationPlugin] Reprocessing messages...");

      setTimeout(() => {
        try {
          const channels = MessageStore.getMutableMessages?.() ?? {};

          Object.entries(channels).forEach(([channelId, messages]: [string, any]) => {
            if (!messages) return;

            Object.values(messages).forEach((msg: any) => {
              if (msg && hasObfuscationEmoji(msg.content)) {
                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: { ...msg },
                });
              }
            });
          });
        } catch (e) {
          console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
        }
      }, 1000);
    } catch (e) {
      console.error("[ObfuscationPlugin] Reprocess failed:", e);
    }
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}
