import { applyPatches } from "./patcher";
import applyPillPatcher from "./pillPatcher";
import Settings from "./Settings";

let unpatch: () => void;
let pillUnpatch: () => void;

export function onLoad() {
  // Initialize all patchers
  unpatch = applyPatches();
  pillUnpatch = applyPillPatcher?.();
}

export function onUnload() {
  // Safely call all unpatch functions
  unpatch?.();
  pillUnpatch?.();
}

export const settings = Settings;