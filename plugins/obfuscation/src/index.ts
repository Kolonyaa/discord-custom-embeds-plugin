import { applyPatches } from "./patcher";
import applyPillPatcher from "./pillPatcher";
import applyAttachmentPatcher from "./attachmentPatcher";
import Settings from "./Settings";

let unpatch: () => void;
let pillUnpatch: () => void;
let attachmentUnpatch: () => void;
let renderUnpatch: () => void;

export function onLoad() {
  // Initialize all patchers
  unpatch = applyPatches();
  pillUnpatch = applyPillPatcher?.();
  attachmentUnpatch = applyAttachmentPatcher?.();
}

export function onUnload() {
  // Safely call all unpatch functions
  unpatch?.();
  pillUnpatch?.();
  attachmentUnpatch?.();
}

export const settings = Settings;