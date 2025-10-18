import { findByProps, findByStoreName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");

export function applyPatches() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying MINIMAL patches...");

  // ONLY patch sendMessage to scramble outgoing messages
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (!vstorage.enabled) return;
      if (!content || !vstorage.secret) return;

      console.log("[ObfuscationPlugin] Sending message:", content);

      try {
        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);
        
        // Simply replace content with scrambled version
        msg.content = scrambled;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble:", e);
      }
    })
  );

  // ONLY patch getMessage to unscramble incoming messages
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message || !message.content) return message;

      const content = message.content;
      
      // Only try to unscramble if it looks like hex and we have secret
      if (!/^[0-9a-f]+$/.test(content) || !vstorage.secret) {
        return message;
      }

      console.log("[ObfuscationPlugin] Receiving scrambled message:", content);

      try {
        const decoded = unscramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Decoded to:", decoded);
        message.content = decoded;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to unscramble:", e);
        // Leave as-is if decryption fails
      }

      return message;
    })
  );

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
  };
}