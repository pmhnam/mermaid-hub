const mermaidLiveDomain = 'mermaid.live';
/**
 * Check if we're on mermaid.live
 */
export const isOnMermaidLive = (): boolean => {
  const domain = window.location.hostname;
  return domain === mermaidLiveDomain || domain.endsWith(`.${mermaidLiveDomain}`);
};
