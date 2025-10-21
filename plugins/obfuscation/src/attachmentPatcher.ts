// applyAttachmentPatcher.ts
import { after } from "@vendetta/patcher";
import { findByName, findByStoreName } from "@vendetta/metro";

const RowManager = findByName("RowManager");
const MessageStore = findByStoreName("MessageStore");

const PLACEHOLDER_URL = "https://i.imgur.com/7dZrkGD.png";
const ATTACHMENT_FILENAME = "obfuscated_attachment.txt";
const FILE_TYPES = new Set(["txt"]);

function makeFakeEmbed(filename: string, size: number) {
  return {
    type: "image",
    url: PLACEHOLDER_URL,
    proxy_url: PLACEHOLDER_URL,
    width: 200,
    height: 200,
    bodyTextColor: 0,
    backgroundColor: 0xffffff,
    borderColor: 0xcccccc,
    headerText: filename,
    titleText: `File — ${size} bytes`,
    structurableSubtitleText: null,
    extendedType: 0,
    participantAvatarUris: [],
    acceptLabelText: null,
    splashUrl: null,
    ctaEnabled: false,
    noParticipantsText: null,
  };
}

export default function applyAttachmentPatcher() {
  const patches: (() => void)[] = [];

  if (RowManager?.prototype?.generate) {
    patches.push(
      after("generate", RowManager.prototype, (_, row) => {
        const { message } = row;
        if (!message?.attachments?.length) return;

        const normalAttachments: any[] = [];
        const fakeEmbeds: any[] = [];

        message.attachments.forEach((att) => {
          const ext = att.filename?.split(".").pop()?.toLowerCase();
          if (att.filename === ATTACHMENT_FILENAME || FILE_TYPES.has(ext)) {
            fakeEmbeds.push(makeFakeEmbed(att.filename, att.size || 0));
          } else {
            normalAttachments.push(att);
          }
        });

        if (fakeEmbeds.length) {
          // Push embeds to the message so Discord renders them
          if (!message.embeds) message.embeds = [];
          message.embeds.push(...fakeEmbeds);

          // Remove original txt attachments
          message.attachments = normalAttachments;

          // Optional: force content to avoid collapsing
          if (!message.content || message.content === "") {
            message.content = "\u200b"; // invisible character
          }

          // Update the message in the store so the UI refreshes
          if (MessageStore?._updateMessage) {
            MessageStore._updateMessage(message.channel_id, message.id, message);
          }
        }
      })
    );
  }

  return () => patches.forEach((unpatch) => unpatch());
}
