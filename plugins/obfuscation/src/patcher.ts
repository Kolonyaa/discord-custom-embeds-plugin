// patcher.js (updated)
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";
import ObfuscationLabel from "./components/ObfuscationLabel.tsx";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

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
        // Remove the visual indicator from the actual content
        msg.content = scrambled;
        // We'll add the marker as metadata that we can read later
        msg.obfuscationMarker = vstorage.marker;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // Patch RowManager for message rendering - ALWAYS process incoming messages
  // Alternative patcher approach
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || !row?.message) return;

      const message = data.message;
      const marker = message?.obfuscationMarker;

      if (!marker) return;

      console.log("[Obfuscation] Processing obfuscated message");

      // Look for the message content text element
      const messageContent = findInReactTree(row,
        x => typeof x?.props?.children === "string" && x.props.children === message.content
      );

      if (messageContent) {
        console.log("[Obfuscation] Found message content element");

        // Replace the string content with an array that includes our label
        const labelElement = React.createElement(ObfuscationLabel, {
          marker: marker,
          isEncrypted: !message._isDecrypted
        });

        messageContent.props.children = [
          labelElement,
          " ", // Add a space
          message._isDecrypted ? message._decodedContent : "[Encrypted Message]"
        ];
      }
    })
  );

  // After message is generated, add our label component
  patches.push(
    after("generate", RowManager.prototype, ([data], row) => {
      if (data.rowType !== 1 || !row?.message) return;

      const message = data.message;
      const marker = message?.obfuscationMarker || vstorage.marker;

      // Check if this message was processed by our obfuscation system
      const isObfuscated = message?.obfuscationMarker ||
        (message.content && !message.content.startsWith("[🔐") && !message.content.startsWith("[🔓"));

      if (!isObfuscated) return;

      // Find the message content container in the React tree
      const contentContainer = findInReactTree(row,
        x => x?.props?.style?.flexDirection === "column" &&
          Array.isArray(x.props.children)
      );

      if (!contentContainer) return;

      // Create our label component
      const labelElement = React.createElement(ObfuscationLabel, {
        marker: marker,
        isEncrypted: !message._isDecrypted
      });

      // Insert the label at the beginning of the message content
      if (Array.isArray(contentContainer.props.children)) {
        contentContainer.props.children.unshift(labelElement);
      } else {
        contentContainer.props.children = [labelElement, contentContainer.props.children];
      }
    })
  );

  // Also patch getMessage to handle message fetching
  patches.push(
    after("getMessage", MessageStore, (args, message) => {
      if (!message) return message;

      const content = message.content;
      const marker = message?.obfuscationMarker || vstorage.marker;

      if (!content || message.obfuscationMarker || content.startsWith("[🔐") || content.startsWith("[🔓")) {
        return message;
      }

      // Try to decrypt if we have the secret
      if (vstorage.secret) {
        try {
          const decoded = unscramble(content, vstorage.secret);
          message._decodedContent = decoded;
          message._isDecrypted = true;
        } catch {
          message._isDecrypted = false;
        }
      }

      return message;
    })
  );

  // Helper function to find in React tree (similar to stafftag plugin)
  function findInReactTree(tree, filter) {
    if (!tree) return null;
    if (filter(tree)) return tree;

    if (tree.props?.children) {
      const children = Array.isArray(tree.props.children)
        ? tree.props.children
        : [tree.props.children];

      for (const child of children) {
        const result = findInReactTree(child, filter);
        if (result) return result;
      }
    }

    return null;
  }

  return () => patches.forEach(unpatch => unpatch());
}