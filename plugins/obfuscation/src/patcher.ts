import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Safely get EmojiStore (optional)
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Invisible marker sequence (not shown on non-plugin clients)
const INVISIBLE_MARKER = "\u200b\u200d\u200b"; // zero-width space + joiner + space

// Helper functions
function hasObfuscationMarker(content: string): boolean {
  return content?.includes(INVISIBLE_MARKER);
}

export function applyPatches() {
  const patches = [];

  // PATCH 1: Outgoing messages
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;

        if (!vstorage.enabled) return;
        if (!content || !vstorage.secret) return;
        if (hasObfuscationMarker(content)) return;

        console.log("[ObfuscationPlugin] Sending message:", content);

        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

        // Non-plugin clients will not see the INVISIBLE_MARKER at all.
        // Plugin users detect it and render the emoji indicator locally.
        msg.content = `${INVISIBLE_MARKER}${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 2: Incoming message decoding (for plugin users)
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.content) return;

        const content = message.content;
        if (!hasObfuscationMarker(content)) return;

        const encryptedBody = content.replace(INVISIBLE_MARKER, "").trim();
        if (!vstorage.secret || !encryptedBody) return;

        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Decoded:", decoded);

        // Insert the emoji locally before the message for plugin users
        const INDICATOR_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
        const wrappedEmojiUrl = `<${INDICATOR_EMOJI_URL}>`;

        data.message.content = `${wrappedEmojiUrl}${decoded}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 3: Emoji rendering (for plugin users)
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
  }

  // PATCH 4: Reprocess already existing messages
  const reprocessExistingMessages = () => {
    try {
      console.log("[ObfuscationPlugin] Reprocessing messages...");

      setTimeout(() => {
        try {
          const channels = MessageStore.getMutableMessages?.() ?? {};

          Object.entries(channels).forEach(([channelId, messages]: [string, any]) => {
            if (!messages) return;

            Object.values(messages).forEach((msg: any) => {
              if (msg && hasObfuscationMarker(msg.content)) {
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