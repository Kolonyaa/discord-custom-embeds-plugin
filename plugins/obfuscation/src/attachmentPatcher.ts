// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
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

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;
  const RowManager = findByName("RowManager");
  const MessageActions = findByProps("sendMessage", "receiveMessage");
  const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
  const ChannelStore = findByProps("getChannelId");
  const MessageSender = findByProps("sendMessage");
  const PendingMessages = findByProps("getPendingMessages", "deletePendingMessage");

  // Helper function to cleanup pending messages
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

  // Store for text file content
  const pendingTextFiles = new Map();

  // FIRST: Intercept file uploads using CloudUpload
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

        // Get channel ID
        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          console.error("[ObfuscationPlugin] Litterbox upload returned null");
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

        // Obfuscate the URL
        const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        
        // Store the text content for the next upload
        const uploadId = `${channelId}-${Date.now()}`;
        pendingTextFiles.set(uploadId, obfuscatedUrl);

        // Create a text file using the original upload mechanism but with text content
        // We'll create a fake file object that represents our text file
        const textFile = {
          ...file, // Copy original file properties
          filename: ATTACHMENT_FILENAME,
          type: 'text/plain',
          // Override the file data with our text content
          item: {
            ...file.item,
            // We need to create a text file that can be uploaded
            // This is a hack - we create a text file URI
            originalUri: `data:text/plain;base64,${btoa(obfuscatedUrl)}`,
          }
        };

        // Cancel the original image upload
        if (typeof this.setStatus === "function") this.setStatus("CANCELED");
        
        // Clean up pending messages
        if (channelId) setTimeout(() => cleanup(channelId), 500);

        // Use the original upload mechanism to upload the text file
        const textFileUpload = new CloudUpload(textFile);
        const textFileData = await originalUpload.call(textFileUpload, ...args);

        if (textFileData) {
          showToast("🔒 Image obfuscated and sent");
        } else {
          showToast("❌ Failed to upload obfuscated file");
        }

        // Clean up
        pendingTextFiles.delete(uploadId);
        return null;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in upload process:", e);
        showToast("❌ Failed to obfuscate image");
        return null;
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // Alternative approach: Patch the message sender to handle text file creation
  if (MessageSender?.sendMessage) {
    patches.push(
      before("sendMessage", MessageSender, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const [channelId, message] = args;
          const attachments = message?.attachments;

          if (!attachments || !attachments.length) return;

          // Check if any attachment is an image that needs obfuscation
          let hasImageToObfuscate = false;
          attachments.forEach((att: any) => {
            const filename = att.filename ?? "";
            const isImage = att.type?.startsWith("image/") || 
                           /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
            if (isImage) hasImageToObfuscate = true;
          });

          if (!hasImageToObfuscate) return;

          // Cancel this message and handle obfuscation
          console.log("[ObfuscationPlugin] Intercepting image upload");
          
          // We'll handle the upload in a different way
          // For now, just block the original message
          args[1] = { ...message, content: "🔄 Obfuscating image..." };
          
        } catch (e) {
          console.error("[ObfuscationPlugin] Error in message sender:", e);
        }
      })
    );
  }

  // SECOND: Handle incoming obfuscated attachments
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const message = args[0];
          if (!message?.attachments?.length) return;

          let hasObfuscatedAttachments = false;

          message.attachments.forEach((attachment: any) => {
            if (attachment.filename === ATTACHMENT_FILENAME || attachment.filename?.endsWith('.txt')) {
              hasObfuscatedAttachments = true;
              (attachment as any).__isObfuscated = true;
            }
          });

          if (hasObfuscatedAttachments && message.content && !message.content.includes(INVISIBLE_MARKER)) {
            message.content = INVISIBLE_MARKER + message.content;
          }

        } catch (e) {
          console.error("[ObfuscationPlugin] Error processing incoming attachments:", e);
        }
      })
    );
  }

  // THIRD: Render obfuscated attachments with the actual Litterbox image
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        try {
          const { message } = row;
          if (!message?.attachments?.length) return;

          const normalAttachments: any[] = [];
          let hasObfuscatedAttachments = false;

          message.attachments.forEach((att) => {
            if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith('.txt')) {
              hasObfuscatedAttachments = true;
            } else {
              normalAttachments.push(att);
            }
          });

          if (hasObfuscatedAttachments && !(message as any).__obfuscationProcessed) {
            (message as any).__obfuscationProcessed = true;
            
            message.attachments.forEach(async (att) => {
              if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith('.txt')) {
                try {
                  const response = await fetch(att.url);
                  const obfuscatedText = await response.text();
                  
                  const litterboxUrl = new TextDecoder().decode(
                    unscrambleBuffer(obfuscatedText, vstorage.secret)
                  );

                  console.log("[ObfuscationPlugin] Decoded Litterbox URL:", litterboxUrl);

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

                    if (!message.embeds) message.embeds = [];
                    message.embeds.push(embed);
                    message.attachments = normalAttachments;
                    
                    if (row.forceUpdate) row.forceUpdate();
                  }
                  
                } catch (error) {
                  console.error("[ObfuscationPlugin] Error decoding attachment:", error);
                  
                  const placeholderUrl = "https://i.imgur.com/7dZrkGD.png";
                  if (Embed && EmbedMedia) {
                    const imageMedia = new EmbedMedia({
                      url: placeholderUrl,
                      proxyURL: placeholderUrl,
                      width: 200,
                      height: 200,
                      srcIsAnimated: false
                    });

                    const embed = new Embed({
                      type: "image",
                      url: placeholderUrl,
                      image: imageMedia,
                      thumbnail: imageMedia,
                      description: "❌ Failed to decode image",
                      color: 0xff0000,
                      bodyTextColor: 0xffffff
                    });

                    if (!message.embeds) message.embeds = [];
                    message.embeds.push(embed);
                    message.attachments = normalAttachments;
                    if (row.forceUpdate) row.forceUpdate();
                  }
                }
              }
            });
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] Error in row generation:", e);
        }
      })
    );
  }

  return () => {
    patches.forEach((unpatch) => unpatch());
    pendingTextFiles.clear();
  };
}