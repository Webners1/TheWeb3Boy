import type { MetadataRoute } from "next";

const LAST_REVIEWED = new Date("2026-09-06T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://theweb3boy.com/",
      lastModified: LAST_REVIEWED,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://theweb3boy.com/youvsbtc",
      lastModified: LAST_REVIEWED,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: "https://theweb3boy.com/dashboard",
      lastModified: LAST_REVIEWED,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];
}