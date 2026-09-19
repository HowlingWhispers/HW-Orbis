import { useEffect } from 'react';

const CANONICAL_BASE = 'https://lib.thehowlingwhispers.com';

export interface SEOProps {
  title: string;
  description: string;
  canonicalPath: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  structuredData?: Record<string, unknown>;
  noindex?: boolean;
  nofollow?: boolean;
}

export function useSEO(props: SEOProps) {
  const { title, description, canonicalPath, ogImage, ogType = 'website', structuredData, noindex, nofollow } = props;

  useEffect(() => {
    const canonicalUrl = `${CANONICAL_BASE}${canonicalPath}`;
    const imageUrl = ogImage ? `${CANONICAL_BASE}${ogImage}` : `${CANONICAL_BASE}/assets/orbis-banner.webp`;

    // Update title
    document.title = title;

    // Helper to set/update meta tag
    const setMeta = (name: string, content: string, isProperty = false) => {
      const selector = isProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`;
      let tag = document.querySelector<HTMLMetaElement>(selector);
      if (!tag) {
        tag = document.createElement('meta');
        if (isProperty) tag.setAttribute('property', name);
        else tag.setAttribute('name', name);
        document.head.appendChild(tag);
      }
      tag.setAttribute('content', content);
    };

    // Helper to remove meta tag
    const removeMeta = (name: string, isProperty = false) => {
      const selector = isProperty ? `meta[property="${name}"]` : `meta[name="${name}"]`;
      const tag = document.querySelector<HTMLMetaElement>(selector);
      if (tag) tag.remove();
    };

    // Basic meta
    setMeta('description', description);
    setMeta('robots', `${noindex ? 'noindex' : 'index'}, ${nofollow ? 'nofollow' : 'follow'}, max-snippet:-1, max-image-preview:large, max-video-preview:-1`);

    // Canonical
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', canonicalUrl);

    // Open Graph
    setMeta('og:type', ogType, true);
    setMeta('og:url', canonicalUrl, true);
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:image', imageUrl, true);
    setMeta('og:site_name', 'Orbis', true);
    setMeta('og:locale', 'en_US', true);

    // Twitter Card
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:url', canonicalUrl);
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);
    setMeta('twitter:image', imageUrl);

    // Structured Data
    if (structuredData) {
      let script = document.querySelector<HTMLScriptElement>('script[data-seo-schema="true"]');
      if (!script) {
        script = document.createElement('script');
        script.setAttribute('type', 'application/ld+json');
        script.setAttribute('data-seo-schema', 'true');
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(structuredData);
    } else {
      const script = document.querySelector<HTMLScriptElement>('script[data-seo-schema="true"]');
      if (script) script.remove();
    }

    // Cleanup function
    return () => {
      // Don't remove on unmount - let the next page set its own
    };
  }, [title, description, canonicalPath, ogImage, ogType, structuredData, noindex, nofollow]);
}