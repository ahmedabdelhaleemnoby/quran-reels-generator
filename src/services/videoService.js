const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const PImage = require('pureimage');

const OUTPUT_DIR = path.join(__dirname, '../../output');
const TEMP_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

/**
 * Validates if ffmpeg is available
 */
const validateTools = async () => {
    return new Promise((resolve) => {
        ffmpeg.getAvailableFormats((err, formats) => {
            resolve(!err);
        });
    });
};

/**
 * Downloads a file from a URL
 */
const downloadFile = async (url, dest) => {
    const writer = fs.createWriteStream(dest);
    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 120000 // 120 seconds timeout (increased from 30s)
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

/**
 * Creates a text overlay image using pureimage
 */
const createTextOverlay = async (text, outputPath) => {
    const width = 1080;
    const height = 1920;
    const img = PImage.make(width, height);
    const ctx = img.getContext('2d');

    // Use system font - Arial
    const fontPath = '/System/Library/Fonts/Supplemental/Arial.ttf';
    if (fs.existsSync(fontPath)) {
        const font = PImage.registerFont(fontPath, 'Arial');
        await new Promise((resolve) => font.load(() => resolve()));
        ctx.font = "60pt 'Arial'";
    } else {
        ctx.font = "60pt sans-serif";
    }

    // Background (transparent)
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, width, height);

    // Text Setup
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';

    // Simple text rendering
    const lines = text.split('\n');
    let y = height / 2 - (lines.length * 40);
    lines.forEach(line => {
        ctx.fillText(line, width / 2, y);
        y += 100;
    });

    await PImage.encodePNGToStream(img, fs.createWriteStream(outputPath));
};

/**
 * Processes the video generation
 */
const generateReel = async (options) => {
    const { reciterId, surahNumber, fromAyah, toAyah, ayahs, backgroundPath: customBackgroundPath } = options;
    const timestamp = Date.now();
    const finalOutputPath = path.join(OUTPUT_DIR, `reel_${timestamp}.mp4`);
    
    // 1. Download audio files
    const audioFiles = [];
    for (const ayah of ayahs) {
        const audioUrl = `https://www.everyayah.com/data/${reciterId}/${String(surahNumber).padStart(3, '0')}${String(ayah.numberInSurah).padStart(3, '0')}.mp3`;
        const audioPath = path.join(TEMP_DIR, `audio_${timestamp}_${ayah.numberInSurah}.mp3`);
        await downloadFile(audioUrl, audioPath);
        audioFiles.push(audioPath);
    }

    // Combine audio using fluent-ffmpeg
    const combinedAudioPath = path.join(TEMP_DIR, `combined_${timestamp}.mp3`);
    const ffmpegCombine = ffmpeg();
    audioFiles.forEach(file => ffmpegCombine.input(file));
    
    await new Promise((resolve, reject) => {
        ffmpegCombine
            .on('error', reject)
            .on('end', resolve)
            .mergeToFile(combinedAudioPath, TEMP_DIR);
    });

    // 2. Prepare Background
    let backgroundPath = customBackgroundPath;
    
    // If custom background is provided, convert to video
    if (backgroundPath && fs.existsSync(backgroundPath)) {
        console.log('Using custom background:', backgroundPath);
        
        // Check if it's already a video
        const ext = path.extname(backgroundPath).toLowerCase();
        if (ext === '.jpg' || ext === '.png' || ext === '.jpeg') {
            // Convert image to video
            const videoBackgroundPath = path.join(TEMP_DIR, `bg_video_${timestamp}.mp4`);
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(backgroundPath)
                    .loop(60)
                    .outputOptions([
                        '-pix_fmt yuv420p',
                        '-t 60',
                        '-vf scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
                    ])
                    .save(videoBackgroundPath)
                    .on('end', () => {
                        console.log('Background image converted to video');
                        resolve();
                    })
                    .on('error', reject);
            });
            backgroundPath = videoBackgroundPath;
        }
    } else {
        // Create black background image using pureimage
        console.log('No custom background, using default black');
        const bgImagePath = path.join(TEMP_DIR, `bg_${timestamp}.png`);
        const bgImg = PImage.make(1080, 1920);
        const bgCtx = bgImg.getContext('2d');
        bgCtx.fillStyle = '#000000';
        bgCtx.fillRect(0, 0, 1080, 1920);
        await PImage.encodePNGToStream(bgImg, fs.createWriteStream(bgImagePath));
        
        // Convert image to video
        backgroundPath = path.join(TEMP_DIR, `bg_gen_${timestamp}.mp4`);
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(bgImagePath)
                .loop(60)
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-t 60'
                ])
                .save(backgroundPath)
                .on('end', resolve)
                .on('error', reject);
        });
    }

    // 3. Create text overlays
    const fullText = ayahs.map(a => a.text).join('\n\n');
    const overlayPath = path.join(TEMP_DIR, `overlay_${timestamp}.png`);
    await createTextOverlay(fullText, overlayPath);

    // 4. Final Assembly
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(backgroundPath)
            .inputOptions(['-stream_loop -1']) 
            .input(combinedAudioPath)
            .input(overlayPath)
            .complexFilter([
                '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg]',
                '[bg][2:v]overlay=0:0[vout]'
            ])
            .outputOptions([
                '-map [vout]',
                '-map 1:a',
                '-shortest' 
            ])
            .output(finalOutputPath)
            .on('end', () => resolve(finalOutputPath))
            .on('error', (err) => {
                console.error('Final FFmpeg Error:', err);
                reject(err);
            })
            .run();
    });
};

module.exports = {
    validateTools,
    generateReel
};
