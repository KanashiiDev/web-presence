const fs = require("fs");
const path = require("path");

module.exports = async function (context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName || process.platform;

  const tryRemove = (fileOrDir) => {
    const fullPath = path.join(appOutDir, fileOrDir);
    if (fs.existsSync(fullPath)) {
      const stat = fs.lstatSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.rmSync(fullPath);
      }
    }
  };

  console.log(`  • cleaning ${platform} build`);

  // Files to be cleaned according to the platform
  let toRemove = [];

  if (platform === "win32") {
    toRemove = [
      "vk_swiftshader.dll",
      "vk_swiftshader_icd.json",
      "swiftshader",
      "LICENSES.chromium.html",
      "ffmpeg.dll",
      "libGLESv2.dll",
      "vulkan-1.dll",
      "d3dcompiler_47.dll",
      "dxcompiler.dll",
      "dxil.dll",
      "libEGL.dll",
    ];
  } else if (platform === "linux") {
    toRemove = [
      "LICENSES.chromium.html",
      "vk_swiftshader_icd.json",
      "swiftshader",
      "chrome-sandbox",
      "libEGL.so",
      "libGLESv2.so",
      "libvk_swiftshader.so",
      "libvulkan.so.1",
    ];
  }

  toRemove.forEach(tryRemove);

  // Simplify the Locales folder
  const localesDir = path.join(appOutDir, "locales");
  if (fs.existsSync(localesDir)) {
    const localeFiles = fs.readdirSync(localesDir);
    localeFiles.forEach((file) => {
      if (file.toLowerCase() !== "en-us.pak") {
        tryRemove(path.join("locales", file));
      }
    });
  }

  if (platform === "linux") {
    try {
      const iconsSrcDir = path.join(__dirname, "..", "app", "assets", "icon");
      const iconSizes = [
        { size: "16x16", file: "16x16.png" },
        { size: "24x24", file: "24x24.png" },
        { size: "32x32", file: "32x32.png" },
        { size: "48x48", file: "48x48.png" },
        { size: "64x64", file: "64x64.png" },
        { size: "128x128", file: "128x128.png" },
        { size: "256x256", file: "256x256.png" },
        { size: "512x512", file: "512x512.png" },
      ];

      iconSizes.forEach(({ size, file }) => {
        const destDir = path.join(appOutDir, "usr", "share", "icons", "hicolor", size, "apps");
        try {
          fs.mkdirSync(destDir, { recursive: true });
          const src = path.join(iconsSrcDir, file);
          const dest = path.join(destDir, "web-presence-bridge.png");
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
          } else {
            // fallback: try icon.png if a size-specific file is missing
            const fallback = path.join(iconsSrcDir, "icon.png");
            if (fs.existsSync(fallback)) {
              fs.copyFileSync(fallback, dest);
            } else {
              console.warn(`  • icon source missing: ${src} and fallback ${fallback}`);
            }
          }
        } catch (err) {
          console.warn(`  • warning copying icon ${file} to ${destDir}: ${err.message}`);
        }
      });
    } catch (err) {
      console.warn(`  • warning preparing linux icons: ${err.message}`);
    }
  }
};
