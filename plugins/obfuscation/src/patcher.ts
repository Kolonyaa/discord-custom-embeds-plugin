// attachmentPatcher.tsx
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const CloudUpload = findByProps("CloudUpload")?.CloudUpload;

// Invisible marker sequence
const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const IMAGE_MARKER = "OBFUSCATED_IMAGE:";

// Helper functions
function hasObfuscationMarker(content: string): boolean {
  return content?.includes(INVISIBLE_MARKER);
}

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

export function applyPatches() {
  const patches = [];

  // Track image uploads by filename
  const imageUploads = new Map();

  // PATCH 1: Intercept image uploads and store Litterbox URLs
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

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          console.error("[ObfuscationPlugin] Litterbox upload failed");
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

        // Store the Litterbox URL by filename
        imageUploads.set(filename, litterboxUrl);
        showToast("🔒 Image URL stored");

        // Let the original upload continue - DON'T CANCEL
        return originalUpload.apply(this, args);

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in image upload:", e);
        showToast("❌ Failed to upload image");
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // PATCH 2: Outgoing messages - add Litterbox URL to content if we have image uploads
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;
        const attachments = msg?.attachments;

        if (!vstorage.enabled) return;
        if (!vstorage.secret) return;
        if (hasObfuscationMarker(content)) return;

        // Check if we have any image uploads for this message
        let hasImageUrls = false;
        let imageUrlsContent = "";

        if (attachments && Array.isArray(attachments)) {
          attachments.forEach((att: any) => {
            const filename = att.filename;
            if (filename && imageUploads.has(filename)) {
              const litterboxUrl = imageUploads.get(filename);
              const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
              imageUrlsContent += `\n${IMAGE_MARKER}${obfuscatedUrl}`;
              hasImageUrls = true;
              
              // Remove from map after using
              imageUploads.delete(filename);
            }
          });
        }

        if (hasImageUrls) {
          console.log("[ObfuscationPlugin] Adding image URLs to message content");
          
          if (content) {
            // Add image URLs to existing content
            msg.content = `${content}${INVISIBLE_MARKER}${imageUrlsContent}`;
          } else {
            // Message only has images, no text
            msg.content = `${INVISIBLE_MARKER}${imageUrlsContent}`;
          }
        } else if (content) {
          // Original text obfuscation logic
          console.log("[ObfuscationPlugin] Sending message:", content);

          const scrambled = scramble(content, vstorage.secret);
          console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

          msg.content = `${INVISIBLE_MARKER}${scrambled}`;
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 3: Incoming message decoding
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.content) return;

        const content = message.content;
        if (!hasObfuscationMarker(content)) return;

        const parts = content.split(INVISIBLE_MARKER);
        const visibleContent = parts[0]?.trim() || "";
        const obfuscatedContent = parts[1]?.trim() || "";

        if (!vstorage.secret || !obfuscatedContent) return;

        let finalContent = visibleContent;
        const embeds = [];

        // Process image markers
        const imageMatches = obfuscatedContent.split(IMAGE_MARKER).filter(Boolean);
        
        for (const match of imageMatches) {
          try {
            const litterboxUrl = unscramble(match, vstorage.secret);
            
            if (litterboxUrl.startsWith("https://")) {
              console.log("[ObfuscationPlugin] Decoded image URL:", litterboxUrl);

              // Create image embed
              const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
              const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

              if (Embed && EmbedMedia) {
                const imageMedia = new EmbedMedia({
                  url: litterboxUrl,
                  proxyURL: litterboxUrl,
                  width: 400,
                  height: 400,
                  srcIsAnimated: false
                });

                const embed = new Embed({
                  type: "image",
                  url: litterboxUrl,
                  image: imageMedia,
                  thumbnail: imageMedia,
                  description: "🔒 Obfuscated Image",
                  color: 0x2f3136,
                  bodyTextColor: 0xffffff
                });

                embeds.push(embed);
              }
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Error decoding image URL:", e);
          }
        }

        // Add embeds to message
        if (embeds.length > 0) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...embeds);
        }

        // Set the final content (only the visible part)
        if (finalContent) {
          data.message.content = finalContent;
        } else if (embeds.length > 0) {
          // If no text content but we have images, clear the content
          data.message.content = "";
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 4: Reprocess existing messages
  const reprocessExistingMessages = () => {
    try {
      console.log("[ObfuscationPlugin] Reprocessing messages...");

      setTimeout(() => {
        try {
          const channels = MessageStore.getMutableMessages?.() ?? {};

          Object.entries(channels).forEach(([channelId, messages]: [string, any]) => {
            if (!messages) return;

            Object.values(messages).forEach((msg: any) => {
              if (msg && hasObfuscationMarker(msg.content)) {
                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: { ...msg },
                });
              }
            });
          });
        } catch (e) {
          console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
        }
      }, 1000);
    } catch (e) {
      console.error("[ObfuscationPlugin] Reprocess failed:", e);
    }
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
    imageUploads.clear();
  };
}