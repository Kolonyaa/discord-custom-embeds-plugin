import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import React from "react";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

/**
 * Try to locate the chat input component dynamically.
 */
function tryFindInputComponent() {
  const names = [
    "ChannelTextArea",
    "ChannelTextInput",
    "MessageInput",
    "ChatFooter",
    "MessageComposer",
    "ChatInput",
    "TextInput",
  ];

  for (const name of names) {
    const mod = findByName(name);
    if (mod) return mod;
  }

  // fallback
  return findByProps("onChangeText", "multiline") || findByProps("sendMessage", "onSubmitEditing");
}

export function applyPatches() {
  const patches: Array<() => void> = [];

  //
  // ─── Outgoing Messages ───────────────────────────────────────────────
  //
  patches.push(
    before("sendMessage", Messages, (args) => {
      const msg = args[1];
      const content = msg?.content;

      if (
        !content ||
        content.startsWith(`[🔐${vstorage.marker}]`) ||
        content.startsWith(`[🔓${vstorage.marker}]`) ||
        !vstorage.enabled ||
        !vstorage.secret
      ) {
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

  //
  // ─── Incoming Messages (RowManager patch) ─────────────────────────────
  //
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
          // failed decryption — keep locked
        }
      }
    })
  );

  //
  // ─── getMessage Patch ────────────────────────────────────────────────
  //
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
          // leave locked
        }
      }

      return message;
    })
  );

  //
  // ─── Reprocess Existing Messages ─────────────────────────────────────
  //
  const reprocessExistingMessages = () => {
    if (!vstorage.enabled) return;

    console.log("[ObfuscationPlugin] Reprocessing existing messages...");

    const channels = MessageStore.getMutableMessages?.() ?? {};

    Object.entries(channels).forEach(([_, channelMessages]: [string, any]) => {
      if (channelMessages && typeof channelMessages === "object") {
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

  //
  // ─── Chat Input Highlight Patch ──────────────────────────────────────
  //
  try {
    const InputComp = tryFindInputComponent();

    if (InputComp && InputComp.prototype && InputComp.prototype.render) {
      console.log("[ObfuscationPlugin] Found chat input component:", InputComp.name || InputComp.displayName);
      patches.push(
        after("render", InputComp.prototype, (args, res) => {
          try {
            if (!vstorage.enabled || !res) return res;

            const highlightStyle = {
              borderWidth: 2,
              borderColor: "#34D399", // emerald green
              borderRadius: 12,
              backgroundColor: "rgba(52,211,153,0.06)", // subtle tint
            };

            const oldStyle = res.props?.style;
            const mergedStyle = Array.isArray(oldStyle)
              ? [highlightStyle, ...oldStyle]
              : [highlightStyle, oldStyle].filter(Boolean);

            return React.cloneElement(res, { style: mergedStyle });
          } catch (e) {
            console.error("[ObfuscationPlugin] Failed to style chat input:", e);
            return res;
          }
        })
      );
    } else {
      console.warn("[ObfuscationPlugin] Could not find chat input component to patch.");
    }
  } catch (e) {
    console.error("[ObfuscationPlugin] Error finding input component:", e);
  }

  //
  // ─── Return Unpatcher ────────────────────────────────────────────────
  //
  return () => patches.forEach((unpatch) => unpatch());
}