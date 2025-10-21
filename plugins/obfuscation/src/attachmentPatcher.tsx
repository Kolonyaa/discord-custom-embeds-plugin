// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
import { findByName, React, ReactNative } from "@vendetta/metro";
const { View, Image } = ReactNative;

const RowManager = findByName("RowManager");
const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const PLACEHOLDER_URL = "https://i.imgur.com/7dZrkGD.png";
const filetypes = new Set(["txt"]);

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (!RowManager?.prototype?.generate) return () => {};

  patches.push(
    after("generate", RowManager.prototype, (_, row) => {
      const { message } = row;
      if (!message?.attachments?.length) return;

      const normalAttachments: any[] = [];
      const inlineImages: React.ReactElement[] = [];

      message.attachments.forEach((att) => {
        if (att.filename === ATTACHMENT_FILENAME || filetypes.has(att.filename?.split(".").pop())) {
          // Render placeholder inline immediately
          inlineImages.push(
            React.createElement(Image, {
              key: att.id || att.filename,
              source: { uri: PLACEHOLDER_URL },
              style: {
                width: 200,
                height: 200,
                resizeMode: "contain",
                borderRadius: 8,
                marginTop: 4,
              },
            })
          );
        } else {
          normalAttachments.push(att);
        }
      });

      if (inlineImages.length) {
        // Ensure contentChildren exists
        row.contentChildren = row.contentChildren || [];
        row.contentChildren.push(...inlineImages);

        // Remove txt attachments so they don't show as default file embeds
        message.attachments = normalAttachments;
      }
    })
  );

  return () => patches.forEach((unpatch) => unpatch());
}
