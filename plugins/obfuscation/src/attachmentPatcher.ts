import { findByName, findByProps } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before, instead } from "@vendetta/patcher";
import { vstorage } from "./storage";
import { unscrambleBuffer } from "./obfuscationUtils";

const patches = [];
const ChannelMessages = findByProps("_channelMessages");
const MessageRecordUtils = findByProps("updateMessageRecord", "createMessageRecord");
const MessageRecord = findByName("MessageRecord", false);
const RowManager = findByName("RowManager");

const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";

// Instead of creating fake embeds, modify the attachment record directly
patches.push(after("createMessageRecord", MessageRecordUtils, function ([message], record) {
  if (!message.attachments?.length) return;
  
  const modifiedAttachments = [];
  
  for (const att of message.attachments) {
    if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
      // Convert the txt attachment to appear as an image attachment
      modifiedAttachments.push({
        ...att,
        filename: "image.png",
        content_type: "image/png",
        // Keep the original URL but change how it's displayed
        __vml_is_obfuscated_image: true,
        __vml_original_url: att.url
      });
    } else {
      modifiedAttachments.push(att);
    }
  }
  
  if (modifiedAttachments.length !== message.attachments.length) {
    record.attachments = modifiedAttachments;
  }
}));

patches.push(after("default", MessageRecord, ([props], record) => {
  if (props.attachments?.length) {
    const modifiedAttachments = [];
    
    for (const att of props.attachments) {
      if (att.__vml_is_obfuscated_image) {
        modifiedAttachments.push({
          ...att,
          // Ensure it displays as an image
          content_type: "image/png",
          __vml_is_obfuscated_image: true
        });
      } else {
        modifiedAttachments.push(att);
      }
    }
    
    if (modifiedAttachments.length !== props.attachments.length) {
      record.attachments = modifiedAttachments;
    }
  }
}));

// Patch the RowManager to handle the display of obfuscated images
patches.push(after("generate", RowManager.prototype, ([data], row) => {
  if (!data.message?.attachments?.length) return;
  
  const { message } = data;
  
  // Look for obfuscated attachments and modify their display
  message.attachments.forEach((att, index) => {
    if (att.__vml_is_obfuscated_image) {
      // Here you can modify how the attachment is displayed
      // You might need to patch the attachment component directly
      console.log("Found obfuscated image attachment:", att);
    }
  });
}));

// Alternative approach: Patch the attachment component directly
const Attachment = findByName("Attachment") || findByProps("Attachment")?.Attachment;
if (Attachment) {
  patches.push(after("default", Attachment, ([props], component) => {
    if (props.attachment?.__vml_is_obfuscated_image) {
      // Modify the attachment props to display as image
      return {
        ...component,
        props: {
          ...props,
          attachment: {
            ...props.attachment,
            content_type: "image/png",
            filename: "image.png"
          }
        }
      };
    }
    return component;
  }));
}

export default function applyAttachmentPatcher() {
  return () => patches.forEach((unpatch) => unpatch());
}