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
const UserStore = findByStoreName("UserStore");
const PendingMessages = findByProps("getPendingMessages", "deletePendingMessage");

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

// Track pending image uploads
const pendingImageUploads = new Map();

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

  // PATCH 1: Intercept message sending to handle images before they're uploaded
  patches.push(
    before("sendMessage", Messages, async (args) => {
      try {
        const channelId = args[0];
        const msg = args[1];
        const attachments = msg?.attachments;

        if (!vstorage.enabled || !vstorage.secret) return;
        if (!attachments?.length) return;

        // Check if any attachments are images
        const imageAttachments = attachments.filter((att: any) => {
          const filename = att.filename ?? "";
          return att.type?.startsWith("image/") || 
                 /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
        });

        if (imageAttachments.length === 0) return;

        console.log("[ObfuscationPlugin] Processing images before sending...");
        showToast("📤 Uploading images to Litterbox...");

        let hasFailedUpload = false;
        let imageContent = "";

        // Upload each image to Litterbox
        for (const att of imageAttachments) {
          try {
            const litterboxUrl = await uploadToLitterbox(att, "1h");
            
            if (litterboxUrl) {
              console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);
              const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
              imageContent += `\n${IMAGE_MARKER}${obfuscatedUrl}`;
            } else {
              console.error("[ObfuscationPlugin] Litterbox upload failed for:", att.filename);
              hasFailedUpload = true;
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Error uploading to Litterbox:", e);
            hasFailedUpload = true;
          }
        }

        if (hasFailedUpload) {
          showToast("❌ Some images failed to upload");
          // Let the message send normally with original attachments
          return;
        }

        // Remove image attachments from the message
        msg.attachments = attachments.filter((att: any) => {
          const filename = att.filename ?? "";
          return !att.type?.startsWith("image/") && 
                 !/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
        });

        // Add obfuscated image URLs to content
        const currentContent = msg.content || "";
        
        if (currentContent && !hasObfuscationMarker(currentContent)) {
          // Text content + images
          msg.content = `${currentContent}${INVISIBLE_MARKER}${imageContent}`;
        } else if (currentContent && hasObfuscationMarker(currentContent)) {
          // Already has obfuscated text, add images
          const parts = currentContent.split(INVISIBLE_MARKER);
          msg.content = `${parts[0]}${INVISIBLE_MARKER}${parts[1]}${imageContent}`;
        } else {
          // Only images, no text
          msg.content = `${INVISIBLE_MARKER}${imageContent}`;
        }

        showToast("🔒 Images obfuscated");

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
        showToast("❌ Failed to process images");
      }
    })
  );

  // PATCH 2: Outgoing text messages (your existing text obfuscation)
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;
        const attachments = msg?.attachments;

        if (!vstorage.enabled) return;
        if (!content || !vstorage.secret) return;
        if (hasObfuscationMarker(content)) return;
        
        // Skip if we have attachments (handled by previous patch)
        if (attachments?.length) return;

        console.log("[ObfuscationPlugin] Sending message:", content);

        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

        msg.content = `${INVISIBLE_MARKER}${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 3: Incoming message decoding (enhanced for images)
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.content) return;

        const content = message.content;
        if (!hasObfuscationMarker(content)) return;

        const parts = content.split(INVISIBLE_MARKER);
        const visibleContent = parts[0]?.trim() || "";
        const obfuscatedContent = parts[1]?.trim() || "";

        if (!vstorage.secret || !obfuscatedContent) return;

        let finalContent = visibleContent;
        let hasImages = false;

        // Check for image markers
        if (obfuscatedContent.includes(IMAGE_MARKER)) {
          const imageParts = obfuscatedContent.split(IMAGE_MARKER).filter(Boolean);

          for (const imagePart of imageParts) {
            try {
              const litterboxUrl = unscramble(imagePart, vstorage.secret);

              if (litterboxUrl.startsWith("https://")) {
                console.log("[ObfuscationPlugin] Decoded image URL:", litterboxUrl);
                hasImages = true;

                // Create image embed
                const embed = {
                  type: "image",
                  url: litterboxUrl,
                  thumbnail: {
                    url: litterboxUrl,
                    proxy_url: litterboxUrl,
                    width: 400,
                    height: 400,
                    srcIsAnimated: false
                  },
                  image: {
                    url: litterboxUrl,
                    proxy_url: litterboxUrl,
                    width: 400,
                    height: 400,
                    srcIsAnimated: false
                  },
                  description: "🔒 Obfuscated Image"
                };

                if (!message.embeds) message.embeds = [];
                message.embeds.push(embed);
              }
            } catch (e) {
              console.error("[ObfuscationPlugin] Error decoding image:", e);
            }
          }

          // If we have images, only show the visible content
          if (hasImages && visibleContent) {
            finalContent = visibleContent;
          } else if (hasImages) {
            finalContent = "🔒 Obfuscated Image";
          }
        } else {
          // Original text decoding logic
          const decoded = unscramble(obfuscatedContent, vstorage.secret);
          console.log("[ObfuscationPlugin] Decoded:", decoded);

          const INDICATOR_EMOJI_URL = "https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless";
          const wrappedEmojiUrl = `<${INDICATOR_EMOJI_URL}>`;

          finalContent = `${wrappedEmojiUrl}${decoded}`;
        }

        data.message.content = finalContent;

      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 4: Emoji rendering (your existing code)
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