// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

// Cache for decoded images
const imageCache = new Map<string, { dataUrl: string; width: number; height: number; mimeType: string }>();

// Detect image type from Uint8Array
function detectImageType(data: Uint8Array): string | null {
  if (data.length < 4) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  return null;
}

// Convert Uint8Array to base64 data URL
function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return `data:${mimeType};base64,${base64}`;
}

// Async function to decode and cache image
async function decodeAndCacheImage(attachmentUrl: string, filename: string): Promise<void> {
  if (imageCache.has(attachmentUrl)) return;

  try {
    console.log("[ObfuscationPlugin] Starting to decode image:", attachmentUrl);
    
    const response = await fetch(attachmentUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const obfText = await response.text();
    console.log("[ObfuscationPlugin] Fetched text length:", obfText.length);
    
    if (!obfText || obfText.length === 0) {
      throw new Error("Empty text content");
    }
    
    const bytes = unscrambleBuffer(obfText, vstorage.secret);
    console.log("[ObfuscationPlugin] Decoded bytes length:", bytes.length);
    
    if (!bytes || bytes.length === 0) {
      throw new Error("No bytes after decoding");
    }
    
    const mimeType = detectImageType(bytes) || "image/png";
    console.log("[ObfuscationPlugin] Detected mime type:", mimeType);
    
    const dataUrl = bytesToDataUrl(bytes, mimeType);
    
    const imageData = { 
      dataUrl, 
      width: 300, 
      height: 300,
      mimeType
    };
    
    imageCache.set(attachmentUrl, imageData);
    console.log("[ObfuscationPlugin] Image successfully cached");
    showToast(`✅ ${filename} decoded!`);
    
  } catch (e) {
    console.error("[ObfuscationPlugin] Failed to decode image:", e);
    showToast(`❌ Failed to decode ${filename}`);
  }
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;
  const RowManager = findByName("RowManager");
  const MessageActions = findByProps("sendMessage", "receiveMessage");
  const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
  const FluxDispatcher = findByProps("dirtyDispatch", "subscribe");

  // FIRST: Intercept file uploads using CloudUpload (same pattern as file upload plugin)
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

  // SECOND: Handle incoming obfuscated attachments AND trigger decoding
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          const message = args[0];
          if (!message?.attachments?.length) return;

          let hasObfuscatedAttachments = false;

          message.attachments.forEach((attachment: any) => {
            if (attachment.filename === ATTACHMENT_FILENAME) {
              hasObfuscatedAttachments = true;
              (attachment as any).__isObfuscated = true;
              
              // Trigger background decoding for plugin users
              if (vstorage.enabled && vstorage.secret) {
                decodeAndCacheImage(attachment.url, attachment.filename);
              }
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

  // Also patch FluxDispatcher to catch messages from other sources
  if (FluxDispatcher) {
    patches.push(
      after("dispatch", FluxDispatcher, ([event]) => {
        if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
          const message = event.message;
          if (message?.attachments?.length && vstorage.enabled && vstorage.secret) {
            message.attachments.forEach(att => {
              if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
                // Start decoding in the background
                decodeAndCacheImage(att.url, att.filename);
              }
            });
          }
        }
      })
    );
  }

  // THIRD: Render obfuscated attachments with ACTUAL decoded images
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            // Get cached image data or use placeholder
            const cachedImage = imageCache.get(att.url);
            
            const imageUrl = cachedImage?.dataUrl || "https://i.imgur.com/7dZrkGD.png";
            const width = cachedImage?.width || 200;
            const height = cachedImage?.height || 200;
            
            const description = cachedImage 
              ? "Decoded obfuscated image" 
              : "Obfuscated image (decoding...)";

            console.log("[ObfuscationPlugin] Rendering:", att.filename, "cached:", !!cachedImage);
            
            if (Embed && EmbedMedia) {
              const imageMedia = new EmbedMedia({
                url: imageUrl,
                proxyURL: imageUrl,
                width: width,
                height: height,
                srcIsAnimated: false
              });

              const embed = new Embed({
                type: "image",
                url: imageUrl,
                image: imageMedia,
                thumbnail: imageMedia,
                description: description,
                color: 0x2f3136,
                bodyTextColor: 0xffffff
              });
              fakeEmbeds.push(embed);
            } else {
              const embedMediaFields = {
                url: imageUrl,
                proxyURL: imageUrl, 
                width: width,
                height: height,
                srcIsAnimated: false
              };

              fakeEmbeds.push({
                type: "image",
                url: imageUrl,
                image: embedMediaFields,
                thumbnail: embedMediaFields,
                description: description,
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

  return () => {
    patches.forEach((unpatch) => unpatch());
    imageCache.clear();
  };
}