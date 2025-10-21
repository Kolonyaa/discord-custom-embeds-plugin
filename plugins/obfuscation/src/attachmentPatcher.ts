// attachmentPatcher.tsx
import { after, before } from "@vendetta/patcher";
import { findByName } from "@vendetta/metro";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";
import { React, ReactNative } from "@vendetta/metro/common";

const { View, Image, ActivityIndicator, Text } = ReactNative;

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const INVISIBLE_MARKER = "\u200b\u200d\u200b";

const RowManager = findByName("RowManager");
const filetypes = new Set(["txt"]);

// Detect image type from Uint8Array
function detectImageType(data: Uint8Array): string | null {
  if (data.length < 4) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return "image/webp";
  return null;
}

// Inline image component
const InlineImage: React.FC<{ attachment: any }> = ({ attachment }) => {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const response = await fetch(attachment.url);
        const obfText = await response.text();
        const bytes = unscrambleBuffer(obfText, vstorage.secret);

        const mimeType = detectImageType(bytes) || "image/jpeg";
        const blob = new Blob([bytes], { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        setUrl(blobUrl);
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed decoding inline image:", e);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [attachment.url]);

  if (loading) return React.createElement(ActivityIndicator, { size: "small" });
  if (error || !url)
    return React.createElement(
      View,
      { style: { marginTop: 4 } },
      React.createElement(Text, { style: { color: "red" } }, "Failed to load image")
    );

  return React.createElement(Image, {
    source: { uri: url },
    style: {
      width: 200,
      height: 200,
      resizeMode: "contain",
      borderRadius: 8,
      marginTop: 4,
    },
  });
};

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (RowManager?.prototype?.generate) {
    // First patch: remove the text attachments and mark the message
    patches.push(
      before("generate", RowManager.prototype, ([data]) => {
        if (data.rowType !== 1) return; // Only process regular messages

        const { message } = data;
        if (!message?.attachments?.length) return;

        const obfuscatedAttachments = message.attachments.filter(
          att => att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")
        );

        if (obfuscatedAttachments.length > 0) {
          // Remove obfuscated attachments from the message
          message.attachments = message.attachments.filter(
            att => !(att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt"))
          );

          // Store the obfuscated attachments for later processing
          data.__obfuscatedImages = obfuscatedAttachments;
        }
      })
    );

    // Second patch: modify the rendered content to include our images
    patches.push(
      after("generate", RowManager.prototype, ([data], row) => {
        if (data.rowType !== 1 || !data.__obfuscatedImages) return;
        
        const { content } = row;
        if (!Array.isArray(content)) return;

        // Add our inline images after the message content
        data.__obfuscatedImages.forEach((attachment, index) => {
          content.push({
            type: "component",
            component: React.createElement(InlineImage, { 
              key: `obfuscated-${attachment.id}-${index}`,
              attachment: attachment 
            })
          });
        });
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}
