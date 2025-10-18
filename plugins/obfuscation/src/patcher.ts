import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

export function applyPatches() {
  const patches: (() => void)[] = [];

  // Outgoing messages - scramble if enabled
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return; // only scramble if enabled
      if (!content || content.startsWith(`[🔐${vstorage.marker}]`) || content.startsWith(`[🔓${vstorage.marker}]`) || !vstorage.secret) return;

      try {
        const scrambled = scramble(content, vstorage.secret);
        msg.content = `[🔐${vstorage.marker}] ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Patch RowManager for rendering decrypted messages
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      if (data.rowType !== 1 || !vstorage.enabled) return;
      const message = data.message;
      const content = message?.content;

      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // leave as locked
        }
      }
    })
  );

  // Patch getMessage for decrypted view
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message || !vstorage.enabled) return message;
      const content = message.content;
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return message;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // leave as locked
        }
      }

      return message;
    })
  );

  // Helper to reprocess all existing messages
  const reprocessExistingMessages = () => {
    const channels = MessageStore.getMutableMessages?.() ?? {};

    Object.entries(channels).forEach(([channelId, channelMessages]: [string, any]) => {
      if (!channelMessages || typeof channelMessages !== "object") return;

      Object.values(channelMessages).forEach((message: any) => {
        const shouldProcess = vstorage.enabled
          ? message?.content?.startsWith(`[🔐${vstorage.marker}]`)
          : message?.content?.startsWith(`[🔓${vstorage.marker}]`);

        if (shouldProcess) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message: message,
            log_edit: false,
          });
        }
      });
    });
  };

  // Initial reprocess (on plugin load)
  setTimeout(reprocessExistingMessages, 500);

  return {
    unpatchAll: () => patches.forEach(unpatch => unpatch()),
    reprocessExistingMessages,
  };
}