// attachmentPatcher.tsx
import { before, after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, FluxDispatcher } from "@vendetta/metro/common";
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
      after("generate", RowManager.prototype, (_, row) => {
        try {
          const { message } = row;
          if (!message?.attachments?.length) return;

          const normalAttachments: any[] = [];
          const placeholderEmbeds: any[] = [];
          const obfuscatedAttachments: any[] = [];

          for (const att of message.attachments) {
            if (att.filename === ATTACHMENT_FILENAME) {
              // keep track to fetch+deobfuscate later
              obfuscatedAttachments.push(att);

              // Add a quick placeholder embed synchronously so renderer is happy.
              // Use a neutral placeholder; viewable clients will see this until we replace it.
              const placeholderUrl = "https://i.imgur.com/7dZrkGD.png";
              placeholderEmbeds.push({
                type: "image",
                url: placeholderUrl,
                image: { url: placeholderUrl, proxyURL: placeholderUrl, width: 200, height: 200, srcIsAnimated: false },
                thumbnail: { url: placeholderUrl, proxyURL: placeholderUrl, width: 200, height: 200, srcIsAnimated: false },
                description: "Obfuscated image — decrypting...",
                color: 0x2f3136,
              });
            } else {
              normalAttachments.push(att);
            }
          }

          if (placeholderEmbeds.length) {
            // replace attachments with non-obfuscated ones and add placeholders
            message.embeds = [...(message.embeds || []), ...placeholderEmbeds];
            message.attachments = normalAttachments;
          }

          // ASYNC: fetch and deobfuscate in background, then dispatch a message update
          // Do not await anything here (no async/await in the after hook)
          (async () => {
            try {
              if (!vstorage.enabled || !vstorage.secret) return;

              // For each obfuscated attachment, fetch the .txt, decode, and create a proper embed
              const realEmbeds: any[] = [];
              for (const att of obfuscatedAttachments) {
                try {
                  // att.url should be accessible; if not, try att.proxy_url / att.url or att.content_url etc.
                  const urlToFetch = att.url ?? att.proxy_url ?? att.content_url ?? att.download_url;
                  if (!urlToFetch) continue;

                  const resp = await fetch(urlToFetch);
                  if (!resp.ok) {
                    console.warn("[ObfuscationPlugin] failed fetching attachment text:", resp.status);
                    continue;
                  }
                  const textData = await resp.text();

                  // The obfuscation utilities might accept the raw string or Uint8Array; adapt as needed.
                  // Here we assume unscrambleBuffer accepts a string and the secret.
                  const deob = unscrambleBuffer(textData, vstorage.secret);
                  const imageUrl = (typeof deob === "string" ? deob : new TextDecoder().decode(deob)).trim();
                  if (!imageUrl) continue;

                  // Sanity check
                  if (!imageUrl.startsWith("http")) {
                    console.warn("[ObfuscationPlugin] deobfuscated URL invalid:", imageUrl);
                    continue;
                  }

                  // Build embed for the real image
                  realEmbeds.push({
                    type: "image",
                    url: imageUrl,
                    image: { url: imageUrl, proxyURL: imageUrl, width: 200, height: 200, srcIsAnimated: false },
                    thumbnail: { url: imageUrl, proxyURL: imageUrl, width: 200, height: 200, srcIsAnimated: false},
                    description: "Decrypted Litterbox image",
                    color: 0x2f3136,
                  });
                } catch (err) {
                  console.warn("[ObfuscationPlugin] deobfuscate/fetch error for attachment:", err);
                  continue;
                }
              }

              if (realEmbeds.length) {
                // Fetch the current message state from store if available or reuse the captured message.
                // We attempt to preserve other fields and just update embeds/attachments.
                const updated = {
                  ...message,
                  embeds: [...(message.embeds || []).filter(e => e.description !== "Obfuscated image — decrypting..."), ...realEmbeds],
                  // We already removed the obfuscated `.txt` from attachments earlier; keep it removed.
                  attachments: normalAttachments,
                };

                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: updated,
                  otherPluginBypass: true,
                });
              }
            } catch (err) {
              console.error("[ObfuscationPlugin] async deobfuscation error:", err);
            }
          })();
        } catch (e) {
          console.error("[ObfuscationPlugin] RowManager.generate patch error:", e);
        }
      })
    );
  }

  return () => patches.forEach(unpatch => unpatch());
}
