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

// Convert Uint8Array to base64 data URL
function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return `data:${mimeType};base64,${base64}`;
}

// Cache for decoded images
const imageCache = new Map();

// Custom component to display decoded images
const DecodedImageComponent: React.FC<{ attachmentUrl: string }> = ({ attachmentUrl }) => {
  const [imageData, setImageData] = React.useState<{ dataUrl: string } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        
        // Check cache first
        if (imageCache.has(attachmentUrl)) {
          setImageData(imageCache.get(attachmentUrl));
          setLoading(false);
          return;
        }

        // Decode the image
        const response = await fetch(attachmentUrl);
        const obfText = await response.text();
        const bytes = unscrambleBuffer(obfText, vstorage.secret);
        
        const mimeType = detectImageType(bytes) || "image/png";
        const dataUrl = bytesToDataUrl(bytes, mimeType);
        
        const result = { dataUrl };
        imageCache.set(attachmentUrl, result);
        setImageData(result);
      } catch (e) {
        console.error("[ObfuscationPlugin] Failed to decode image:", e);
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [attachmentUrl]);

  if (loading) {
    return React.createElement(
      View,
      { 
        style: { 
          flexDirection: "row", 
          alignItems: "center", 
          marginTop: 8,
          padding: 8,
          backgroundColor: "#2f3136",
          borderRadius: 8
        } 
      },
      React.createElement(ActivityIndicator, { size: "small", style: { marginRight: 8 } }),
      React.createElement(Text, { style: { color: "#b9bbbe", fontSize: 12 } }, "Decoding image...")
    );
  }

  if (error || !imageData) {
    return React.createElement(
      View,
      { 
        style: { 
          marginTop: 8,
          padding: 8,
          backgroundColor: "#2f3136",
          borderRadius: 8
        } 
      },
      React.createElement(Text, { style: { color: "#ed4245", fontSize: 12 } }, "Failed to decode image")
    );
  }

  return React.createElement(
    View,
    { 
      style: { 
        marginTop: 8
      } 
    },
    React.createElement(
      Text, 
      { 
        style: { 
          color: "#b9bbbe", 
          fontSize: 12, 
          marginBottom: 4 
        } 
      }, 
      "Decoded Image:"
    ),
    React.createElement(Image, {
      source: { uri: imageData.dataUrl },
      style: {
        width: 200,
        height: 200,
        resizeMode: "contain",
        borderRadius: 8,
        borderWidth: 1,
        borderColor: "#40444b"
      },
    })
  );
};

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (RowManager?.prototype?.generate) {
    // First, mark messages that have obfuscated images
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        let hasObfuscatedImages = false;

        message.attachments.forEach((att) => {
          if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
            hasObfuscatedImages = true;
            // Store the attachment URLs for later use
            if (!message.obfuscatedImageUrls) message.obfuscatedImageUrls = [];
            message.obfuscatedImageUrls.push(att.url);
          } else {
            normalAttachments.push(att);
          }
        });

        // Remove txt attachments from the message
        message.attachments = normalAttachments;

        // Mark that this message has obfuscated images
        if (hasObfuscatedImages) {
          message.hasObfuscatedImages = true;
        }
      })
    );

    // Now patch the message content to inject our custom components
    // We need to find the right place in the message structure to inject
    const MessageContent = findByName("MessageContent") || findByProps("MessageContent")?.MessageContent;
    
    if (MessageContent) {
      patches.push(
        after("default", MessageContent, ([props], result) => {
          try {
            const { message } = props;
            if (!message?.hasObfuscatedImages || !message.obfuscatedImageUrls) {
              return result;
            }

            // Find where to inject our components - typically after the message content
            // This depends on Discord's specific React structure
            if (result && result.props && result.props.children) {
              const newChildren = React.Children.toArray(result.props.children);
              
              // Add our decoded image components
              message.obfuscatedImageUrls.forEach((url: string) => {
                newChildren.push(
                  React.createElement(DecodedImageComponent, {
                    key: `decoded-image-${url}`,
                    attachmentUrl: url
                  })
                );
              });

              // Return modified result
              return React.cloneElement(result, {
                children: newChildren
              });
            }
          } catch (e) {
            console.error("[ObfuscationPlugin] Error injecting custom components:", e);
          }
          
          return result;
        })
      );
    } else {
      // Fallback: Try to patch the message render method more directly
      patches.push(
        after("render", RowManager.prototype, (args, result) => {
          try {
            if (!result?.props?.message?.hasObfuscatedImages) {
              return result;
            }

            const message = result.props.message;
            
            // This is a more complex approach - we need to find the right place in the render tree
            // Let's try to find a content container
            const findAndInject = (node: any): any => {
              if (!node || typeof node !== 'object') return node;
              
              // Look for message content areas
              if (node.props && node.props.className && 
                  (node.props.className.includes('messageContent') || 
                   node.props.className.includes('message-'))) {
                
                // Clone and add our components
                const newChildren = React.Children.toArray(node.props.children);
                message.obfuscatedImageUrls.forEach((url: string) => {
                  newChildren.push(
                    React.createElement(DecodedImageComponent, {
                      key: `decoded-image-${url}`,
                      attachmentUrl: url
                    })
                  );
                });
                
                return React.cloneElement(node, {
                  children: newChildren
                });
              }
              
              // Recursively search
              if (node.props && node.props.children) {
                return React.cloneElement(node, {
                  children: React.Children.map(node.props.children, findAndInject)
                });
              }
              
              return node;
            };
            
            return findAndInject(result);
          } catch (e) {
            console.error("[ObfuscationPlugin] Error in render patch:", e);
            return result;
          }
        })
      );
    }
  }

  return () => {
    patches.forEach((unpatch) => unpatch());
    imageCache.clear();
  };
}