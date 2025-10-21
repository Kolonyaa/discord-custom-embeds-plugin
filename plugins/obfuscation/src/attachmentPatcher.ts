// attachmentPatcherTest.tsx
import { after } from "@vendetta/patcher";
import { findByName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

const { Image, View, Text } = ReactNative;
const RowManager = findByName("RowManager");
const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";

// Inline placeholder image component
const InlineImage: React.FC = () =>
  React.createElement(Image, {
    source: { uri: "https://i.imgur.com/7dZrkGD.png" },
    style: { width: 200, height: 200, resizeMode: "contain", borderRadius: 8, marginTop: 4 },
  });

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];

        message.attachments.forEach(att => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            if (!row.contentChildren) row.contentChildren = [];
            row.contentChildren.push(React.createElement(InlineImage, { key: att.id || att.filename }));
          } else {
            normalAttachments.push(att);
          }
        });

        message.attachments = normalAttachments; // remove handled txt
      })
    );
  }

  return () => patches.forEach(unpatch => unpatch());
}
