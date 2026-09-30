# <img align="center" src="app/assets/icon/icon.png" alt="Extension Icon" width="48" height="48"> Web Presence

<p align="center">
  <strong>Show what you're listening to or watching on Discord — from ANY website!</strong>
</p>
<p align="center">
   <a href="https://www.star-history.com/#kanashiiDev/web-presence&type=date&legend=top-left" target="_blank"><img src="https://img.shields.io/github/stars/KanashiiDev/web-presence?style=for-the-badge&logo=github&color=yellow&cacheSeconds=3600" alt="GitHub Stars"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases" target="_blank"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgist.githubusercontent.com%2FKanashiiDev%2Faf52962d2844e33de8e0bbbb11040b54%2Fraw%2Fweb-presence-stats.json&query=%24.total&style=for-the-badge&label=Downloads&color=blue&cacheSeconds=3600" alt="Total Downloads"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest" target="_blank"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgist.githubusercontent.com%2FKanashiiDev%2Faf52962d2844e33de8e0bbbb11040b54%2Fraw%2Fweb-presence-stats.json&query=%24.latest&style=for-the-badge&label=Downloads%40Latest&color=green&cacheSeconds=3600" alt="Latest Release"></a>
</p>
<p align="center">

**Web Presence** is an <ins>open-source</ins> project that combines a browser extension with a lightweight desktop application to show what you’re listening to or watching directly in your Discord Rich Presence.

Its customizable selector system lets anyone add support for almost any music or video website without writing code. For more complex integrations, Web Presence also includes an advanced userscript engine.

## Installation Guide

To display your media status on Discord, install **both components**.

If you only use Discord in your browser, the desktop app is not required.

### Step 1: Install the Browser Extension

Detects music and videos on supported websites and sends playback data to the desktop bridge.

- Compatible with Chrome, Firefox, and all Chromium-based browsers (Opera, Brave, Edge, etc.).

<p>
  <a href="https://chromewebstore.google.com/detail/mpnijlpiepmpgoamimfmbdmglpdjmoic" target="_blank"><img src="https://img.shields.io/badge/-Chrome%20Web%20Store-555?logo=googlechrome&logoColor=white&style=for-the-badge&label=%20&labelColor=4285F4" alt="Get it on Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/web-presence-for-discord/" target="_blank"><img src="https://img.shields.io/badge/-Firefox%20Addons-555?logo=firefox-browser&logoColor=white&style=for-the-badge&label=%20&labelColor=orange" alt="Get it on Firefox Add-ons"></a>
</p>

### Step 2: Install the Desktop App

Acts as a bridge between the browser extension and Discord, allowing your media status to appear in Discord Rich Presence.

- It runs in the background as a tray-only application with no visible interface.
- Manage all configuration options through the dashboard at `http://localhost:3000`.

<p>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x64-installer.exe">
    <img src="https://img.shields.io/badge/Windows-Installer (x64)-0078D6?logo=windows11&logoColor=white&style=for-the-badge" alt="Windows Installer (x64)"></a>
    <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x64.zip">
    <img src="https://img.shields.io/badge/%20-ZIP (x64)-0078D6?logo=windows11&logoColor=white&style=for-the-badge" alt="Windows ZIP (x64)">
  </a>
  <br>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-universal.dmg">
    <img src="https://img.shields.io/badge/macOS%2013+-DMG (Universal)-161616?logo=apple&logoColor=white&style=for-the-badge" alt="macOS DMG (Universal)"></a>
  <br>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x86_64.AppImage">
    <img src="https://img.shields.io/badge/Linux-AppImage%20(x64)-536c7b?logo=linux&logoColor=black&style=for-the-badge" alt="Linux AppImage x86_64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x86_64-anylinux.AppImage">
    <img src="https://img.shields.io/badge/%20-AppImage%20Anylinux%20(x64)-536c7b?style=for-the-badge" alt="Linux Anylinux AppImage x86_64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-amd64.deb">
    <img src="https://img.shields.io/badge/%20-DEB%20(x64)-A81D33?logo=debian&logoColor=white&style=for-the-badge" alt="Linux DEB x64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x86_64.rpm">
    <img src="https://img.shields.io/badge/%20-RPM%20(x64)-d12626?logo=redhat&logoColor=white&style=for-the-badge" alt="Linux RPM x64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.3.0-x64.pkg.tar.zst">
    <img src="https://img.shields.io/badge/%20-Pacman%20(x64)-1482b8?logo=arch-linux&logoColor=white&style=for-the-badge" alt="Linux Pacman x64"></a>
