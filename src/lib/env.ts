function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export const env = {
  THORSMM_API_BASE: required("THORSMM_API_BASE"),
  THORSMM_API_KEY: required("THORSMM_API_KEY"),
  SESSION_SECRET: required("SESSION_SECRET"),
  CRON_SECRET: required("CRON_SECRET"),
  SYNC_INTERVAL_MINUTES: Number(process.env.SYNC_INTERVAL_MINUTES ?? 10),
};
