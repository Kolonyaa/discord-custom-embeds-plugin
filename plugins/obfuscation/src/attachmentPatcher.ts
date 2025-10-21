// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { React, ReactNative } from "@vendetta/metro/common";

const { View, Image, ActivityIndicator, Text } = ReactNative;

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const RowManager = findByName("RowManager");
const filetypes = new Set(["txt"]);

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

// Cache for decoded images
const imageCache = new Map();

// Async function to get decoded image data URL
async function getDecodedImageData(attachmentUrl: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  if (imageCache.has(attachmentUrl)) {
    return imageCache.get(attachmentUrl);
  }

  try {
    const response = await fetch(attachmentUrl);
    const obfText = await response.text();
    const bytes = unscrambleBuffer(obfText, vstorage.secret);
    
    const mimeType = detectImageType(bytes) || "image/png";
    const dataUrl = bytesToDataUrl(bytes, mimeType);
    
    // For now, use default dimensions - you could get actual dimensions from image data
    const result = { 
      dataUrl, 
      width: 200, 
      height: 200 
    };
    
    imageCache.set(attachmentUrl, result);
    return result;
  } catch (e) {
    console.error("[ObfuscationPlugin] Failed to decode image:", e);
    return null;
  }
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

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