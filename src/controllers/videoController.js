const quranService = require('../services/quranService');
const videoService = require('../services/videoService');
const path = require('path');
const fs = require('fs');

const generateVideo = async (req, res) => {
    try {
        const { reciterId, surahNumber, fromAyah, toAyah, backgroundId } = req.body;

        if (!reciterId || !surahNumber || !fromAyah || !toAyah) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // 1. Fetch ayahs text
        const ayahs = await quranService.getAyahs(surahNumber, fromAyah, toAyah);
        
        // 2. Determine background
        let backgroundPath = null;
        const bgDir = path.join(__dirname, '../../public/assets/backgrounds');
        if (fs.existsSync(bgDir)) {
            const files = fs.readdirSync(bgDir);
            const bgFile = files.find(f => f.endsWith('.mp4'));
            if (bgFile) {
                backgroundPath = path.join(bgDir, bgFile);
            }
        }

        // 3. Generate Video
        const videoPath = await videoService.generateReel({
            reciterId,
            surahNumber,
            fromAyah,
            toAyah,
            ayahs,
            backgroundPath
        });

        res.json({
            success: true,
            videoUrl: `/output/${path.basename(videoPath)}`
        });

    } catch (error) {
        console.error('Generation Error:', error);
        res.status(500).json({ error: 'Failed to generate video: ' + error.message });
    }
};

const getInitialData = async (req, res) => {
    try {
        const surahs = await quranService.getSurahs();
        res.json({
            reciters: quranService.reciters,
            surahs
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch initial data' });
    }
};

module.exports = {
    generateVideo,
    getInitialData
};
