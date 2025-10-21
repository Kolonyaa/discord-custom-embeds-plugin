// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts"; // might remove eventually
import { vstorage } from "./storage";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;
  const RowManager = findByName("RowManager");
  const MessageActions = findByProps("sendMessage", "receiveMessage");




  // PATCH 2: Handle incoming obfuscated attachments
  if (MessageActions?.receiveMessage) {
    patches.push(
      before("receiveMessage", MessageActions, (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const message = args[0];
          if (!message?.attachments?.length) return;

          let hasObfuscatedAttachments = false;

          message.attachments.forEach((attachment: any) => {
            if (attachment.filename === ATTACHMENT_FILENAME) {
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
  }




  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        // We'll process attachments and create embeds
        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            // For now, use placeholder - we'll enhance this to use real data
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
              fakeEmbeds.push(embed);
            } else {
              const embedMediaFields = {
                url: placeholderUrl,
                proxyURL: placeholderUrl, 
                width: 200,
                height: 200,
                srcIsAnimated: false
              };

              fakeEmbeds.push({
                type: "image",
                url: placeholderUrl,
                image: embedMediaFields,
                thumbnail: embedMediaFields,
                description: "Obfuscated image (click to decode)",
                color: 0x2f3136,
                bodyTextColor: 0xffffff
              });
            }
          } else {
            normalAttachments.push(att);
          }
        });

        if (fakeEmbeds.length) {
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...fakeEmbeds);
          message.attachments = normalAttachments;
        }
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}