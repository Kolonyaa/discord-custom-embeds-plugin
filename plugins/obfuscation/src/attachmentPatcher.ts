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

  // FIRST: Patch CloudUpload constructor to intercept image uploads
  if (CloudUpload) {
    patches.push(
      before("CloudUpload", CloudUpload, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const uploadObject = args[0];
          if (!uploadObject) return;

          const filename = uploadObject.filename ?? "";
          const isImage = uploadObject.type?.startsWith("image/") || 
                         /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

          if (!isImage) return;

          console.log("[ObfuscationPlugin] Intercepting image upload:", filename);
          
          // Store the original method
          const originalMethod = uploadObject.reactNativeCompressAndExtractData;
          
          // Override the upload method
          uploadObject.reactNativeCompressAndExtractData = async function (...args: any[]) {
            try {
              showToast("📤 Uploading to Litterbox...");

              // Upload to Litterbox
              const litterboxUrl = await uploadToLitterbox(this, "1h");
              
              if (!litterboxUrl) {
                console.error("[ObfuscationPlugin] Litterbox upload failed");
                showToast("❌ Litterbox upload failed");
                return originalMethod?.apply(this, args);
              }

              console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

              // Obfuscate the URL
              const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
              
              // Get channel ID
              const channelId = this?.channelId ?? ChannelStore?.getChannelId?.();
              
              // Find and modify the pending message
              const pendingMessages = PendingMessages?.getPendingMessages?.(channelId);
              if (pendingMessages) {
                for (const [messageId, pendingMsg] of Object.entries(pendingMessages)) {
                  if (pendingMsg.attachments && pendingMsg.attachments.length > 0) {
                    // Add obfuscated URL to content
                    const originalContent = pendingMsg.content || "";
                    const obfuscatedContent = `${INVISIBLE_MARKER}${obfuscatedUrl}`;
                    const newContent = originalContent ? 
                      `${originalContent}\n${obfuscatedContent}` : 
                      obfuscatedContent;

                    // Update the pending message
                    pendingMsg.content = newContent;
                    // Remove the image attachment so only our obfuscated URL remains
                    pendingMsg.attachments = [];

                    console.log("[ObfuscationPlugin] Modified pending message with obfuscated URL");
                    showToast("🔒 Image obfuscated");
                    
                    // Return null to cancel the original file upload
                    // The message will still send with our modified content
                    return null;
                  }
                }
              }

              // If we couldn't find/modify the pending message, fall back to original
              return originalMethod?.apply(this, args);

            } catch (e) {
              console.error("[ObfuscationPlugin] Error obfuscating upload:", e);
              showToast("❌ Failed to obfuscate image");
              return originalMethod?.apply(this, args);
            }
          };

        } catch (e) {
          console.error("[ObfuscationPlugin] Error in CloudUpload patch:", e);
        }
      })
    );
  }

  // SECOND: Also patch the uploadLocalFiles method as a fallback
  try {
    const uploadModule = findByProps("uploadLocalFiles");
    if (uploadModule) {
      patches.push(
        before("uploadLocalFiles", uploadModule, (args) => {
          try {
            if (!vstorage.enabled || !vstorage.secret) return;

            const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads;
            if (!Array.isArray(files)) return;

            // Look for image files in the upload batch
            let hasImages = false;
            files.forEach((file: any) => {
              const filename = file.filename ?? "";
              const isImage = file.type?.startsWith("image/") || 
                             /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
              if (isImage) hasImages = true;
            });

            if (!hasImages) return;

            console.log("[ObfuscationPlugin] Intercepting uploadLocalFiles with images");
            
            // We'll handle this in the CloudUpload patch above
            // This just ensures we catch all upload methods

          } catch (e) {
            console.error("[ObfuscationPlugin] Error in uploadLocalFiles patch:", e);
          }
        })
      );
    }
  } catch {}

  return () => patches.forEach((unpatch) => unpatch());
}