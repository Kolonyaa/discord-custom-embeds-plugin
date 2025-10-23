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

// Safely get EmojiStore (optional)
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Invisible marker sequence
const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const IMAGE_MARKER = "OBFUSCATED_IMAGE:";

// Helper functions
function hasObfuscationMarker(content: string): boolean {
  return content?.includes(INVISIBLE_MARKER);
}

// Track pending image uploads
const pendingImageUploads = new Map();

export function applyPatches() {
  const patches = [];

  // PATCH 1: Intercept message sending to handle attachments
  patches.push(
    before("sendMessage", Messages, async (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;
        const attachments = msg?.attachments || [];

        if (!vstorage.enabled || !vstorage.secret) return;

        // Check if there are any image attachments to obfuscate
        const imageAttachments = attachments.filter((att: any) => 
          att.type?.startsWith("image/") || 
          /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(att.filename || "")
        );

        if (imageAttachments.length === 0) {
          // Only text obfuscation needed
          if (content && !hasObfuscationMarker(content)) {
            const scrambled = scramble(content, vstorage.secret);
            msg.content = `${INVISIBLE_MARKER}${scrambled}`;
          }
          return;
        }

        // We have images to obfuscate - cancel the original message
        args[0] = null; // Prevent the original message from sending

        showToast("📤 Uploading images to Litterbox...");

        // Upload all images to Litterbox
        const uploadPromises = imageAttachments.map(async (attachment: any) => {
          try {
            const litterboxUrl = await uploadToLitterbox(attachment, "1h");
            if (!litterboxUrl) throw new Error("Upload failed");
            return { originalFilename: attachment.filename, litterboxUrl };
          } catch (err) {
            console.error("[ObfuscationPlugin] Image upload failed:", err);
            return null;
          }
        });

        const uploadResults = (await Promise.all(uploadPromises)).filter(Boolean);
        
        if (uploadResults.length === 0) {
          showToast("❌ All image uploads failed");
          return;
        }

        // Build the new message content
        let newContent = content || "";
        
        // Add text obfuscation if there's text content
        if (content && !hasObfuscationMarker(content)) {
          const scrambled = scramble(content, vstorage.secret);
          newContent = `${INVISIBLE_MARKER}${scrambled}`;
        }

        // Add image obfuscation markers
        const imageMarkers = uploadResults.map(result => 
          `${IMAGE_MARKER}${scramble(result.litterboxUrl, vstorage.secret)}`
        ).join("");

        if (newContent.includes(INVISIBLE_MARKER)) {
          // Append images to existing obfuscated content
          newContent += imageMarkers;
        } else {
          // Create new obfuscated content with just images
          newContent = `${INVISIBLE_MARKER}${imageMarkers}`;
        }

        // Send the new message without attachments
        setTimeout(async () => {
          try {
            await Messages.sendMessage(msg.channelId, {
              content: newContent,
              messageReference: msg.messageReference,
              stickerIds: msg.stickerIds,
              tts: msg.tts,
              // Don't include attachments
            });
            showToast("🔒 Message sent with obfuscated images");
          } catch (err) {
            console.error("[ObfuscationPlugin] Failed to send obfuscated message:", err);
            showToast("❌ Failed to send message");
          }
        }, 100);

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 2: Incoming message decoding (enhanced for images)
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
                  },
                  image: {
                    url: litterboxUrl,
                    proxy_url: litterboxUrl,
                    width: 400,
                    height: 400,
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

          // Update content display
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

  // PATCH 3: Emoji rendering (your existing code)
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

  // PATCH 4: Reprocess existing messages
  const reprocessExistingMessages = () => {
    try {
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

// Litterbox upload function (unchanged)
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