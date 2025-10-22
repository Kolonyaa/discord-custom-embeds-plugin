// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const OBFUSCATED_URL_PREFIX = "OBFUSCATED_URL:";

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

  // FIRST: Intercept file uploads and replace with obfuscated URL in content
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

        // Obfuscate the URL and create the marker
        const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        const urlMarker = `${OBFUSCATED_URL_PREFIX}${obfuscatedUrl}`;

        // Cancel the original upload
        if (typeof this.setStatus === "function") this.setStatus("CANCELED");
        
        // Clean up pending messages
        if (channelId) setTimeout(() => cleanup(channelId), 500);

        // Send a message with the obfuscated URL in content
        if (channelId && MessageSender?.sendMessage) {
          // Get the original message content if any
          const pendingMessages = PendingMessages?.getPendingMessages?.(channelId);
          let originalContent = "";
          
          if (pendingMessages) {
            // Find the pending message that matches this upload
            for (const [_, pendingMsg] of Object.entries(pendingMessages)) {
              if (pendingMsg.attachments && pendingMsg.attachments.length > 0) {
                originalContent = pendingMsg.content || "";
                break;
              }
            }
          }

          // Combine original content with our obfuscated URL
          const newContent = originalContent ? 
            `${originalContent}\n${urlMarker}` : 
            urlMarker;

          await MessageSender.sendMessage(channelId, { 
            content: newContent 
          });
          
          showToast("🔒 Image obfuscated and sent");
        } else {
          showToast("❌ Failed to send obfuscated image");
        }

        return null;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in upload process:", e);
        showToast("❌ Failed to obfuscate image");
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // SECOND: Scan incoming messages for obfuscated URLs and create image embeds
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const message = args[0];
          if (!message?.content) return;

          // Check if message contains obfuscated URL
          const urlMatch = message.content.match(new RegExp(`${OBFUSCATED_URL_PREFIX}([^\\s]+)`));
          if (!urlMatch) return;

          const obfuscatedUrl = urlMatch[1];
          
          try {
            // Deobfuscate the URL
            const litterboxUrl = new TextDecoder().decode(
              unscrambleBuffer(obfuscatedUrl, vstorage.secret)
            );

            console.log("[ObfuscationPlugin] Decoded Litterbox URL:", litterboxUrl);

            // Create image embed
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

              // Initialize embeds array if needed
              if (!message.embeds) message.embeds = [];
              
              // Add our embed
              message.embeds.push(embed);
              
              // Remove the obfuscated URL from content and add invisible marker
              message.content = message.content.replace(urlMatch[0], "");
              if (!message.content.includes(INVISIBLE_MARKER)) {
                message.content = INVISIBLE_MARKER + message.content;
              }
            }

          } catch (decodeError) {
            console.error("[ObfuscationPlugin] Error decoding URL:", decodeError);
          }

        } catch (e) {
          console.error("[ObfuscationPlugin] Error processing incoming message:", e);
        }
      })
    );
  }

  // THIRD: Also patch row generation to handle any missed messages
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        try {
          const { message } = row;
          if (!message?.content || (message as any).__obfuscationProcessed) return;

          // Check if message contains obfuscated URL but wasn't processed yet
          const urlMatch = message.content.match(new RegExp(`${OBFUSCATED_URL_PREFIX}([^\\s]+)`));
          if (!urlMatch) return;

          (message as any).__obfuscationProcessed = true;

          try {
            const obfuscatedUrl = urlMatch[1];
            const litterboxUrl = new TextDecoder().decode(
              unscrambleBuffer(obfuscatedUrl, vstorage.secret)
            );

            console.log("[ObfuscationPlugin] Late-decoded Litterbox URL:", litterboxUrl);

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
              
              // Clean up the content
              message.content = message.content.replace(urlMatch[0], "");
              if (!message.content.includes(INVISIBLE_MARKER)) {
                message.content = INVISIBLE_MARKER + message.content;
              }
              
              // Force re-render
              if (row.forceUpdate) row.forceUpdate();
            }
            
          } catch (decodeError) {
            console.error("[ObfuscationPlugin] Error in row generation decode:", decodeError);
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