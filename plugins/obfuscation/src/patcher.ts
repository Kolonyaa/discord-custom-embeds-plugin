import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Find the tag component for creating our label
const TagModule = findByProps("getBotLabel");

export function applyPatches() {
  const patches = [];

  // Outgoing messages - only apply if obfuscation is enabled
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      // Only skip if obfuscation is disabled (this controls SENDING only)
      if (!vstorage.enabled) return;

      if (!content || content.startsWith(`[🔐${vstorage.marker}]`) || content.startsWith(`[🔓${vstorage.marker}]`) || !vstorage.secret) {
        return;
      }

      try {
        const scrambled = scramble(content, vstorage.secret);
        msg.content = `[🔐${vstorage.marker}] ${scrambled}`;
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
      const content = message?.content;

      // Check if message has our lock indicator (encrypted message)
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      // If we have the secret, try to decrypt and show unlocked version
      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          // Mark the message as processed and store the decoded content
          message.__obfuscatedProcessed = true;
          message.__originalEncryptedContent = content;
          message.content = decoded;
        } catch {
          // Failed to decrypt with our key, leave as locked version
        }
      }
    })
  );

  // Second patch to RowManager to add the label after message content is processed
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || !data.message?.__obfuscatedProcessed) return;

      const message = data.message;
      
      // Find the message content container in the React tree
      const contentContainer = findMessageContentContainer(row);
      if (!contentContainer || !Array.isArray(contentContainer.props?.children)) return;

      // Create our custom label component
      const labelComponent = React.createElement(TagModule.default, {
        type: 0, // Custom type
        text: `${vstorage.marker.toUpperCase()}`, // Convert marker to uppercase like "ADMIN"
        textColor: "#ffffff", // White text
        backgroundColor: "#5865f2", // Discord blurple
        style: { 
          marginRight: 4,
          marginBottom: 4
        }
      });

      // Insert the label at the beginning of the message content
      contentContainer.props.children.unshift(labelComponent);
      
      // Clean up our temporary properties
      delete message.__obfuscatedProcessed;
    })
  );

  // Also patch getMessage - ALWAYS process incoming messages
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      if (!content?.startsWith(`[🔐${vstorage.marker}]`)) return message;

      const encryptedBody = content.slice(`[🔐${vstorage.marker}] `.length);

      if (vstorage.secret) {
        try {
          const decoded = unscramble(encryptedBody, vstorage.secret);
          message.content = decoded;
        } catch {
          // Leave as locked if decryption fails
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
          if (message?.content?.startsWith(`[🔐${vstorage.marker}]`)) {
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

// Helper function to find the message content container in React tree
function findMessageContentContainer(node: any): any {
  if (!node || typeof node !== 'object') return null;

  // Look for the message content container
  if (node.props?.className?.includes?.('messageContent') || 
      node.props?.style?.flexDirection === 'row' && 
      Array.isArray(node.props.children)) {
    return node;
  }

  if (node.props?.children) {
    if (Array.isArray(node.props.children)) {
      for (const child of node.props.children) {
        const result = findMessageContentContainer(child);
        if (result) return result;
      }
    } else {
      return findMessageContentContainer(node.props.children);
    }
  }

  return null;
}