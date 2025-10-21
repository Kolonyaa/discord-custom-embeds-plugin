// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts"; // might remove eventually
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;
  const RowManager = findByName("RowManager");
  const CloudUpload = findByName("CloudUpload")?.CloudUpload;;




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




  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        // We'll process attachments and create embeds
        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            // For now, use placeholder - we'll enhance this to use real data
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
                description: "Obfuscated image (click to decode)",
                color: 0x2f3136,
                bodyTextColor: 0xffffff
              });
              fakeEmbeds.push(embed);
            } else {
              const embedMediaFields = {
                url: placeholderUrl,
                proxyURL: placeholderUrl, 
                width: 200,
                height: 200,
                srcIsAnimated: false
              };

              fakeEmbeds.push({
                type: "image",
                url: placeholderUrl,
                image: embedMediaFields,
                thumbnail: embedMediaFields,
                description: "Obfuscated image (click to decode)",
                color: 0x2f3136,
                bodyTextColor: 0xffffff
              });
            }
          } else {
            normalAttachments.push(att);
          }
        });

        if (fakeEmbeds.length) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...fakeEmbeds);
          message.attachments = normalAttachments;
        }
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}