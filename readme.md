# <img align="center" src="app/assets/icon/icon.png" alt="Extension Icon" width="48" height="48"> Web Presence

<p align="center">
  <strong>Show what you're listening to or watching on Discord — from ANY music or video website</strong>
</p>
<p align="center">
   <a href="https://www.star-history.com/#kanashiiDev/web-presence&type=date&legend=top-left" target="_blank"><img src="https://img.shields.io/github/stars/KanashiiDev/web-presence?style=for-the-badge&logo=github&color=yellow&cacheSeconds=3600" alt="GitHub Stars"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases" target="_blank"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgist.githubusercontent.com%2FKanashiiDev%2Faf52962d2844e33de8e0bbbb11040b54%2Fraw%2Fweb-presence-stats.json&query=%24.total&style=for-the-badge&label=Downloads&color=blue&cacheSeconds=3600" alt="Total Downloads"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest" target="_blank"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgist.githubusercontent.com%2FKanashiiDev%2Faf52962d2844e33de8e0bbbb11040b54%2Fraw%2Fweb-presence-stats.json&query=%24.latest&style=for-the-badge&label=Downloads%40Latest&color=green&cacheSeconds=3600" alt="Latest Release"></a>
</p>
<p align="center">

**Web Presence** is an <ins>open-source</ins> project that combines a browser extension with a lightweight desktop application to display what you’re listening to or watching on websites directly in your Discord Rich Presence. What makes it unique is its **fully customizable selector system**, which allows anyone to add support for almost any music or video site without coding, along with an advanced userscript engine for more complex integrations.

## Download

_You must install both the **browser extension** and the **desktop app** for the **discord desktop app** to work._

> If you’re only going to use Discord in your browser, there’s no need to install the desktop app.

**Browser Extension**

Required to detect music and video on supported websites and send playback data to the desktop app.

<p>
  <a href="https://chromewebstore.google.com/detail/mpnijlpiepmpgoamimfmbdmglpdjmoic" target="_blank"><img src="https://img.shields.io/badge/-Chrome%20Web%20Store-555?logo=googlechrome&logoColor=white&style=for-the-badge&label=%20&labelColor=4285F4" alt="Get it on Chrome Web Store"></a>
  <a href="https://addons.mozilla.org/en-US/firefox/addon/web-presence-for-discord/" target="_blank"><img src="https://img.shields.io/badge/-Firefox%20Addons-555?logo=firefox-browser&logoColor=white&style=for-the-badge&label=%20&labelColor=orange" alt="Get it on Firefox Add-ons"></a>
</p>

**Desktop App**

Required to communicate with Discord and display your media status in Discord Rich Presence.

<p>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-x64-installer.exe">
    <img src="https://img.shields.io/badge/Windows-Installer (x64)-0078D6?logo=windows11&logoColor=white&style=for-the-badge" alt="Windows Installer (x64)"></a>
    <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-x64.zip">
    <img src="https://img.shields.io/badge/%20-ZIP (x64)-0078D6?logo=windows11&logoColor=white&style=for-the-badge" alt="Windows ZIP (x64)">
  </a>
  <br>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-x86_64.AppImage">
    <img src="https://img.shields.io/badge/Linux-AppImage%20(x64)-FCC624?logo=linux&logoColor=black&style=for-the-badge" alt="Linux AppImage x86_64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-amd64.deb"><img src="https://img.shields.io/badge/%20-DEB%20(x64)-A81D33?logo=debian&logoColor=white&style=for-the-badge" alt="Linux DEB x64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-x86_64.rpm"><img src="https://img.shields.io/badge/%20-RPM%20(x64)-d12626?logo=redhat&logoColor=white&style=for-the-badge" alt="Linux RPM x64"></a>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-x64.pkg.tar.zst"><img src="https://img.shields.io/badge/%20-Pacman%20(x64)-1793D1?logo=arch-linux&logoColor=white&style=for-the-badge" alt="Linux Pacman x64"></a>
  <br>
  <a href="https://github.com/KanashiiDev/web-presence/releases/latest/download/web-presence-3.1.0-universal.dmg">
    <img src="https://img.shields.io/badge/macOS-DMG (Universal)-161616?logo=apple&logoColor=white&style=for-the-badge" alt="macOS DMG (Universal)"></a>
