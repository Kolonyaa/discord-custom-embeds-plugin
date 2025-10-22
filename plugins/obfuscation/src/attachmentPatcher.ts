// attachmentPatcher.tsx
import { before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { findByProps } from "@vendetta/metro";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const MessageSender = findByProps("sendMessage");
const ChannelStore = findByProps("getChannelId");

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

  // Approach 1: Patch CloudUpload constructor (like the filename anonymizer)
  if (CloudUpload) {
    patches.push(
      before("CloudUpload", CloudUpload, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const uploadObject = args[0];
          if (!uploadObject) return;

          const filename = uploadObject.filename ?? "file";
          
          // Check if it's an image
          const isImage = uploadObject?.type?.startsWith("image/") || 
                         /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

          if (!isImage) return;

          console.log("[ObfuscationPlugin] Intercepting image upload:", filename);
          
          // Store the original upload object for later processing
          uploadObject.__originalType = uploadObject.type;
          uploadObject.__originalFilename = uploadObject.filename;
          
          // We'll process this in the upload method
          uploadObject.__shouldObfuscate = true;

        } catch (e) {
          console.error("[ObfuscationPlugin] Error in CloudUpload patch:", e);
        }
      })
    );
  }

  // Approach 2: Patch the upload method
  if (CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
    const originalUpload = CloudUpload.prototype.reactNativeCompressAndExtractData;

    CloudUpload.prototype.reactNativeCompressAndExtractData = async function (...args: any[]) {
      try {
        if (!vstorage.enabled || !vstorage.secret) {
          return originalUpload.apply(this, args);
        }

        const file = this;
        
        // Check if this upload should be obfuscated
        if (!file.__shouldObfuscate) {
          return originalUpload.apply(this, args);
        }

        const filename = file.__originalFilename ?? file.filename ?? "file";
        console.log("[ObfuscationPlugin] Processing image for obfuscation:", filename);
        showToast("📤 Uploading to Litterbox...");

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
        
        // Get channel ID to find the pending message
        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();

        // Send a new message with the obfuscated URL
        if (channelId && MessageSender?.sendMessage) {
          await MessageSender.sendMessage(channelId, { 
            content: `${INVISIBLE_MARKER}${obfuscatedUrl}`
          });
          
          showToast("🔒 Image obfuscated and sent");
        } else {
          showToast("❌ Failed to send obfuscated image");
        }

        // Return null to cancel the original file upload
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