import { env } from "./env";

type ScrapeResult = {
  followers?: number;
  following?: number;
  likes?: number;
  views?: number;
  comments?: number;
  shares?: number;
  subscribers?: number;
  members?: number;
  posts?: number;
  videos?: number;
  saves?: number;
  retweets?: number;
  replies?: number;
};

async function counterApiCall(
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<any> {
  const url = new URL(env.COUNTER_API_BASE + path);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.COUNTER_API_KEY) headers["X-API-Key"] = env.COUNTER_API_KEY;

  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json();
  if (res.ok && json?.status === "success") return json.data;
  throw new Error(
    `counter_http_${res.status} ${path} ${json?.message ?? JSON.stringify(json).slice(0, 150)}`,
  );
}

function detectPlatform(url: string): string | null {
  if (/instagram\.com|instagr\.am/i.test(url)) return "instagram";
  if (/facebook\.com|fb\.com|fb\.watch/i.test(url)) return "facebook";
  if (/tiktok\.com|vm\.tiktok|vt\.tiktok/i.test(url)) return "tiktok";
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/(?:x\.com|twitter\.com)/i.test(url)) return "x";
  if (/t\.me/i.test(url)) return "telegram";
  if (/linkedin\.com/i.test(url)) return "linkedin";
  if (/kick\.com/i.test(url)) return "kick";
  if (/threads\.net/i.test(url)) return "threads";
  return null;
}

function detectServiceType(name: string | null | undefined): string | null {
  const n = (name || "").toLowerCase();
  if (/\bfollower/.test(n)) return "followers";
  if (/\bsubscrib/.test(n)) return "subscribers";
  if (/\bmember/.test(n)) return "members";
  if (/\bcomment/.test(n)) return "comments";
  if (/\b(view|impression|watch)/.test(n)) return "views";
  if (/\b(share|repost|retweet)/.test(n)) return "shares";
  if (/\b(like|love|reaction)/.test(n)) return "likes";
  return null;
}

async function scrape(platform: string, url: string, serviceType?: string): Promise<ScrapeResult> {
  switch (platform) {
    case "instagram": {
      const postMatch = url.match(/instagram\.com\/p\/([A-Za-z0-9_-]+)/);
      const reelMatch = url.match(/instagram\.com\/reels?\/([A-Za-z0-9_-]+)/);
      const profileMatch = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/);
      if (postMatch || reelMatch) {
        const shortcode = (postMatch || reelMatch)![1];
        const data = await counterApiCall("/instagram/post", {
          url: shortcode,
          with_views: serviceType?.toLowerCase() === "views",
        });
        return { likes: data?.likes ?? 0, comments: data?.comments ?? 0, views: data?.video_view_count ?? data?.video_play_count ?? 0 };
      }
      if (profileMatch) {
        const data = await counterApiCall("/instagram/profile", { username: profileMatch[1] });
        return { followers: data?.followers ?? 0, following: data?.following ?? 0, posts: data?.posts_count ?? 0 };
      }
      throw new Error("Invalid Instagram link");
    }
    case "facebook": {
      const data = await counterApiCall("/facebook/link", { url });
      return { followers: data?.followers ?? 0, likes: data?.likes ?? 0, comments: data?.comments ?? 0, shares: data?.shares ?? 0, views: data?.views ?? 0 };
    }
    case "tiktok": {
      const profileMatch = url.match(/tiktok\.com\/@([\w.]+)$/);
      if (profileMatch) {
        const data = await counterApiCall("/tiktok/user", { username: profileMatch[1] });
        return { followers: data?.followers ?? 0, following: data?.following ?? 0, likes: data?.hearts ?? 0, videos: data?.videos ?? 0 };
      }
      const data = await counterApiCall("/tiktok/video", { url });
      return { likes: data?.likes ?? 0, comments: data?.comments ?? 0, shares: data?.shares ?? 0, views: data?.plays ?? 0, saves: data?.collects ?? 0 };
    }
    case "youtube": {
      const data = await counterApiCall("/youtube/link", { url });
      return { views: data?.views ?? 0, likes: data?.likes ?? 0, comments: data?.comments ?? 0, subscribers: data?.subscribers ?? 0, videos: data?.videos ?? 0 };
    }
    case "x":
    case "twitter": {
      const tweetMatch = url.match(/(?:x\.com|twitter\.com)\/(?:[^/]+\/)?(?:i\/)?status\/(\d+)/);
      if (tweetMatch) {
        const data = await counterApiCall("/x/tweet", { id: tweetMatch[1] });
        return { likes: data?.favorites ?? 0, retweets: (data?.retweets ?? 0) + (data?.quotes ?? 0), comments: data?.replies ?? 0, saves: data?.bookmarks ?? 0, views: data?.views ?? 0 };
      }
      const profileMatch = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/);
      if (profileMatch) {
        const data = await counterApiCall("/x/user", { username: profileMatch[1] });
        return { followers: data?.followers ?? 0, following: data?.following ?? 0, posts: data?.tweet_count ?? 0 };
      }
      throw new Error("Invalid X link");
    }
    case "telegram": {
      const data = await counterApiCall("/telegram/link", { url });
      return { members: data?.members ?? 0, views: data?.views ?? 0 };
    }
    case "kick": {
      const data = await counterApiCall("/kick/link", { url });
      return { followers: data?.followers ?? 0, views: data?.viewer_count ?? 0 };
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function pickCount(result: ScrapeResult, serviceType: string): number | null {
  const t = serviceType.toLowerCase();
  if (t === "followers") return result.followers ?? result.likes ?? null;
  if (t === "likes") return result.likes ?? null;
  if (t === "views") return result.views ?? null;
  if (t === "comments") return result.comments ?? null;
  if (t === "subscribers") return result.subscribers ?? result.followers ?? null;
  if (t === "members") return result.members ?? result.followers ?? null;
  if (t === "shares") return result.shares ?? null;
  if (t === "reposts") return result.retweets ?? null;
  if (t === "saves") return result.saves ?? null;
  return null;
}

export type CheckResult = {
  orderId: number;
  currentCount: number | null;
  dropRate: number | null;
  error: string | null;
};

export async function checkOrder(order: {
  id: number;
  link: string | null;
  quantity: number | null;
  startCount: number | null;
  serviceName: string | null;
  serviceType: string | null;
}): Promise<CheckResult> {
  if (!order.link) return { orderId: order.id, currentCount: null, dropRate: null, error: "no link" };
  if (!order.quantity || !order.startCount) return { orderId: order.id, currentCount: null, dropRate: null, error: "missing quantity or startCount" };

  const platform = detectPlatform(order.link);
  if (!platform) return { orderId: order.id, currentCount: null, dropRate: null, error: "unknown platform" };

  const svcType = order.serviceType
    ? detectServiceType(order.serviceType) ?? detectServiceType(order.serviceName)
    : detectServiceType(order.serviceName);
  if (!svcType) return { orderId: order.id, currentCount: null, dropRate: null, error: "unknown service type" };

  try {
    const result = await scrape(platform, order.link, svcType);
    const currentCount = pickCount(result, svcType);
    if (currentCount === null || currentCount === 0) {
      return { orderId: order.id, currentCount, dropRate: null, error: "count unavailable" };
    }

    const expected = order.startCount + order.quantity;
    const drop = expected - currentCount;
    const dropRate = parseFloat(((drop / order.quantity) * 100).toFixed(2));

    return { orderId: order.id, currentCount, dropRate, error: null };
  } catch (e) {
    return { orderId: order.id, currentCount: null, dropRate: null, error: e instanceof Error ? e.message.slice(0, 200) : "unknown error" };
  }
}
