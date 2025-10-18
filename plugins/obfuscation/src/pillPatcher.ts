import { findByName } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { findInReactTree } from "@vendetta/utils";
import { vstorage } from "../storage";
import FloatingPill from "../components/FloatingPill";

const ChatInputGuardWrapper = findByName("ChatInputGuardWrapper", false);
const JumpToPresentButton = findByName("JumpToPresentButton", false);

export interface ChatInputProps {
  handleTextChanged: (text: string) => void;
}

export default () => {
  const patches: (() => void)[] = [];
  let currentInputProps: ChatInputProps | null = null;
  let forceUpdateCount = 0;

  patches.push(
    after("default", ChatInputGuardWrapper, (_, ret) => {
      const inputProps = findInReactTree(
        ret.props.children,
        x => x?.props?.chatInputRef?.current,
      )?.props?.chatInputRef?.current as ChatInputProps;
      
      if (!inputProps?.handleTextChanged) return;
      currentInputProps = inputProps;

      const children = findInReactTree(
        ret.props.children,
        x => x.type?.displayName === "View" && Array.isArray(x.props?.children)
      )?.props?.children as any[];
      
      if (!children) return;

      // Remove any existing pills
      const pillIndices = [];
      children.forEach((child, index) => {
        if (child?.type?.name === "FloatingPill" || child?.type?.displayName === "FloatingPill") {
          pillIndices.push(index);
        }
      });
      
      pillIndices.sort((a, b) => b - a).forEach(index => {
        children.splice(index, 1);
      });

      // Add new pill with force update capability
      children.unshift(
        React.createElement(FloatingPill, {
          key: `obfuscation-pill-${forceUpdateCount}`,
          onToggle: (enabled: boolean) => {
            // Force re-render by triggering a text change
            if (currentInputProps) {
              // This will force the entire chat input to re-render
              currentInputProps.handleTextChanged("");
              setTimeout(() => {
                forceUpdateCount++;
                currentInputProps?.handleTextChanged("");
              }, 10);
            }
          }
        })
      );
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