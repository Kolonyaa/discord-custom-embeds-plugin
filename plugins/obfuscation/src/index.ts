import { applyPatches } from "./patcher";
import FloatingPill from "./pillPatcher";
import Settings from "./Settings";

let patches: ReturnType<typeof applyPatches>;
let pillUnpatch: () => void;

export function onLoad() {
  patches = applyPatches();
  pillUnpatch = () => {};
}

export function onUnload() {
  patches?.unpatchAll();
  pillUnpatch?.();
}

export const settings = Settings;