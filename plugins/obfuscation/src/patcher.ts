// sendButtonPatch.ts (paste into your patcher.ts or import/run from applyPatches)
import { findByName, findByProps } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import React from "react";
import { vstorage } from "./storage";

function getComponentCandidate(name: string) {
  // try findByName (common), then findByProps as fallback
  return findByName(name) || findByProps(name);
}

// Helper: get a component constructor from a module export that might be { type } or default
function normalizeToComponent(mod: any) {
  if (!mod) return null;
  if (typeof mod === "function") return mod;
  if (mod.type && typeof mod.type === "function") return mod.type;
  if (mod.default && typeof mod.default === "function") return mod.default;
  return null;
}

// Helper: try to tint an icon React element (Image/SVG) by setting color/tintColor/style props
function tintIconElement(elem: any, color = "#34D399") {
  if (!React.isValidElement(elem)) return elem;
  const newProps: any = {};

  // If icon uses a 'color' prop (vector icons), set it.
  if ("color" in (elem.props || {})) newProps.color = color;
  // If icon uses style/tintColor, merge the style.
  const oldStyle = elem.props?.style;
  if (oldStyle) {
    newProps.style = Array.isArray(oldStyle) ? [...oldStyle, { tintColor: color }] : [oldStyle, { tintColor: color }];
  } else {
    newProps.style = { tintColor: color };
  }

  return React.cloneElement(elem, newProps);
}

// Primary installer: patches ChatInputSendButton / ChatInputActions
export function patchInputButtons() {
  const unpatches: Array<() => void> = [];

  // Candidate names seen in various clients/plugins
  const candidateNames = ["ChatInputSendButton", "ChatInputActions", "ChatInput", "ChannelTextArea"];

  for (const name of candidateNames) {
    try {
      const raw = getComponentCandidate(name);
      const comp = normalizeToComponent(raw);
      if (!comp || !comp.prototype || typeof comp.prototype.render !== "function") {
        continue;
      }

      // BEFORE render: mutate the props argument directly (forwardRef moment)
      const uBefore = before("render", comp.prototype, ([props, ref]) => {
        try {
          // only when enabled
          if (!vstorage.enabled) return;

          if (!props || typeof props !== "object") return;

          // Example heuristics:
          // - For send button, props may include 'canSendVoiceMessage', 'onPress', 'icon', 'hasText', etc.
          // - For actions, props often include 'isAppLauncherEnabled', 'shouldShowGiftButton', etc.

          // If there's a single 'icon' prop, try tinting it
          if (props.icon) {
            props.icon = tintIconElement(props.icon, "#34D399");
          }

          // If children include an icon element (e.g., a View with children), try to map children
          if (props.children) {
            // simple: if children is a valid element and has a child icon prop, try to tint recursively
            const children = Array.isArray(props.children) ? props.children : [props.children];
            let modified = false;
            const newChildren = children.map((c: any) => {
              try {
                if (React.isValidElement(c)) {
                  // If it's a direct icon, tint it
                  if (c.props && ("color" in c.props || "style" in c.props)) {
                    modified = true;
                    return tintIconElement(c, "#34D399");
                  }

                  // If it has a single child that is an icon, attempt to tint that child
                  const inner = c.props?.children;
                  if (React.isValidElement(inner) && (inner.props?.color || inner.props?.style)) {
                    const replacedInner = tintIconElement(inner, "#34D399");
                    modified = true;
                    return React.cloneElement(c, undefined, replacedInner);
                  }
                }
              } catch (e) {
                // ignore errors for non-standard shapes
              }
              return c;
            });

            if (modified) {
              props.children = Array.isArray(props.children) ? newChildren : newChildren[0];
            }
          }

          // If the component accepts a style prop, append a tint (less likely for icon, more for wrapper)
          if (props.style) {
            props.style = Array.isArray(props.style) ? [...props.style, { tintColor: "#34D399" }] : [props.style, { tintColor: "#34D399" }];
          }

          // store ref if needed externally
          // (some plugins use refs to call setHasText or onShowActions later)
          if (ref) {
            try {
              (comp as any).__lastRef = ref;
            } catch {}
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] send-button before-render error:", e);
        }
      });

      unpatches.push(uBefore);

      // AFTER render: if icon is deeper in returned element tree, cloneElement the return to change it
      const uAfter = after("render", comp.prototype, (args, res) => {
        try {
          if (!vstorage.enabled || !res) return res;

          // If res.props.icon exists, tint it
          if (res.props?.icon) {
            return React.cloneElement(res, { icon: tintIconElement(res.props.icon, "#34D399") });
          }

          // If the return has children, search shallowly for an icon-like child and tint it
          const children = React.Children.toArray(res.props?.children ?? []);
          let changed = false;
          const newChildren = children.map((c: any) => {
            if (!React.isValidElement(c)) return c;
            if (c.props && ("color" in c.props || "style" in c.props)) {
              changed = true;
              return tintIconElement(c, "#34D399");
            }
            // try inner child
            const inner = c.props?.children;
            if (React.isValidElement(inner) && (inner.props?.color || inner.props?.style)) {
              changed = true;
              const replacedInner = tintIconElement(inner, "#34D399");
              return React.cloneElement(c, undefined, replacedInner);
            }
            return c;
          });

          if (changed) {
            return React.cloneElement(res, undefined, ...newChildren);
          }

          // fallback: if root supports style, merge highlight
          if (res.props && res.props.style) {
            const oldStyle = res.props.style;
            const mergedStyle = Array.isArray(oldStyle) ? [...oldStyle, { borderColor: "#34D399", borderWidth: 1 }] : [oldStyle, { borderColor: "#34D399", borderWidth: 1 }];
            return React.cloneElement(res, { style: mergedStyle });
          }

          return res;
        } catch (e) {
          console.error("[ObfuscationPlugin] send-button after-render error:", e);
          return res;
        }
      });

      unpatches.push(uAfter);

      console.log(`[ObfuscationPlugin] installed send-button patches on: ${name}`);
    } catch (e) {
      // ignore and continue
    }
  }

  // If you want to keep unpatchers to call later:
  return () => {
    for (const u of unpatches) u && u();
  };
}