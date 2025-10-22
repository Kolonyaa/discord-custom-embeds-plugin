// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";
import { uploadToLitterbox } from "./litterbox";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;
  const RowManager = findByName("RowManager");
  const MessageActions = findByProps("sendMessage", "receiveMessage");
  const CloudUpload = findByProps("CloudUpload")?.CloudUpload;

  // --- 1. Intercept uploads ---
  if (CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
    const originalUpload = CloudUpload.prototype.reactNativeCompressAndExtractData;

    CloudUpload.prototype.reactNativeCompressAndExtractData = async function (...args: any[]) {
      try {
        if (!vstorage.enabled || !vstorage.secret) {
          return originalUpload.apply(this, args);
        }

        const file = this;
        const filename = file?.filename ?? "file";
        const isImage = file?.type?.startsWith("image/") ||
                        /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

        if (!isImage) {
          return originalUpload.apply(this, args);
        }

        showToast("📤 Uploading image to Litterbox...");
        console.log("[ObfuscationPlugin] Uploading image:", filename);

        // Upload to Litterbox (use default duration 1h)
        const litterboxUrl = await uploadToLitterbox(file, "1h");
        if (!litterboxUrl) throw new Error("Litterbox upload failed");

        console.log("[ObfuscationPlugin] Litterbox URL:", litterboxUrl);

        // Obfuscate the URL
        const obfuscated = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
        const buffer = new TextEncoder().encode(obfuscated).buffer;

        // Replace file metadata
        file.filename = ATTACHMENT_FILENAME;
        file.contentType = "text/plain";

        showToast("🔒 Uploaded and obfuscated image link");

        return buffer;

      } catch (e) {
        console.error("[ObfuscationPlugin] Upload error:", e);
        showToast("❌ Litterbox upload failed");
        return originalUpload.apply(this, args);
      }
    };

    patches.push(() => {
      CloudUpload.prototype.reactNativeCompressAndExtractData = originalUpload;
    });
  }

  // --- 2. Process incoming messages ---
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;
          const message = args[0];
          if (!message?.attachments?.length) return;

          let hasObfuscatedAttachments = false;
          for (const att of message.attachments) {
            if (att.filename === ATTACHMENT_FILENAME) {
              hasObfuscatedAttachments = true;
              (att as any).__isObfuscated = true;
            }
          }

          if (hasObfuscatedAttachments && message.content && !message.content.includes(INVISIBLE_MARKER)) {
            message.content = INVISIBLE_MARKER + message.content;
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] receiveMessage error:", e);
        }
      })
    );
  }

  // --- 3. Render deobfuscated embeds ---
  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, async (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        for (const att of message.attachments) {
          if (att.filename === ATTACHMENT_FILENAME) {
            try {
              const response = await fetch(att.url);
              const textData = await response.text();

              // Deobfuscate URL
              const deobfuscated = unscrambleBuffer(textData, vstorage.secret);
              console.log("[ObfuscationPlugin] Deobfuscated URL:", deobfuscated);

              const imageUrl = deobfuscated.trim();
              if (!imageUrl.startsWith("https://")) throw new Error("Invalid URL");

              if (Embed && EmbedMedia) {
                const media = new EmbedMedia({
                  url: imageUrl,
                  proxyURL: imageUrl,
                  width: 200,
                  height: 200,
                  srcIsAnimated: false
                });

                const embed = new Embed({
                  type: "image",
                  url: imageUrl,
                  image: media,
                  thumbnail: media,
                  description: "Obfuscated Litterbox image",
                  color: 0x2f3136,
                });

                fakeEmbeds.push(embed);
              } else {
                fakeEmbeds.push({
                  type: "image",
                  url: imageUrl,
                  image: { url: imageUrl },
                  description: "Obfuscated Litterbox image",
                });
              }

            } catch (err) {
              console.warn("[ObfuscationPlugin] Failed to deobfuscate:", err);
            }
          } else {
            normalAttachments.push(att);
          }
        }

        if (fakeEmbeds.length) {
          message.embeds = [...(message.embeds || []), ...fakeEmbeds];
          message.attachments = normalAttachments;
        }
      })
    );
  }

  return () => patches.forEach(unpatch => unpatch());
}
