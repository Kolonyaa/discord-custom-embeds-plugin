// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

// Litterbox upload function (exact copy from the plugin)
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

  // Helper function to cleanup pending messages (from plugin)
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

        // Get channel ID for cleanup
        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL:", litterboxUrl);

        // Obfuscate the URL - make sure scrambleBuffer returns a string
        const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        
        // Create a blob for the text file
        const blob = new Blob([obfuscatedUrl], { type: 'text/plain' });
        
        // Create a file object that Discord can handle
        // We need to create a proper file reference that the upload system understands
        const fileReader = new FileReader();
        
        return new Promise((resolve) => {
          fileReader.onload = async () => {
            try {
              // Cancel the original image upload
              if (typeof this.setStatus === "function") this.setStatus("CANCELED");
              
              // Clean up any pending messages
              if (channelId) setTimeout(() => cleanup(channelId), 500);

              // Send the text file as a separate message
              if (channelId && MessageSender?.sendMessage) {
                // Convert blob to a format Discord understands
                const textFile = {
                  uri: URL.createObjectURL(blob),
                  name: ATTACHMENT_FILENAME,
                  type: 'text/plain'
                };

                await MessageSender.sendMessage(channelId, {
                  content: "",
                  attachments: [textFile]
                });
                
                showToast("🔒 Image obfuscated and sent");
              } else {
                showToast("❌ Failed to send obfuscated file");
              }

              resolve(null);
            } catch (sendError) {
              console.error("[ObfuscationPlugin] Error sending text file:", sendError);
              showToast("❌ Failed to send obfuscated file");
              resolve(null);
            }
          };
          
          fileReader.readAsArrayBuffer(blob);
        });

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

  // THIRD: Render obfuscated attachments with the actual Litterbox image
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        try {
          const { message } = row;
          if (!message?.attachments?.length) return;

          const normalAttachments: any[] = [];
          let hasObfuscatedAttachments = false;

          // First pass: identify obfuscated attachments
          message.attachments.forEach((att) => {
            if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith('.txt')) {
              hasObfuscatedAttachments = true;
            } else {
              normalAttachments.push(att);
            }
          });

          // If we have obfuscated attachments, process them
          if (hasObfuscatedAttachments && !(message as any).__obfuscationProcessed) {
            (message as any).__obfuscationProcessed = true;
            
            message.attachments.forEach(async (att) => {
              if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith('.txt')) {
                try {
                  // Fetch the attachment content
                  const response = await fetch(att.url);
                  const obfuscatedText = await response.text();
                  
                  // Deobfuscate to get the Litterbox URL
                  const litterboxUrl = new TextDecoder().decode(
                    unscrambleBuffer(obfuscatedText, vstorage.secret)
                  );

                  console.log("[ObfuscationPlugin] Decoded Litterbox URL:", litterboxUrl);

                  // Create embed with the actual Litterbox image
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
                    
                    // Update attachments to remove the text file
                    message.attachments = normalAttachments;
                    
                    // Force re-render
                    if (row.forceUpdate) row.forceUpdate();
                  }
                  
                } catch (error) {
                  console.error("[ObfuscationPlugin] Error decoding attachment:", error);
                  
                  // Fallback placeholder
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
  };
}