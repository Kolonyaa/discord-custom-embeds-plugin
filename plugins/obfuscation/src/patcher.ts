import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import React from "react";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

/* -------------------------
   Existing message patches
   ------------------------- */

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");

function reprocessMessagesLater() {
  try {
    if (!vstorage.enabled) return;
    const channels = MessageStore.getMutableMessages?.() ?? {};
    Object.values(channels).forEach((channelMessages: any) => {
      if (!channelMessages || typeof channelMessages !== "object") return;
      Object.values(channelMessages).forEach((message: any) => {
        if (message?.content?.startsWith(`[🔐${vstorage.marker}]`)) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_UPDATE",
            message,
            log_edit: false,
          });
        }
      });
    });
  } catch (e) {
    console.error("[ObfuscationPlugin] reprocessMessagesLater error:", e);
  }
}

/* -------------------------
   Helpers for input patch
   ------------------------- */

/**
 * Given a module returned by findByName or findByProps, normalize to component constructor
 * Many plugins expose a wrapper object with `.type` pointing to the component (see example you found).
 */
function normalizeToComponent(mod: any) {
  if (!mod) return null;
  if (typeof mod === "function") return mod;
  if (mod.type && typeof mod.type === "function") return mod.type;
  // some modules export default
  if (mod.default && typeof mod.default === "function") return mod.default;
  return mod;
}

/**
 * Return true if this React element looks like a TextInput or input wrapper:
 * heuristics: props contain onChangeText OR multiline OR placeholder
 */
function looksLikeTextInput(elem: any): boolean {
  if (!elem || !elem.props) return false;
  const p = elem.props;
  return "onChangeText" in p || "multiline" in p || "placeholder" in p || "value" in p;
}

/**
 * Recursively traverse the React element tree and attempt to find a node to inject style into.
 * When a node that matches looksLikeTextInput is found, clone it with merged style and return
 * the modified root (cloning along the path).
 *
 * If nothing matched, return null.
 */
function injectStyleIntoTree(root: any, styleToInject: any): any | null {
  if (!root) return null;

  if (looksLikeTextInput(root)) {
    const oldStyle = root.props?.style;
    const mergedStyle = Array.isArray(oldStyle) ? [styleToInject, ...oldStyle] : [styleToInject, oldStyle].filter(Boolean);
    return React.cloneElement(root, { style: mergedStyle });
  }

  // If leaf and not matching, nothing to do
  if (!root.props || !root.props.children) return null;

  const children = React.Children.toArray(root.props.children);
  let didChange = false;
  const newChildren = children.map((child: any) => {
    // If child is a React element, try to inject
    if (React.isValidElement(child)) {
      const replaced = injectStyleIntoTree(child, styleToInject);
      if (replaced) {
        didChange = true;
        return replaced;
      } else {
        return child;
      }
    }
    return child;
  });

  if (didChange) {
    return React.cloneElement(root, undefined, ...newChildren);
  }

  return null;
}

/* -------------------------
   Main applyPatches
   ------------------------- */

export function applyPatches() {
  const patches: Array<() => void> = [];

  // Outgoing: scramble before sending
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
      )
        return;

      try {
        const scrambled = scramble(content, vstorage.secret);
        msg.content = `[🔐${vstorage.marker}] ${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to scramble message:", e);
      }
    })
  );

  // RowManager.generate: try to transparently decode if we have the secret
  if (RowManager && RowManager.prototype) {
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
            // leave locked
          }
        }
      })
    );
  }

  // MessageStore.getMessage: decode there too
  if (MessageStore) {
    patches.push(
      after("getMessage", MessageStore, (args, message) => {
        try {
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
        } catch (e) {
          console.error("[ObfuscationPlugin] getMessage patch error:", e);
        }
        return message;
      })
    );
  }

  // Reprocess existing messages shortly after load
  setTimeout(reprocessMessagesLater, 500);

  /* -------------------------
     Input highlighting logic
     ------------------------- */

  // style to inject (green outline & subtle tint)
  const highlightStyle = {
    borderWidth: 2,
    borderColor: "#34D399",
    borderRadius: 12,
    backgroundColor: "rgba(52,211,153,0.06)",
  };

  // Candidate names to try (include ones you mentioned + common ones)
  const candidateNames = [
    "ChannelTextArea",
    "ChannelTextInput",
    "MessageInput",
    "ChatFooter",
    "MessageComposer",
    "ChatInput",
    "ChatInputSendButton",
    "ChatInputActions",
    "TextInput",
  ];

  // Try multiple strategies to find a component to patch
  let foundAnyInput = false;

  for (const name of candidateNames) {
    try {
      const raw = findByName(name) || findByProps(name);
      const comp = normalizeToComponent(raw);
      if (!comp || !comp.prototype || !comp.prototype.render) continue;

      // patch its render (after) so we can inspect the returned react element
      patches.push(
        after("render", comp.prototype, (args, res) => {
          try {
            // only highlight when enabled
            if (!vstorage.enabled || !res) return res;

            // 1) Try to inject into a TextInput-like child
            const injected = injectStyleIntoTree(res, highlightStyle);
            if (injected) {
              foundAnyInput = true;
              return injected;
            }

            // 2) fallback: merge into root props.style if it exists (some components accept style)
            const oldStyle = res.props?.style;
            const mergedStyle = Array.isArray(oldStyle)
              ? [highlightStyle, ...oldStyle]
              : [highlightStyle, oldStyle].filter(Boolean);

            // If root has props, clone with merged style; otherwise leave unchanged
            if (res.props) {
              foundAnyInput = true;
              return React.cloneElement(res, { style: mergedStyle });
            }

            return res;
          } catch (e) {
            console.error(`[ObfuscationPlugin] render-patch (${name}) failed:`, e);
            return res;
          }
        })
      );

      console.log(`[ObfuscationPlugin] installed render patch on candidate: ${name}`);
    } catch (e) {
      // ignore and continue
    }
  }

  if (!foundAnyInput) {
    console.warn("[ObfuscationPlugin] No input candidate was successfully patched. If Discord's client changed, try inspecting component names or enable diagnostics.");
  }

  /* -------------------------
     Return unpatcher
     ------------------------- */
  return () => {
    try {
      patches.forEach((unpatch) => unpatch && unpatch());
    } catch (e) {
      console.error("[ObfuscationPlugin] error while unpatching:", e);
    }
  };
}