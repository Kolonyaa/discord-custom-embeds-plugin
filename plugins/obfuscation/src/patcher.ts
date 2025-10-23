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

// Safely get EmojiStore (optional)
let getCustomEmojiById: any = null;
try {
  const EmojiStore = findByStoreName("EmojiStore");
  getCustomEmojiById = EmojiStore?.getCustomEmojiById;
} catch {
  console.warn("[ObfuscationPlugin] EmojiStore not available, emoji rendering disabled");
}

// Invisible marker sequence (not shown on non-plugin clients)
const INVISIBLE_MARKER = "\u200b\u200d\u200b";
const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";

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

  // PATCH 1: Intercept image uploads and replace with text file containing obfuscated URL
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
        showToast("📤 Uploading to Litterbox...");

        // Upload to Litterbox
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        
        if (!litterboxUrl) {
          console.error("[ObfuscationPlugin] Litterbox upload failed");
          showToast("❌ Litterbox upload failed");
          return originalUpload.apply(this, args);
        }

        console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

        // Obfuscate the URL
        const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
        
        // Convert to ArrayBuffer for Discord (text file content)
        const textContent = obfuscatedUrl;
        const textBuffer = new TextEncoder().encode(textContent).buffer;

        // Update file metadata to be a text file
        file.filename = ATTACHMENT_FILENAME;
        file.contentType = "text/plain";

        showToast("🔒 Image obfuscated");

        return textBuffer;

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

  // PATCH 2: Outgoing messages (your existing text obfuscation)
  patches.push(
    before("sendMessage", Messages, (args) => {
      try {
        const msg = args[1];
        const content = msg?.content;

        if (!vstorage.enabled) return;
        if (!content || !vstorage.secret) return;
        if (hasObfuscationMarker(content)) return;

        console.log("[ObfuscationPlugin] Sending message:", content);

        const scrambled = scramble(content, vstorage.secret);
        console.log("[ObfuscationPlugin] Scrambled to:", scrambled);

        msg.content = `${INVISIBLE_MARKER}${scrambled}`;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error in sendMessage patch:", e);
      }
    })
  );

  // PATCH 3: Handle incoming obfuscated attachments
  patches.push(
    before("receiveMessage", Messages, (args) => {
      try {
        if (!vstorage.enabled || !vstorage.secret) return;

        const message = args[0];
        if (!message?.attachments?.length) return;

        let hasObfuscatedAttachments = false;

        message.attachments.forEach((attachment: any) => {
          if (attachment.filename === ATTACHMENT_FILENAME || attachment.filename?.endsWith(".txt")) {
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

  // PATCH 4: Render obfuscated attachments as images
  patches.push(
    before("generate", RowManager.prototype, ([data]) => {
      try {
        if (data.rowType !== 1) return;
        const message = data.message;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        let hasObfuscatedAttachments = false;

        // Process attachments
        message.attachments.forEach((att: any) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            hasObfuscatedAttachments = true;
            
            // This will be processed asynchronously
            processObfuscatedAttachment(att, message, data);
          } else {
            normalAttachments.push(att);
          }
        });

        // If we have obfuscated attachments, remove them from the message
        // They will be replaced with embeds once decoded
        if (hasObfuscatedAttachments) {
          message.attachments = normalAttachments;
        }

      } catch (e) {
        console.error("[ObfuscationPlugin] Error in generate patch:", e);
      }
    })
  );

  // PATCH 5: Emoji rendering (your existing code)
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

  // PATCH 6: Reprocess already existing messages
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
  };
}

// Helper function to process obfuscated attachments
async function processObfuscatedAttachment(attachment: any, message: any, rowData: any) {
  try {
    // Fetch the text file content
    const response = await fetch(attachment.url);
    const obfuscatedText = await response.text();
    
    // Deobfuscate to get the Litterbox URL
    const litterboxUrl = unscramble(obfuscatedText, vstorage.secret);

    if (litterboxUrl.startsWith("https://")) {
      console.log("[ObfuscationPlugin] Decoded Litterbox URL:", litterboxUrl);

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
        
        // Force re-render
        if (rowData.forceUpdate) rowData.forceUpdate();
      }
    }
  } catch (error) {
    console.error("[ObfuscationPlugin] Error decoding attachment:", error);
    
    // Fallback to placeholder
    const placeholderUrl = "https://i.imgur.com/7dZrkGD.png";
    const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
    const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

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
        description: "❌ Failed to decode image",
        color: 0xff0000,
        bodyTextColor: 0xffffff
      });

      if (!message.embeds) message.embeds = [];
      message.embeds.push(embed);
      
      if (rowData.forceUpdate) rowData.forceUpdate();
    }
  }
}