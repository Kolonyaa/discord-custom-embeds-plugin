import { getCurrentProfile } from "./storage";
import type { Profile } from "./types";

export const base64UrlEncodeUnicode = (str: string): string => {
  if (!str) return '';
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < utf8.length; i += chunkSize) {
    binary += String.fromCharCode(...utf8.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    ?.replace(/\+/g, '-')
    ?.replace(/\//g, '_')
    ?.replace(/=+$/, '');
};

export const buildEmbedUrl = (text: string): string => {
  if (text.includes('[⠀](') && text.includes('?text=')) return text;

  const encodedText = base64UrlEncodeUnicode(text);
  const currentProfile = getCurrentProfile();

  const params = new URLSearchParams({ text: encodedText });
  if (currentProfile.color) params.append("color", currentProfile.color?.replace("#", ""));
  if (currentProfile.title) params.append("title", base64UrlEncodeUnicode(currentProfile.title));
  if (currentProfile.siteName) params.append("siteName", base64UrlEncodeUnicode(currentProfile.siteName));

  if (currentProfile.avatarType !== "none") {
    params.append("avatarType", currentProfile.avatarType);
    const avatarUrl = currentProfile.avatarUrl || "https://files.catbox.moe/1f995e.webp";
    params.append("avatarUrl", encodeURIComponent(avatarUrl));
    if (currentProfile.avatarWidth) params.append("avatarWidth", currentProfile.avatarWidth);
    if (currentProfile.avatarHeight) params.append("avatarHeight", currentProfile.avatarHeight);
  }

  return `${currentProfile.baseUrl}?${params.toString()}`;
};
