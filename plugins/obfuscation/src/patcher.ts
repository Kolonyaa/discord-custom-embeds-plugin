// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByProps, findByStoreName, findByName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scramble, unscramble } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_image.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const Messages = findByProps("sendMessage", "editMessage", "receiveMessage");
const MessageStore = findByStoreName("MessageStore");
const RowManager = findByName("RowManager");
const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const UserStore = findByStoreName("UserStore");

// Upload file to Litterbox
async function uploadToLitterbox(media: any): Promise<string | null> {
  try {
    const fileUri = media?.item?.originalUri || media?.uri || media?.fileUri || media?.path || media?.sourceURL;
    if (!fileUri) throw new Error("Missing file URI");

    const filename = media.filename ?? "upload";
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", "1h");
    formData.append("fileToUpload", {
      uri: fileUri,
      name: filename,
      type: media.mimeType ?? "application/octet-stream",
    } as any);

    const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
      method: "POST",
      body: formData,
    });

    const text = await res.text();
    if (!text.startsWith("https://")) throw new Error(text);
    return text;
  } catch (e) {
    console.error("[ObfuscationPlugin] Litterbox upload failed:", e);
    return null;
  }
}

// Helper to edit message with obfuscated .txt attachment
async function replaceImageWithObfuscatedTxt(msg: any, litterboxUrl: string, filename: string) {
  try {
    const obfuscatedUrl = scramble(litterboxUrl, vstorage.secret);

    const txtAttachment = {
      filename: ATTACHMENT_FILENAME,
      contentType: "text/plain",
      data: new TextEncoder().encode(obfuscatedUrl).buffer,
    };

    // Remove original image attachment
    const newAttachments = msg.attachments?.filter((a: any) => a.filename !== filename) ?? [];
    newAttachments.push(txtAttachment);

    // Update message locally
    FluxDispatcher.dispatch({
      type: "MESSAGE_UPDATE",
      message: {
        ...msg,
        attachments: newAttachments,
        edited_timestamp: new Date().toISOString(),
      },
      log_edit: false,
      otherPluginBypass: true,
    });

    // Update message on server
    if (Messages.editMessage) {
      await Messages.editMessage(msg.channel_id, msg.id, { attachments: newAttachments });
    }

    showToast("🔒 Image obfuscated in .txt");

  } catch (e) {
    console.error("[ObfuscationPlugin] Failed to replace image:", e);
    showToast("❌ Failed to obfuscate image");
  }
}

export default function applyPatches() {
  const patches: (() => void)[] = [];

  // PATCH 1: Intercept image uploads
  if (CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
    const originalUpload = CloudUpload.prototype.reactNativeCompressAndExtractData;

    CloudUpload.prototype.reactNativeCompressAndExtractData = async function (...args: any[]) {
      try {
        if (!vstorage.enabled || !vstorage.secret) return originalUpload.apply(this, args);

        const file = this;
        const filename = file?.filename ?? "file";
        const isImage = file?.type?.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);
        if (!isImage) return originalUpload.apply(this, args);

        console.log("[ObfuscationPlugin] Uploading image:", filename);
        const result = await originalUpload.apply(this, args);
        if (!result) return result;

        // Start background Litterbox upload after a short delay
        setTimeout(async () => {
          try {
            showToast("📤 Uploading to Litterbox...");
            const url = await uploadToLitterbox(file);
            if (!url) return showToast("❌ Litterbox upload failed");

            const messages = MessageStore.getMessages?.(file?.channelId)?.toArray?.() ?? [];
            const currentUser = UserStore.getCurrentUser();
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i];
              if (msg.author?.id === currentUser?.id && msg.attachments?.length > 0) {
                await replaceImageWithObfuscatedTxt(msg, url, filename);
                break;
              }
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Error processing image:", e);
            showToast("❌ Failed to process image");
          }
        }, 2000);

        return result;
      } catch (e) {
        console.error("[ObfuscationPlugin] Upload patch error:", e);
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // PATCH 2: Detect obfuscated .txt attachments
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const fakeEmbeds: any[] = [];

        message.attachments.forEach((att: any) => {
          if (att.filename === ATTACHMENT_FILENAME) {
            att.__isObfuscated = true;

            const placeholderUrl = "https://i.imgur.com/7dZrkGD.png";
            fakeEmbeds.push({
              type: "image",
              url: placeholderUrl,
              image: { url: placeholderUrl, proxy_url: placeholderUrl, width: 200, height: 200, srcIsAnimated: false },
              thumbnail: { url: placeholderUrl, proxy_url: placeholderUrl, width: 200, height: 200, srcIsAnimated: false },
              description: "🔒 Obfuscated Image (click to decode)",
              color: 0x2f3136,
              bodyTextColor: 0xffffff,
            });
          }
        });

        if (fakeEmbeds.length) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...fakeEmbeds);
        }
      })
    );
  }

  // PATCH 3 (optional): add decode handler when user clicks the placeholder
  // This can be implemented as a UI button or tap gesture to read att.data and unscramble it.

  return () => patches.forEach(unpatch => unpatch());
}
