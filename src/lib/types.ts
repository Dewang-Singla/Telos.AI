export const categories = [
  "All intentions",
  "Social & fun",
  "Learn & grow",
  "Build & create",
  "Sports & outdoors",
  "Work & opportunities",
  "Community",
] as const;
export const roles = [
  "open",
  "socialize",
  "collaborate",
  "learn",
  "teach",
  "hire",
  "work",
  "request",
  "offer",
  "organize",
  "join",
] as const;
export type Role = (typeof roles)[number];
export type Mode = "online" | "in-person" | "hybrid";
export type Profile = {
  id: string;
  username: string;
  name: string;
  bio: string;
  city: string;
  state?: string;
  country?: string;
  interests: string[];
  skills: string[];
  avatar_url: string | null;
  cover_url: string | null;
  portfolio: string;
  visibility: "public" | "connections";
  created_at?: string;
  details?: { label: string; value: string }[];
  is_demo?: boolean;
};
export type Intent = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  role: Role;
  mode: Mode;
  city: string;
  tags: string[];
  skills: string[];
  starts_at: string | null;
  ends_at: string | null;
  participants: number;
  status: "active" | "paused" | "completed";
  created_at: string;
  profile: Profile;
  saved?: boolean;
  distance_km?: number | null;
  is_online?: boolean;
  show_on_profile?: boolean;
  is_saved?: boolean;
};
export type Interpretation = {
  title: string;
  category: string;
  role: Role;
  mode: Mode;
  tags: string[];
  skills: string[];
  city: string;
  participants: number;
  starts_at: string | null;
  ends_at: string | null;
  topic: string;
};
export type PersonMatch = {
  profile: Profile;
  is_online: boolean;
  distance_km: number | null;
  matched_intent: string | null;
};
export type MatchPage = {
  people: PersonMatch[];
  next_offset: number | null;
  mode: "ai" | "keyword";
};
export type SocialPost = {
  id: string;
  user_id: string;
  body: string;
  media_paths: string[];
  media_urls: string[];
  visibility: "public" | "connections";
  created_at: string;
  updated_at: string;
  profile: Profile;
  like_count: number;
  comment_count: number;
  liked: boolean;
  saved: boolean;
};
export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile: Profile;
};
export type Connection = {
  id: string;
  sender_id: string;
  recipient_id: string;
  intent_id: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled" | "removed";
  note: string;
  created_at: string;
  sender: Profile;
  recipient: Profile;
};
export type Conversation = {
  id: string;
  request_id: string;
  created_at: string;
  conversation_members: {
    user_id: string;
    last_read_at: string;
    profile: Profile;
  }[];
  unread?: number;
  last_message?: string;
  last_message_at?: string;
  can_message: boolean;
};
export type Relationship = {
  following: boolean;
  follows_you: boolean;
  follower_count: number;
  following_count: number;
  connection_count: number;
  connection: "none" | "sent" | "received" | "connected";
  request_id: string | null;
  conversation_id: string | null;
};
export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};
export type Notification = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  href: string;
  read_at: string | null;
  created_at: string;
};
