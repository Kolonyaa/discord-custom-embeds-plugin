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
const UserStore = findByStoreName("UserStore");

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

// Helper to normalize file objects from message
function extractFilesFromMessage(msg: any): any[] {
  const files: any[] = [];

  if (Array.isArray(msg?.files) && msg.files.length) files.push(...msg.files);
  if (Array.isArray(msg?.attachments) && msg.attachments.length) files.push(...msg.attachments);
  if (msg?.file) files.push(msg.file);

  return files;
}

// Helper function to edit message with obfuscated image URL
async function editMessageWithImageUrl(originalMessage: any, litterboxUrl: string, filename: string) {
  try {
    const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);
    const imageContent = `${IMAGE_MARKER}${obfuscatedUrl}`;

    const currentContent = originalMessage.content || "";
    let newContent = currentContent ? `${currentContent}\n${INVISIBLE_MARKER}${imageContent}` : `${INVISIBLE_MARKER}${imageContent}`;

    // Remove the original attachment
    const newAttachments = originalMessage.attachments?.filter((att: any) => att.filename !== filename) || [];

    // Update message locally
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...originalMessage,
        content: newContent,
        attachments: newAttachments,
        edited_timestamp: new Date().toISOString()
      },
      log_edit: false,
      otherPluginBypass: true
    });

    // Also send edit to server
    if (Messages.editMessage) {
      await Messages.editMessage(originalMessage.channel_id, originalMessage.id, {
        content: newContent,
        attachments: newAttachments
      });
    }

    showToast("🔒 Image obfuscated");
  } catch (e) {
    console.error("[ObfuscationPlugin] Error editing message:", e);
    showToast("❌ Failed to update message");
  }
}

export function applyPatches() {
  const patches: (() => void)[] = [];
  const originalSendMessage = Messages.sendMessage?.bind(Messages);

  // PATCH 1: Intercept sendMessage for attachments
  if (originalSendMessage) {
    patches.push(
      before("sendMessage", Messages, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const channelId = args[0];
          const msg = args[1] ?? {};
          const originalContent = msg.content ?? "";
          const files = extractFilesFromMessage(msg);

          // If no attachments, do nothing (text obfuscation handled elsewhere)
          if (!files || files.length === 0) return;

          // Intercept: asynchronously handle attachment upload
          args[1] = { ...msg }; // keep local copy; originalSendMessage will be called manually

          (async () => {
            try {
              showToast("📤 Uploading attachments to Litterbox...");

              const uploadResults = await Promise.all(files.map(async (f) => {
                try {
                  const url = await uploadToLitterbox(f, "1h");
                  return { ok: !!url, url, filename: f.filename ?? f.name ?? f?.item?.filename ?? null };
                } catch (e) {
                  return { ok: false, error: e, filename: f?.filename ?? f?.name ?? null };
                }
              }));

              const successful = uploadResults.filter(r => r.ok);
              const failed = uploadResults.filter(r => !r.ok);

              if (failed.length && successful.length === 0) {
                showToast("⚠️ Litterbox upload failed — sending original attachments");
                return originalSendMessage(channelId, msg);
              }

              if (failed.length) showToast("⚠️ Some attachments failed to upload — sending what succeeded");
              else showToast("✅ Uploaded to Litterbox");

              // Build obfuscated image markers
              const imageMarkers = successful.map(r => `${IMAGE_MARKER}${scramble(r.url, vstorage.secret)}`);

              // Prepare message content: scramble text + append image markers
              let newContent = "";
              if (originalContent.trim()) newContent = `${INVISIBLE_MARKER}${scramble(originalContent, vstorage.secret)}`;
              for (const im of imageMarkers) newContent = newContent ? `${newContent}\n${INVISIBLE_MARKER}${im}` : `${INVISIBLE_MARKER}${im}`;

              // Send message with no attachments
              await originalSendMessage(channelId, { ...msg, content: newContent, attachments: [], files: undefined });
              showToast("🔒 Image obfuscated");
            } catch (e) {
              console.error("[ObfuscationPlugin] sendMessage intercept/upload failed:", e);
              try { originalSendMessage(channelId, msg); } catch {}
            }
          })();

          return; // prevent original send synchronously
        } catch (e) {
          console.error("[ObfuscationPlugin] Error in sendMessage intercept:", e);
        }
      })
    );
  }

  // PATCH 2: Incoming message decoding (text + images)
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

        if (obfuscatedContent.includes(IMAGE_MARKER)) {
          const imageParts = obfuscatedContent.split(IMAGE_MARKER).filter(Boolean);
          for (const imagePart of imageParts) {
            try {
              const litterboxUrl = unscramble(imagePart, vstorage.secret);
              if (litterboxUrl.startsWith("https://")) {
                hasImages = true;
                const embed = {
                  type: "image",
                  url: litterboxUrl,
                  thumbnail: { url: litterboxUrl, proxy_url: litterboxUrl, width: 400, height: 400, srcIsAnimated: false },
                  image: { url: litterboxUrl, proxy_url: litterboxUrl, width: 400, height: 400, srcIsAnimated: false },
                  description: "🔒 Obfuscated Image"
                };
                if (!message.embeds) message.embeds = [];
                message.embeds.push(embed);
              }
            } catch {}
          }

          finalContent = hasImages ? (visibleContent || "🔒 Obfuscated Image") : visibleContent;
        } else {
          finalContent = `<https://cdn.discordapp.com/emojis/1429170621891477615.webp?size=48&quality=lossless>${unscramble(obfuscatedContent, vstorage.secret)}`;
        }

        data.message.content = finalContent;
      } catch (e) {
        console.error("[ObfuscationPlugin] Error decoding message:", e);
      }
    })
  );

  // PATCH 3: Emoji rendering
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
                  if (emoji?.name) emojiName = emoji.name;
                } catch {}
                message.content[i] = { type: "customEmoji", id: match[1], alt: emojiName, src: url, frozenSrc: url.replace("gif", "webp"), jumboable: false };
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
    setTimeout(() => {
      try {
        const channels = MessageStore.getMutableMessages?.() ?? {};
        Object.entries(channels).forEach(([channelId, messages]: [string, any]) => {
          if (!messages) return;
          Object.values(messages).forEach((msg: any) => {
            if (msg && hasObfuscationMarker(msg.content)) {
              FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message: { ...msg } });
            }
          });
        });
      } catch (e) {
        console.error("[ObfuscationPlugin] Error reprocessing messages:", e);
      }
    }, 1000);
  };

  setTimeout(reprocessExistingMessages, 1000);

  return () => {
    patches.forEach(unpatch => unpatch());
  };
}
