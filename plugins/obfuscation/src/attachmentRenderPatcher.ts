import { after } from "@vendetta/patcher";
import { findByProps } from "@vendetta/metro";
import { ReactNative as RN, React } from "@vendetta/metro/common";
import { unscrambleBuffer } from "./obfuscationUtils";
import { vstorage } from "./storage";

export default function applyAttachmentRenderPatcher() {
  const patches = [];
  const AttachmentComponent = findByProps("AttachmentMedia")?.AttachmentMedia;

  if (!AttachmentComponent) return () => {};

  const unpatch = after("render", AttachmentComponent.prototype, (args, ret) => {
    try {
      const attachment = args[0]?.attachment;
      if (!attachment || !attachment.filename?.endsWith(".txt")) return ret;

      if (attachment.filename !== "obfuscated_attachment.txt") return ret;
      if (!vstorage.enabled || !vstorage.secret) return ret;

      console.log("[ObfuscationPlugin] Detected obfuscated image render:", attachment.filename);

      // React element replacement
      const [decodedUri, setDecodedUri] = React.useState<string | null>(null);

      React.useEffect(() => {
        (async () => {
          try {
            const response = await fetch(attachment.url);
            const scrambled = await response.text();
            const decodedData = unscrambleBuffer(scrambled, vstorage.secret);
            const blob = new Blob([decodedData], { type: "image/png" }); // fallback type
            const uri = URL.createObjectURL(blob);
            setDecodedUri(uri);
          } catch (err) {
            console.error("[ObfuscationPlugin] Failed to decode inline image:", err);
          }
        })();
      }, [attachment.url]);

      if (decodedUri) {
        return React.createElement(RN.Image, {
          source: { uri: decodedUri },
          resizeMode: "contain",
          style: {
            width: "100%",
            height: 200,
            borderRadius: 8,
            backgroundColor: "black",
          },
        });
      }

      // Show loading placeholder
      return React.createElement(
        RN.View,
        {
          style: {
            width: "100%",
            height: 200,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#111",
            borderRadius: 8,
          },
        },
        React.createElement(RN.ActivityIndicator, { color: "#888" })
      );
    } catch (e) {
      console.error("[ObfuscationPlugin] Error rendering obfuscated image:", e);
      return ret;
    }
  });

  patches.push(unpatch);
  return () => patches.forEach(u => u());
}
