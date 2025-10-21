// attachmentPatcherTest.tsx
import { after } from "@vendetta/patcher";
import { findByName } from "@vendetta/metro";
import { React, ReactNative } from "@vendetta/metro/common";

const { View, Image, ActivityIndicator, Text } = ReactNative;

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const RowManager = findByName("RowManager");

// Inline placeholder image component
const InlineImage: React.FC = () => {
  return React.createElement(Image, {
    source: { uri: "https://i.imgur.com/7dZrkGD.png" },
    style: {
      width: 200,
      height: 200,
      resizeMode: "contain",
      borderRadius: 8,
      marginTop: 4,
    },
  });
};

// Patch RowManager
export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        // Prevent collapse of message
        if (message.content && !message.content.includes(INVISIBLE_MARKER)) {
          message.content = INVISIBLE_MARKER + message.content;
        }

        const normalAttachments: any[] = [];

        message.attachments.forEach(att => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            if (!row.contentChildren) row.contentChildren = [];
            row.contentChildren.push(
              React.createElement(InlineImage, { key: att.id || att.filename })
            );
          } else {
            normalAttachments.push(att);
          }
        });

        // Remove handled txt attachments
        message.attachments = normalAttachments;
      })
    );
  }

  return () => patches.forEach(unpatch => unpatch());
}
