const quranService = require('../services/quranService');
const videoService = require('../services/videoService');
const path = require('path');
const fs = require('fs');

const generateVideo = async (req, res) => {
    try {
        const { reciterId, surahNumber, fromAyah, toAyah, backgroundData } = req.body;

        if (!reciterId || !surahNumber || !fromAyah || !toAyah) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // 1. Fetch ayahs text
        const ayahs = await quranService.getAyahs(surahNumber, fromAyah, toAyah);
        
        // 2. Determine background - handle base64 image if provided
        let backgroundPath = null;
        
        // Check if user uploaded a background (base64)
        if (backgroundData && backgroundData.includes('base64,')) {
            console.log('Received background image data');
            const timestamp = Date.now();
            const matches = backgroundData.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
                const ext = matches[1];
                const base64Data = matches[2];
                const bgFileName = `bg_upload_${timestamp}.${ext}`;
                backgroundPath = path.resolve(path.join(__dirname, '../../uploads', bgFileName));
                fs.writeFileSync(backgroundPath, Buffer.from(base64Data, 'base64'));
                console.log('Saved uploaded background to:', backgroundPath);
            } else {
                console.warn('Invalid base64 image format received');
            }
        } else {
            // Fallback to default backgrounds directory
            const bgDir = path.resolve(path.join(__dirname, '../../public/assets/backgrounds'));
            console.log('Checking default backgrounds in:', bgDir);
            if (fs.existsSync(bgDir)) {
                const files = fs.readdirSync(bgDir);
                const bgFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.jpg') || f.endsWith('.png'));
                if (bgFile) {
                    backgroundPath = path.join(bgDir, bgFile);
                    console.log('Using default background found:', backgroundPath);
                }
            } else {
                console.log('Default backgrounds directory not found');
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
