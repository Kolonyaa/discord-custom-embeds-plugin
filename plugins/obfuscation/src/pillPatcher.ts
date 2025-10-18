import { findByName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { vstorage } from "../storage";
import FloatingPill from "../components/FloatingPill";

const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
const JumpToPresentButton = findByName("JumpToPresentButton", false);

export default () => {
  const patches: (() => void)[] = [];
  let forceUpdateKey = 0;

  patches.push(
    after("default", ChatInputGuardWrapper, (_, ret) => {
      const children = findInReactTree(
        ret.props.children,
        x => x.type?.displayName === "View" && Array.isArray(x.props?.children)
      )?.props?.children as any[];
      
      if (!children) return;

      // Remove any existing pill first
      const existingPillIndex = children.findIndex(child => 
        child?.type?.name === "FloatingPill" || child?.type?.displayName === "FloatingPill"
      );
      if (existingPillIndex !== -1) {
        children.splice(existingPillIndex, 1);
      }

      // Add the floating pill with a key that changes when enabled state changes
      children.unshift(
        React.createElement(FloatingPill, {
          key: `obfuscation-pill-${vstorage.enabled}-${forceUpdateKey}`
        })
      );
    })
  );

  // Listen for storage changes and force re-render
  const originalEnabled = vstorage.enabled;
  const interval = setInterval(() => {
    if (vstorage.enabled !== originalEnabled) {
      forceUpdateKey++;
      // This will force the ChatInputGuardWrapper to re-render
      FluxDispatcher.dispatch({ type: "UPDATE_TEXT_INPUT" });
    }
  }, 100);

  // Adjust the JumpToPresentButton position to avoid overlap
  patches.push(
    after("default", JumpToPresentButton, (_, ret) => {
      if (ret?.props?.style) {
        ret.props.style = [
          ...ret.props.style,
          { bottom: ret.props.style[1].bottom + 32 + 8 },
        ];
      }
    })
  );

  return () => {
    clearInterval(interval);
    for (const x of patches) x();
  };
};