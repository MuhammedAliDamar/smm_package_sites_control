import { env } from "./env";

export type ThorCharge = {
  value: string;
  currency_code: string;
  formatted: string;
};

export type ThorOrder = {
  id: number;
  external_id: string | null;
  user: string;
  creation_type: string | null;
  charge: ThorCharge | null;
  provider_charge: ThorCharge | null;
  provider_currency_charge: ThorCharge | null;
  link: string | null;
  start_count: number | null;
  quantity: number | null;
  service_id: number | null;
  service_type: string | null;
  service_name: string | null;
  provider: string | null;
  status: string;
  remains: number | null;
  is_autocomplete: boolean;
  is_active_autocomplete: boolean;
  created: string;
  created_timestamp: number;
  mode: string | null;
  ip_address: string | null;
};

export type ThorUser = {
  id: number;
  username: string;
  email: string;
  balance: ThorCharge;
  spent: ThorCharge;
  status: string;
  created: string;
  created_timestamp: number;
  last_auth: string | null;
  last_auth_timestamp: number | null;
};

type ThorListResponse<T> = {
  data: { count: number; list: T[] } | T[];
  pagination?: {
    prev_page_href: string;
    next_page_href: string;
    offset: number;
    limit: number;
  };
  error_message?: string;
  error_code?: number;
};

async function request<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<ThorListResponse<T>> {
  const url = new URL(env.THORSMM_API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      "X-Api-Key": env.THORSMM_API_KEY,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const json = (await res.json()) as ThorListResponse<T>;
  if (!res.ok || json.error_code) {
    throw new Error(
      `Thor API ${path} failed: ${res.status} ${json.error_message ?? "unknown"}`,
    );
  }
  return json;
}

export async function fetchOrdersForUser(
  username: string,
  opts: { limit?: number; maxPages?: number } = {},
): Promise<ThorOrder[]> {
  const limit = opts.limit ?? 100;
  const maxPages = opts.maxPages ?? 20;
  const out: ThorOrder[] = [];
  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const res = await request<ThorOrder>("/orders", {
      user: username,
      limit,
      offset,
    });
    const list = Array.isArray(res.data) ? res.data : res.data.list;
    if (!list || list.length === 0) break;
    out.push(...list);
    if (list.length < limit) break;
  }
  return out;
}

export async function fetchAllUsers(): Promise<ThorUser[]> {
  const limit = 100;
  const out: ThorUser[] = [];
  for (let page = 0; page < 50; page++) {
    const offset = page * limit;
    const res = await request<ThorUser>("/users", { limit, offset });
    const list = Array.isArray(res.data) ? res.data : res.data.list;
    if (!list || list.length === 0) break;
    out.push(...list);
    if (list.length < limit) break;
  }
  return out;
}
