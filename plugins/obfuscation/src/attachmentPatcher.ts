// attachmentPatcher.tsx
import { after } from "@vendetta/patcher";
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
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            // Convert the txt attachment to appear as an image attachment
            att.filename = "image.png";
            att.content_type = "image/png";
            att.original_content_type = "image/png";
            
            // Add image dimensions so Discord treats it as an image
            att.width = 200;
            att.height = 200;
            
            // Keep the original URL but Discord will try to fetch it as an image
            // The proxy_url might also need to be set
            if (!att.proxy_url) {
              att.proxy_url = att.url;
            }
            
            // Remove any text-specific properties
            delete att.content_scan_version;
            delete att.placeholder;
            delete att.placeholder_version;
          }
        });
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}
