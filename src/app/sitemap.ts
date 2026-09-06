import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://theweb3boy.com/",
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://theweb3boy.com/youvsbtc",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: "https://theweb3boy.com/dashboard",
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];
}