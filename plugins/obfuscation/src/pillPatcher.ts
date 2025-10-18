import { findByName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { vstorage } from "../storage";
import FloatingPill from "../components/FloatingPill";

const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);

export default () => {
  const patches: (() => void)[] = [];
  let renderCount = 0;

  const renderPill = () => {
    return React.createElement(FloatingPill, {
      key: `obfuscation-pill-${renderCount}`
    });
  };

  patches.push(
    after("default", ChatInputGuardWrapper, (_, ret) => {
      const children = findInReactTree(
        ret.props.children,
        x => x.type?.displayName === "View" && Array.isArray(x.props?.children)
      )?.props?.children as any[];
      
      if (!children) return;

      // Remove existing pills
      const pillIndices = [];
      children.forEach((child, index) => {
        if (child?.type?.name === "FloatingPill" || child?.type?.displayName === "FloatingPill") {
          pillIndices.push(index);
        }
      });
      
      // Remove from highest index to lowest to avoid index issues
      pillIndices.sort((a, b) => b - a).forEach(index => {
        children.splice(index, 1);
      });

      // Add new pill
      children.unshift(renderPill());
    })
  );

  // Force re-render when enabled state changes
  const originalEnabled = vstorage.enabled;
  setInterval(() => {
    if (vstorage.enabled !== originalEnabled) {
      renderCount++;
      // This will trigger a re-render of the chat input
      FluxDispatcher.dispatch({ type: "UPDATE_TEXT_INPUT" });
    }
  }, 100);

  return () => {
    for (const x of patches) x();
  };
};