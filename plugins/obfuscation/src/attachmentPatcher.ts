// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { React } from "@vendetta/metro/common";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";

const RowManager = findByName("RowManager");
const FluxDispatcher = findByProps("dirtyDispatch", "subscribe");

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
async function decodeAndCacheImage(attachmentUrl: string): Promise<void> {
  if (imageCache.has(attachmentUrl)) return;

  try {
    console.log("[ObfuscationPlugin] Starting to decode image:", attachmentUrl);
    
    const response = await fetch(attachmentUrl);
    const obfText = await response.text();
    console.log("[ObfuscationPlugin] Fetched text length:", obfText.length);
    
    const bytes = unscrambleBuffer(obfText, vstorage.secret);
    console.log("[ObfuscationPlugin] Decoded bytes length:", bytes.length);
    
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
    
  } catch (e) {
    console.error("[ObfuscationPlugin] Failed to decode image:", e);
  }
}

// Function to get cached image data
function getCachedImageData(attachmentUrl: string): { dataUrl: string; width: number; height: number } | null {
  return imageCache.get(attachmentUrl) || null;
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

  // Patch dispatcher to pre-decode images when messages arrive
  if (FluxDispatcher) {
    patches.push(
      after("dispatch", FluxDispatcher, ([event]) => {
        if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
          const message = event.message;
          if (message?.attachments?.length) {
            message.attachments.forEach(att => {
              if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
                // Start decoding in the background
                decodeAndCacheImage(att.url);
              }
            });
          }
        }
        
        if (event.type === "LOAD_MESSAGES_SUCCESS") {
          event.messages?.forEach((message: any) => {
            if (message?.attachments?.length) {
              message.attachments.forEach(att => {
                if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
                  // Start decoding in the background
                  decodeAndCacheImage(att.url);
                }
              });
            }
          });
        }
      })
    );
  }

  // Main patch for rendering - this stays synchronous but uses cached data
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
            const cachedImage = getCachedImageData(att.url);
            
            const imageUrl = cachedImage?.dataUrl || "https://i.imgur.com/7dZrkGD.png";
            const width = cachedImage?.width || 200;
            const height = cachedImage?.height || 200;
            
            const description = cachedImage 
              ? "Decoded obfuscated image" 
              : "Decoding image... (click to reload)";

            console.log("[ObfuscationPlugin] Rendering embed for:", att.filename, "cached:", !!cachedImage);
            
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