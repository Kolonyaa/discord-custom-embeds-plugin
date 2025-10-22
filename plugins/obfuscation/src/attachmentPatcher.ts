// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

// Litterbox upload function (adapted from the plugin)
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

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL:", litterboxUrl);

        // Obfuscate the URL
        const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        
        // Convert to ArrayBuffer for Discord
        const obfuscatedArrayBuffer = new TextEncoder().encode(obfuscatedUrl).buffer;

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

  // THIRD: Render obfuscated attachments with the actual Litterbox image
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        try {
          const { message } = row;
          if (!message?.attachments?.length) return;

          const normalAttachments: any[] = [];
          const fakeEmbeds: any[] = [];

          // Process attachments and create embeds for obfuscated ones
          message.attachments.forEach((att) => {
            if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
              // This is an obfuscated attachment - we need to fetch and decode it
              const fetchAndDecodeAttachment = async () => {
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
                      width: att.width || 200,
                      height: att.height || 200,
                      srcIsAnimated: false
                    });

                    const embed = new Embed({
                      type: "image",
                      url: litterboxUrl,
                      image: imageMedia,
                      thumbnail: imageMedia,
                      description: "Obfuscated image",
                      color: 0x2f3136,
                      bodyTextColor: 0xffffff
                    });
                    fakeEmbeds.push(embed);
                  } else {
                    // Fallback if Embed/EmbedMedia not available
                    const embedMediaFields = {
                      url: litterboxUrl,
                      proxyURL: litterboxUrl, 
                      width: att.width || 200,
                      height: att.height || 200,
                      srcIsAnimated: false
                    };

                    fakeEmbeds.push({
                      type: "image",
                      url: litterboxUrl,
                      image: embedMediaFields,
                      thumbnail: embedMediaFields,
                      description: "Obfuscated image",
                      color: 0x2f3136,
                      bodyTextColor: 0xffffff
                    });
                  }

                  // Update the row to trigger re-render
                  if (row.forceUpdate) row.forceUpdate();
                  
                } catch (error) {
                  console.error("[ObfuscationPlugin] Error decoding attachment:", error);
                  
                  // Fallback to placeholder if decoding fails
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
                      description: "Obfuscated image (failed to decode)",
                      color: 0xff0000,
                      bodyTextColor: 0xffffff
                    });
                    fakeEmbeds.push(embed);
                  }
                }
              };

              // Start the async decoding process
              fetchAndDecodeAttachment();
            } else {
              normalAttachments.push(att);
            }
          });

          // If we have fake embeds (obfuscated attachments), update the message
          if (fakeEmbeds.length) {
            if (!message.embeds) message.embeds = [];
            
            // Remove any existing obfuscated embeds to avoid duplicates
            message.embeds = message.embeds.filter((embed: any) => 
              !embed.description?.includes("Obfuscated image")
            );
            
            message.embeds.push(...fakeEmbeds);
            message.attachments = normalAttachments;
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] Error in row generation:", e);
        }
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}