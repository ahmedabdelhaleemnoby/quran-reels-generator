# Quran Reels Generator 🎬

A local web application for generating beautiful Quranic video reels with synchronized audio and Arabic text overlays.

## ✨ Features

- 📖 Generate video reels for any Quranic verses (Ayahs)
- 🎙️ Multiple renowned reciters to choose from
- 🎨 Customizable backgrounds (or fallback to solid color)
- 🔤 Arabic text overlays with proper rendering
- 🌐 Fully RTL (Right-to-Left) user interface
- 💾 Local processing - no cloud dependencies

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v14 or higher)
- **FFmpeg** - for video processing
- **macOS** (currently optimized for Mac)

### Installation

1. **Install system dependencies**:
   ```bash
   brew install ffmpeg
   ```

2. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   node server.js
   ```

4. **Open your browser**:
   Navigate to [http://localhost:3005](http://localhost:3005)

## 📁 Project Structure

```
quran-reels-generator/
├── public/              # Frontend assets
│   ├── index.html      # Main UI
│   ├── style.css       # RTL-optimized styling
│   └── script.js       # Frontend logic
├── src/
│   ├── controllers/    # API controllers
│   ├── services/       # Business logic (Quran, Video)
│   └── routes/         # API routes
├── output/             # Generated videos
├── uploads/            # Temporary files
└── server.js           # Express server
```

## 🎯 Usage

1. **Select a Reciter** from the dropdown
2. **Choose a Surah** (Chapter)
3. **Specify Ayah Range** (From - To)
4. **Click "Generate Video"** and wait for processing
5. **Preview and Download** your generated reel

## 🛡️ Technologies

- **Backend**: Node.js, Express.js
- **Video Processing**: FFmpeg, fluent-ffmpeg
- **Text Rendering**: pureimage
- **APIs**: 
  - [AlQuran Cloud API](https://alquran.cloud) - Quranic text
  - [EveryAyah](https://everyayah.com) - Audio recitations

## 📝 Notes

- Videos are generated at 1080x1920 (vertical format for Reels/Stories)
- Default background is solid black if no custom background is provided
- All processing happens locally on your machine
- Generated videos are saved in the `output/` directory

## 🐛 Known Issues

- Arabic text rendering currently uses system Arial font
- For best results, ensure stable internet connection for API calls

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## 📄 License

ISC

## 👨‍💻 Author

Ahmed Abu Zyad

---

**Made with ❤️ for the Quran**
