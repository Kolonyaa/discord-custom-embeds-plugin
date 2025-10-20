// attachmentPatcher.ts
import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";

// Find the CloudUpload component like the file upload plugin
const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const MessageActions = findByProps("sendMessage", "receiveMessage");

export default function applyAttachmentPatcher() {
  const patches = [];

  console.log("[ObfuscationPlugin] Applying attachment patches...");

  // PATCH 1: Intercept file uploads using CloudUpload (same pattern as file upload plugin)
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

        console.log("[ObfuscationPlugin] Obfuscating image upload:", filename);

        // Read the file data
        const fileData = await originalUpload.apply(this, args);
        if (!fileData) return null;

        // Obfuscate the image data
        const obfuscatedData = scrambleBuffer(new Uint8Array(fileData), vstorage.secret);
        
        // Convert to ArrayBuffer for Discord
        const obfuscatedArrayBuffer = new TextEncoder().encode(obfuscatedData).buffer;

        // Update file metadata
        file.filename = ATTACHMENT_FILENAME;
        file.contentType = "text/plain";

        showToast("🔒 Image obfuscated");

        return obfuscatedArrayBuffer;

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

  // PATCH 2: Handle incoming obfuscated attachments
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const message = args[0];
          if (!message?.attachments?.length) return;

          let hasObfuscatedAttachments = false;

          message.attachments.forEach((attachment: any) => {
            if (attachment.filename === ATTACHMENT_FILENAME) {
              hasObfuscatedAttachments = true;
              (attachment as any).__isObfuscated = true;
            }
          });

          // Add marker to content if we have obfuscated attachments
          if (hasObfuscatedAttachments && message.content && !message.content.includes(INVISIBLE_MARKER)) {
            message.content = INVISIBLE_MARKER + message.content;
          }

        } catch (e) {
          console.error("[ObfuscationPlugin] Error processing incoming attachments:", e);
        }
      })
    );
  }

  // PATCH 3: Decode obfuscated attachments when they're accessed
  const URLHandlers = findByProps("handleOpenURL");
  if (URLHandlers?.handleOpenURL) {
    patches.push(
      before("handleOpenURL", URLHandlers, async (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const url = args[0];
          if (!url) return;

          // Check if this is an obfuscated attachment URL
          const isObfuscatedAttachment = await isURLObfuscated(url);
          if (!isObfuscatedAttachment) return;

          console.log("[ObfuscationPlugin] Decoding obfuscated attachment:", url);

          // Fetch and decode the obfuscated data
          const response = await fetch(url);
          const obfuscatedText = await response.text();
          
          const decodedData = unscrambleBuffer(obfuscatedText, vstorage.secret);
          
          // Create a blob URL for the decoded image
          const blob = new Blob([decodedData], { type: "image/jpeg" });
          const blobUrl = URL.createObjectURL(blob);

          // Replace the URL with the decoded one
          args[0] = blobUrl;

          showToast("🔓 Image decoded");

        } catch (e) {
          console.error("[ObfuscationPlugin] Error decoding attachment:", e);
          showToast("❌ Failed to decode image");
        }
      })
    );
  }

  console.log(`[ObfuscationPlugin] Applied ${patches.length} attachment patches`);

  return () => {
    console.log("[ObfuscationPlugin] Removing attachment patches...");
    patches.forEach(unpatch => unpatch());
  };
}

// Helper function to check if a URL points to an obfuscated attachment
async function isURLObfuscated(url: string): Promise<boolean> {
  try {
    // Check if this is from a message with obfuscated attachments
    // This would need to be integrated with your message store
    // For now, we'll check the filename in the URL
    return url.includes(ATTACHMENT_FILENAME);
  } catch {
    return false;
  }
}