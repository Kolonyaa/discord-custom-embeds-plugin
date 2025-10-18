// patcher.ts
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import React from "react";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

/* -------------------------
   Message obfuscation (unchanged)
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
   Helpers
   ------------------------- */

/** Normalize possible module export shapes to a component constructor */
function normalizeToComponent(mod: any) {
  if (!mod) return null;
  if (typeof mod === "function") return mod;
  if (mod.type && typeof mod.type === "function") return mod.type;
  if (mod.default && typeof mod.default === "function") return mod.default;
  return null;
}

/** Heuristic: does this props object look like a chat input props? */
function propsLooksLikeInput(props: any) {
  if (!props || typeof props !== "object") return false;
  return (
    "onChangeText" in props ||
    "multiline" in props ||
    "placeholder" in props ||
    "value" in props ||
    "canSendVoiceMessage" in props ||
    "isAppLauncherEnabled" in props ||
    "shouldShowGiftButton" in props
  );
}

/** Merge/insert highlight style into props.style (array or object) */
function injectHighlightIntoPropsStyle(props: any, highlightStyle: any) {
  if (!props) return false;
  try {
    const s = props.style;
    if (Array.isArray(s)) {
      // push to end so existing styles win when colliding, or unshift if you prefer priority
      s.push(highlightStyle);
      props.style = s;
      return true;
    } else if (s && typeof s === "object") {
      props.style = [s, highlightStyle];
      return true;
    } else {
      // no style — set as array
      props.style = [highlightStyle];
      return true;
    }
  } catch (e) {
    console.error("[ObfuscationPlugin] injectHighlightIntoPropsStyle err:", e);
    return false;
  }
}

/* -------------------------
   Main applyPatches
   ------------------------- */

export function applyPatches() {
  const unpatches: Array<() => void> = [];

  // === Outgoing: scramble before sending ===
  if (Messages) {
    unpatches.push(
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
  } else {
    console.warn("[ObfuscationPlugin] Messages module not found; outgoing patch skipped.");
  }

  // === RowManager.generate ===
  if (RowManager && RowManager.prototype) {
    unpatches.push(
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
  } else {
    console.warn("[ObfuscationPlugin] RowManager not found; incoming message patch skipped.");
  }

  // === MessageStore.getMessage ===
  if (MessageStore) {
    unpatches.push(
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
  } else {
    console.warn("[ObfuscationPlugin] MessageStore not found; getMessage patch skipped.");
  }

  // reprocess existing messages a bit later
  setTimeout(reprocessMessagesLater, 500);

  /* -------------------------
     Input UI highlighting (props-mutation approach)
     ------------------------- */

  // highlight style to apply (tweak as you like)
  const highlightStyle = {
    borderWidth: 2,
    borderColor: "#34D399",
    borderRadius: 12,
    backgroundColor: "rgba(52,211,153,0.06)",
  };

  // Candidate names / fallbacks — include many options
  const candidates = [
    // common input components
    "ChannelTextArea",
    "ChannelTextInput",
    "MessageInput",
    "ChatFooter",
    "MessageComposer",
    "ChatInput",
    "ChatInputSendButton", // sometimes exposes .type with a ref to the input
    "ChatInputActions",
    "TextInput",
  ];

  // Also check findByProps fallback
  const fallbackByProps = findByProps("onChangeText", "multiline", "placeholder");

  // keep track of whether we actually patched something
  let patchedAny = false;

  // Patch each candidate if present and looks like a component or wrapper
  for (const name of candidates) {
    try {
      const raw = findByName(name) || findByProps(name) || null;
      const comp = normalizeToComponent(raw);
      if (!comp || !comp.prototype || typeof comp.prototype.render !== "function") {
        // try if raw itself looks like a component container with .type
        if (raw && raw.type && raw.type.prototype && typeof raw.type.prototype.render === "function") {
          // we'll patch raw.type
          const componentToPatch = raw.type;
          const unpatcher = before("render", componentToPatch.prototype, (args) => {
            try {
              if (!vstorage.enabled) return;
              const props = args[0];
              if (!props || typeof props !== "object") return;
              // If it looks like input props, inject style
              if (propsLooksLikeInput(props)) {
                if (injectHighlightIntoPropsStyle(props, highlightStyle)) {
                  patchedAny = true;
                }
              }
            } catch (e) {
              console.error(`[ObfuscationPlugin] error in render patch (${name} .type):`, e);
            }
          });
          unpatches.push(unpatcher);
          console.log(`[ObfuscationPlugin] patched (via raw.type) candidate: ${name}`);
        } else {
          // not a component; skip
          // console.info(`[ObfuscationPlugin] candidate not a component: ${name}`);
        }
        continue;
      }

      // Patch the component's render args (props) like the avatar example did
      const unpatch = before("render", comp.prototype, (args) => {
        try {
          if (!vstorage.enabled) return;
          const props = args[0];
          if (!props || typeof props !== "object") return;

          // If this props already matches input heuristics, inject highlight
          if (propsLooksLikeInput(props)) {
            if (injectHighlightIntoPropsStyle(props, highlightStyle)) {
              patchedAny = true;
            }
            return;
          }

          // Sometimes the input is nested deeper: check props.children to find child props objects to modify
          // we only mutate direct children that look like input props (this mimics in-place wrapper edits)
          const children = props.children;
          if (Array.isArray(children)) {
            for (let i = 0; i < children.length; i++) {
              const c = children[i];
              if (c && c.props && propsLooksLikeInput(c.props)) {
                injectHighlightIntoPropsStyle(c.props, highlightStyle);
                patchedAny = true;
                return;
              }
            }
          } else if (children && children.props && propsLooksLikeInput(children.props)) {
            injectHighlightIntoPropsStyle(children.props, highlightStyle);
            patchedAny = true;
            return;
          }

          // If props.style is an array, we can append highlight unconditionally when present (less safe)
          if (props.style && Array.isArray(props.style)) {
            props.style.push(highlightStyle);
            patchedAny = true;
            return;
          }
        } catch (e) {
          console.error(`[ObfuscationPlugin] error in render patch (${name}):`, e);
        }
      });

      unpatches.push(unpatch);
      console.log(`[ObfuscationPlugin] installed render-before patch on candidate: ${name}`);
    } catch (e) {
      // ignore candidate errors
    }
  }

  // Merge the findByProps fallback (if not already patched)
  if (fallbackByProps) {
    const comp = normalizeToComponent(fallbackByProps);
    if (comp && comp.prototype && typeof comp.prototype.render === "function") {
      try {
        const unpatch = before("render", comp.prototype, (args) => {
          try {
            if (!vstorage.enabled) return;
            const props = args[0];
            if (!props || typeof props !== "object") return;
            if (propsLooksLikeInput(props)) {
              if (injectHighlightIntoPropsStyle(props, highlightStyle)) {
                patchedAny = true;
              }
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] fallback render patch error:", e);
          }
        });
        unpatches.push(unpatch);
        console.log("[ObfuscationPlugin] installed fallback render-before patch (findByProps)");
      } catch (e) {
        // nothing
      }
    }
  }

  if (!patchedAny) {
    console.warn("[ObfuscationPlugin] No input candidate appeared to be patched. Check console logs for which candidates were present. You can enable additional diagnostics if needed.");
  } else {
    console.log("[ObfuscationPlugin] Input highlight applied (one or more candidates patched).");
  }

  // Return unpatch function
  return () => {
    try {
      unpatches.forEach((u) => u && u());
      console.log("[ObfuscationPlugin] unpatched all patches.");
    } catch (e) {
      console.error("[ObfuscationPlugin] error during unpatch:", e);
    }
  };
}
