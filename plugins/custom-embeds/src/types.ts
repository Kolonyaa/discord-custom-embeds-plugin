export interface Profile {
  id: string;
  name: string;
  baseUrl: string;
  color: string;
  title: string;
  siteName: string;
  avatarType: "none" | "small" | "large";
  avatarUrl: string;
  avatarWidth: string;
  avatarHeight: string;
}