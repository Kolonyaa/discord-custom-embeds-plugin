// attachmentPatcher.tsx
import { before } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { findByProps } from "@vendetta/metro";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const MessageSender = findByProps("sendMessage");
const ChannelStore = findByProps("getChannelId");
const PendingMessages = findByProps("getPendingMessages", "deletePendingMessage");

const INVISIBLE_MARKER = "\u200b\u200d\u200b";

// Litterbox upload function
async function uploadToLitterbox(media: any, duration = "1h"): Promise<string | null> {
  try {
    const fileUri =
      media?.item?.originalUri ||
      media?.uri ||
      media?.fileUri ||
      media?.path ||
      media?.sourceURL;

    if (!fileUri) throw new Error("Missing file URI");

    const filename = media.filename ?? "upload";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", duration);
    formData.append("fileToUpload", {
      uri: fileUri,
      name: filename,
      type: media.mimeType ?? "application/octet-stream",
    } as any);

    const response = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
      method: "POST",
      body: formData,
    });

    const text = await response.text();
    if (!text.startsWith("https://")) throw new Error(text);
    return text;
  } catch (err) {
    console.error("[ObfuscationPlugin] Litterbox upload failed:", err);
    return null;
  }
}

function cleanup(channelId: string) {
  try {
    const pending = PendingMessages?.getPendingMessages?.(channelId);
    if (!pending) return;

    for (const [messageId, message] of Object.entries(pending)) {
      if (message.state === "FAILED") {
        PendingMessages.deletePendingMessage(channelId, messageId);
        console.log(`[ObfuscationPlugin] Deleted failed message: ${messageId}`);
      }
    }
  } catch (err) {
    console.warn("[ObfuscationPlugin] Failed to delete pending messages:", err);
  }
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  // Patch the uploader to handle image attachments
  if (CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
    const originalUpload = CloudUpload.prototype.reactNativeCompressAndExtractData;

    CloudUpload.prototype.reactNativeCompressAndExtractData = async function (...args: any[]) {
      try {
        if (!vstorage.enabled || !vstorage.secret) {
          return originalUpload.apply(this, args);
        }

        const file = this;
        const filename = file?.filename ?? "file";
        
        // Check if it's an image
        const isImage = file?.type?.startsWith("image/") || 
                       /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

        if (!isImage) {
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Uploading image to Litterbox:", filename);
        showToast("📤 Uploading to Litterbox...");

        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          console.error("[ObfuscationPlugin] Litterbox upload failed");
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

        // Obfuscate the URL
        const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        
        // Cancel the original upload
        if (typeof this.setStatus === "function") this.setStatus("CANCELED");
        if (channelId) setTimeout(() => cleanup(channelId), 500);

        // Find the pending message and modify it
        const pendingMessages = PendingMessages?.getPendingMessages?.(channelId);
        if (pendingMessages) {
          for (const [messageId, pendingMsg] of Object.entries(pendingMessages)) {
            if (pendingMsg.attachments && pendingMsg.attachments.length > 0) {
              // Remove attachments and add obfuscated URL to content
              const originalContent = pendingMsg.content || "";
              const obfuscatedContent = `${INVISIBLE_MARKER}${obfuscatedUrl}`;
              const newContent = originalContent ? 
                `${originalContent}\n${obfuscatedContent}` : 
                obfuscatedContent;

              // Update the pending message
              pendingMsg.content = newContent;
              pendingMsg.attachments = [];

              console.log("[ObfuscationPlugin] Modified pending message with obfuscated URL");
              break;
            }
          }
        }

        showToast("🔒 Image obfuscated");

        return null;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error obfuscating upload:", e);
        showToast("❌ Failed to obfuscate image");
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  return () => patches.forEach((unpatch) => unpatch());
}