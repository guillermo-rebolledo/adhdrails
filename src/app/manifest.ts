import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rails — Calm Focus",
    short_name: "Rails",
    description: "Calm focus for the work that matters now.",
    start_url: "/today",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
  };
}