</p>

## 📚 Table of Contents

- [Features](#-features)
- [Supported Websites](#-supported-websites)
- [Compatibility](#-compatibility)
- [Setup](#-setup)
- [Troubleshooting](#-troubleshooting)
- [How to Add a New Site](#-how-to-add-a-new-site)
- [Filter Management](#-filter-management)
- [Live Activity Output](#-live-activity-output)
- [Developer Setup](#-developer-setup)
- [Contributing](#-contributing)
- [License](#-license)

## 🚀 Features

- No login required, works entirely locally
- Discord Web support
- Over 20 community-supported music, video, and radio integrations via the [Activity Library](https://github.com/KanashiiDev/web-presence-activities).
- Easy to extend - add support for almost any music and video site using the built-in selector system or userscripts
- Filter system - block or replace songs by artist/title, per-site or globally
- Both listening and watching activity support
- Live activity output - WebNowPlaying (Rainmeter & OBS), and plain text/JSON files on disk
- Cross-platform Electron desktop app (Windows / Linux / macOS)
- Automatic updates for both the browser extension and the desktop app
- Fully customizable Discord status per site - control artist, source, cover art, buttons, timestamps, and more
- Open-source and community-driven

---

## 🎵 Supported Websites & Platforms

These are the integrations available in the activity library. Additional sites can be easily added using the built-in selector system or the UserScript manager - see the [How to Add a New Site](#-how-to-add-a-new-site) section.

<table>
  <tr>
    <td><a href="https://www.youtube.com"><img src="https://www.google.com/s2/favicons?domain=youtube.com" width="15"></a> YouTube</td>
    <td><a href="https://music.youtube.com"><img src="https://www.google.com/s2/favicons?domain=music.youtube.com" width="15"></a> YouTube Music</td>
    <td><a href="https://soundcloud.com"><img src="https://www.google.com/s2/favicons?domain=soundcloud.com" width="15"></a> SoundCloud</td>
    <td><a href="https://www.deezer.com"><img src="https://www.google.com/s2/favicons?domain=deezer.com" width="15"></a> Deezer</td>
    <td><a href="https://tidal.com"><img src="https://www.google.com/s2/favicons?domain=tidal.com" width="15"></a> Tidal</td>
  </tr>
  <tr>
    <td><a href="https://www.pandora.com"><img src="https://www.google.com/s2/favicons?domain=pandora.com" width="15"></a> Pandora</td>
    <td><a href="https://music.apple.com"><img src="https://www.google.com/s2/favicons?domain=music.apple.com" width="15"></a> Apple Music</td>
    <td><a href="https://music.amazon.com"><img src="https://www.google.com/s2/favicons?domain=music.amazon.com" width="15"></a> Amazon Music</td>
    <td><a href="https://www.vk.com"><img src="https://www.google.com/s2/favicons?domain=vk.com" width="15"></a> VK</td>
    <td><a href="https://tunein.com"><img src="https://www.google.com/s2/favicons?domain=tunein.com" width="15"></a> TuneIn</td>
  </tr>
  <tr>
    <td><a href="https://www.onlineradiobox.com"><img src="https://www.google.com/s2/favicons?domain=onlineradiobox.com" width="15"></a> OnlineRadioBox</td>
    <td><a href="https://www.iheart.com"><img src="https://www.google.com/s2/favicons?domain=iheart.com" width="15"></a> iHeartRadio</td>
    <td><a href="https://www.radio.net"><img src="https://www.google.com/s2/favicons?domain=radio.net" width="15"></a> Radio.net</td>
    <td><a href="https://radio.garden"><img src="https://www.google.com/s2/favicons?domain=radio.garden" width="15"></a> Radio Garden</td>
    <td><a href="https://listen.moe"><img src="https://www.google.com/s2/favicons?domain=listen.moe" width="15"></a> Listen.moe</td>
  </tr>
  <tr>
    <td><a href="https://gensokyoradio.net"><img src="https://www.google.com/s2/favicons?domain=gensokyoradio.net" width="15"></a> Gensokyo Radio</td>
    <td><a href="https://accuRadio.com"><img src="https://www.google.com/s2/favicons?domain=accuRadio.com" width="15"></a> accuRadio</td>
    <td><a href="https://anison.fm"><img src="https://www.google.com/s2/favicons?domain=anison.fm" width="15"></a> anison.fm</td>
    <td><a href="https://asiaDreamRadio.com"><img src="https://www.google.com/s2/favicons?domain=asiaDreamRadio.com" width="15"></a> Asia Dream Radio</td>
    <td><a href="https://plaza.one"><img src="https://www.google.com/s2/favicons?domain=plaza.one" width="15"></a> Plaza One</td>
  </tr>
  <tr>
    <td><a href="https://www.bilibili.tv"><img src="https://www.google.com/s2/favicons?domain=bilibili.tv" width="15"></a> Bilibili TV</td>
    <td><a href="https://kick.com"><img src="https://www.google.com/s2/favicons?domain=kick.com" width="15"></a> Kick</td>
    <td><a href="https://www.twitch.tv"><img src="https://www.google.com/s2/favicons?domain=twitch.tv" width="15"></a> Twitch</td>
    <td><a href="https://r-a-d.io"><img src="https://www.google.com/s2/favicons?domain=r-a-d.io" width="15"></a> r/a/dio</td>
    <td><a href="https://basic.pp.ua"><img src="https://www.google.com/s2/favicons?domain=basic.pp.ua" width="15"></a> Sasalele Music Station</td>
  </tr>
</table>

---

### 🔧 Setup

1. **Install the Extension**  
   Install the browser extension and complete the initial setup.

2. **Install the Desktop App**  
   Install and run the app - it will appear in your system tray.

   _If you’re only going to use Discord in your browser, there’s no need to install the desktop app._

   **Important:** If Discord runs as administrator, Web Presence must also run as administrator.

3. **Install the Activities**  
   Install the activities from the "Activity Library", go to the website and start playing.

4. **Check Your Discord Status**  
   Open Discord and look at your status - it should now show what you're listening to!

5. **Disable on Specific Pages**  
   To disable detection on certain websites:
   - Click the extension icon (top-right of browser)
   - Toggle the switch to turn off detection for that page

---

## 💻 Compatibility

### Browser Extension

Chrome, Firefox, and Chromium-based browsers (Opera, Brave, Edge, etc.)

### Desktop App

| Platform          | Support                 | Notes                                           |
| ----------------- | ----------------------- | ----------------------------------------------- |
| **Windows 10/11** | Full support            | -                                               |
| **macOS 11+**     | Full support            | Drag app to `/Applications` before first launch |
| **Linux**         | AppImage/DEB/RPM/Pacman | See Linux-specific notes below                  |
| **Nix/NixOS**     | Nix package             | `nix profile add` or flake input                |

<details>
<summary><strong>Linux Installation Notes</strong></summary>

**Arch Linux:**  
Install via the one-shot installer script:

```bash
curl -fsSL https://raw.githubusercontent.com/KanashiiDev/web-presence/main/scripts/install-arch.sh | bash
```

Or install the `.pkg.tar.zst` package directly from [GitHub Releases](https://github.com/KanashiiDev/web-presence/releases/latest):

```bash
sudo pacman -U web-presence-<version>-x64.pkg.tar.zst
```

**NixOS / Nix:**  
Quick install without modifying your configuration:

```bash
nix profile add github:KanashiiDev/web-presence
```

Or add as a flake input for NixOS module / home-manager support:

```nix
inputs.web-presence.url = "github:KanashiiDev/web-presence";
```

**GNOME Users:**  
Enable the _AppIndicator / KStatusNotifierItem_ extension.

**Required packages on some distributions:**

```bash
sudo apt install libayatana-appindicator3-1  # Debian/Ubuntu
```

**If tray icon doesn't appear:**

- Install [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher) or run from terminal once
- On GNOME + Wayland: Switch to X11 session or enable AppIndicator support

**Auto-start note:**  
Moving the AppImage after first launch requires re-enabling "Run at Startup" in tray menu.

</details>

---

## 🐞 Troubleshooting

Having issues? Check the [Troubleshooting Guide](https://github.com/KanashiiDev/web-presence/wiki/Troubleshooting) on the Wiki.

---

## 🧩 How to Add a New Site

Want to add support for a new music or video site? See the [Adding a New Site](https://github.com/KanashiiDev/web-presence/wiki/Adding-a-New-Website) guide on the Wiki.

---

## 📚 Filter Management

Learn how to block or replace activity in the [Filter Management](https://github.com/KanashiiDev/web-presence/wiki/Filter-Management) guide on the Wiki.

---

## 📤 Live Activity Output

Rainmeter, OBS, and file output setup is covered in the [Live Activity Output](https://github.com/KanashiiDev/web-presence/wiki/Live-Activity-Output) guide on the Wiki.

---

## 💻 Developer Setup

For build instructions and NPM scripts, see the [Developer Setup](https://github.com/KanashiiDev/web-presence/wiki/Developer-Setup) guide on the Wiki.

---

## 🧱 Built With

### Core Framework

- **[Electron](https://github.com/electron/electron)** - Cross-platform desktop application framework
- **[Electron Builder](https://github.com/electron-userland/electron-builder)** - Complete solution for packaging and distributing Electron applications

### System & Services

- **[Node.js](https://nodejs.org/)** - JavaScript runtime powering the backend services and build tooling
- **[Express](https://github.com/expressjs/express)** - Lightweight web server used for local RPC and extension communication
- **[cors](https://github.com/expressjs/cors)** - Middleware for enabling Cross-Origin Resource Sharing
- **[electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater)** - Auto-update solution for Electron applications
- **[electron-log](https://github.com/megahertz/electron-log)** - Persistent logging for Electron applications
- **[simple-json-db](https://github.com/nmaggioni/Simple-JSONdb)** - Lightweight JSON-based local storage for configuration and state

### Discord Integration

- **[@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc)** - Discord Rich Presence client implementation

### UI Components

- **[CodeMirror](https://github.com/codemirror/codemirror5)** - In-browser code editor for advanced scripting
- **[SimpleBar](https://github.com/Grsmto/simplebar)** - Custom, cross-browser scrollbars
- **[Flatpickr](https://github.com/flatpickr/flatpickr)** - Lightweight date and time picker

### Build & Packaging

- **[Archiver](https://github.com/archiverjs/node-archiver)** - ZIP archive generation
- **[PostCSS](https://github.com/postcss/postcss)** & **[Autoprefixer](https://github.com/postcss/autoprefixer)** - CSS processing and automatic vendor prefixing
- **[Acorn](https://github.com/acornjs/acorn)** - JavaScript parser
- **[Pako](https://github.com/nodeca/pako)** - High-performance compression library

---

## 🤝 Contributing

You can contribute in several ways:

- **Create new Activities** - [Activity Library](https://github.com/KanashiiDev/web-presence-activities)
- **Help translate** the project on [Crowdin](https://crowdin.com/project/web-presence)
- **Report bugs or request features** via [GitHub Issues](https://github.com/kanashiiDev/web-presence/issues)
- **Support the project** by sharing it and helping others discover it

---

## 📄 License

This project is licensed under the MIT License. See the [`LICENSE`](LICENSE) file for details.
