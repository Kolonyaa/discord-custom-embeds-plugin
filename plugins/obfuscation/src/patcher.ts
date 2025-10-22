// attachmentPatcher.tsx
import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const ChannelStore = findByStoreName("ChannelStore");

const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const IMAGE_MARKER = "OBFUSCATED_IMAGE:";

// Track pending uploads and their corresponding messages
const pendingUploads = new Map();

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

  // PATCH 1: Intercept image uploads and track them
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

        console.log("[ObfuscationPlugin] Starting image upload to Litterbox:", filename);
        
        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();
        const uploadId = `${channelId}-${Date.now()}`;

        // Store upload info
        pendingUploads.set(uploadId, {
          filename,
          channelId,
          status: 'uploading'
        });

        // Let the original upload proceed normally
        const result = await originalUpload.apply(this, args);

        // After upload completes, start Litterbox upload in background
        setTimeout(async () => {
          try {
            console.log("[ObfuscationPlugin] Uploading to Litterbox in background:", filename);
            showToast("📤 Uploading to Litterbox...");

            const litterboxUrl = await uploadToLitterbox(file, "1h");
            
            if (!litterboxUrl) {
              console.error("[ObfuscationPlugin] Litterbox upload failed");
              showToast("❌ Litterbox upload failed");
              pendingUploads.delete(uploadId);
              return;
            }

            console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

            // Update upload status
            const uploadInfo = pendingUploads.get(uploadId);
            if (uploadInfo) {
              uploadInfo.litterboxUrl = litterboxUrl;
              uploadInfo.status = 'completed';
              
              // Find the most recent message in this channel with attachments
              const messages = MessageStore.getMessages?.(channelId)?.toArray?.() || [];
              
              for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.author?.id === UserStore.getCurrentUser()?.id && 
                    msg.attachments?.length > 0 &&
                    msg.attachments.some((att: any) => att.filename === filename)) {
                  
                  // Found the message! Now edit it
                  await editMessageWithLitterboxUrl(msg, litterboxUrl, filename);
                  break;
                }
              }
            }

            pendingUploads.delete(uploadId);
            
          } catch (e) {
            console.error("[ObfuscationPlugin] Error in background Litterbox upload:", e);
            showToast("❌ Litterbox upload failed");
            pendingUploads.delete(uploadId);
          }
        }, 1000); // Wait 1 second before starting Litterbox upload

        return result;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in upload:", e);
        pendingUploads.delete(uploadId);
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // PATCH 2: Also intercept message sending to track which messages have images
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const channelId = args[0];
        const msg = args[1];
        const attachments = msg?.attachments;

        if (!vstorage.enabled || !vstorage.secret) return;
        if (!attachments?.length) return;

        // Check if any attachments are images
        const hasImages = attachments.some((att: any) => {
          const filename = att.filename ?? "";
          return att.type?.startsWith("image/") || 
                 /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
        });

        if (hasImages) {
          console.log("[ObfuscationPlugin] Message with images being sent");
          // The message will be edited later when Litterbox upload completes
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error tracking message:", e);
      }
    })
  );

  // PATCH 3: Handle incoming messages to decode obfuscated images
  patches.push(
    before("receiveMessage", Messages, (args) => {
      try {
        if (!vstorage.enabled || !vstorage.secret) return;

        const message = args[0];
        if (!message?.content) return;

        const content = message.content;
        if (!content.includes(INVISIBLE_MARKER)) return;

        // Decode obfuscated image URLs in the content
        const parts = content.split(INVISIBLE_MARKER);
        const visibleContent = parts[0]?.trim() || "";
        const obfuscatedContent = parts[1]?.trim() || "";

        if (!obfuscatedContent) return;

        const imageMatches = obfuscatedContent.split(IMAGE_MARKER).filter(Boolean);
        const embeds = [];

        for (const match of imageMatches) {
          try {
            const litterboxUrl = unscramble(match, vstorage.secret);
            
            if (litterboxUrl.startsWith("https://")) {
              console.log("[ObfuscationPlugin] Decoded image URL:", litterboxUrl);

              // Create image embed using FluxDispatcher like the translation plugin
              const embed = {
                type: "image",
                url: litterboxUrl,
                thumbnail: {
                  url: litterboxUrl,
                  proxy_url: litterboxUrl,
                  width: 400,
                  height: 400
                },
                image: {
                  url: litterboxUrl,
                  proxy_url: litterboxUrl,
                  width: 400,
                  height: 400
                },
                description: "🔒 Obfuscated Image"
              };

              embeds.push(embed);
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Error decoding image URL:", e);
          }
        }

        // Update message with embeds
        if (embeds.length > 0) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...embeds);
          
          // Keep only the visible content
          message.content = visibleContent;
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error processing incoming message:", e);
      }
    })
  );

  return () => {
    patches.forEach(unpatch => unpatch());
    pendingUploads.clear();
  };
}

// Helper function to edit message with Litterbox URL
async function editMessageWithLitterboxUrl(originalMessage: any, litterboxUrl: string, filename: string) {
  try {
    const channelId = originalMessage.channel_id;
    const messageId = originalMessage.id;
    
    console.log("[ObfuscationPlugin] Editing message with Litterbox URL:", litterboxUrl);

    // Obfuscate the URL
    const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
    const imageContent = `${IMAGE_MARKER}${obfuscatedUrl}`;

    // Get current message content
    const currentContent = originalMessage.content || "";
    
    // Create new content with obfuscated image URL
    let newContent = currentContent;
    if (currentContent) {
      newContent = `${currentContent}\n${INVISIBLE_MARKER}${imageContent}`;
    } else {
      newContent = `${INVISIBLE_MARKER}${imageContent}`;
    }

    // Use FluxDispatcher to update the message locally (like the translation plugin)
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...originalMessage,
        content: newContent,
        // Remove the original attachment since we're replacing it with Litterbox URL
        attachments: originalMessage.attachments?.filter((att: any) => att.filename !== filename) || []
      },
      log_edit: false,
      otherPluginBypass: true
    });

    // Also send the actual edit to Discord
    if (Messages.editMessage) {
      await Messages.editMessage(channelId, messageId, {
        content: newContent,
        attachments: originalMessage.attachments?.filter((att: any) => att.filename !== filename) || []
      });
    }

    showToast("🔒 Image obfuscated and message updated");

  } catch (e) {
    console.error("[ObfuscationPlugin] Error editing message:", e);
    showToast("❌ Failed to update message with obfuscated image");
  }
}

// Get UserStore for current user check
const UserStore = findByStoreName("UserStore");