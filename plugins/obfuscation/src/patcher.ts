import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher, React } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

// Create a custom label component similar to stafftag
function ObfuscationLabel({ marker }) {
  const { View, Text } = ReactNative;
  
  return React.createElement(View, {
    style: {
      backgroundColor: '#5865f2',
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginRight: 8,
      alignSelf: 'flex-start',
    }
  }, React.createElement(Text, {
    style: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: 'bold',
    }
  }, marker));
}

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
          // Successfully decoded with our key - replace with unlocked version
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
        } catch {
          // Failed to decrypt with our key, leave as locked version
        }
      }
    })
  );

  // After message is generated, add our custom label
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1) return row;

      const message = data.message;
      const content = message?.content;

      // Check if this is one of our obfuscated messages
      const isEncrypted = content?.startsWith(`[🔐${vstorage.marker}]`);
      const isDecrypted = content?.startsWith(`[🔓${vstorage.marker}]`);
      
      if (!isEncrypted && !isDecrypted) return row;

      // Find the message content container in the React tree
      const findMessageContent = (node) => {
        if (!node || typeof node !== 'object') return null;
        
        // Look for the message content container
        if (node.props?.className?.includes?.('messageContent') || 
            node.props?.style?.flexDirection === 'row') {
          return node;
        }
        
        if (node.props?.children) {
          const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
          for (const child of children) {
            const result = findMessageContent(child);
            if (result) return result;
          }
        }
        
        return null;
      };

      const messageContent = findMessageContent(row);
      if (messageContent && Array.isArray(messageContent.props.children)) {
        // Create our label component
        const label = React.createElement(ObfuscationLabel, {
          marker: vstorage.marker,
          key: 'obfuscation-label'
        });
        
        // Insert the label at the beginning of the message content
        messageContent.props.children.unshift(label);
      }

      return row;
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
          message.content = `[🔓${vstorage.marker}] ${decoded}`;
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