import { applyPatches } from "./patcher";
import applyPillPatcher from "./pillPatcher";
import applyAttachmentPatcher from "./attachmentPatcher";
import Settings from "./Settings";
import applyAttachmentRenderPatcher from "./attachmentRenderPatcher";

let unpatch: () => void;
let pillUnpatch: () => void;
let attachmentUnpatch: () => void;
let renderUnpatch: () => void;

export function onLoad() {
  // Initialize all patchers
  unpatch = applyPatches();
  pillUnpatch = applyPillPatcher?.();
  attachmentUnpatch = applyAttachmentPatcher?.();
  renderUnpatch = applyAttachmentRenderPatcher?.();
}

export function onUnload() {
  // Safely call all unpatch functions
  unpatch?.();
  pillUnpatch?.();
  attachmentUnpatch?.();
  renderUnpatch?.();
}

export const settings = Settings;