</p>

<details>
<summary><strong>Additional Linux Installation Options</strong></summary>

**Arch Linux**

Install via the one-shot installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/KanashiiDev/web-presence/main/scripts/install-arch.sh | bash
```

Or install the `.pkg.tar.zst` package directly from [GitHub Releases](https://github.com/KanashiiDev/web-presence/releases/latest):

```bash
sudo pacman -U web-presence-<version>-x64.pkg.tar.zst
```

**NixOS / Nix**

Quick install without modifying your configuration:

```bash
nix profile add github:KanashiiDev/web-presence
```

Or add as a flake input for NixOS module / home-manager support:

```nix
inputs.web-presence.url = "github:KanashiiDev/web-presence";
```

**GNOME Users**

Enable the _AppIndicator / KStatusNotifierItem_ extension.

**Required Packages**

Some distributions require an additional package for tray icon support:

```bash
sudo apt install libayatana-appindicator3-1  # Debian/Ubuntu
```

**Tray Icon Not Appearing**

- Install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or run the AppImage from a terminal once
- On GNOME + Wayland: switch to an X11 session or enable AppIndicator support

**Auto-Start Note**

Moving the AppImage after its first launch requires re-enabling "Run at Startup" from the tray menu.

</details>

### Step 3: Install the Activities

Open the activity library from the extension popup, install the activities you want, then visit the website and start playing.

---

## 🚀 Features

- No login required, works entirely locally
- Discord Web support
- Community-supported integrations through the [Activity Library](https://github.com/KanashiiDev/web-presence-activities).
- Easy to extend - add support for almost any music or video site using selectors or userscripts
- Filter system - block or replace songs by artist/title, per site or globally
- Both listening and watching activity support
- Live activity output - WebNowPlaying (Rainmeter & OBS), plus plain-text/JSON files on disk
- Fully customizable Discord status per site - control the artist, source, cover art, buttons, timestamps, and more
- Open-source and community-driven

---

## 🎵 Supported Websites & Platforms

These integrations are available through the activity library.

Additional sites can be added using the built-in selector system or the UserScript manager. See [How to Add a New Site](#-how-to-add-a-new-site) for details.

<table>
  <tr>
    <td><a href="https://accuRadio.com"><img src="https://www.google.com/s2/favicons?domain=accuRadio.com" width="15"></a> AccuRadio</td>
    <td><a href="https://music.amazon.com"><img src="https://www.google.com/s2/favicons?domain=music.amazon.com" width="15"></a> Amazon Music</td>
    <td><a href="https://music.apple.com"><img src="https://www.google.com/s2/favicons?domain=music.apple.com" width="15"></a> Apple Music</td>
    <td><a href="https://asiaDreamRadio.com"><img src="https://www.google.com/s2/favicons?domain=asiaDreamRadio.com" width="15"></a> Asia Dream Radio</td>
    <td><a href="https://www.bilibili.tv"><img src="https://www.google.com/s2/favicons?domain=bilibili.tv" width="15"></a> Bilibili TV</td>
  </tr>
  <tr>
    <td><a href="https://crunchyroll.com"><img src="https://www.google.com/s2/favicons?domain=crunchyroll.com" width="15"></a> Crunchyroll</td>
    <td><a href="https://www.deezer.com"><img src="https://www.google.com/s2/favicons?domain=deezer.com" width="15"></a> Deezer</td>
    <td><a href="https://gensokyoradio.net"><img src="https://www.google.com/s2/favicons?domain=gensokyoradio.net" width="15"></a> Gensokyo Radio</td>
    <td><a href="https://www.iheart.com"><img src="https://www.google.com/s2/favicons?domain=iheart.com" width="15"></a> iHeartRadio</td>
    <td><a href="https://kick.com"><img src="https://www.google.com/s2/favicons?domain=kick.com" width="15"></a> Kick</td>
  </tr>
  <tr>
    <td><a href="https://listen.moe"><img src="https://www.google.com/s2/favicons?domain=listen.moe" width="15"></a> Listen.moe</td>
    <td><a href="https://www.netflix.com"><img src="https://www.google.com/s2/favicons?domain=netflix.com" width="15"></a> Netflix</td>
    <td><a href="https://www.onlineradiobox.com"><img src="https://www.google.com/s2/favicons?domain=onlineradiobox.com" width="15"></a> OnlineRadioBox</td>
    <td><a href="https://www.pandora.com"><img src="https://www.google.com/s2/favicons?domain=pandora.com" width="15"></a> Pandora</td>
    <td><a href="https://plaza.one"><img src="https://www.google.com/s2/favicons?domain=plaza.one" width="15"></a> Nightwave Plaza</td>
  </tr>
  <tr>
    <td><a href="https://r-a-d.io"><img src="https://www.google.com/s2/favicons?domain=r-a-d.io" width="15"></a> r/a/dio</td>
    <td><a href="https://radio.garden"><img src="https://www.google.com/s2/favicons?domain=radio.garden" width="15"></a> Radio Garden</td>
    <td><a href="https://www.radio.net"><img src="https://www.google.com/s2/favicons?domain=radio.net" width="15"></a> Radio.net</td>
    <td><a href="https://soundcloud.com"><img src="https://www.google.com/s2/favicons?domain=soundcloud.com" width="15"></a> SoundCloud</td>
    <td><a href="https://tidal.com"><img src="https://www.google.com/s2/favicons?domain=tidal.com" width="15"></a> Tidal</td>
  </tr>
  <tr>
    <td><a href="https://tunein.com"><img src="https://www.google.com/s2/favicons?domain=tunein.com" width="15"></a> TuneIn</td>
    <td><a href="https://www.twitch.tv"><img src="https://www.google.com/s2/favicons?domain=twitch.tv" width="15"></a> Twitch</td>
    <td><a href="https://www.vk.com"><img src="https://www.google.com/s2/favicons?domain=vk.com" width="15"></a> VK</td>
    <td><a href="https://www.youtube.com"><img src="https://www.google.com/s2/favicons?domain=youtube.com" width="15"></a> YouTube</td>
    <td><a href="https://music.youtube.com"><img src="https://www.google.com/s2/favicons?domain=music.youtube.com" width="15"></a> YouTube Music</td>
  </tr>
</table>

---

## 🔗 Quick Links

- 🐞 **[Troubleshooting](https://github.com/KanashiiDev/web-presence/wiki/Troubleshooting):** Fix common issues and errors.
- 🧩 **[Adding a New Site](https://github.com/KanashiiDev/web-presence/wiki/Adding-a-New-Website):** Guide for adding music or video platform support.
- 📚 **[Filter Management](https://github.com/KanashiiDev/web-presence/wiki/Filter-Management):** Learn how to block or customize activities.
- 📤 **[Live Activity Output](https://github.com/KanashiiDev/web-presence/wiki/Live-Activity-Output):** Setup guide for Rainmeter, OBS, and file output.
- 💻 **[Developer Setup](https://github.com/KanashiiDev/web-presence/wiki/Developer-Setup):** Build instructions and NPM scripts.

---

## 👥 Community

- **Activities Repository**: [Activity Library](https://github.com/KanashiiDev/web-presence-activities)
- **Discord Server**: [Web Presence Discord](https://discord.gg/BWqcVKmb2P)

---

## 🤝 Contributing

There are several ways to contribute:

- **Create new Activities** - [Activity Library](https://github.com/KanashiiDev/web-presence-activities)
- **Help translate** the project on [Crowdin](https://crowdin.com/project/web-presence)
- **Report bugs or request features** via [GitHub Issues](https://github.com/kanashiiDev/web-presence/issues)
- **Support the project** by sharing it and helping others discover it

---

## 📄 License

This project is licensed under the MIT License. See the [`LICENSE`](LICENSE) file for details.
