import { findByProps } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { buildEmbedUrl } from "./embedBuilder";
import { getCurrentProfile } from "./storage";

const Messages = findByProps("sendMessage", "editMessage");

export function applyPatches() {
  const patches = [];

  patches.push(
    before("sendMessage", Messages, (args) => {
      const content = args[1]?.content;
      if (!content || content.includes('[⠀](') && content.includes('?text=')) return;
      args[1].content = `[⠀](${buildEmbedUrl(content)})`;
      console.log(`[CustomEmbed] Using profile: ${getCurrentProfile().name}`);
    })
  );

  patches.push(
    before("editMessage", Messages, (args) => {
      const content = args[2]?.content;
      if (!content || content.includes('[⠀](') && content.includes('?text=')) return;
      args[2].content = `[⠀](${buildEmbedUrl(content)})`;
    })
  );

  return () => patches.forEach(unpatch => unpatch());
}