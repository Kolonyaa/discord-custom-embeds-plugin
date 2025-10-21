// attachmentPatcher.ts
import { before } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { ReactNative, FluxDispatcher } from "@vendetta/metro/common";
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

  function detectImageMime(bytes: Uint8Array): string {
  if (!bytes || bytes.length < 12) return "application/octet-stream";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return "image/png";
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return "image/jpeg";
  // GIF: 47 49 46 38  (GIF8)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  // WEBP: 'RIFF' .... 'WEBP'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  // otherwise unknown
  return "application/octet-stream";
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    default: return "bin";
  }
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

        // mark obfuscated attachments and kick off async decode+replace
        message.attachments.forEach((attachment: any) => {
          if (attachment.filename === ATTACHMENT_FILENAME) {
            hasObfuscatedAttachments = true;
            (attachment as any).__isObfuscated = true;
          }
        });

        // add invisible marker as before so message text handling still works
        if (hasObfuscatedAttachments && message.content && !message.content.includes(INVISIBLE_MARKER)) {
          message.content = INVISIBLE_MARKER + message.content;
        }

        // Async: fetch and decode attachments, then patch message attachments in-place
        (async () => {
          try {
            const changed = [];

            for (const attachment of message.attachments) {
              if (!(attachment as any).__isObfuscated) continue;

              try {
                console.log("[ObfuscationPlugin] Fetching obfuscated attachment:", attachment.url);

                // fetch as text because upload used Braille text encoding
                const res = await fetch(attachment.url);
                if (!res.ok) {
                  console.warn("[ObfuscationPlugin] Failed to fetch attachment:", res.status);
                  continue;
                }
                const obfText = await res.text();

                // decode to bytes
                const decodedBytes = unscrambleBuffer(obfText, vstorage.secret);
                if (!decodedBytes || decodedBytes.length === 0) {
                  console.warn("[ObfuscationPlugin] Decoded bytes empty");
                  continue;
                }

                // try to detect mime & extension from magic bytes
                const mime = detectImageMime(decodedBytes);
                const ext = mimeToExt(mime);

                // build blob and blob url
                const blob = new Blob([new Uint8Array(decodedBytes)], { type: mime });
                const blobUrl = URL.createObjectURL(blob);

                // replace attachment metadata so UI treats as image
                attachment.url = blobUrl;
                attachment.contentType = mime;
                // give it a friendly filename so some renderers infer type
                attachment.filename = `obfuscated_attachment.${ext}`;

                // store a flag so we don't try to re-decode
                (attachment as any).__decoded = true;

                changed.push(attachment);
                console.log("[ObfuscationPlugin] Decoded attachment -> blobUrl", attachment.filename);
              } catch (err) {
                console.error("[ObfuscationPlugin] Error decoding single attachment:", err);
              }
            }

            // if we changed attachments, trigger a MESSAGE_UPDATE so UI refreshes
            if (changed.length) {
              try {
                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: { ...message },
                });
              } catch (e) {
                console.warn("[ObfuscationPlugin] Failed to dispatch MESSAGE_UPDATE:", e);
              }
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Async decode loop failed:", e);
          }
        })();

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