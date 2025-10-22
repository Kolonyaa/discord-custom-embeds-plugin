// attachmentPatcher.tsx
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { before, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const ChannelStore = findByProps("getChannelId");

// Safely get EmojiStore (optional)
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Invisible marker sequence (not shown on non-plugin clients)
const INVISIBLE_MARKER = "\u200b\u200d\u200b"; // zero-width space + joiner + space
const IMAGE_MARKER = "OBFUSCATED_IMAGE:";

// Helper functions
function hasObfuscationMarker(content: string): boolean {
  return content?.includes(INVISIBLE_MARKER);
}

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

  // Track pending image uploads
  const pendingImageUploads = new Map();

  // PATCH 1: Intercept image uploads and upload to Litterbox
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

        // Get channel ID to track which message this belongs to
        const channelId = file?.channelId ?? ChannelStore?.getChannelId?.();

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          console.error("[ObfuscationPlugin] Litterbox upload failed");
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

        // Store the Litterbox URL for the pending message
        if (channelId) {
          pendingImageUploads.set(channelId, litterboxUrl);
        }

        // Cancel the original file upload since we'll handle it in the message
        if (typeof this.setStatus === "function") this.setStatus("CANCELED");
        showToast("🔒 Image ready for obfuscation");
        return null;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in image upload:", e);
        showToast("❌ Failed to upload image");
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // PATCH 2: Outgoing messages - add Litterbox URL to content
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const channelId = args[0];
        const msg = args[1];
        const content = msg?.content;

        if (!vstorage.enabled) return;
        if (!vstorage.secret) return;

        // Check if we have a pending image upload for this channel
        const litterboxUrl = pendingImageUploads.get(channelId);
        
        if (litterboxUrl) {
          console.log("[ObfuscationPlugin] Adding Litterbox URL to message:", litterboxUrl);
          
          // Obfuscate the Litterbox URL
          const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
          const imageMarker = `${IMAGE_MARKER}${obfuscatedUrl}`;
          
          // Add to message content
          const newContent = content ? 
            `${content}\n${INVISIBLE_MARKER}${imageMarker}` : 
            `${INVISIBLE_MARKER}${imageMarker}`;
          
          msg.content = newContent;
          
          // Remove the pending upload
          pendingImageUploads.delete(channelId);
          
          console.log("[ObfuscationPlugin] Message content updated with obfuscated image URL");
        } else if (content && !hasObfuscationMarker(content)) {
          // Original text obfuscation logic
          console.log("[ObfuscationPlugin] Sending message:", content);

          const scrambled = scramble(content, vstorage.secret);
          console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

          msg.content = `${INVISIBLE_MARKER}${scrambled}`;
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 3: Incoming message decoding (for plugin users)
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.content) return;

        const content = message.content;
        if (!hasObfuscationMarker(content)) return;

        const encryptedBody = content.replace(INVISIBLE_MARKER, "").trim();
        if (!vstorage.secret || !encryptedBody) return;

        // Check if it's an image marker
        if (encryptedBody.startsWith(IMAGE_MARKER)) {
          // It's an obfuscated image URL
          const obfuscatedUrl = encryptedBody.replace(IMAGE_MARKER, "");
          const litterboxUrl = unscramble(obfuscatedUrl, vstorage.secret);
          
          console.log("[ObfuscationPlugin] Decoded image URL:", litterboxUrl);

          // Create image embed
          const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
          const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

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
            
            // Clear the content since we're showing the image embed
            message.content = "";
          }
        } else {
          // Original text decoding logic
          const decoded = unscramble(encryptedBody, vstorage.secret);
          console.log("[ObfuscationPlugin] Decoded:", decoded);

          // Insert the emoji locally before the message for plugin users
          const INDICATOR_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
          const wrappedEmojiUrl = `<${INDICATOR_EMOJI_URL}>`;

          data.message.content = `${wrappedEmojiUrl}${decoded}`;
        }
      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 4: Emoji rendering (for plugin users) - keep your existing code
  if (getCustomEmojiById) {
    patches.push(
      after("generate", RowManager.prototype, ([data], row) => {
        try {
          if (data.rowType !== 1) return;
          const message = row?.message;
          if (!message || !message.content) return;

          if (Array.isArray(message.content)) {
            for (let i = 0; i < message.content.length; i++) {
              const el = message.content[i];
              if (el && el.type === "link" && el.target) {
                const match = el.target.match(/https:\/\/cdn\.discordapp\.com\/emojis\/(\d+)\.\w+/);
                if (!match) continue;

                const url = `${match[0]}?size=128`;

                let emojiName = "<indicator>";
                try {
                  const emoji = getCustomEmojiById(match[1]);
                  if (emoji && emoji.name) emojiName = emoji.name;
                } catch (e) {
                  console.warn("[ObfuscationPlugin] Failed to get emoji info:", e);
                }

                message.content[i] = {
                  type: "customEmoji",
                  id: match[1],
                  alt: emojiName,
                  src: url,
                  frozenSrc: url.replace("gif", "webp"),
                  jumboable: false,
                };
              }
            }
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] Emoji rendering error:", e);
        }
      })
    );
  }

  // PATCH 5: Reprocess already existing messages
  const reprocessExistingMessages = () => {
    try {
      console.log("[ObfuscationPlugin] Reprocessing messages...");

      setTimeout(() => {
        try {
          const channels = MessageStore.getMutableMessages?.() ?? {};

          Object.entries(channels).forEach(([channelId, messages]: [string, any]) => {
            if (!messages) return;

            Object.values(messages).forEach((msg: any) => {
              if (msg && hasObfuscationMarker(msg.content)) {
                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: { ...msg },
                });
              }
            });
          });
        } catch (e) {
          console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
        }
      }, 1000);
    } catch (e) {
      console.error("[ObfuscationPlugin] Reprocess failed:", e);
    }
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    console.log("[ObfuscationPlugin] Removing patches...");
    patches.forEach(unpatch => unpatch());
    pendingImageUploads.clear();
  };
}