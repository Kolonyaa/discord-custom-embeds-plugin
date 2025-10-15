import { storage } from "@vendetta/plugin";
import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";

import Settings from "./components/Settings";

export const vstorage = storage as {
  config: {
    enabled: boolean;
    prefix: string;
  };
};

export function onLoad() {
  vstorage.config ??= {
    enabled: true,
    prefix: "you said: "
  };
}

const Messages = findByProps("sendMessage", "editMessage");

let unpatch: () => void;

export function onUnload() {
  unpatch?.();
}

export function onActivate() {
  const patches = [];
  
  // Patch sendMessage
  patches.push(
    before("sendMessage", Messages, (args) => {
      if (args[1]?.content && vstorage.config.enabled) {
        args[1].content = `${vstorage.config.prefix}${args[1].content}`;
      }
    })
  );
  
  // Patch editMessage
  patches.push(
    before("editMessage", Messages, (args) => {
      if (args[2]?.content && vstorage.config.enabled) {
        args[2].content = `${vstorage.config.prefix}${args[2].content}`;
      }
    })
  );
  
  unpatch = () => patches.forEach(p => p());
}

export const settings = Settings;