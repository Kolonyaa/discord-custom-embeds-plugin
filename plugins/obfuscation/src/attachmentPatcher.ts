// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, findByProps } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { React, ReactNative } from "@vendetta/metro/common";

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const RowManager = findByName("RowManager");

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  const Embed = findByName("Embed") || findByProps("Embed")?.Embed;
  const EmbedMedia = findByName("EmbedMedia") || findByProps("EmbedMedia")?.EmbedMedia;

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