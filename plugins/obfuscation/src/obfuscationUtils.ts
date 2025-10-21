// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { FluxDispatcher } from "@vendetta/metro/common";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const RowManager = findByName("RowManager");
const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

// Helper: Uint8Array -> base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // create chunked binary string to avoid stack issues for large arrays
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Helper: rudimentary mime sniff from first bytes -> png/jpg/gif fallback to octet-stream
function detectMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 &&
      bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  return "application/octet-stream";
}

// Try to get an URL from common attachment fields
function getAttachmentUrl(att: any) {
  return att.url || att.proxyURL || att.proxyUrl || att.localUrl || att.previewURL || att.content || null;
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (!RowManager?.prototype?.generate) return () => {};

  patches.push(
    after("generate", RowManager.prototype, (args, row) => {
      try {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        message.attachments.forEach((att) => {
          // keep original behavior for unknown attachments
          if (!(att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt"))) {
            normalAttachments.push(att);
            return;
          }

          // create an immediate placeholder image so UI stays consistent
          const placeholderUrl = "https://i.imgur.com/7dZrkGD.png";

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
              description: "Obfuscated image (click to decode)",
              color: 0x2f3136,
              bodyTextColor: 0xffffff
            });

            // attach a small marker so we can find this embed later if needed
            embed.__obfuscatedAttachmentId = att.id ?? att.filename ?? Math.random().toString(36).slice(2, 8);

            fakeEmbeds.push(embed);
          } else {
            const embedMediaFields = {
              url: placeholderUrl,
              proxyURL: placeholderUrl,
              width: 200,
              height: 200,
              srcIsAnimated: false
            };

            const embedObj: any = {
              type: "image",
              url: placeholderUrl,
              image: embedMediaFields,
              thumbnail: embedMediaFields,
              description: "Obfuscated image (click to decode)",
              color: 0x2f3136,
              bodyTextColor: 0xffffff,
            };

            embedObj.__obfuscatedAttachmentId = att.id ?? att.filename ?? Math.random().toString(36).slice(2, 8);

            fakeEmbeds.push(embedObj);
          }

          // Kick off async decode + replace of embed image once the txt is fetched & decoded
          (async () => {
            try {
              // require secret to be available
              if (!vstorage?.secret) return;

              // attempt to fetch raw text from the attachment
              const rawUrl = getAttachmentUrl(att);
              if (!rawUrl) return;

              // fetch the txt content
              const resp = await fetch(rawUrl);
              if (!resp || !resp.ok) return;
              const brailleStr = await resp.text();

              if (!brailleStr) return;

              // decode with unscrambleBuffer -> Uint8Array
              let decodedBytes: Uint8Array;
              try {
                decodedBytes = unscrambleBuffer(brailleStr, vstorage.secret);
              } catch (e) {
                console.error("[attachmentPatcher] unscrambleBuffer failed:", e);
                return;
              }

              if (!decodedBytes || decodedBytes.length === 0) return;

              const mime = detectMime(decodedBytes);
              const b64 = uint8ArrayToBase64(decodedBytes);
              const dataUrl = `data:${mime};base64,${b64}`;

              // Find the message object and replace embed url(s)
              // We dispatch a MESSAGE_UPDATE to force re-render (same approach used elsewhere)
              // Build a shallow copy and replace embeds that match our placeholder marker
              try {
                const patchedMsg = { ...message };
                const embeds = (patchedMsg.embeds || []).map((e: any) => {
                  if (e && (e.__obfuscatedAttachmentId === (att.id ?? att.filename))) {
                    // mutate image & thumbnail fields (some embed implementations expect object)
                    if (e.image) {
                      if (typeof e.image === "object") {
                        e.image.url = dataUrl;
                        e.image.proxyURL = dataUrl;
                      } else {
                        e.image = { url: dataUrl, proxyURL: dataUrl };
                      }
                    } else {
                      e.image = { url: dataUrl, proxyURL: dataUrl };
                    }

                    if (e.thumbnail) {
                      if (typeof e.thumbnail === "object") {
                        e.thumbnail.url = dataUrl;
                        e.thumbnail.proxyURL = dataUrl;
                      } else {
                        e.thumbnail = { url: dataUrl, proxyURL: dataUrl };
                      }
                    }

                    // main url for some embeds
                    e.url = dataUrl;

                    // also update description to show decoded
                    e.description = "Decoded attachment (rendered locally)";
                  }
                  return e;
                });

                patchedMsg.embeds = embeds;

                FluxDispatcher.dispatch({
                  type: "MESSAGE_UPDATE",
                  message: patchedMsg,
                });
              } catch (e) {
                console.error("[attachmentPatcher] failed dispatching MESSAGE_UPDATE:", e);
              }
            } catch (e) {
              console.error("[attachmentPatcher] async decode error:", e);
            }
          })();

        });

        if (fakeEmbeds.length) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...fakeEmbeds);
          message.attachments = normalAttachments;
        }
      } catch (e) {
        console.error("[attachmentPatcher] generate patch error:", e);
      }
    })
  );

  return () => patches.forEach((unpatch) => unpatch());
}
