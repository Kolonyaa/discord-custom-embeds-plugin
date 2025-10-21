// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { React, ReactNative } from "@vendetta/metro/common";

const { View, Image, ActivityIndicator, Text } = ReactNative;

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const RowManager = findByName("RowManager");
const FluxDispatcher = findByProps("dirtyDispatch", "subscribe");

// Cache for decoded images
const imageCache = new Map<string, { dataUrl: string; width: number; height: number }>();

// Track which messages we're currently processing
const processingMessages = new Set<string>();

async function decodeAndCacheImage(attachmentUrl: string, messageId: string): Promise<void> {
  if (imageCache.has(attachmentUrl)) return;

  try {
    console.log("[ObfuscationPlugin] Decoding image:", attachmentUrl);
    
    const response = await fetch(attachmentUrl);
    const obfText = await response.text();
    const bytes = unscrambleBuffer(obfText, vstorage.secret);
    
    // Detect image type
    let mimeType = "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mimeType = "image/jpeg";
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) mimeType = "image/png";
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) mimeType = "image/gif";
    
    // Convert to data URL
    const base64 = btoa(String.fromCharCode(...bytes));
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    imageCache.set(attachmentUrl, { 
      dataUrl, 
      width: 300, 
      height: 300 
    });
    
    console.log("[ObfuscationPlugin] Image decoded successfully");
    
    // Force a re-render of the message now that we have the real image
    processingMessages.delete(messageId);
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: { id: messageId }
    });
    
  } catch (e) {
    console.error("[ObfuscationPlugin] Failed to decode image:", e);
    processingMessages.delete(messageId);
  }
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

  // Patch message creation to start async decoding
  patches.push(
    after("dispatch", FluxDispatcher, ([event]) => {
      if (event.type === "MESSAGE_CREATE" || event.type === "MESSAGE_UPDATE") {
        const message = event.message;
        if (message?.attachments?.length && message.id) {
          message.attachments.forEach(att => {
            if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
              if (!imageCache.has(att.url) && !processingMessages.has(message.id)) {
                processingMessages.add(message.id);
                // Start async decoding
                decodeAndCacheImage(att.url, message.id);
              }
            }
          });
        }
      }
    })
  );

  // Main sync patch for rendering
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length || !message.id) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            // Check if we have the real image decoded
            const cachedImage = imageCache.get(att.url);
            
            const imageUrl = cachedImage?.dataUrl || "https://i.imgur.com/7dZrkGD.png";
            const description = cachedImage ? "Decoded image" : "Decoding...";
            const width = cachedImage?.width || 200;
            const height = cachedImage?.height || 200;
            
            if (Embed && EmbedMedia) {
              const imageMedia = new EmbedMedia({
                url: imageUrl,
                proxyURL: imageUrl,
                width,
                height,
                srcIsAnimated: false
              });

              const embed = new Embed({
                type: "image",
                url: imageUrl,
                image: imageMedia,
                thumbnail: imageMedia,
                description,
                color: 0x2f3136,
                bodyTextColor: 0xffffff
              });
              fakeEmbeds.push(embed);
            } else {
              const embedMediaFields = {
                url: imageUrl,
                proxyURL: imageUrl, 
                width,
                height,
                srcIsAnimated: false
              };

              fakeEmbeds.push({
                type: "image",
                url: imageUrl,
                image: embedMediaFields,
                thumbnail: embedMediaFields,
                description,
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
    processingMessages.clear();
  };
}