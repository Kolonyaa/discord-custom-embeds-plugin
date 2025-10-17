import { applyPatches } from "./patcher";
import Settings from "./Settings";

let unpatch: () => void;

export function onLoad() {
  unpatch = applyPatches();
}

export function onUnload() {
  unpatch?.();
}

export const settings = Settings;