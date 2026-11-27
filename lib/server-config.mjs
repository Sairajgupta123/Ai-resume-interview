const PLACEHOLDER_VALUES = new Set([
  "change-this-to-a-long-password",
  "replace-with-a-random-secret-at-least-32-characters-long",
  "your_xai_api_key_here"
]);

export function getProductionConfigErrors(env = process.env) {
  if (env.NODE_ENV !== "production") return [];
  const errors = [];
  const username = env.EMPLOYER_USERNAME?.trim();
  const password = env.EMPLOYER_PASSWORD || "";
  const sessionSecret = env.SESSION_SECRET || "";
  const apiKey = env.XAI_API_KEY || "";
  const endpoint = env.S3_ENDPOINT || "";
  const bucket = env.S3_BUCKET || "";
  const accessKey = env.S3_ACCESS_KEY_ID || "";
  const secretKey = env.S3_SECRET_ACCESS_KEY || "";
  const databaseUrl = env.DATABASE_URL || "";

  if (!databaseUrl.trim()) errors.push("DATABASE_URL must be configured.");
  if (!username || username.toLowerCase() === "admin") {
    errors.push("Set EMPLOYER_USERNAME to a non-default production username.");
  }
  if (password.length < 16 || PLACEHOLDER_VALUES.has(password)) {
    errors.push("Set EMPLOYER_PASSWORD to a unique password of at least 16 characters.");
  }
  if (sessionSecret.length < 32 || PLACEHOLDER_VALUES.has(sessionSecret)) {
    errors.push("Set SESSION_SECRET to a unique random value of at least 32 characters.");
  }
  if (!apiKey.trim() || PLACEHOLDER_VALUES.has(apiKey)) {
    errors.push("XAI_API_KEY must be configured for AI interviews.");
  }

  const storageValues = [endpoint, bucket, accessKey, secretKey];
  if (storageValues.some(value => !value.trim())) {
    errors.push("Configure S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for private production recordings.");
  }
  if (endpoint) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:") errors.push("S3_ENDPOINT must use HTTPS in production.");
      if (url.username || url.password || url.search || url.hash) {
        errors.push("S3_ENDPOINT must not contain credentials, query parameters or a fragment.");
      }
    } catch {
      errors.push("S3_ENDPOINT must be a valid absolute HTTPS URL.");
    }
  }
  return errors;
}

export function assertProductionConfig(env = process.env) {
  const errors = getProductionConfigErrors(env);
  if (errors.length) {
    throw new Error(["Production configuration is incomplete:", ...errors.map(error => "- " + error)].join("\\n"));
  }
}
