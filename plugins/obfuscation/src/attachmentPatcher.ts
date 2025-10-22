// attachmentPatcher.tsx
import { before } from "@vendetta/patcher";
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
        
        // Find and modify the pending message
        const pendingMessages = PendingMessages?.getPendingMessages?.(channelId);
        let foundPendingMessage = false;

        if (pendingMessages) {
          for (const [messageId, pendingMsg] of Object.entries(pendingMessages)) {
            if (pendingMsg.attachments && pendingMsg.attachments.length > 0) {
              // Add obfuscated URL to content and keep the message
              const originalContent = pendingMsg.content || "";
              const obfuscatedContent = `${INVISIBLE_MARKER}${obfuscatedUrl}`;
              const newContent = originalContent ? 
                `${originalContent}\n${obfuscatedContent}` : 
                obfuscatedContent;

              // Update the pending message - remove attachments, add obfuscated content
              pendingMsg.content = newContent;
              pendingMsg.attachments = []; // Remove the image attachment

              console.log("[ObfuscationPlugin] Modified pending message with obfuscated URL");
              foundPendingMessage = true;
              break;
            }
          }
        }

        if (foundPendingMessage) {
          showToast("🔒 Image obfuscated");
          // Return the original upload result to let the message send normally
          // but with our modifications (no attachments + obfuscated URL in content)
          return originalUpload.apply(this, args);
        } else {
          console.error("[ObfuscationPlugin] Could not find pending message to modify");
          showToast("❌ Failed to obfuscate image");
          return originalUpload.apply(this, args);
        }

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