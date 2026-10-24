/** Who built this, and where to find them. The footer on every page reads from here, so change it in one place. */
export const BRAND = {
  name: "Kushal Rana",
  links: [
    { id: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/in/kushal-rana" },
    { id: "x", label: "X", href: "https://x.com/KushalranaAI" },
    { id: "medium", label: "Medium", href: "https://kushalrana448.medium.com/" },
    { id: "youtube", label: "YouTube", href: "https://www.youtube.com/@naaku-o2x" },
  ],
} as const;

export type BrandLinkId = (typeof BRAND.links)[number]["id"];
