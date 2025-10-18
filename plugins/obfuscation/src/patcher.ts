import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Safely get EmojiStore - it might not exist in some contexts
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch (e) {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Base emoji URL - simplified without marker
const BASE_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
const EMOJI_REGEX = /<https:\/\/cdn\.discordapp\.com\/emojis\/1429170621891477615\.webp\?size=48&quality=lossless>/;

// Helper functions - simplified
function createEmojiUrl(): string {
  return `<${BASE_EMOJI_URL}>`;
}

function hasObfuscationEmoji(content) {
  return content?.startsWith("\u200B");
}

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying simplified patches...");

  // Outgoing messages - simplified
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
        
        // Simplified - just use the emoji URL without marker
        msg.content = `\u200B${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // Process incoming messages - simplified
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        if (!data.message?.content) return;

        const content = data.message.content;
        if (!hasObfuscationEmoji(content)) return;

        console.log("[ObfuscationPlugin] Processing message:", content);

        const emojiMatch = content.match(EMOJI_REGEX);
        if (!emojiMatch) return;

        const wrappedEmojiUrl = emojiMatch[0];
        const encryptedBody = content.slice(content.indexOf(wrappedEmojiUrl) + wrappedEmojiUrl.length).trim();

        if (!vstorage.secret || !encryptedBody) {
          console.log("[ObfuscationPlugin] No secret or encrypted body");
          return;
        }

        const decoded = unscramble(encryptedBody, vstorage.secret);
        console.log("[ObfuscationPlugin] Successfully decoded:", decoded);
        
        data.message.content = `${wrappedEmojiUrl} ${decoded}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in RowManager generate patch:", e);
      }
    })
  );

  // Emoji rendering patch (unchanged)
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
                
                let emojiName = "<external-emoji>";
                try {
                  const emoji = getCustomEmojiById(match[1]);
                  if (emoji && emoji.name) {
                    emojiName = emoji.name;
                  }
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
          console.error("[ObfuscationPlugin] Error in emoji rendering patch:", e);
        }
      })
    );
  } else {
    console.warn("[ObfuscationPlugin] Skipping emoji rendering patch - getCustomEmojiById not available");
  }

  // Process existing messages
  const reprocessExistingMessages = () => {
    try {
      console.log("[ObfuscationPlugin] Reprocessing existing messages...");

      setTimeout(() => {
        try {
          const channels = MessageStore.getMutableMessages?.() ?? {};

          Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
            if (channelMessages && typeof channelMessages === 'object') {
              Object.values(channelMessages).forEach((message: any) => {
                if (message && hasObfuscationEmoji(message.content)) {
                  FluxDispatcher.dispatch({
                    type: "MESSAGE_UPDATE",
                    message: { ...message },
                  });
                }
              });
            }
          });
        } catch (e) {
          console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
        }
      }, 1000);
    } catch (e) {
      console.error("[ObfuscationPlugin] Error in reprocessExistingMessages:", e);
    }
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}