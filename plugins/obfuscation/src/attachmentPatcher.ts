// attachmentPatcher.tsx
import { before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";
import { vstorage } from "./storage";
import { findByProps } from "@vendetta/metro";
import { scrambleBuffer, unscrambleBuffer } from "./obfuscationUtils";

const CloudUpload = findByProps("CloudUpload")?.CloudUpload;
const uploadModule = findByProps("uploadLocalFiles");

const INVISIBLE_MARKER = "\u200b\u200d\u200b";

// Litterbox upload function
async function uploadToLitterbox(media: any, duration = "1h"): Promise<string | null> {
  try {
    const fileUri =
      media?.item?.originalUri ||
      media?.uri ||
      media?.fileUri ||
      media?.path ||
      media?.sourceURL;

    if (!fileUri) throw new Error("Missing file URI");

    const filename = media.filename ?? "upload";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", duration);
    formData.append("fileToUpload", {
      uri: fileUri,
      name: filename,
      type: media.mimeType ?? "application/octet-stream",
    } as any);

    const response = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
      method: "POST",
      body: formData,
    });

    const text = await response.text();
    if (!text.startsWith("https://")) throw new Error(text);
    return text;
  } catch (err) {
    console.error("[ObfuscationPlugin] Litterbox upload failed:", err);
    return null;
  }
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  // Store for pending uploads to avoid duplicate processing
  const processingUploads = new Set();

  // Approach 1: Patch CloudUpload constructor (like the filename randomizer)
  if (CloudUpload) {
    patches.push(
      before("CloudUpload", CloudUpload, async (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const uploadObject = args[0];
          if (!uploadObject) return;

          const filename = uploadObject.filename ?? "";
          
          // Check if it's an image
          const isImage = uploadObject.type?.startsWith("image/") || 
                         /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

          if (!isImage) return;

          // Avoid processing the same upload multiple times
          const uploadKey = `${filename}-${Date.now()}`;
          if (processingUploads.has(uploadKey)) return;
          processingUploads.add(uploadKey);

          console.log("[ObfuscationPlugin] Processing image upload:", filename);
          showToast("📤 Uploading to Litterbox...");

          // Upload to Litterbox
          const litterboxUrl = await uploadToLitterbox(uploadObject, "1h");
          
          if (!litterboxUrl) {
            console.error("[ObfuscationPlugin] Litterbox upload failed");
            showToast("❌ Litterbox upload failed");
            processingUploads.delete(uploadKey);
            return;
          }

          console.log("[ObfuscationPlugin] Litterbox URL received:", litterboxUrl);

          // Obfuscate the URL
          const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
          
          // Modify the upload object to be a text file with the obfuscated URL
          uploadObject.filename = "obfuscated_image.txt";
          uploadObject.type = "text/plain";
          
          // Create a text file content
          const textContent = `${INVISIBLE_MARKER}${obfuscatedUrl}`;
          
          // Convert to base64 data URI for the file
          const dataUri = `data:text/plain;base64,${btoa(textContent)}`;
          
          // Update the file URI to point to our text content
          if (uploadObject.item) {
            uploadObject.item.originalUri = dataUri;
          }
          if (uploadObject.uri) {
            uploadObject.uri = dataUri;
          }

          showToast("🔒 Image obfuscated");
          processingUploads.delete(uploadKey);

        } catch (e) {
          console.error("[ObfuscationPlugin] Error in CloudUpload patch:", e);
          showToast("❌ Failed to obfuscate image");
          processingUploads.clear();
        }
      })
    );
  }

  // Approach 2: Patch uploadLocalFiles as a fallback (like the filename randomizer)
  if (uploadModule?.uploadLocalFiles) {
    patches.push(
      before("uploadLocalFiles", uploadModule, async (args) => {
        try {
          if (!vstorage.enabled || !vstorage.secret) return;

          const files = args[0]?.items ?? args[0]?.files ?? args[0]?.uploads;
          if (!Array.isArray(files)) return;

          for (const file of files) {
            const filename = file.filename ?? file.name ?? "";
            
            // Check if it's an image
            const isImage = file.type?.startsWith("image/") || 
                           /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(filename);

            if (!isImage) continue;

            console.log("[ObfuscationPlugin] Processing image in uploadLocalFiles:", filename);
            showToast("📤 Uploading to Litterbox...");

            // Upload to Litterbox
            const litterboxUrl = await uploadToLitterbox(file, "1h");
            
            if (!litterboxUrl) {
              console.error("[ObfuscationPlugin] Litterbox upload failed");
              showToast("❌ Litterbox upload failed");
              continue;
            }

            // Obfuscate the URL
            const obfuscatedUrl = scrambleBuffer(new TextEncoder().encode(litterboxUrl), vstorage.secret);
            
            // Modify the file to be a text file
            file.filename = "obfuscated_image.txt";
            file.name = "obfuscated_image.txt";
            file.type = "text/plain";
            
            // Create text content
            const textContent = `${INVISIBLE_MARKER}${obfuscatedUrl}`;
            const dataUri = `data:text/plain;base64,${btoa(textContent)}`;
            
            // Update file URIs
            if (file.item) {
              file.item.originalUri = dataUri;
            }
            if (file.uri) {
              file.uri = dataUri;
            }

            showToast("🔒 Image obfuscated");
          }
        } catch (e) {
          console.error("[ObfuscationPlugin] Error in uploadLocalFiles patch:", e);
          showToast("❌ Failed to obfuscate image");
        }
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}