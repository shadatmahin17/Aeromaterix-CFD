/**
 * Synchronizes runtime canonical URL, OpenGraph URL, image absolute URLs,
 * and JSON-LD structured data URL with the active origin and pathname.
 */
export function syncRuntimeSeoMetadata(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const origin = window.location.origin;
  const canonicalUrl = `${origin}${window.location.pathname}`;
  const absoluteLogoUrl = `${origin}/aerolab-logo.png`;

  const canonicalLink = document.querySelector('link[rel="canonical"]');
  if (canonicalLink) {
    canonicalLink.setAttribute('href', canonicalUrl);
  }

  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    ogUrl.setAttribute('content', canonicalUrl);
  }

  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    ogImage.setAttribute('content', absoluteLogoUrl);
  }

  const twitterImage = document.querySelector('meta[name="twitter:image"]');
  if (twitterImage) {
    twitterImage.setAttribute('content', absoluteLogoUrl);
  }

  const ldScript = document.getElementById('aerolab-jsonld');
  if (ldScript && ldScript.textContent) {
    try {
      const data = JSON.parse(ldScript.textContent);
      if (Array.isArray(data['@graph'])) {
        for (const node of data['@graph']) {
          if (node['@type'] === 'WebApplication' || node['@type'] === 'WebSite' || node['@type'] === 'LearningResource') {
            node.url = canonicalUrl;
          }
          if (node['@type'] === 'WebApplication') {
            node.image = absoluteLogoUrl;
            node.screenshot = absoluteLogoUrl;
          }
        }
        ldScript.textContent = JSON.stringify(data);
      }
    } catch {
      // Keep static JSON-LD intact if parsing fails
    }
  }
}
