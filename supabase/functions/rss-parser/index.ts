import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { parseFeed } from "https://deno.land/x/rss@1.0.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author?: string;
  categories?: string[];
  content?: string;
}

interface ParsedFeed {
  title: string;
  description: string;
  link: string;
  language?: string;
  lastBuildDate?: string;
  items: FeedItem[];
}

type FeedLink = string | { href?: string };

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, keywords } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching RSS feed:', url);

    // Fetch the RSS feed
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch feed:', response.status, response.statusText);
      return new Response(
        JSON.stringify({ success: false, error: `Failed to fetch feed: ${response.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const xml = await response.text();
    console.log('Received XML content, length:', xml.length);

    // Parse the feed
    const feed = await parseFeed(xml);
    console.log('Parsed feed:', feed.title?.value || 'Unknown');

    // Transform feed items
    let items: FeedItem[] = feed.entries?.map((entry, index) => ({
      id: entry.id || `${url}-${index}`,
      title: entry.title?.value || 'Untitled',
      link: entry.links?.[0]?.href || '',
      description: entry.description?.value || entry.content?.value?.substring(0, 300) || '',
      pubDate: entry.published?.toISOString() || entry.updated?.toISOString() || new Date().toISOString(),
      author: entry.author?.name || entry.author?.email || undefined,
      categories: entry.categories?.map(c => c.term || c.label || '').filter(Boolean) || [],
      content: entry.content?.value || entry.description?.value || '',
    })) || [];

    // Apply keyword filtering if provided
    if (keywords) {
      const { whitelist, blacklist } = keywords;
      
      if (whitelist && whitelist.length > 0) {
        items = items.filter(item => {
          const text = `${item.title} ${item.description} ${item.content}`.toLowerCase();
          return whitelist.some((kw: string) => text.includes(kw.toLowerCase()));
        });
      }
      
      if (blacklist && blacklist.length > 0) {
        items = items.filter(item => {
          const text = `${item.title} ${item.description} ${item.content}`.toLowerCase();
          return !blacklist.some((kw: string) => text.includes(kw.toLowerCase()));
        });
      }
    }

    const feedLink = feed.links?.[0] as FeedLink | undefined;
    const parsedFeed: ParsedFeed = {
      title: feed.title?.value || 'Unknown Feed',
      description: feed.description || '',
      link: typeof feedLink === 'string' ? feedLink : (feedLink?.href || url),
      language: feed.language || undefined,
      lastBuildDate: feed.updateDate?.toISOString() || undefined,
      items,
    };

    console.log('Returning', items.length, 'items');

    return new Response(
      JSON.stringify({ success: true, data: parsedFeed }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error parsing RSS feed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to parse RSS feed';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});