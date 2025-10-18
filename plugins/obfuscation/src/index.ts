import { applyPatches } from "./patcher";
import applyPillPatcher from "./pillPatcher";
import Settings from "./Settings";

let unpatch: () => void;
let pillUnpatch: () => void;

export function onLoad() {
  unpatch = applyPatches();
  pillUnpatch = applyPillPatcher();
}

export function onUnload() {
  unpatch?.();
  pillUnpatch?.();
}

export const settings = Settings;