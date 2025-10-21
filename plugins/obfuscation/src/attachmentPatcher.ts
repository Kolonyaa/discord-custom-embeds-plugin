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
const PLACEHOLDER_IMAGE = "https://i.imgur.com/7dZrkGD.png";

// Modify the message record to replace txt attachments with our image
patches.push(after("createMessageRecord", MessageRecordUtils, function ([message], record) {
  if (!message.attachments?.length) return;
  
  const modifiedAttachments = [];
  
  for (const att of message.attachments) {
    if (att.filename === ATTACHMENT_FILENAME || att.filename?.endsWith(".txt")) {
      // Replace the txt attachment with our image URL
      modifiedAttachments.push({
        ...att,
        filename: "image.png",
        content_type: "image/png",
        url: PLACEHOLDER_IMAGE,
        proxy_url: PLACEHOLDER_IMAGE,
        // Keep track that this was originally an obfuscated attachment
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
          url: PLACEHOLDER_IMAGE,
          proxy_url: PLACEHOLDER_IMAGE,
          content_type: "image/png",
          filename: "image.png"
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

// Patch RowManager to ensure proper display
patches.push(after("generate", RowManager.prototype, ([data], row) => {
  if (!data.message?.attachments?.length) return;
  
  const { message } = data;
  
  // Ensure any obfuscated attachments use our placeholder image
  message.attachments.forEach((att) => {
    if (att.__vml_is_obfuscated_image && att.url !== PLACEHOLDER_IMAGE) {
      att.url = PLACEHOLDER_IMAGE;
      att.proxy_url = PLACEHOLDER_IMAGE;
    }
  });
}));

// Patch the attachment component to force image display
const Attachment = findByName("Attachment") || findByProps("Attachment")?.Attachment;
if (Attachment) {
  patches.push(after("default", Attachment, ([props], component) => {
    if (props.attachment?.__vml_is_obfuscated_image) {
      return {
        ...component,
        props: {
          ...props,
          attachment: {
            ...props.attachment,
            url: PLACEHOLDER_IMAGE,
            proxy_url: PLACEHOLDER_IMAGE,
            content_type: "image/png",
            filename: "image.png"
          }
        }
      };
    }
    return component;
  }));
}

// Also patch any message update events to maintain our image URL
patches.push(before("dispatch", FluxDispatcher, ([event]) => {
  if (event.type === "MESSAGE_UPDATE" && event.message?.attachments) {
    event.message.attachments.forEach(att => {
      if (att.__vml_is_obfuscated_image && att.url !== PLACEHOLDER_IMAGE) {
        att.url = PLACEHOLDER_IMAGE;
        att.proxy_url = PLACEHOLDER_IMAGE;
      }
    });
  }
}));

export default function applyAttachmentPatcher() {
  return () => patches.forEach((unpatch) => unpatch());
}