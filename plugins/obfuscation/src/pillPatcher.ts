import { findByName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";

import FloatingPill from "../components/FloatingPill";

const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
const JumpToPresentButton = findByName("JumpToPresentButton", false);

export default () => {
  const patches: (() => void)[] = [];

  patches.push(
    after("default", ChatInputGuardWrapper, (_, ret) => {
      const children = findInReactTree(
        ret.props.children,
        x => x.type?.displayName === "View" && Array.isArray(x.props?.children)
      )?.props?.children as any[];
      
      if (!children) return;

      // Add the floating pill to the chat input
      children.unshift(React.createElement(FloatingPill));
    })
  );

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
    for (const x of patches) x();
  };
};