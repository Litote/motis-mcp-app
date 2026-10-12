// Bundles each MCP App view into a single self-contained HTML file (dist/<view>.html):
// hosts load the view from a ui:// resource, without access to other files.
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const views = ["explorer", "departures", "itinerary", "rentals"];

for (const [index, view] of views.entries()) {
  await build({
    configFile: false,
    root: "src",
    logLevel: "warn",
    plugins: [viteSingleFile()],
    build: {
      outDir: "../dist",
      emptyOutDir: index === 0,
      rollupOptions: { input: `src/${view}.html` },
    },
  });
  console.log(`built dist/${view}.html`);
}
