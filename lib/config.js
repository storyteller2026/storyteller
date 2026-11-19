// Central place for settings read from environment variables.
const env = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;

export const config = {
  anthropicKey: () => env("ANTHROPIC_API_KEY"),
  replicateToken: () => env("REPLICATE_API_TOKEN"),
  blobToken: () => env("BLOB_READ_WRITE_TOKEN"),
  betaCode: () => env("BETA_CODE"),
  adminCode: () => env("ADMIN_CODE"),
  appSecret: () => env("APP_SECRET") || env("REPLICATE_API_TOKEN") || env("ANTHROPIC_API_KEY") || "storyteller-dev-secret",
  storyModel: () => env("STORY_MODEL", "claude-sonnet-5-5"),
  storyModelFast: () => env("STORY_MODEL_FAST", "claude-haiku-5-5"),
  imageModel: () => env("IMAGE_MODEL", "black-forest-labs/flux-2-pro"),
  sheetModel: () => env("SHEET_MODEL", "black-forest-labs/flux-kontext-pro"),
  videoModel: () => env("VIDEO_MODEL", "minimax/h3-lite"),
  videoDuration: () => Math.min(10, Math.max(4, parseInt(env("VIDEO_DURATION", "6"), 10) || 6)),
  // Demo mode: when a provider key is missing, that provider is simulated.
  mockText: () => !env("ANTHROPIC_API_KEY"),
  mockMedia: () => !env("REPLICATE_API_TOKEN"),
};
