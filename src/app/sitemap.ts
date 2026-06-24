import type { MetadataRoute } from 'next';
import { getAllPosts } from '@/lib/blog/posts';
import { publicItineraries } from '@/lib/public-itineraries';

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();

  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `https://ourtrips.to/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  const itineraryEntries: MetadataRoute.Sitemap = publicItineraries.map((itinerary) => ({
    url: itinerary.url,
    lastModified: new Date('2026-05-18'),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }));

  return [
    {
      url: 'https://ourtrips.to',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: 'https://ourtrips.to/blog',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://ourtrips.to/changelog',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: 'https://ourtrips.to/guide',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: 'https://ourtrips.to/itineraries',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...itineraryEntries,
    ...blogEntries,
  ];
}
