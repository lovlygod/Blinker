import type { Configuration } from "electron-builder";

// Helper Functions //
/**
 * Get the custom app version from environment variables.
 * @returns The custom app version from environment variables, or undefined if not provided
 */
function getCustomAppVersion(): string | undefined {
  return process.env.CUSTOM_APP_VERSION;
}

// Options //
const customAppVersion = getCustomAppVersion();
const hasMacSigningSecrets = Boolean(process.env.CSC_LINK);
const hasMacNotarizationSecrets = Boolean(
  process.env.APPLE_API_KEY_DATA && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER
);
if (customAppVersion) {
  console.log(`Using custom version: ${customAppVersion}`);
}

// Main Configuration //
const electronBuilderConfig: Configuration = {
  appId: "dev.lovly.blinker",
  productName: "Blinker",
  ...(customAppVersion && { buildVersion: customAppVersion, extraMetadata: { version: customAppVersion } }),
  directories: {
    buildResources: "build"
  },
  files: [
    { from: "compiled-app", to: "out", filter: ["**/*"] },
    { from: "assets", to: "assets", filter: ["**/*"] },
    "package.json",
    "LICENSE",
    "README.md",
    "favicon.png",
    "dev.lovly.blinker.*",
    "!**/.vscode/*",
    "!build/**",
    "!src/*",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc,dev-app-update.yml}",
    "!{CHANGELOG.md,README.md,CONTRIBUTING.md,docs/**}",
    "!{scripts/**}",
    "!{.env,.env.*,.npmrc,bun.lock}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}"
  ],
  disableDefaultIgnoredFiles: true,
  protocols: [
    {
      name: "HyperText Transfer Protocol",
      schemes: ["http", "https"]
    }
  ],
  fileAssociations: [
    {
      ext: "htm",
      name: "HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "html",
      description: "HTML Document",
      role: "Viewer"
    },
    {
      ext: "mhtml",
      description: "MHTML Document",
      role: "Viewer"
    },
    {
      ext: "mht",
      description: "MHTML Document",
      role: "Viewer"
    },
    {
      ext: "shtml",
      name: "HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "xhtml",
      name: "Extensible HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "xhtm",
      name: "Extensible HyperText Markup File",
      role: "Viewer"
    },
    {
      ext: "pdf",
      description: "PDF Document",
      role: "Viewer"
    },
    {
      ext: "txt",
      description: "Text Document",
      role: "Viewer"
    },
    {
      ext: "svg",
      description: "SVG Image",
      role: "Viewer"
    },
    {
      ext: "xml",
      description: "XML Document",
      role: "Viewer"
    },
    {
      ext: "webp",
      description: "WebP Image",
      role: "Viewer"
    },
    {
      ext: "png",
      description: "PNG Image",
      role: "Viewer"
    },
    {
      ext: "jpg",
      description: "JPEG Image",
      role: "Viewer"
    },
    {
      ext: "jpeg",
      description: "JPEG Image",
      role: "Viewer"
    },
    {
      ext: "gif",
      description: "GIF Image",
      role: "Viewer"
    },
    {
      ext: "avif",
      description: "AVIF Image",
      role: "Viewer"
    }
  ],
  asarUnpack: ["assets/**", "node_modules/@img/**", "node_modules/better-sqlite3/**"],
  extraResources: [
    {
      from: "drizzle",
      to: "drizzle"
    }
  ],
  win: {
    executableName: "blinker",
    verifyUpdateCodeSignature: false
  },
  nsis: {
    artifactName: "${name}-${version}-setup.${ext}",
    shortcutName: "${productName}",
    uninstallDisplayName: "${productName}",
    createDesktopShortcut: "always"
  },
  mac: {
    category: "public.app-category.productivity",
    entitlements: "./build/entitlements.mac.plist",
    identity: hasMacSigningSecrets ? undefined : null,
    notarize: hasMacNotarizationSecrets,
    ...(hasMacSigningSecrets && { provisioningProfile: "build/profile.provisionprofile" }),
    binaries: ["Contents/PlugIns/DockTilePlugIn.plugin"],
    extendInfo: {
      CFBundleIconName: "AppIcon",
      NSUserActivityTypes: ["NSUserActivityTypeBrowsingWeb"],
      NSDockTilePlugIn: "DockTilePlugIn.plugin"
    }
  },
  dmg: {
    artifactName: "${name}-${version}-${arch}.${ext}",
    background: "./build/dmg-background.tiff",
    icon: "./build/volume-icon.icns"
  },
  linux: {
    target: ["AppImage", "deb"],
    category: "Network;WebBrowser;",
    maintainer: "lovlygod <whylovlygod@icloud.com>",
    executableArgs: ["--ozone-platform-hint=auto"],
    icon: "icon.png"
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}"
  },
  npmRebuild: false,
  publish: {
    provider: "github",
    owner: "lovlygod",
    repo: "Blinker",
    releaseType: "release"
  },
  electronDist: "node_modules/electron/dist",
  afterPack: "./build/hooks/afterPack.js",
  afterSign: "./build/hooks/afterSign.js"
};

export default electronBuilderConfig;
